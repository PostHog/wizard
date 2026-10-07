# Screen flow, state, and interactions

## Ownership

| Surface                                                           | Owns                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [WizardSession](../../../../src/programs/session/wizard-session.ts) | Run configuration, decisions, credentials, and lifecycle state                |
| [TuiState](../../../../src/tui/tui-state.ts) | Each screen's answers, what an overlay shows, and the TUI's launch choices |
| [FlowStep](../../../../src/tui/flow.ts)                       | Screens, visibility/completion predicates, gates, and `onInit` hooks          |
| [TUI programs](../../../../src/tui/programs/index.ts) | Each program's flow, deck, tips and screens, by program id |
| [TUI tools](../../../../src/tui/tools/index.ts) | Each tool's flow and screens, by tool id |
| [screen-sequences.ts](../../../../src/tui/screen-sequences.ts) | `Screen`, `Sequence` and `programSequence(programId)`; re-exports `ScreenId` |
| [WizardRouter](../../../../src/tui/router.ts)                     | Resolution and the `Overlay` stack                                            |
| [WizardStore](../../../../src/tui/store.ts)                       | Reactive state, gate promises, display observations, and pending interactions |

## Program screens

Each program's TUI lives in `src/tui/programs/<id>/`: its flow (`flow.ts`, or
`AGENT_SKILL_STEPS` adapted), `screens/`, `screen-ids.ts` and an optional `deck/`.
Its entry (`index.ts(x)`) exports `TUI_PROGRAMS`, mapping each program id it
serves to a [TuiProgram](../../../../src/tui/programs/types.ts): flow, deck,
tips and the screens it mounts. `getTuiProgram(programId)`, `flowOwner(programId)`
and `listTuiPrograms()` look them up, and a program with no entry gets the
generic skill program (`programs/shared/skill-program.tsx`). The screen registry
and the store read programs only through these lookups. Each program folder has
its own `tsconfig.json`, listed in `references` in
[`src/tui/tsconfig.json`](../../../../src/tui/tsconfig.json), so it can't import
another program's folder, and the core sees the registry only through its
signature in [`types/tui-programs.d.ts`](../../../../types/tui-programs.d.ts).

`createProgramSequence` in [flow.ts](../../../../src/tui/flow.ts) projects flow
steps with a `screenId` into `Screen` entries: `id`, `show`, and `isComplete`.
Completion defaults to the step's `gate` when no separate `isComplete` is
provided. Steps without a screen are omitted, and the exit screen is appended.
`programSequence` applies
[withAiOptInGate](../../../../src/tui/ai-opt-in-gate.ts) before projecting, the
same wrapper the store uses for its gates.

`WizardRouter.resolve(view)` takes the store as a `TuiView`, its `session` and
its TUI state, the same input every step predicate reads. It first routes a
failed agent run to the mint-failure handoff, then checks the overlay stack,
then returns the first visible, incomplete screen. It also handles the
failed-authentication outro case. Follow this method and the
[router tests](../../../../src/tui/__tests__/router.test.ts) for exact behavior.

Each tool's screens live in `src/tui/tools/<id>/`, built the same way: its entry
exports `TUI_TOOLS`, `getTuiTool(id)` and `listTuiTools()` look them up, and
`runTuiTool` in [run-tool.ts](../../../../src/tui/run-tool.ts) runs one, with no
program run. [`flowOwner(id)`](../../../../src/tui/flow-owner.ts) finds the
owner of a flow id: the tool's TUI first, then the program's. Only a program's
flow gets the AI opt-in step.

The screen sequence is a presentation projection of the program. It is distinct
from the agent execution sequence selected by the runner; see
[wizard-development](../../wizard-development/SKILL.md) for that policy.

## Gates and initialization

Read `FlowStep` and the program's `ProgramConfig.onReady` before adding
asynchronous work:

- `gate` supplies a blocking checkpoint, while `isComplete` determines when its
  screen is finished. Separate them when those conditions differ.
- `onInit` runs when the TUI starts rendering, before the real session is
  assigned. Reserve it for work independent of that session.
- `ProgramConfig.onReady` runs detection after the real session is assigned. The
  store's `runReadyHooks` awaits it once.

[The store](../../../../src/tui/store.ts) derives gate promises from the
program. `getGate(stepId)` resolves once: a predicate becoming false later does
not close it again. A missing gate returns a resolved promise.
`waitUntil(predicate)` evaluates live state at the await point; use that
distinction when a decision can change after startup.

[startTUI](../../../../src/tui/start-tui.ts) invokes `runInitHooks` after
rendering starts. Merely constructing a store for a test or playground does not
start those effects.

## Reactive mutations

The session is a nanostores map, and the TUI state an atom beside it. Store
setters update them and call `emitChange()` once, which increments the React
snapshot version, checks gates, and detects screen transitions. Consumers
subscribe through `subscribe`/`getSnapshot` and `useSyncExternalStore`.

Display observations such as status messages, tasks, and event plans have
separate store atoms. Reuse the existing setters (`pushStatus`, `syncTodos`,
`setEventPlan`) for those updates. Do not mutate session fields behind the store
after attaching the session.

TUI code reports through the store it is handed: the login and the scans a
screen runs push status lines, and
[agent-progress.ts](../../../../src/tui/agent-progress.ts) writes a run's
progress to the store (`displayProgress` for a `runProgram` run, `scanProgress`
for a scan). Programs never use the UI. They get a runner context.

## Interaction requests and overlays

Screens own input handling, while the store exposes typed interaction requests.
`requestQuestion` opens the `WizardAsk` overlay and resolves with answers;
`showTaskNotice` opens an optional-task notice and resolves with the decision.
Their cancellation methods settle pending requests and dismiss the corresponding
overlay. Use the established methods rather than pushing a question overlay
without its pending state or promise.

Read [WizardAskScreen](../../../../src/tui/screens/WizardAskScreen.tsx),
[TaskNoticeScreen](../../../../src/tui/screens/TaskNoticeScreen.tsx), and the
matching store methods before changing their lifecycle. Headless has no screens:
it passes `runProgram` no interaction, so the agent's questions and optional
task notices get no answer there.

`Overlay` lives in the router; `ScreenName` is a string: a core `ScreenId`, an
`Overlay`, or a program's screen id. Store `pushOverlay`/`popOverlay` wrappers
notify subscribers and preserve transition direction. Their use for interrupts
is separate from program progression. Choose actual overlay values from the
enum; the health check is a core flow screen, not an overlay.

## Components and services

[App](../../../../src/tui/App.tsx) creates the service bundle and screen
registry, then renders
[ScreenContainer](../../../../src/tui/primitives/ScreenContainer.tsx). The
registry injects services where needed, such as the
[MCP installer](../../../../src/tui/services/mcp-installer.ts). Prefer this
boundary when a screen needs external operations rather than coupling a new
component to step internals.

`ScreenContainer` owns transitions, shared keyboard hints, viewport handling,
and
[ScreenErrorBoundary](../../../../src/tui/primitives/ScreenErrorBoundary.tsx).
The boundary records an error outro and run phase on render failure. When
changing completion predicates, verify that failure and dismissal remain
reachable; the boundary does not replace those predicates.
