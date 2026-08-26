import type { Arguments } from 'yargs';

import { getSkillsBaseUrl } from '@lib/constants';
import { fetchSkillMenu, type CliEntry } from '@lib/wizard-tools';
import { analytics } from '@utils/analytics';

import { runSkillMode } from './basic-integration/skill';
import { skillProgramOptions } from './skill-program-options';
import { runCommandHandler } from './factories/shared';
import { ErrorCodes } from '@lib/errors';
import { emitPhwError } from '@lib/errors';
import type { Command } from './command';

/** Read the `<skill-name>` positional (yargs camelCases the hyphenated key). */
function readSkillName(argv: Arguments): string {
  return String(argv.skillName ?? argv['skill-name'] ?? '').trim();
}

const BROWSABLE_ROLES: ReadonlySet<CliEntry['role']> = new Set([
  'command',
  'skill',
]);

/**
 * Reject an unknown skill id before the wizard authenticates.
 *
 * Without this, `readSkillName` accepts any non-empty string and the name is
 * only validated far downstream, when the agent tries to download it — after
 * the user has already logged in. A typo then costs a full auth round-trip
 * (the concern raised in review). We resolve against the same set
 * `downloadSkill` uses (`categories` flattened by `id`), so this never
 * false-rejects a skill the download would have accepted.
 *
 * If the registry is unreachable we stay silent and defer to the download
 * step's own `menu-fetch-failed` handling, rather than adding a second network
 * dependency that could block an otherwise-valid run.
 */
async function assertSkillExists(skillName: string): Promise<void> {
  const skillsBaseUrl = getSkillsBaseUrl();
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return; // registry down — let the download step surface it
  const known = Object.values(menu.categories)
    .flat()
    .some((s) => s.id === skillName);
  if (known) return;
  analytics.wizardCapture('cli dispatch error', {
    reason: 'unknown skill',
    family: 'skill',
    sub: skillName,
    skillsBaseUrl,
  });
  try {
    await analytics.flush();
  } catch {
    /* best-effort */
  }
  throw new Error(
    `Unknown skill "${skillName}". Run \`wizard skill list\` to see available skills.`,
  );
}

function formatEntry(entry: CliEntry): string {
  const path = entry.parentCommand
    ? `wizard ${entry.parentCommand} ${entry.command}`
    : entry.command
    ? `wizard ${entry.command}`
    : `wizard skill ${entry.skillId}`;
  return `  ${entry.skillId.padEnd(38)}  ${path.padEnd(36)}  ${
    entry.description
  }`;
}

/**
 * `wizard skill list` — fetch and print every browsable skill in the catalog.
 *
 * Reads the live `skill-menu.json` so new skills appear immediately after a
 * context-mill release. `internal` skills are excluded from the listing.
 */
const listCommand: Command = {
  name: 'list',
  description: 'List every browsable skill in the catalog',
  handler: () => {
    runCommandHandler(async () => {
      const skillsBaseUrl = getSkillsBaseUrl();
      const menu = await fetchSkillMenu(skillsBaseUrl);
      if (!menu) {
        analytics.wizardCapture('cli dispatch error', {
          reason: 'registry unreachable',
          family: 'skill',
          sub: 'list',
          skillsBaseUrl,
        });
        try {
          await analytics.flush();
        } catch {
          /* best-effort */
        }
        process.stderr.write(
          `\n\x1b[1;91m✖ Couldn't reach the skill registry.\x1b[0m\n` +
            `  Check your network connection and try again.\n\n`,
        );
        emitPhwError({
          code: ErrorCodes.SkillMenuFetchFailed,
          message: "Couldn't reach the skill registry.",
        });
        process.exit(1);
      }
      const entries = (menu.cliEntries ?? []).filter((e) =>
        BROWSABLE_ROLES.has(e.role),
      );
      if (entries.length === 0) {
        process.stdout.write('No skills found.\n');
        return;
      }
      process.stdout.write(
        `${entries.length} skill${entries.length === 1 ? '' : 's'}:\n`,
      );
      process.stdout.write(
        `  ${'SKILL ID'.padEnd(38)}  ${'COMMAND'.padEnd(36)}  DESCRIPTION\n`,
      );
      for (const entry of entries) {
        process.stdout.write(`${formatEntry(entry)}\n`);
      }
    });
  },
};

/**
 * `wizard skill <skill-name>` — run a single context-mill skill by id.
 * `wizard skill list`         — list every browsable skill in the catalog.
 *
 * Replaces the old `--skill=<id>` flag on the default command. The skill id
 * is fetched from context-mill's release at runtime (same mechanism the flag
 * used), so any published skill id works. Pass `--ci` to run headlessly.
 */
export const skillCommand: Command = {
  name: 'skill <skill-name>',
  description: 'Run a specific context-mill skill by name (or `list` them)',
  children: [listCommand],
  options: {
    ...skillProgramOptions,
  },
  // Under `.strictOptions()` yargs rejects a positional declared only in the
  // command string as an "Unknown argument" — it has to be registered via
  // `.positional()` too (see the `positionals` note on the Command interface).
  // Declare `skill-name` here so `wizard skill <id>` actually accepts its value.
  positionals: {
    'skill-name': {
      type: 'string',
      describe: 'Skill id to run (e.g. audit-events), or `list`',
    },
  },
  // yargs already enforces the presence of the `<skill-name>` positional, but
  // an explicitly-empty value (`wizard skill ""`) would otherwise slip
  // through to a broken run. Reject it with the same friendly message
  // the old --skill flag gave. When `wizard skill list` matched the
  // child instead, yargs leaves the positional unset — the `null` guard
  // keeps the check from rejecting that route.
  check: (argv) => {
    if (argv.skillName == null && argv['skill-name'] == null) return true;
    if (!readSkillName(argv)) {
      throw new Error(
        'skill needs a skill name, e.g. `wizard skill audit-events`',
      );
    }
    return true;
  },
  handler: (argv) => {
    runCommandHandler(async () => {
      const skillName = readSkillName(argv);
      await assertSkillExists(skillName);
      // runSkillMode reads `argv.skill`; bridge the positional onto it.
      runSkillMode({ ...argv, skill: skillName });
    });
  },
};
