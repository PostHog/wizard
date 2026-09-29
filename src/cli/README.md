# CLI

The CLI is the composition root. It parses argv, registers the commands, and
picks the host a run goes to: the TUI host (`runTui` from `@tui`) for an
interactive run, or the headless host (`runHeadless` from `@headless`) for a
`--ci` or headless run. It builds the host's launch values from the arguments
and the environment, aborts the host's signal on SIGINT or SIGTERM, and exits
with the code the host resolves. Only the CLI and `bin.ts` call `process.exit`:
a host's run ends through `withSignals` or `exitWith`. It never runs a program
itself: each host calls `runProgram`. A tool's command calls the tool's runner
the same way: `runTuiTool` from `@tui` for its screens, or a console runner from
`@tools`; see [`src/tools`](../tools/README.md). It is the only layer that
imports both the TUI and the headless layer, and it loads each host only when a
command needs it, so a headless run never loads the TUI and a TUI run never
loads headless. With `--control-socket` it passes the socket and the mode to the
host, which attaches its own control server.

## Entry and imports

[`bin.ts`](../../bin.ts) checks the Node version, restores Claude settings
backups an interrupted run left behind, and calls `runCli()`, which runs
`Wizard.use(...wizardCommands()).init()`. `wizardCommands()` in
[`commands/index.ts`](commands/index.ts) lists every top-level command in
`PROGRAM_REGISTRY` order. A program config with a top-level `command` gets a
command built by `nativeCommandFactory`. The commands with their own shape are
listed in `CUSTOM_COMMANDS`. `bin.ts` imports the CLI only through its entry,
`@cli` ([`index.ts`](index.ts)), which exports only `runCli`, plus `@env` and
`@shared/*`. CLI modules import each other by relative path.

The CLI may import every other layer through its entries: `@env`, `@shared/*`,
`@utils/*`, `@host/*`, `@agent`, `@agent/types`, `@programs`, `@programs/types`,
each `@programs/<id>` entry, `@tools`, `@tui` and `@headless`. It reaches no TUI
or headless module behind those two entries:

| Entry       | What the CLI uses                                             |
| ----------- | ------------------------------------------------------------- |
| `@tui`      | `runTui`, `runTuiTool`, `renderFamilyPicker`, `runPlayground` |
| `@headless` | `runHeadless` and `HeadlessMode`                              |

Each entry function loads its module on first call, so importing an entry loads
no host. A tool's screens run under `underSignals`, whose listeners go once the
screens end, so a console fallback after them ends on Ctrl-C as Node does; a
console runner runs under `exitWith` and prints through `consoleLog`. Each
program's and tool's screens load through the TUI registries, so the CLI never
imports a TUI program or tool folder. `ink` and `react` resolve to a fence that
fails every import form here, so rendering stays in the TUI. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Where things live

| What                                             | Where                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Global options and the yargs setup               | [`wizard.ts`](wizard.ts)                                                                                    |
| The command list and the `Command` shape         | [`commands/index.ts`](commands/index.ts) and [`commands/command.ts`](commands/command.ts)                   |
| Commands built from configs, and family commands | [`commands/factories`](commands/factories) and [`commands/dispatch-family.ts`](commands/dispatch-family.ts) |
| The TUI run: launch values, then `runTui`        | [`runners/run-wizard.ts`](runners/run-wizard.ts)                                                            |
| The `--ci` and headless runs, then `runHeadless` | [`runners/run-non-interactive.ts`](runners/run-non-interactive.ts)                                          |
| A tool's command: its arguments, then its runner | `commands/`: [`mcp`](commands/mcp), [`doctor.ts`](commands/doctor.ts), [`slack.ts`](commands/slack.ts), …   |
| Signals, and the host's code as the exit         | [`runners/signals.ts`](runners/signals.ts)                                                                  |
| The control-socket flags                         | [`control-flags.ts`](control-flags.ts)                                                                      |
