import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { IS_PRODUCTION_BUILD } from '@env';
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
  telemetry: {
    default: true,
    describe:
      'Send wizard run state to PostHog (pass --no-telemetry to disable)\nenv: POSTHOG_WIZARD_TELEMETRY',
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
    let cli = yargs(hideBin(process.argv))
      .env('POSTHOG_WIZARD')
      .options(GLOBAL_OPTIONS);

    // CI mode (--ci) is only supported in dev/test. It is left undeclared in
    // published builds (NODE_ENV==='production'), so .strictOptions() rejects
    // it there as an unknown argument — exactly like any other unrecognized
    // flag. init() additionally detects it up front to print a clearer message.
    if (!IS_PRODUCTION_BUILD) {
      cli = cli.option('ci', {
        default: false,
        describe:
          'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
        type: 'boolean',
      });
    }

    this.cli = cli
      .strictOptions()
      // Print the error first (bright red) and the usage below it, instead of
      // yargs' default of burying the message under the full help output.
      .fail((msg, err, parser) => {
        const text = msg || (err && err.message) || 'Invalid arguments';
        process.stderr.write(`\n\x1b[1;91m✖ ${text}\x1b[0m\n\n`);
        parser.showHelp();
        process.exit(1);
      })
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
    // In published builds, `--ci` is undeclared, so yargs would reject it as
    // an unknown argument — accurate but unhelpful, since --help doesn't list
    // --ci either and the user has no path forward. POSTHOG_WIZARD_CI silently
    // no-ops for the same reason (yargs only resolves env vars for declared
    // options). Detect both up front and exit with a message that explains why.
    if (IS_PRODUCTION_BUILD) {
      const args = process.argv.slice(2);
      const argvHasCI = args.some(
        (a) => a === '--ci' || a === '--no-ci' || a.startsWith('--ci='),
      );
      const envHasCI =
        process.env.POSTHOG_WIZARD_CI != null &&
        process.env.POSTHOG_WIZARD_CI !== '';
      if (argvHasCI || envHasCI) {
        process.stderr.write(
          `\n\x1b[1;91m✖ CI mode is not currently supported in published builds.\x1b[0m\n\n`,
        );
        process.exit(1);
      }
    }
    void this.cli.wrap(process.stdout.isTTY ? this.cli.terminalWidth() : 80)
      .argv;
  }
}
