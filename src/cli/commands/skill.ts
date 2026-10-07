import type { Arguments } from 'yargs';

import { getSkillsBaseUrl } from '@shared/constants';
import { fetchSkillMenu } from '@shared/skill-menu';
import { analytics } from '@utils/analytics';
import { listSkills } from '@tools';
import { exitWith } from '@cli/runners';

import { runSkillMode } from './basic-integration/skill';
import { skillProgramOptions } from './skill-program-options';
import { runCommandHandler } from './factories/shared';
import type { Command } from './command';

/** Read the `<skill-name>` positional (yargs camelCases the hyphenated key). */
function readSkillName(argv: Arguments): string {
  return String(argv.skillName ?? argv['skill-name'] ?? '').trim();
}

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
  // the old --skill flag gave.
  check: (argv) => {
    if (!readSkillName(argv)) {
      throw new Error(
        'skill needs a skill name, e.g. `wizard skill audit-events`',
      );
    }
    return true;
  },
  handler: (argv) => {
    // `list` is the positional's one reserved value, not a skill id.
    if (readSkillName(argv) === 'list') return exitWith(listSkills);
    runCommandHandler(async () => {
      const skillName = readSkillName(argv);
      await assertSkillExists(skillName);
      // runSkillMode reads `argv.skill`; bridge the positional onto it.
      runSkillMode({ ...argv, skill: skillName });
    });
  },
};
