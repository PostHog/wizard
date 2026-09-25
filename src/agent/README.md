# Agent

The agent runs one AI pipeline against a project. It takes resolved data in,
reports through progress events, asks through an answerer you pass, and returns
a result. It never reads a session, a store or a UI.

To call it from code, use `runAgent`. The
[developer interfaces](../../docs/developer-interfaces.md#runagent) cover it.

## What goes in and out

| Direction | What the agent takes or gives                                                                                                                                                                                                               | What never crosses                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| In        | `RunConfig`: the program ID, the run definition, a resolved route, tools and a flag snapshot. `RunInput`: the project directory, the login, the project and user, the flags and the PostHog host. `onProgress`, `interaction` and `signal`. | A `WizardSession`, a TUI or headless store, `getUI()` or a `ProgramConfig` |
| Out       | Progress events as copies, questions through `interaction`, and one `RunResult`.                                                                                                                                                            | Live objects, a thrown error or a process exit                             |

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

## Future work

- **Bindings move to programs.** The program bindings table still lives in the
  agent. It will move to programs, and the agent will take a resolved route
  only.
