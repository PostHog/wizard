# Driving & exploring the wizard as an agent

A runbook for a future AI agent (you) that wants to **run the real wizard
headlessly, drive its state, and snapshot the TUI to view it** — to explore or
test the app with no terminal. It uses the control plane in this folder
(`WizardCiDriver` + the `wizard-ci-tools` MCP server). For _how_ it works under
the hood, read [`ARCHITECTURE.md`](ARCHITECTURE.md); this is the _how to do it_.

## 0. Ask for the key, then set up

**First, ask the user for the path to their PostHog key file** — e.g. "What's
the absolute path to your phx key file?" — plus the project id and region if you
don't have them. Then, in the shell you'll run from:

```bash
export POSTHOG_PERSONAL_API_KEY="$(cat <key-file-path>)"   # the phx key
export POSTHOG_WIZARD_PROJECT_ID=<project-id>              # the team the key is scoped to
export POSTHOG_REGION=us                                   # or eu
export WIZARD_PATH=<this wizard repo>                      # where e2e-harness/ lives
```

Rules: **never print or commit the key.** Always run against a **`/tmp` copy**
of an app, never a real fixture. If you're inside a Claude Code session, the
harness strips the host `CLAUDE_*`/`ANTHROPIC_*` env for the child so the
spawned agent auths with the phx key (the `apiKeySource: none` → 401 trap).

## 1. Full run, then view it (the easy path)

From [wizard-workbench](https://github.com/PostHog/wizard-workbench):

```bash
pnpm wizard-ci <app> --e2e          # real agent, headless; writes a recording
pnpm wizard-ci-snapshots <app>       # renders each key moment → .ans + report.html
```

To watch it back:
`pnpm wizard-ci --replay /tmp/wizard-e2e-<app>.recording.json --step`, or just
read the `.ans` frames / `report.html`. This is the whole flow, real agent, no
decisions for you to make.

## 2. Drive it yourself (the control plane)

To step the flow and **decide each screen**, use the three primitives —
`read_state`, `list_actions`, `perform_action`. They're exposed as the
`wizard-ci-tools` MCP server (`createWizardCiToolsServer`) for a connected
driver model; the same primitives are `WizardCiDriver` methods you can call
directly from a tsx script. The loop is always:

```
read_state → look at currentScreen + the legal actions → perform_action(one of them) → read_state → …
```

Recipe — write it to a scratch file **inside this repo** so the `@lib`/`@ui`/
`@e2e-harness` aliases resolve (a `/tmp` file won't see the tsconfig). Name it
`scripts/explore.no-jest.ts` (the `.no-jest` suffix keeps Jest from picking it
up), run `npx tsx scripts/explore.no-jest.ts` from `$WIZARD_PATH`, then delete
it. It drives the **UI** screens offline (no agent/auth) and renders each one so
you can see it:

```ts
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import { WizardRecorder } from '@e2e-harness/recorder';
import { renderFrame } from '@e2e-harness/replay';

async function main() {
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));
  store.session = buildSession({ installDir: '/tmp/app-copy', ci: true });
  await store.runReadyHooks(); // real framework detection

  const rec = new WizardRecorder(store, { program: 'posthog-integration' });
  rec.start();
  const driver = new WizardCiDriver(store);

  // LOOK: where am I, and what can I commit?
  console.log(
    driver.readState().currentScreen,
    driver.listActions().map((a) => a.id),
  );

  // ACT: name an action from list_actions (not a keystroke)
  driver.performAction('confirm_setup');
  console.log(
    driver.readState().currentScreen,
    driver.listActions().map((a) => a.id),
  );
  // …repeat: read_state → decide → perform_action…

  // VIEW: render every captured frame as the real TUI (ANSI) so you can see it
  rec.stop();
  for (const f of rec.getRecording().frames) {
    console.log(
      `\n=== ${f.screen} ===\n` + renderFrame(f, Program.PostHogIntegration),
    );
  }
}
main();
```

`auth` and `run` are _external_ steps (the runner sets credentials, the agent
sets run state) — for those, drive the full `--e2e` path in §1, which runs the
real agent and records it for you.

## 3. Snapshot for yourself to view

Two ways to "see" a screen as an agent:

- **`renderFrame(frame, program)`** → the real Ink screen as an ANSI string you
  can print and read (used above). Strip ANSI if you want plain text.
- **The recording JSON** — each frame already carries `screen`, `tasks`,
  `statusMessages`, and the (secret-redacted) `session`, so you can assert on
  what happened without rendering.

The access token is redacted in both `read_state` and recordings, so anything
you capture is safe to share.

## Key facts

- **State → screen.** You never navigate; you flip a session flag (via an
  action's store setter) and the router re-derives the active screen. Name
  actions, not keys.
- **Secrets stay out.** `read_state` reduces credentials to `hasCredentials` +
  `projectId`; the token is never serialized.
- **None of this ships.** The harness lives in `e2e-harness/`, out of `src/`,
  and is absent from the production bundle.
