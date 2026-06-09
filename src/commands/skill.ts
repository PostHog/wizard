import type { Arguments } from 'yargs';
import { runSkillMode } from './basic-integration/skill';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

/** Read the `<skill-name>` positional (yargs camelCases the hyphenated key). */
function readSkillName(argv: Arguments): string {
  return String(argv.skillName ?? argv['skill-name'] ?? '').trim();
}

/**
 * `wizard skill <skill-name>` — run a single context-mill skill by id.
 *
 * Replaces the old `--skill=<id>` flag on the default command. The skill id
 * is fetched from context-mill's release at runtime (same mechanism the flag
 * used), so any published skill id works. Pass `--ci` to run headlessly.
 */
export const skillCommand: Command = {
  name: 'skill <skill-name>',
  description: 'Run a specific context-mill skill by name',
  options: {
    ...skillProgramOptions,
  },
  // yargs already requires the positional, but an explicitly-empty value
  // (`wizard skill ""`) would otherwise slip through to a broken run with no
  // skill id. Reject it with the same friendly message the old flag gave.
  check: (argv) => {
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
