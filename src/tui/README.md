# TUI

The TUI renders a program's journey with Ink: one screen at a time, chosen by a
router from the program's flow and the session. It owns the screen state
(confirmations, dismissals, overlays, the pending question and notice), answers
the agent's questions from the user, shows the OAuth login, and projects run
progress. It reaches programs through `@programs`, takes agent types only, and
never looks up a global UI or exits on anyone else's behalf.

## Signatures

```ts
import { loadStartTui, WizardStore, buildSession, InkUI } from '@tui';
import type { TuiHost, TuiHandle, WizardSession, FlowStep } from '@tui/types';

const { startTUI } = await loadStartTui();
const tui: TuiHandle = startTUI(version, programId, {
  onUi: (ui: InkUI) => setUI(ui), // install the TUI's UI before the first frame
  abort: (failure) => wizardAbort(failure), // how a screen or login ends the run
});
tui.store.session = buildSession({ installDir, apiKey /* ... */ });
await tui.waitForSetup(); // the intro gate
```

- `@tui` never renders on import. Ink loads through `loadStartTui`,
  `loadPlayground` and `loadFamilyPicker`.
- `WizardStore` holds a `WizardSession` (`ProgramSession` from programs plus the
  TUI's `TuiSessionState`) and the run projection (tasks, status, event plan,
  handoff, usage). Screens change it only through its setters.
- `InkUI` adapts the store to the progress and interaction halves of the CLI's
  UI contract: progress becomes store writes, `requestQuestion` opens the
  wizard-ask overlay and resolves with the user's answers.
- `getProgramFlow(id)` / `rawProgramFlow(id)` return a program's flow;
  `postAuthGateSteps` names the gates a run waits on after login.
- `wizardStoreControlTarget(store, { screens })` is the control adapter the
  headless control server drives (see [headless](../headless/README.md)).
- The MCP client installers (`getSupportedClients`, `addMCPServer`,
  `removeMCPServer`, `getInstalledClients`) are the TUI's, and `wizard mcp`
  commands reuse them.

## Intent

The CLI starts the TUI for an interactive run and hands it a `TuiHost`. Without
`onUi` the CLI's current UI stays as it was; without `abort` a store logs the
request and never ends the process (tests and the playground). Detection runs
through the program's `onReady` with store setters; composed runs and the agent
run from the CLI's runner, which waits on the flow's gates.

## Architecture

```text
cli ── startTUI(version, program, host) ──▶ WizardStore ◀── InkUI (progress, questions)
                                              │
                   flows/<program>.ts ──▶ router ──▶ screen ──▶ store setters
                                              │
                   control/ ── actions · setters · state ──▶ headless control server
```

- `flow.ts` defines `FlowStep` (screen, show, isComplete, gate, onInit) and the
  helpers that project a flow for the router and the runners. `flows/` holds one
  module per program, registered in `PROGRAM_FLOWS`; product checks a flow needs
  (`needsFrameworkSetup`, `isPostHogPresent`, …) come from `@programs`.
- `session.ts` owns `WizardSession` and `buildSession`.
- `auth-host.ts` builds the login host screens use from the store, aborting
  through the host's `abort`.
- `control/` is partial control (per-screen actions) and full control (every
  store setter) for the control server.
