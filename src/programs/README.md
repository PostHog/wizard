# Programs

A program is one thing the wizard does for a user, such as adding PostHog or
setting up error tracking. Each program is a `ProgramConfig`: the screens the
TUI walks, the agent run it performs, and its settings.

To run a program from code, call `runProgram`. The
[developer interfaces](../../docs/developer-interfaces.md) cover it.

## What goes in and out of `runProgram`

| Direction | What `runProgram` takes or gives                                                                                                                                                                            | What never crosses                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| In        | `ProgramInput`: the run and settings built from a `ProgramConfig`, the project directory, a login and flags. `ProgramOptions`: the login, questions, approval and gate waits, flags, progress and `signal`. | A `WizardSession`, a TUI store or `getUI()` |
| Out       | Progress as copies, and one `ProgramRunOutcome`.                                                                                                                                                            | The `ProgramStore` itself, or live objects  |

## Where things live

| What                                          | Where                                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| One program's config, steps and prompt        | Its own folder, such as [`metrics`](metrics/index.ts)       |
| The list of every program                     | [`program-registry.ts`](program-registry.ts)                |
| The `ProgramConfig` and step types            | [`program-step.ts`](program-step.ts)                        |
| Running one program from explicit inputs      | [`run-program.ts`](run-program.ts)                          |
| What a program's `run` receives from a runner | [`runner-context.ts`](runner-context.ts)                    |
| Framework detection and project scoping       | [`detection`](detection/index.ts)                           |
| Framework integrations                        | [`frameworks`](frameworks) and [`registry.ts`](registry.ts) |
| Commands that pick a program by skill         | [`dispatch-family.ts`](dispatch-family.ts)                  |

Import runtime values from `@programs` and types from `@programs/types`.

## Add a program

Follow the
[adding-skill-program](../../.claude/skills/adding-skill-program/SKILL.md)
skill. A framework integration uses
[adding-framework-support](../../.claude/skills/adding-framework-support/SKILL.md)
instead.

## Future work

- **One folder per program.** Each program will move into its own folder with
  everything it owns, so a team can own a full program through `CODEOWNERS`.
- **No legacy adapter.** The TUI and the headless runner reach `runProgram`
  through `runProgramAgent` in [`run-agent-legacy.ts`](run-agent-legacy.ts).
  This is a temporary adapter, and we will remove it in the full program.
- **No session in program configs.** A program's `run` and `ciPreRun` still take
  a `WizardSession`. This is temporary, and we will remove it in the full
  program.
- **No direct `getUI()` calls.** Some program code still calls `getUI()`. This
  is temporary, and we will remove it in the full program.
