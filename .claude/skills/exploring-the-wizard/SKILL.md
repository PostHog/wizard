---
name: exploring-the-wizard
description: Run, drive, and explore the PostHog wizard headlessly against an app — decide each screen yourself (read_state / perform_action / run_agent) and snapshot the TUI to view. Use when you want to test or explore the wizard end-to-end without a terminal.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "2.1"
---

# Exploring the wizard as an agent

Drive a real wizard run headlessly and decide each step yourself — read the
current screen, commit a decision, fire the agent, snapshot the TUI. The control
plane is `WizardCiDriver` (read/act over a live store); for _how_ it works, read
[`e2e-harness/ARCHITECTURE.md`](../../../e2e-harness/ARCHITECTURE.md).

## 0. Ask for the key, set up

**First, ask the user for the path to their PostHog key file** — e.g. "What's the
absolute path to your phx key file?" — plus the project id and region if you don't
have them. Clone/point at the app as a **throwaway `/tmp` copy** (never a real
fixture). Note `WIZARD_PATH` (this repo). Never print or commit the key.

## 1. Drive it from a script (works in THIS session)

Write a script that drives the `WizardCiDriver` turn by turn — `readState()` →
_your_ decision → `performAction()`, `renderFrame()` to see each screen. Put it
**inside this repo** (so `@lib`/`@e2e-harness` resolve), name it
`scripts/explore.no-jest.ts`, run `npx tsx scripts/explore.no-jest.ts`, then
delete it. Run it, read the output, adjust the decisions, re-run.

```ts
import fs from 'fs';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { runAgent } from '@lib/agent/agent-runner';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import { WizardRecorder } from '@e2e-harness/recorder';
import { renderFrame } from '@e2e-harness/replay';

async function main() {
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));
  store.session = buildSession({
    installDir: process.env.APP_DIR!,
    ci: true,
    apiKey: fs.readFileSync(process.env.POSTHOG_KEY_FILE!, 'utf8').trim(),
    projectId: process.env.PROJECT_ID!,
    region: 'us',
  });
  await store.runReadyHooks(); // framework detection
  store.runInitHooks(); // health-check probe

  const rec = new WizardRecorder(store, { program: 'posthog-integration' });
  rec.start();
  const driver = new WizardCiDriver(store);
  const at = () => {
    const s = driver.readState();
    console.log(s.currentScreen, s.actions.map((a) => a.id));
    return s.currentScreen;
  };

  // YOU decide each screen — read state, then commit a legal action:
  at(); // intro
  driver.performAction('confirm_setup');
  at(); // health-check
  driver.performAction('dismiss_outage');
  // setup question? -> driver.performAction('choose', { key, value })

  // the `run` screen = the real integration agent (blocks minutes):
  await store.getGate('intro');
  await store.getGate('health-check');
  await runAgent(posthogIntegrationConfig, store.session);

  // post-run screens:
  driver.performAction('dismiss_outro');
  driver.performAction('set_mcp_outcome', { outcome: 'skipped' });
  driver.performAction('dismiss_slack');
  driver.performAction('keep_skills', { kept: false });

  // SEE every key moment as the real TUI:
  rec.stop();
  for (const f of rec.getRecording().frames) {
    console.log(`\n=== ${f.screen} ===\n` + renderFrame(f, Program.PostHogIntegration));
  }
}
main();
```

`APP_DIR` is any directory — so for an **external repo**, clone it to `/tmp` and
point `APP_DIR` at it.

## 2. Drive it as MCP tools (needs a fresh session)

`scripts/wizard-ci-mcp.no-jest.ts` is a stdio MCP server over one live store,
exposing `read_state` / `perform_action` / `render_screen` / `run_agent` as tools
you call turn-by-turn — the most interactive way. **But MCP tools load at session
start**, so you cannot add-and-use it in the same session. Register it first, then
drive in a **new** session:

```bash
claude mcp add -s project wizard-ci \
  -e APP_DIR=/tmp/<the app copy> \
  -e POSTHOG_KEY_FILE=<key file path> \
  -e PROJECT_ID=<project id> \
  -- npx tsx "$WIZARD_PATH/scripts/wizard-ci-mcp.no-jest.ts"
```

Then start a fresh Claude Code session in this repo and call the tools
(`read_state` → `perform_action` → … → `run_agent` → … → `keep_skills`,
`render_screen` to view).

## 3. Or run it hands-off (scripted)

To let the scripted profile make the decisions (for apps under
`wizard-workbench/apps/`):

```bash
pnpm wizard-ci <app> --e2e          # real agent, headless; writes a recording
pnpm wizard-ci-snapshots <app>       # renders each key moment → .ans + report.html
```

## Key facts

- **State → screen.** You never navigate; you commit a decision (an action's store
  setter) and the router re-derives the active screen. Name actions, not keys.
- **`run` is the only blocking step.** Everything else is an instant store commit;
  `run_agent` / `runAgent` is the real, billable integration.
- **A green run ≠ a valid integration.** `runPhase=completed` means the flow
  finished, not that the wizard understood the framework (e.g. it'll treat a Wasp
  app as react-router). Read what it actually changed.
- **None of this ships.** The harness lives in `e2e-harness/`, out of `src/`.
