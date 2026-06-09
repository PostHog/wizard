import type { ProgramConfig } from '@lib/programs/program-step';
import type { CliManifestEntry } from '@lib/programs/cli-manifest.generated';

import type { Command } from '../command';

import { dispatchProgram, mergeCommandOptions } from './shared';

export interface SkillCommandFactoryOpts {
  /** Subcommands nested under this command. */
  children?: readonly Command[];
}

/**
 * Build a yargs `Command` from a context-mill manifest entry plus the
 * wizard-side `ProgramConfig` that supplies the runner mechanics.
 *
 * The manifest entry owns the user-visible bits — command name, description,
 * role, skill id — while `ProgramConfig` supplies the run mechanics
 * (steps, hooks, content blocks, options). Each side stays responsible for
 * what it knows best: context-mill curates the CLI surface, wizard owns
 * execution.
 *
 * The entry's `skillId` shadows the base config's `skillId` at dispatch
 * time, so one shared config (e.g. the generic `agent-skill` program) can
 * back many manifest entries by skill id.
 *
 * Only `role: 'command'` entries become commands. `skill` and `internal`
 * entries are reachable through different paths (`wizard skill <id>`,
 * `--skill=<id>`) and throw if passed here.
 */
export function skillCommandFactory(
  entry: CliManifestEntry,
  config: ProgramConfig,
  opts: SkillCommandFactoryOpts = {},
): Command {
  if (entry.role !== 'command') {
    throw new Error(
      `skillCommandFactory: entry "${entry.skillId}" has role "${entry.role}" — only "command" entries become commands`,
    );
  }
  if (!entry.command) {
    throw new Error(
      `skillCommandFactory: entry "${entry.skillId}" is missing \`command\` — context-mill must declare a name for every command entry`,
    );
  }
  const dispatchConfig: ProgramConfig = {
    ...config,
    skillId: entry.skillId,
  };
  return {
    name: entry.command,
    description: entry.description,
    options: mergeCommandOptions(dispatchConfig),
    children: opts.children,
    handler: (argv) => dispatchProgram(dispatchConfig, argv),
    // The manifest's `recommended` flag feeds the family picker's `default`
    // (pre-highlighted) slot — two different names, one bridge.
    default: entry.recommended,
  };
}
