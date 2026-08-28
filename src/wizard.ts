import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { IS_PRODUCTION_BUILD } from '@env';
import { Harness, Sequence } from '@lib/constants';
import { initLocalDev, localMcpSkillsNotice } from '@lib/local-dev';
import { toCommandModule, type Command } from './commands/command';
import { ErrorCodes } from '@lib/errors';
import { emitWizardError } from '@lib/errors';

/**
 * Global yargs options applied to every command. These are read from the
 * `POSTHOG_WIZARD` env prefix as well as flags.
 *
 * Options with `hidden: true` are "internal modes" — they don't show up in
 * `--help` but are still accepted on every command. The `--local-*` flags live
 * in the constructor's `!IS_PRODUCTION_BUILD` block instead, so published
 * builds reject them; see `docs/local-dev.md`.
 */
export const GLOBAL_OPTIONS = {
  debug: {
    default: false,
    describe: 'Enable verbose logging\nenv: POSTHOG_WIZARD_DEBUG',
    type: 'boolean' as const,
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
  // Hidden from `--help`.
  // NB: the experimental headless flag is deliberately NOT global — it's
  // declared per-command (basic integration + audit) via `headlessOption`
  // in @lib/headless-mode, so no other command accepts it.
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
    // flag — declared per-command on basic integration + audit via
    // `headlessOption` (see @lib/headless-mode), not globally, so no other
    // command accepts it. --ci and headless are kept as separate flags so they
    // can diverge — see basic-integration's dispatch. headless is deliberately
    // not advertised.
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
        })
        .option('model', {
          describe:
            'Override the agent model (gateway id, e.g. claude-sonnet-4-6 | openai/gpt-5). Wins over the binding default.\nenv: POSTHOG_WIZARD_MODEL',
          type: 'string',
          hidden: true,
        })
        .option('capture-aio', {
          default: false,
          describe:
            "Capture wizard LLM calls as $ai_generation events in the authenticated project's AI Observability tab.\nenv: POSTHOG_WIZARD_CAPTURE_AIO",
          type: 'boolean',
          hidden: true,
        })
        // ── Local dev targets (see docs/local-dev.md) ──────────────────
        // Not `hidden`: the build gate already keeps them from users, so
        // hiding them would only cost the dev-build help row. Deliberately not
        // named `--local`, which `wizard mcp add` already uses for something
        // unrelated.
        .option('local-dev', {
          default: false,
          describe:
            'Point context-mill, MCP, and PostHog at local dev servers\nenv: POSTHOG_WIZARD_LOCAL_DEV',
          type: 'boolean',
        })
        // No `default` on the three below — they must stay `undefined` when
        // absent for resolveLocalDev() to honour the umbrella and `--no-*`.
        .option('local-context-mill', {
          describe:
            'Fetch skills from the local context-mill server (http://localhost:8765)\nenv: POSTHOG_WIZARD_LOCAL_CONTEXT_MILL',
          type: 'boolean',
        })
        .option('local-mcp', {
          describe:
            'Use the local MCP server (http://localhost:8787/mcp). Affects MCP only — use --local-context-mill for skills.\nenv: POSTHOG_WIZARD_LOCAL_MCP',
          type: 'boolean',
        })
        .option('local-posthog', {
          describe:
            'Point every PostHog origin (API, app, OAuth, gateway) at http://localhost:8010\nenv: POSTHOG_WIZARD_LOCAL_POSTHOG',
          type: 'boolean',
        });
    }

    this.cli = cli
      // Middleware rather than an argv scan so the env path is covered too,
      // and it runs before any TUI takes the terminal.
      .middleware((argv) => {
        // The one place local targets are resolved; everything downstream reads
        // getLocalDev().
        initLocalDev(argv);

        // Temporary.
        const notice = localMcpSkillsNotice({
          localDev: argv.localDev as boolean | undefined,
          localMcp: argv.localMcp as boolean | undefined,
          localContextMill: argv.localContextMill as boolean | undefined,
        });
        if (notice) {
          process.stderr.write(`\n\x1b[33m! ${notice}\x1b[0m\n\n`);
        }
      })
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
        emitWizardError({ code: ErrorCodes.CliBadArgs, message: text });
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
        emitWizardError({
          code: ErrorCodes.CliFlagUnavailable,
          message: 'CI mode is not supported in published builds.',
        });
        process.exit(1);
      }

      // --harness / --sequence / --model / --capture-aio are dev/test-only.
      // In published builds the env vars would silently no-op, so reject them
      // explicitly instead.
      const argvHasOverride = args.some(
        (a) =>
          a === '--harness' ||
          a.startsWith('--harness=') ||
          a === '--sequence' ||
          a.startsWith('--sequence=') ||
          a === '--model' ||
          a.startsWith('--model=') ||
          a === '--capture-aio' ||
          a === '--no-capture-aio' ||
          a.startsWith('--capture-aio='),
      );
      const envHasOverride =
        (process.env.POSTHOG_WIZARD_HARNESS != null &&
          process.env.POSTHOG_WIZARD_HARNESS !== '') ||
        (process.env.POSTHOG_WIZARD_SEQUENCE != null &&
          process.env.POSTHOG_WIZARD_SEQUENCE !== '') ||
        (process.env.POSTHOG_WIZARD_MODEL != null &&
          process.env.POSTHOG_WIZARD_MODEL !== '') ||
        (process.env.POSTHOG_WIZARD_CAPTURE_AIO != null &&
          process.env.POSTHOG_WIZARD_CAPTURE_AIO !== '');
      if (argvHasOverride || envHasOverride) {
        process.stderr.write(
          `\n\x1b[1;91m✖ The --harness, --sequence, --model, and --capture-aio overrides are not available in published builds.\x1b[0m\n\n`,
        );
        emitWizardError({
          code: ErrorCodes.CliFlagUnavailable,
          message:
            'The --harness, --sequence, --model, and --capture-aio overrides are not available in published builds.',
        });
        process.exit(1);
      }

      // `--local-mcp` used to be declared unconditionally, so published builds
      // accepted it and quietly aimed the run at localhost. Reject explicitly.
      const argvHasLocalTarget = args.some((a) =>
        LOCAL_TARGET_FLAGS.some(
          (f) => a === `--${f}` || a === `--no-${f}` || a.startsWith(`--${f}=`),
        ),
      );
      const envHasLocalTarget = LOCAL_TARGET_ENV_VARS.some(
        (k) => process.env[k] != null && process.env[k] !== '',
      );
      if (argvHasLocalTarget || envHasLocalTarget) {
        process.stderr.write(
          `\n\x1b[1;91m✖ The --local-dev, --local-context-mill, --local-mcp, and --local-posthog targets are not available in published builds.\x1b[0m\n` +
            `  They point the wizard at development servers on localhost.\n\n`,
        );
        emitWizardError({
          code: ErrorCodes.CliFlagUnavailable,
          message:
            'The --local-dev, --local-context-mill, --local-mcp, and --local-posthog targets are not available in published builds.',
        });
        process.exit(1);
      }
    }
    void this.cli.wrap(process.stdout.isTTY ? this.cli.terminalWidth() : 80)
      .argv;
  }
}

/** Excludes bare `local`: `wizard mcp add --local` stays available in prod. */
const LOCAL_TARGET_FLAGS = [
  'local-dev',
  'local-context-mill',
  'local-mcp',
  'local-posthog',
] as const;

const LOCAL_TARGET_ENV_VARS = [
  'POSTHOG_WIZARD_LOCAL_DEV',
  'POSTHOG_WIZARD_LOCAL_CONTEXT_MILL',
  'POSTHOG_WIZARD_LOCAL_MCP',
  'POSTHOG_WIZARD_LOCAL_POSTHOG',
] as const;
