# Agent

> ⚠️ **The bindings table will be gone.** The program bindings table still lives
> in the agent. By the end of this refactor it moves to programs, and the agent
> takes a resolved route only.

The agent runs one AI pipeline against a project. It takes resolved data in,
reports through progress events, asks through an answerer you pass, and returns
a result. It never reads a session, a store or a UI.

To call it from code, use `runAgent`. The
[developer interfaces](../../docs/developer-interfaces.md#runagent) cover it.

## What goes in and out

- **In.** A `RunConfig`, a `RunInput`, and callbacks for progress and questions.
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
| Security scans of what the run installs   | [`yara-hooks.ts`](yara-hooks.ts)                  |

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside the agent imports deeper, and lint rejects it.
