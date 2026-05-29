import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { toCommandModule, type Command } from './commands/command';

/**
 * Global yargs options applied to every command. These are read from the
 * `POSTHOG_WIZARD` env prefix as well as flags.
 */
export const GLOBAL_OPTIONS = {
  debug: {
    default: false,
    describe: 'Enable verbose logging\nenv: POSTHOG_WIZARD_DEBUG',
    type: 'boolean' as const,
  },
  region: {
    describe: 'PostHog cloud region\nenv: POSTHOG_WIZARD_REGION',
    choices: ['us', 'eu'] as const,
    type: 'string' as const,
  },
  signup: {
    default: false,
    describe:
      'Create a new PostHog account during setup\nenv: POSTHOG_WIZARD_SIGNUP',
    type: 'boolean' as const,
  },
  'local-mcp': {
    default: false,
    describe:
      'Use local MCP server at http://localhost:8787/mcp\nenv: POSTHOG_WIZARD_LOCAL_MCP',
    type: 'boolean' as const,
  },
  ci: {
    default: false,
    describe:
      'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
    type: 'boolean' as const,
  },
  'api-key': {
    describe:
      'PostHog personal API key (phx_xxx) for authentication\nenv: POSTHOG_WIZARD_API_KEY',
    type: 'string' as const,
  },
  'project-id': {
    describe:
      'PostHog project ID to use (optional; when not set, uses default from API key or OAuth)\nenv: POSTHOG_WIZARD_PROJECT_ID',
    type: 'string' as const,
  },
  email: {
    describe:
      'Email address for signup (used with --signup)\nenv: POSTHOG_WIZARD_EMAIL',
    type: 'string' as const,
  },
};

export class Wizard {
  private cli: Argv;

  private constructor() {
    this.cli = yargs(hideBin(process.argv))
      .env('POSTHOG_WIZARD')
      .options(GLOBAL_OPTIONS)
      .help()
      .alias('help', 'h')
      .version()
      .alias('version', 'v');
  }

  /** Start a chain; equivalent to `new Wizard().use(...cmds)`. */
  static use(...cmds: Command[]): Wizard {
    return new Wizard().use(...cmds);
  }

  /** Register one or more commands with yargs. */
  use(...cmds: Command[]): this {
    for (const cmd of cmds) {
      this.cli = this.cli.command(toCommandModule(cmd, []));
    }
    return this;
  }

  /** Parse argv and dispatch to the matching registered command. */
  init(): void {
    void this.cli.wrap(process.stdout.isTTY ? this.cli.terminalWidth() : 80)
      .argv;
  }
}
