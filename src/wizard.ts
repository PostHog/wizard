import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { IS_PRODUCTION_BUILD } from '@env';
import { HEADLESS_FLAG } from '@lib/headless-mode';
import { Harness, Sequence } from '@lib/constants';
import { toCommandModule, type Command } from './commands/command';

/**
 * Global yargs options applied to every command. These are read from the
 * `POSTHOG_WIZARD` env prefix as well as flags.
 *
 * Options with `hidden: true` are "internal modes" — they don't show up in
 * `--help` but are still accepted on every command. The catalog of internal
 * flags and what each one does lives in CONTRIBUTING.md.
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
  // ── Internal modes ─────────────────────────────────────────────────
  // Hidden from `--help`. See CONTRIBUTING.md for what each one does.
  [HEADLESS_FLAG]: {
    default: false,
    // EXPERIMENTAL + UNSTABLE: the non-interactive published-build run path.
    // Declared unconditionally (unlike --ci) so it works in the shipped
    // package, but hidden and intentionally ugly-named — the contract may
    // break without notice, so it must not be advertised. See @lib/headless-mode.
    describe:
      'EXPERIMENTAL — do not use. Unstable, subject to breaking changes.',
    type: 'boolean' as const,
    hidden: true,
  },
  'local-mcp': {
    default: false,
    describe:
      'Use local MCP server at http://localhost:8787/mcp\nenv: POSTHOG_WIZARD_LOCAL_MCP',
    type: 'boolean' as const,
    hidden: true,
  },
  'base-url': {
    describe:
      'Override the PostHog base URL (e.g. http://localhost:8010), bypassing region resolution. Pins the API host, cloud URL, and OAuth server.\nenv: POSTHOG_WIZARD_BASE_URL',
    type: 'string' as const,
    hidden: true,
  },
  benchmark: {
    default: false,
    describe:
      'Run in benchmark mode with per-phase token tracking\nenv: POSTHOG_WIZARD_BENCHMARK',
    type: 'boolean' as const,
    hidden: true,
  },
  'yara-report': {
    default: false,
    describe:
      'Print YARA scanner summary after the agent run\nenv: POSTHOG_WIZARD_YARA_REPORT',
    type: 'boolean' as const,
    hidden: true,
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
    // The published-build, non-interactive path is the experimental headless
    // flag (declared unconditionally in GLOBAL_OPTIONS, see @lib/headless-mode);
    // --ci and headless are kept as separate flags so they can diverge — see
    // basic-integration's dispatch. headless is deliberately not advertised.
    if (!IS_PRODUCTION_BUILD) {
      cli = cli
        .option('ci', {
          default: false,
          describe:
            'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
          type: 'boolean',
          hidden: true,
        })
        // Runner overrides — dev/test only, same lifecycle as --ci.
        .option('harness', {
          describe:
            'Override the agent harness (anthropic | pi). Wins over the PostHog runner flag.\nenv: POSTHOG_WIZARD_HARNESS',
          choices: Object.values(Harness),
          type: 'string',
          hidden: true,
        })
        .option('sequence', {
          describe:
            'Override the runner sequence (linear | orchestrator). Wins over the PostHog orchestrator flag.\nenv: POSTHOG_WIZARD_SEQUENCE',
          choices: Object.values(Sequence),
          type: 'string',
          hidden: true,
        });
    }

    this.cli = cli
      .strictOptions()
      // Reject unrecognized commands (e.g. `wizard bogus`) instead of letting
      // them fall through to the default `$0` integration flow.
      .strictCommands()
      // Print a concise error and point to `--help`, instead of yargs' default
      // of dumping the entire usage screen under every failure.
      .fail((msg, err) => {
        const text = msg || (err && err.message) || 'Invalid arguments';
        process.stderr.write(
          `\n\x1b[1;91m✖ ${text}\x1b[0m\n` +
            `  Run \`wizard --help\` to see available commands and options.\n\n`,
        );
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

      // --harness / --sequence are dev/test-only. In published builds the env
      // vars would silently no-op, so reject them explicitly instead.
      const argvHasOverride = args.some(
        (a) =>
          a === '--harness' ||
          a.startsWith('--harness=') ||
          a === '--sequence' ||
          a.startsWith('--sequence='),
      );
      const envHasOverride =
        (process.env.POSTHOG_WIZARD_HARNESS != null &&
          process.env.POSTHOG_WIZARD_HARNESS !== '') ||
        (process.env.POSTHOG_WIZARD_SEQUENCE != null &&
          process.env.POSTHOG_WIZARD_SEQUENCE !== '');
      if (argvHasOverride || envHasOverride) {
        process.stderr.write(
          `\n\x1b[1;91m✖ The --harness and --sequence overrides are not available in published builds.\x1b[0m\n\n`,
        );
        process.exit(1);
      }
    }
    void this.cli.wrap(process.stdout.isTTY ? this.cli.terminalWidth() : 80)
      .argv;
  }
}
