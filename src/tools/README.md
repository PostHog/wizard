# Tools

A tool is a command that does its job without an agent run: `mcp add`,
`mcp remove`, `mcp tutorial`, `slack`, `doctor`, `provision`, `cli add` and
`skill list`. No tool goes through `runProgram`, and no program imports a tool.

Every tool runner resolves an exit code and never exits: the CLI exits with the
code. A runner flushes its analytics events before it resolves.

## What a tool is made of

- **Its logic** in `src/tools/<folder>/`. Other layers reach it only through the
  one entry, [`index.ts`](index.ts), as `@tools`.
- **Its screens**, when it has any, in `src/tui/tools/<folder>/`, with the same
  folder name. The folder is built like a TUI program's: a flow, screens and
  control commits, entered through its `index` module (`TUI_TOOLS`), plus an
  optional `start`, the work its flow's gates wait on. Doctor's `start` logs in
  once its intro and health check pass.
- **Its command** in `src/cli/commands/`, which parses the arguments and calls
  the tool's runner.

A tool with screens has a `ToolConfig` in `TOOL_REGISTRY`: its id, its command
words and its help line. Its id (`mcp-add`, `mcp-remove`, `mcp-tutorial`,
`slack`, `posthog-doctor`) is the flow the TUI shows, the `program_id` analytics
tag and the gateway cost attribution.

## How the CLI runs each tool

| Command                 | Runner                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp add`, `mcp remove` | The TUI's `runTuiTool`. `--headless`, or a terminal with no raw mode, runs `addMcpServer` or `removeMcpServer` and prints the outcome instead |
| `mcp tutorial`, `slack` | `runTuiTool`                                                                                                                                  |
| `doctor`                | `runTuiTool`. `--ci` runs `runDoctorReport`: an API-key login and the active health issues, printed                                           |
| `provision`             | `runProvision`                                                                                                                                |
| `cli add`               | `runCliAdd`                                                                                                                                   |
| `skill list`            | `listSkills`                                                                                                                                  |

`runTuiTool` ([`src/tui/run-tool.ts`](../tui/run-tool.ts)) mounts the TUI for
the tool's id, runs its `start`, and resolves with the code of the first screen
exit request, or 130 or 143 on a signal. It runs no program, and records no task
stream and no WizardRun. The posthog-integration intro lists doctor too, and
hands off to its screens in the same process.

`addMcpServer` resolves 1 when any client fails or none ends up with the server,
since a scripted caller has no screen to read. The console runners print through
a `ConsoleLog` (`@shared/console-log`), the printer headless's log lines use.

## What a tool may import

Tool source may import `@env`, `@shared/*`, `@utils/*`, and the `@agent` entry,
only for the MCP tutorial's `streamMcpPrompt`. It never imports `@programs`,
`@host/*`, the TUI, headless, the CLI, Ink or React: `pnpm typecheck` builds the
tools as their own project, [`tsconfig.json`](tsconfig.json), which references
only `src`, `shared` and `agent`, and rejects each. Ink and React resolve to the
fence in [`types/tui-only.d.fence.ts`](../../types/tui-only.d.fence.ts), which
fails every import form with TS6263. Files inside `src/tools` import each other
relatively.

A TUI tool folder may import the TUI core, `@tools`, `@programs` and shared
code, never another tool's folder or a TUI program's folder. A program's flow
uses a step a tool also shows, such as the MCP install or Connect Slack, by its
core screen id.

## Add a tool

1. Its logic in `src/tools/<folder>/`, exported from [`index.ts`](index.ts). A
   tool with screens adds its id to `ToolId` in [`types.ts`](types.ts) and its
   `ToolConfig` to `TOOL_REGISTRY`.
2. Its screens, if any, in `src/tui/tools/<folder>/`: an `index` module that
   exports `TUI_TOOLS`, spread in
   [`src/tui/tools/index.ts`](../tui/tools/index.ts), and a `tsconfig.json`
   copied unchanged from a sibling, which makes the folder one project. Add
   `{ "path": "tools/<folder>" }` to `references` in
   [`src/tui/tsconfig.json`](../tui/tsconfig.json), then run `pnpm typecheck`.
3. Its command file in `src/cli/commands/` and its entry in `CUSTOM_COMMANDS`,
   in [`src/cli/commands/index.ts`](../cli/commands/index.ts), at the place in
   `wizard --help` it takes.
