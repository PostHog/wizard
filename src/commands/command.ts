import type {
  Arguments,
  Argv,
  CommandModule,
  Options,
  PositionalOptions,
} from 'yargs';
import { setEntryCommand } from '@utils/links';

export interface Command {
  /** Yargs command name. Use `['$0']` for the default command. */
  name: string | readonly string[];
  description: string;
  /** Flags exposed by this command. Same shape as yargs `.options()`. */
  options?: Record<string, Options>;
  /**
   * Positional arguments declared in `name` (e.g. the `id` in `skill [id]`).
   * Under `.strictOptions()`, yargs only treats a positional as a known
   * argument once it's registered via `.positional()` — a command-string
   * positional alone is rejected as `Unknown argument`. Declare each one here
   * so an optional positional like `skill [id]` actually accepts its value.
   */
  positionals?: Record<string, PositionalOptions>;
  /** Nested subcommands. */
  children?: readonly Command[];
  /** `--help` examples shown for this command. */
  examples?: ReadonlyArray<readonly [string, string]>;
  /**
   * Called synchronously by yargs when the command matches. Wrap async work in
   * `void (async () => { ... })()`. Optional only when `children` is set — in
   * that case yargs requires the user to pick a subcommand (or to set
   * `interactiveDefault` for an in-process picker).
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
  /**
   * Optional handler invoked when this command has `children` but the user
   * supplied no subcommand. Use it to mount an interactive picker over the
   * children so `wizard audit` (no leaf) opens a TUI menu instead of yargs
   * help. When set, suppresses the implicit `demandCommand(1)`.
   *
   * May return a Promise — yargs awaits the result before exiting.
   */
  interactiveDefault?: (argv: Arguments) => void | Promise<void>;
  /**
   * When true, this child is the "recommended" leaf in its family: the
   * family picker pre-highlights it so a single Enter runs it. The picker
   * still always opens — this never auto-runs the child. At most one child
   * per parent should be marked. Propagated from the context-mill manifest
   * entry's `recommended` flag through `skillCommandFactory`.
   */
  default?: boolean;
}

/** Extract the bare command word(s) from a yargs name spec, dropping positionals and aliases' arg syntax. */
export function commandKeys(name: string | readonly string[]): string[] {
  const list: readonly string[] = typeof name === 'string' ? [name] : name;
  return list.map((n) => n.trim().split(/\s+/)[0]);
}

export function toCommandModule(
  cmd: Command,
  parentPath: readonly string[],
): CommandModule {
  // `wizard slack` → 'slack', `wizard mcp add` → 'mcp-add'. The default
  // `$0` resolves to '' and is skipped — its handler reports itself.
  const entryCommand = [...parentPath, commandKeys(cmd.name)[0]]
    .filter((key) => key !== '$0')
    .join('-');
  return {
    command: cmd.name,
    describe: cmd.description,
    builder: (y: Argv) => {
      let next = cmd.options ? y.options(cmd.options) : y;
      for (const [key, opts] of Object.entries(cmd.positionals ?? {})) {
        next = next.positional(key, opts);
      }
      if (cmd.check) next = next.check(cmd.check);
      for (const [usage, description] of cmd.examples ?? []) {
        next = next.example(usage, description);
      }
      const ownPath = [...parentPath, commandKeys(cmd.name)[0]];
      for (const child of cmd.children ?? []) {
        next = next.command(toCommandModule(child, ownPath));
      }
      if (cmd.children?.length && !cmd.handler && !cmd.interactiveDefault) {
        next = next.demandCommand(1);
      }
      return next;
    },
    handler: (argv: Arguments) => {
      if (entryCommand) setEntryCommand(entryCommand);
      const run = cmd.handler ?? cmd.interactiveDefault ?? (() => undefined);
      run(argv);
    },
  };
}
