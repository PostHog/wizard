import { getSubcommandPrograms } from '@lib/programs/program-registry';
import { runWizard, runWizardCI } from '@lib/runners';
import type { WizardCommand } from '../wizard';

/** Shared yargs options for skill-based program commands. */
const skillProgramOptions = {
  debug: {
    default: false,
    describe: 'Enable verbose logging',
    type: 'boolean' as const,
  },
  'install-dir': {
    describe: 'Directory to install in',
    type: 'string' as const,
  },
  'local-mcp': {
    default: false,
    describe: 'Use local MCP server',
    type: 'boolean' as const,
  },
  benchmark: {
    default: false,
    describe: 'Run in benchmark mode',
    type: 'boolean' as const,
  },
  'yara-report': {
    default: false,
    describe: 'Print YARA scanner summary',
    type: 'boolean' as const,
    hidden: true,
  },
};

/**
 * A `WizardCommand` for every program in the registry that exposes a
 * `command` field. The registry stays the single source of truth — adding
 * a new skill-based program automatically surfaces a new command here.
 *
 * A function, not a module-level const, so importing this file does not
 * eagerly evaluate the registry (which pulls in every program's React/Ink
 * deps). Only bin.ts calls it.
 */
export function getProgramCommands(): WizardCommand[] {
  return getSubcommandPrograms().map((programConfig) => ({
    name: programConfig.command,
    description: programConfig.description,
    options: {
      ...skillProgramOptions,
      ...(programConfig.cliOptions ?? {}),
    },
    handler: (argv) => {
      const extras =
        programConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
      const options = { ...argv, ...extras };
      if (options.ci) {
        runWizardCI(programConfig, options);
      } else {
        runWizard(programConfig, options);
      }
    },
  }));
}
