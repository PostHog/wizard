# Agent

The agent runs one AI pipeline against a project. It takes resolved data in,
reports through progress events, asks through an answerer you pass, and returns
a result. It never reads a session, a store or a UI.

To call it from code, use `runAgent`. The
[developer interfaces](../../docs/developer-interfaces.md#runagent) cover it.

## What goes in and out

- **In.** A `RunConfig` with the caller's routing, a `RunInput`, and callbacks
  for progress and questions.
- **Out.** One `RunResult` at the end.
- **Never in.** A session, a store or the UI.

## Where things live

| What                                      | Where                                             |
| ----------------------------------------- | ------------------------------------------------- |
| The entry points                          | [`index.ts`](index.ts) and [`types.ts`](types.ts) |
| The run types: config, input and result   | [`shared/types.ts`](runner/shared/types.ts)       |
| Progress events and the answerer          | [`progress.ts`](progress.ts)                      |
| Sequences, harnesses and route resolution | [`runner`](runner/README.md)                      |
| The wizard tools both harnesses share     | [`tools`](tools)                                  |
| The benchmark pipeline                    | [`middleware`](middleware)                        |
| YARA scans of tool calls (Pre/PostToolUse) and of installed skills | [`yara-hooks.ts`](yara-hooks.ts)                  |

Import runtime values from `@agent` and types from `@agent/types`. `@agent`
exports `runAgent`, `RunOutcome` (from `@shared/run-state`, so the hosts read it
without the agent), `AgentSignals`, `WIZARD_TOOL_NAMES`, `DEFAULT_BINDING` and
`streamMcpPrompt`, the MCP tutorial's prompt stream. `pnpm typecheck` rejects a
deeper import from any other layer. Files inside `src/agent` import each other
by relative path: the agent's project maps no `@agent` alias, so every
declaration it emits resolves in its consumers. The agent itself may import
`@env`, `@shared/*` and `@utils/*`, and nothing else; see
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).
