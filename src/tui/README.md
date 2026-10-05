# TUI

The TUI is the host for an interactive run: it renders a program's journey, or a
tool's screens, in the terminal with Ink and React. It shares nothing with
headless but the kind of session store it builds. It owns:

- **`runTui`**, the host: it starts the screens, settles the intro, and calls
  `runProgram` once with its login (the launch's, else OAuth), the WizardAsk
  screen as the answerer (`storeInteraction`) and its screens as the workflow
  (`tuiWorkflow`): a run step waits until the flow reaches it, the AI opt-in
  waits on its screen, an outage stops the run, and a settings conflict opens
  its overlay. When the intro hands off to a tool, such as doctor, it drives the
  tool's screens instead and runs no program.
- **`runTuiTool`**, the host for a tool's screens (`mcp add`, `slack`, `doctor`
  and the rest in [`src/tools`](../tools/README.md)): it runs the tool's `start`
  and ends on the first screen exit request, with no program run, no task stream
  and no WizardRun.
- **`WizardStore`**, the screen store: the shared session store, with the TUI's
  own state beside it (`TuiState`: each screen's answers and what an overlay
  shows, read as `store.X`), and the router, the flow's gates, overlays and
  display-only state on top, such as the token HUD and the stage. `runProgram`
  writes the run into the session store; the screens write the TUI state; both
  re-render the screens. A step's predicates read the store as a `TuiView`: its
  `session` and its TUI state.
- **The screens**, which with the login report through the store: a line goes to
  the status feed with `store.pushStatus`, an error outro to the outro screen
  with `store.showOutroError`. `displayProgress(store)` shows a run's display
  events, a debug run's lines among them, and `scanProgress(store)` a scan a
  screen runs itself. `abortOnScreens(store)` ends a decided failure on the
  outro screen.

## Entry and imports

The TUI's one entry is [`index.ts`](index.ts), `@tui`; no other layer imports a
TUI module behind it. It exports `runTui`, which runs a program, `runTuiTool`,
which runs a tool's screens, `renderFamilyPicker`, `runPlayground`,
`tuiProgramFlow`, their launch types, and what the e2e harness and its tests
use: the `WizardStore` type, the screen vocabulary (`ScreenId`, `Overlay` and
each program's and tool's screen ids) and the store helpers `tuiScreenIds`,
`createTuiStore`, `readTuiState` and `mountScreens`. The launch types live in
[`launch.ts`](launch.ts), which names no screen code, so the entry's
declarations never reach React. Each function loads its module on first call, so
importing the entry loads only the screen-id modules. The CLI imports it; the
e2e harness imports it too, to host a real run and to drive and read its
screens.
`startTUI(version, flowId, onInterrupt)` in [`start-tui.ts`](start-tui.ts)
creates the store and renders the app, and calls `onInterrupt` when Ink tears
itself down on Ctrl+C. It throws `CliInteractiveRequired` first when stdin is not
a TTY, since Ink needs raw mode: `runTuiTool` rejects with it, and `runTui`
prints it and resolves 1.

`runTui` logs in with `launch.credentials`, the browser OAuth login when it is
absent. `launch.onStore` receives the run's store once it exists, which is how
the e2e harness drives a real run, and `tuiProgramFlow(programId)` returns the
program's flow steps, for walking a flow in tests.

`runTui` and `runTuiTool` resolve an exit code and never exit: the CLI applies
it. A screen ends the run with `store.requestExit(code)`: `runTui` unmounts,
reports the run's end to analytics within two seconds and resolves it, and
`runTuiTool` resolves it once the tool's analytics events flush. A decided
failure ends it through `abortOnScreens`, or through `wizardAbort` with
`printAbortOutro` before the TUI mounts; Ctrl+C or a signal ends it 130 or 143.

A flow id names a program or a tool. The core finds its flow, screens and deck
through `flowOwner` ([`flow-owner.ts`](flow-owner.ts)): the tool's TUI if one
has the id, else the program's, else the generic skill program. Only a program's
flow gets the AI opt-in step.

The TUI core may import `@env`, `@shared/*`, `@utils/*`, `@host/*`,
`@agent/types`, `@programs`, `@programs/types` and `@tools`. It never imports
headless. It reaches the TUI program and tool registries only through their
signatures. Each `programs/<id>/` and `tools/<id>/` folder is its own project: a
program folder adds its own `@programs/<id>`, a tool folder sees `@tools`, and
neither reaches another folder. The entry, the registries and the playground see
every folder's entry; the core can't import the entry. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Where things live

| What                                             | Where                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| The host and its answers to `runProgram`'s steps | [`run.ts`](run.ts) and [`workflow.ts`](workflow.ts)                                                        |
| Agent progress written to the store              | [`agent-progress.ts`](agent-progress.ts)                                                                   |
| A decided failure on the outro screen            | [`abort.ts`](abort.ts)                                                                                     |
| The store, its TUI state and the router          | [`store.ts`](store.ts), [`tui-state.ts`](tui-state.ts) and [`router.ts`](router.ts)                        |
| Flow steps and the screen sequence they project  | [`flow.ts`](flow.ts) and [`screen-sequences.ts`](screen-sequences.ts)                                      |
| One program's flow, deck and screens             | `programs/<id>/`, registered in [`programs/index.ts`](programs/index.ts)                                   |
| One tool's flow and screens                      | `tools/<id>/`, registered in [`tools/index.ts`](tools/index.ts), run by [`run-tool.ts`](run-tool.ts)       |
| The generic skill program                        | [`programs/shared/skill-program.tsx`](programs/shared/skill-program.tsx)                                   |
| Screens, components, primitives and hooks        | [`screens`](screens), [`components`](components), [`primitives`](primitives/index.ts) and [`hooks`](hooks) |
| The login: browser OAuth or signup               | [`auth`](auth/login.ts)                                                                                    |
| Effects screens call, such as the MCP installer  | [`services`](services), over [`@shared/mcp-clients/install`](../shared/mcp-clients/install.ts)             |
| Primitive demos (`pnpm try --playground`)        | [`playground`](playground/PlaygroundApp.tsx)                                                               |

To build screens or primitives, follow the
[ink-tui](../../.claude/skills/ink-tui/SKILL.md) skill. To give a program its
own TUI folder, follow
[adding-skill-program](../../.claude/skills/adding-skill-program/SKILL.md).
