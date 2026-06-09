import { runSkillMode } from './basic-integration/skill';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

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
  handler: (argv) => {
    const skillName = String(argv.skillName ?? argv['skill-name'] ?? '').trim();
    // runSkillMode reads `argv.skill`; bridge the positional onto it.
    runSkillMode({ ...argv, skill: skillName });
  },
};
