# TUI Architecture: Reactive Flow, State, and Screen Management

## Core principle

The rendered screen is a pure function of session state. Nobody imperatively pushes screens around. Business logic sets state through store setters, the router derives which screen should be active.

## Session (src/lib/wizard-session.ts)

`WizardSession` is the single source of truth for every decision the wizard needs. It contains:

- **CLI args**: `debug`, `forceInstall`, `installDir`, `ci`, `signup`, `localMcp`, `apiKey`, `menu`
- **Detection**: `cloudRegion`, `integration`, `frameworkContext`, `typescript`, `detectedFrameworkLabel`, `detectionComplete`
- **OAuth**: `credentials` (accessToken, projectApiKey, host, projectId)
- **Lifecycle**: `runPhase` (Idle → Running → Completed | Error), `mcpComplete`
- **Runtime**: `serviceStatus`, `outroData`, `loginUrl`, `frameworkConfig`

`buildSession(args)` creates a session from CLI args. Pre-TUI fields (`installDir`, `integration`, `frameworkConfig`) can be set directly. Reactive fields that affect screen resolution must go through store setters.

### Enums

```ts
enum RunPhase { Idle, Running, Completed, Error }
enum OutroKind { Success, Error, Cancel }
```

## Router (src/ui/tui/router.ts)

### Screen resolution

The `WizardRouter` has a `resolve(session)` method that walks the flow pipeline and returns the first incomplete screen:

```ts
resolve(session: WizardSession): ScreenName {
  if (overlays.length > 0) return top overlay;
  for (entry of flow) {
    if (entry.show && !entry.show(session)) continue;  // skip hidden
    if (entry.isComplete && entry.isComplete(session)) continue;  // skip complete
    return entry.screen;  // first incomplete = active
  }
  return last screen;  // all complete
}
```

There is no cursor. No `advance()`. No `jumpTo()`. The screen is resolved fresh every render.

### Flow definitions

Flows are declarative arrays of `FlowEntry`:

```ts
interface FlowEntry {
  screen: Screen;
  show?: (session: WizardSession) => boolean;      // skip if false
  isComplete?: (session: WizardSession) => boolean; // resolved if true
}
```

The wizard flow:

| Screen | isComplete | show |
|--------|-----------|------|
| Intro | `cloudRegion !== null` | always |
| Setup | `!needsSetup(s)` | `needsSetup` |
| Auth | `credentials !== null` | always |
| Run | `runPhase === Completed \|\| Error` | always |
| Mcp | `mcpComplete` | always |
| Outro | (terminal) | always |

### Enums

```ts
enum Screen { Intro, Setup, Auth, Run, Mcp, Outro, McpAdd, McpRemove }
enum Overlay { Outage }
enum Flow { Wizard, McpAdd, McpRemove }
```

### Overlays

Overlays are interrupts — they push on top of the flow and pop to resume:

```ts
store.pushOverlay(Overlay.Outage);  // outage screen appears
store.popOverlay();                  // flow screen resumes
```

Overlays don't affect the flow. They're orthogonal.

### Adding a screen

1. Add to `Screen` enum
2. Add a `FlowEntry` to the flow array with an `isComplete` predicate
3. Create the component in `screens/`
4. Register in `screen-registry.tsx`

No other files change.

## Store (src/ui/tui/store.ts)

`WizardStore` extends EventEmitter. React subscribes via `useSyncExternalStore`.

### Session setters

Every session mutation that affects screen resolution goes through an explicit setter:

| Setter | Session field | What resolves |
|--------|--------------|---------------|
| `setCloudRegion(region)` | `cloudRegion` | Past Intro |
| `setRunPhase(phase)` | `runPhase` | Past Run (on Completed/Error) |
| `setCredentials(creds)` | `credentials` | Past Auth |
| `setFrameworkConfig(integration, config)` | `frameworkConfig` + `integration` | Past detection |
| `setDetectionComplete()` | `detectionComplete` | IntroScreen shows results |
| `setDetectedFramework(label)` | `detectedFrameworkLabel` | Display only |
| `setLoginUrl(url)` | `loginUrl` | Display only |
| `setServiceStatus(status)` | `serviceStatus` | Display only |
| `setOutroData(data)` | `outroData` | Display only |
| `setFrameworkContext(key, value)` | `frameworkContext[key]` | Past Setup |
| `setMcpComplete()` | `mcpComplete` | Past Mcp |
| `completeSetup(region)` | `cloudRegion` + unblocks bin.ts | Past Intro |

Each setter mutates the field and calls `emitChange()`, which bumps the version counter and triggers React re-renders. On the next render, `store.currentScreen` calls `router.resolve(session)`.

### Other state

- `statusMessages: string[]` — agent log lines, fed by `pushStatus()`
- `tasks: TaskItem[]` — agent progress, fed by `syncTodos()` and `setTasks()`
- `version: string` — package version for TitleBar

## WizardUI interface (src/ui/wizard-ui.ts)

The bridge between business logic and the store. Business logic calls `getUI()` methods, which translate to store setters in the TUI implementation (`InkUI`).

Session-mutating methods on WizardUI:
- `startRun()` → `store.setRunPhase(Running)`
- `setCredentials(creds)` → `store.setCredentials(creds)`
- `showServiceStatus(data)` → `store.setServiceStatus(data)` + `store.pushOverlay(Outage)`
- `outro(message)` → `store.setOutroData(...)` + `store.setRunPhase(Completed)`
- `setDetectedFramework(label)` → `store.setDetectedFramework(label)`
- `setLoginUrl(url)` → `store.setLoginUrl(url)`

Logging methods (not session-mutating):
- `log.info/warn/error/success/step()` → `store.pushStatus()`
- `pushStatus()`, `spinner()`, `syncTodos()` — agent observation

There are NO prompt methods. `select`, `confirm`, `text`, `multiselect`, `groupMultiselect` were deleted from the interface. Calling them is a compile error.

## Screen registry (src/ui/tui/screen-registry.tsx)

Maps screen names to React components. App.tsx calls the factory:

```ts
const services = createServices();        // McpInstaller, etc.
const screens = createScreens(store, services);  // Record<ScreenName, ReactNode>
```

Adding a screen to the registry requires no changes to App.tsx.

## Services (src/ui/tui/services/)

Screens receive services via props instead of importing business logic:

```ts
interface McpInstaller {
  detectClients(): Promise<McpClientInfo[]>;
  install(names: string[], region?: CloudRegion): Promise<string[]>;
  remove(): Promise<string[]>;
}
```

Services are created in the registry and injected into screens. Testable, swappable, no dynamic imports in React components.

## Error boundaries (src/ui/tui/primitives/ScreenErrorBoundary.tsx)

`ScreenContainer` wraps every screen in a `ScreenErrorBoundary`. On crash:
1. Sets `outroData` with error message
2. Sets `runPhase = Error`
3. Router resolves to Outro

## IntroScreen progressive states

The IntroScreen handles three states in one component:

1. **Detecting** (`!detectionComplete`): header says "Setup Wizard starting up", shows detection spinner
2. **Detection failed** (`detectionComplete && !frameworkConfig`): shows framework picker
3. **Ready** (`frameworkConfig !== null`): shows detected framework label, description, region picker

## Dark mode

`start-tui.ts` forces a black terminal background via ANSI escape codes on startup and resets on exit.

## Shared UI components

- **PromptLabel** — accent-colored `→` badge + message. Used by PickerMenu and ConfirmationInput.
- **LoadingBox** — wraps `@inkjs/ui` Spinner with a message.
- **ProgressList** — task checklist with spinner on the progress tally while incomplete, LoadingBox "Starting up..." when empty.

## Data flow summary

```
Business logic         →  getUI().setX()
  → InkUI              →  store.setX()
    → Store             →  session.x = value; emitChange()
      → React re-render →  store.currentScreen → router.resolve(session)
        → Router        →  walks flow, returns first incomplete screen
```
