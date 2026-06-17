import type { Arguments } from 'yargs';

import { getSkillsBaseUrl } from '@lib/constants';
import { fetchSkillMenu, type CliEntry } from '@lib/wizard-tools';
import { analytics } from '@utils/analytics';

import { runSkillMode } from './basic-integration/skill';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

/** Read the `<skill-name>` positional (yargs camelCases the hyphenated key). */
function readSkillName(argv: Arguments): string {
  return String(argv.skillName ?? argv['skill-name'] ?? '').trim();
}

const BROWSABLE_ROLES: ReadonlySet<CliEntry['role']> = new Set([
  'command',
  'skill',
]);

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
  handler: (argv) => {
    void (async () => {
      const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
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
    })();
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
  // yargs already enforces the `<skill-name>` positional, but an
  // explicitly-empty value (`wizard skill ""`) would otherwise slip
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
    // runSkillMode reads `argv.skill`; bridge the positional onto it.
    runSkillMode({ ...argv, skill: readSkillName(argv) });
  },
};
