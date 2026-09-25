# Screen flow, state, and interactions

## Ownership

| Surface                                                           | Owns                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [WizardSession](../../../../src/lib/wizard-session.ts)            | Run configuration, decisions, credentials, and lifecycle state                |
| [ProgramStep](../../../../src/lib/programs/program-step.ts)       | Screens, visibility/completion predicates, gates, and initialization hooks    |
| [screen-sequences.ts](../../../../src/ui/tui/screen-sequences.ts) | `ScreenId`, `Screen`, `Sequence`, and the derived `PROGRAM_SEQUENCES`         |
| [WizardRouter](../../../../src/ui/tui/router.ts)                  | Resolution and the `Overlay` stack                                            |
| [WizardStore](../../../../src/ui/tui/store.ts)                    | Reactive state, gate promises, display observations, and pending interactions |
| [WizardUI](../../../../src/ui/wizard-ui.ts)                       | Typed operations available to business logic                                  |

## Program screens

`createProgramSequence` projects program steps with a `screenId` into `Screen`
entries: `id`, `show`, and `isComplete`. Completion defaults to the step's
`gate` when no separate `isComplete` is provided. Steps without a screen are
omitted, and the exit screen is appended. The projection applies
[withAiOptInGate](../../../../src/lib/programs/ai-opt-in-gate.ts) consistently
with store gate creation.

`WizardRouter.resolve(session)` first checks the overlay stack, then returns the
first visible, incomplete screen. It also handles the failed-authentication
outro case. Follow this method and the
[router tests](../../../../src/ui/tui/__tests__/router.test.ts) for exact
behavior; there is no program cursor or `next()` API.

The screen sequence is a presentation projection of the program. It is distinct
from the agent execution sequence selected by the runner; see
[wizard-development](../../wizard-development/SKILL.md) for that policy.

## Gates and initialization

Read `ProgramStep` before adding asynchronous work:

- `gate` supplies a blocking checkpoint, while `isComplete` determines when its
  screen is finished. Separate them when those conditions differ.
- `onInit` runs when the TUI starts rendering, before the real session is
  assigned. Reserve it for work independent of that session.
- `onReady` runs after the real session is assigned and is awaited in order.

[The store](../../../../src/ui/tui/store.ts) derives gate promises from the
program. `getGate(stepId)` resolves once: a predicate becoming false later does
not close it again. A missing gate returns a resolved promise.
`waitUntil(predicate)` evaluates live state at the await point; use that
distinction when a decision can change after startup.

[startTUI](../../../../src/ui/tui/start-tui.ts) invokes `runInitHooks` after
rendering starts. Merely constructing a store for a test or playground does not
start those effects.

## Reactive mutations

The session is a nanostores map. Store setters update it and call
`emitChange()`, which increments the React snapshot version, checks gates, and
detects screen transitions. Consumers subscribe through
`subscribe`/`getSnapshot` and `useSyncExternalStore`.

Display observations such as status messages, tasks, and event plans have
separate store atoms. Reuse the existing setters (`pushStatus`, `syncTodos`,
`setEventPlan`) for those updates. Do not mutate session fields behind the store
after attaching the session.

[InkUI](../../../../src/ui/tui/ink-ui.ts) translates `getUI()` calls into store
operations. Business logic should use this interface rather than import the
store; screens can use the store directly.

## Interaction requests and overlays

Screens own input handling, while `WizardUI` exposes typed interaction requests.
`requestQuestion` opens the `WizardAsk` overlay and resolves with answers;
`showTaskNotice` opens an optional-task notice and resolves with the decision.
Their cancellation methods settle pending requests and dismiss the corresponding
overlay. Use the established methods rather than pushing a question overlay
without its pending state or promise.

Read [WizardAskScreen](../../../../src/ui/tui/screens/WizardAskScreen.tsx),
[TaskNoticeScreen](../../../../src/ui/tui/screens/TaskNoticeScreen.tsx), and the
matching store methods before changing their lifecycle.
[LoggingUI](../../../../src/ui/logging-ui.ts) rejects question requests,
declines optional task notices, and leaves the manual-auth-code promise pending;
it cannot collect terminal input.

`Overlay` lives in the router; `ScreenName` is `ScreenId | Overlay`. Store
`pushOverlay`/`popOverlay` wrappers notify subscribers and preserve transition
direction. Their use for interrupts is separate from program progression. Choose
actual overlay values from the enum; health checks are program screens.

## Components and services

[App](../../../../src/ui/tui/App.tsx) creates the service bundle and screen
registry, then renders
[ScreenContainer](../../../../src/ui/tui/primitives/ScreenContainer.tsx). The
registry injects services where needed, such as the
[MCP installer](../../../../src/ui/tui/services/mcp-installer.ts). Prefer this
boundary when a screen needs external operations rather than coupling a new
component to step internals.

`ScreenContainer` owns transitions, shared keyboard hints, viewport handling,
and
[ScreenErrorBoundary](../../../../src/ui/tui/primitives/ScreenErrorBoundary.tsx).
The boundary records an error outro and run phase on render failure. When
changing completion predicates, verify that failure and dismissal remain
reachable; the boundary does not replace those predicates.
