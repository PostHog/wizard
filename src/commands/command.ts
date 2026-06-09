import type { Arguments, Argv, CommandModule, Options } from 'yargs';

export interface Command {
  /** Yargs command name. Use `['$0']` for the default command. */
  name: string | readonly string[];
  description: string;
  /** Flags exposed by this command. Same shape as yargs `.options()`. */
  options?: Record<string, Options>;
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
      if (cmd.children?.length && !cmd.handler && !cmd.interactiveDefault) {
        next = next.demandCommand(1);
      }
      return next;
    },
    handler: cmd.handler ?? cmd.interactiveDefault ?? (() => undefined),
  };
}
