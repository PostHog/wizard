import type { ProgramConfig } from '@lib/programs/program-step';

import type { Command } from '../command';

import { dispatchProgram, mergeCommandOptions } from './shared';

export interface NativeCommandFactoryOpts {
  /** Subcommands nested under this command. */
  children?: readonly Command[];
}

/**
 * Build a yargs `Command` from a wizard-native `ProgramConfig`.
 *
 * Collapses the previously duplicated boilerplate (read `config.command`,
 * merge skill-program flags with program-specific options, dispatch via
 * `runWizard` / `runWizardCI`) into a single call.
 */
export function nativeCommandFactory(
  config: ProgramConfig,
  opts: NativeCommandFactoryOpts = {},
): Command {
  if (!config.command) {
    throw new Error(
      `nativeCommandFactory: program "${config.id}" has no \`command\` — wizard-native programs must declare a CLI name`,
    );
  }
  return {
    name: config.command,
    description: config.description,
    options: mergeCommandOptions(config),
    children: opts.children,
    handler: (argv) => dispatchProgram(config, argv),
  };
}
