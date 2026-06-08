import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { IS_PRODUCTION_BUILD, wizardEnvBool, wizardEnvDefault } from '@env';
import { toCommandModule, type Command } from './commands/command';

/**
 * Global yargs options applied to every command. In dev/CI each can also be set
 * via a `WIZARD_<NAME>` env var (wired as the option's `default`, e.g.
 * `WIZARD_API_KEY` backs `--api-key`); `wizardEnvDefault`/`wizardEnvBool` return
 * undefined/the fallback in published builds, so the shipped package is driven
 * through flags only. The `env:` lines below document the dev/CI env-var form.
 */
export const GLOBAL_OPTIONS = {
  debug: {
    default: wizardEnvBool('DEBUG', false),
    describe: 'Enable verbose logging\nenv: WIZARD_DEBUG',
    type: 'boolean' as const,
  },
  region: {
    ...wizardEnvDefault('REGION'),
    describe: 'PostHog cloud region\nenv: WIZARD_REGION',
    choices: ['us', 'eu'] as const,
    type: 'string' as const,
  },
  signup: {
    default: wizardEnvBool('SIGNUP', false),
    describe: 'Create a new PostHog account during setup\nenv: WIZARD_SIGNUP',
    type: 'boolean' as const,
  },
  'local-mcp': {
    default: wizardEnvBool('LOCAL_MCP', false),
    describe:
      'Use local MCP server at http://localhost:8787/mcp\nenv: WIZARD_LOCAL_MCP',
    type: 'boolean' as const,
  },
  telemetry: {
    default: wizardEnvBool('TELEMETRY', true),
    describe:
      'Send wizard run state to PostHog (pass --no-telemetry to disable)\nenv: WIZARD_TELEMETRY',
    type: 'boolean' as const,
  },
  'api-key': {
    ...wizardEnvDefault('API_KEY'),
    describe:
      'PostHog personal API key (phx_xxx) for authentication\nenv: WIZARD_API_KEY',
    type: 'string' as const,
  },
  'project-id': {
    ...wizardEnvDefault('PROJECT_ID'),
    describe:
      'PostHog project ID to use (optional; when not set, uses default from API key or OAuth)\nenv: WIZARD_PROJECT_ID',
    type: 'string' as const,
  },
  email: {
    ...wizardEnvDefault('EMAIL'),
    describe:
      'Email address for signup (used with --signup)\nenv: WIZARD_EMAIL',
    type: 'string' as const,
  },
};

export class Wizard {
  private cli: Argv;

  private constructor() {
    let cli = yargs(hideBin(process.argv)).options(GLOBAL_OPTIONS);

    // `--ci` is dev/CI-only and left out of published builds
    // (NODE_ENV==='production') because CI mode isn't supported there. Without
    // the option declared, .strictOptions() rejects `--ci` as an unknown
    // argument — exactly like any other unrecognized flag. init() additionally
    // detects it up front to print a clearer message. The `WIZARD_*` env
    // overrides are wired per-option via `default` (see GLOBAL_OPTIONS and the
    // command options), not yargs' `.env()` prefix — see src/env.ts for why.
    if (!IS_PRODUCTION_BUILD) {
      cli = cli.option('ci', {
        default: wizardEnvBool('CI', false),
        describe:
          'Enable CI mode for non-interactive execution\nenv: WIZARD_CI',
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
    // --ci either and the user has no path forward. WIZARD_CI silently no-ops
    // for the same reason (its `default` helper returns false in published
    // builds). Detect both up front and exit with a message that explains why.
    if (IS_PRODUCTION_BUILD) {
      const args = process.argv.slice(2);
      const argvHasCI = args.some(
        (a) => a === '--ci' || a === '--no-ci' || a.startsWith('--ci='),
      );
      const envHasCI =
        process.env.WIZARD_CI != null && process.env.WIZARD_CI !== '';
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
