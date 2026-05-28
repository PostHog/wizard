import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Arguments, Argv, CommandModule, Options } from 'yargs';

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

export interface WizardCommand {
  /** Yargs command name. Use `['$0']` for the default command. */
  name: string | readonly string[];
  description: string;
  /** Flags exposed by this command. Same shape as yargs `.options()`. */
  options?: Record<string, Options>;
  /** Nested subcommands. */
  children?: readonly WizardCommand[];
  /** `--help` examples shown for this command. */
  examples?: ReadonlyArray<readonly [string, string]>;
  /**
   * Called synchronously by yargs when the command matches. Wrap async work in
   * `void (async () => { ... })()`. Optional only when `children` is set — in
   * that case yargs requires the user to pick a subcommand.
   */
  handler?: (argv: Arguments) => void;
  /**
   * Cross-flag validation run by yargs after parsing. Throw to reject (yargs
   * prints the message and exits non-zero); return `true` to accept. Prefer
   * this over per-option `conflicts` for mutually exclusive flags: yargs
   * counts a `default`-valued flag as "present", so `conflicts` misfires on
   * boolean flags that default to `false` — a hand-written predicate only
   * sees what you test for (e.g. truthiness).
   */
  check?: (argv: Arguments) => boolean;
}

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
  static use(...cmds: WizardCommand[]): Wizard {
    return new Wizard().use(...cmds);
  }

  /** Register one or more commands with yargs. */
  use(...cmds: WizardCommand[]): this {
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

/** Extract the bare command word(s) from a yargs name spec, dropping positionals and aliases' arg syntax. */
export function commandKeys(name: string | readonly string[]): string[] {
  const list: readonly string[] = typeof name === 'string' ? [name] : name;
  return list.map((n) => n.trim().split(/\s+/)[0]);
}

export function toCommandModule(
  cmd: WizardCommand,
  parentPath: readonly string[],
): CommandModule {
  return {
    command: cmd.name,
    describe: cmd.description,
    builder: (y: Argv) => {
      let next = cmd.options ? y.options(cmd.options) : y;
      if (cmd.check) next = next.check(cmd.check);
      for (const [usage, description] of cmd.examples ?? []) {
        next = next.example(usage, description);
      }
      const ownPath = [...parentPath, commandKeys(cmd.name)[0]];
      for (const child of cmd.children ?? []) {
        next = next.command(toCommandModule(child, ownPath));
      }
      if (cmd.children?.length && !cmd.handler) {
        next = next.demandCommand(1);
      }
      return next;
    },
    handler: cmd.handler ?? (() => undefined),
  };
}
