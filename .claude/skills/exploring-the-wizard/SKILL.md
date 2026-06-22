---
name: exploring-the-wizard
description: Run, drive, and explore the PostHog wizard headlessly against an app — decide each screen yourself over MCP (read_state / perform_action / run_agent) and snapshot the TUI to view. Use when you want to test or explore the wizard end-to-end without a terminal.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "2.2"
---

# Exploring the wizard as an agent

Drive a real wizard run headlessly and decide each step yourself — read the
current screen, commit a decision, fire the agent, snapshot the TUI. For _how_ it
works, read [`e2e-harness/ARCHITECTURE.md`](../../../e2e-harness/ARCHITECTURE.md).

## 0. Ask for the key, set up

**First, ask the user for the path to their PostHog key file** — e.g. "What's the
absolute path to your phx key file?" — plus the project id and region if you don't
have them. Clone/point at the app as a **throwaway `/tmp` copy** (never a real
fixture). Note `WIZARD_PATH` (this repo). Never print or commit the key.

## 1. Drive it over MCP

The `wizard-ci-mcp` server holds one live store and exposes it as tools. **MCP
tools load at session start**, so this is two phases — register, then drive in a
**fresh session**.

**Phase 1 — register (in your current session):**

```bash
claude mcp add -s project wizard-ci \
  -e APP_DIR=/tmp/<the app copy> \
  -e POSTHOG_KEY_FILE=<key file path> \
  -e PROJECT_ID=<project id> \
  -e POSTHOG_REGION=us \
  -- npx tsx "$WIZARD_PATH/scripts/wizard-ci-mcp.no-jest.ts"
```

Confirm it loads: `claude mcp list` shows `wizard-ci: … ✔ Connected`. Then tell the
user to **start a fresh Claude Code session in this repo** (a new tab) — that's
where the tools live. (`APP_DIR` is any dir, so an external repo works: clone it to
`/tmp` and point `APP_DIR` at it.)

**Phase 2 — drive (in the fresh session):** the `wizard-ci` tools are now bound.
Walk the flow, deciding each screen:

- **`read_state`** — current screen, run phase, secret-free session, tasks, the
  actions legal now. Call first and after every move.
- **`perform_action {action, params?}`** — `confirm_setup`, `dismiss_outage`,
  `choose` (a setup question), `set_mcp_outcome`, `dismiss_slack`, `keep_skills`.
- **`render_screen`** — render the current TUI to ANSI so you can _see_ it.
- **`run_agent`** — on the `run` screen, the **real integration** (blocks minutes).

```
read_state → intro → perform_action confirm_setup
read_state → health-check → perform_action dismiss_outage
read_state → run → run_agent            (the real integration)
read_state → outro → perform_action dismiss_outro → … → keep_skills
```

## 2. Drive it from a script (no fresh session needed)

If you can't start a new session, drive the same `WizardCiDriver` from a script —
`readState()` → your decision → `performAction()`, `renderFrame()` to view. Put it
inside this repo (so `@lib`/`@e2e-harness` resolve) as `scripts/explore.no-jest.ts`,
run `npx tsx scripts/explore.no-jest.ts`, then delete it.

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
  await store.runReadyHooks();
  store.runInitHooks();
  const rec = new WizardRecorder(store, { program: 'posthog-integration' });
  rec.start();
  const driver = new WizardCiDriver(store);
  const at = () => {
    const s = driver.readState();
    console.log(s.currentScreen, s.actions.map((a) => a.id));
  };

  at(); // intro
  driver.performAction('confirm_setup');
  at(); // health-check
  driver.performAction('dismiss_outage');
  // setup question? -> driver.performAction('choose', { key, value })

  await store.getGate('intro');
  await store.getGate('health-check');
  await runAgent(posthogIntegrationConfig, store.session); // the real integration

  driver.performAction('dismiss_outro');
  driver.performAction('set_mcp_outcome', { outcome: 'skipped' });
  driver.performAction('dismiss_slack');
  driver.performAction('keep_skills', { kept: false });

  rec.stop();
  for (const f of rec.getRecording().frames) {
    console.log(`\n=== ${f.screen} ===\n` + renderFrame(f, Program.PostHogIntegration));
  }
}
main();
```

## 3. Or run it hands-off (scripted)

To let the scripted profile decide (for apps under `wizard-workbench/apps/`):

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
