# Driving wizard e2e runs from an agent

For a future AI agent asked to run a **real** wizard integration end-to-end and
check it worked. This is the control-plane path (`wizard-ci --e2e`): it runs the
WHOLE interactive flow headlessly via `wizard-ci-tools` and asserts on structured
state — not the classic `--ci` (LoggingUI, stdout-grep, agent-only).

It complements the human runbook `workbench/ci-verify-plan.md` (read that too —
it has the key/region/build-channel facts). This doc is the agent-specific how-to.

## The one command

```bash
cd <workbench>/wizard-workbench
WIZARD_PATH=<workbench>/wizard \
POSTHOG_PERSONAL_API_KEY="$(cat <workbench>/test-api-key.txt)" \
POSTHOG_REGION=us \
  npx tsx services/wizard-ci/index.ts \
    basic-integration/javascript-node/express-todo --e2e --project-id 228144
```

Pass `--keep-skills` to keep the installed skills (default deletes them). Swap the
app path for any `apps/<...>` dir (e.g. `basic-integration/next-js/15-app-router-todo`).

It copies the app to `/tmp`, runs the real agent against prod cloud, drives every
screen, and prints `✓ E2E PASS` / `✗ E2E FAIL` + a `/tmp/wizard-e2e-<app>.json`
result. Exit 0 = pass. A run takes **~3-8 min** (gateway round-trips dominate).

## The four things that bite an agent (and why)

1. **You are running INSIDE a Claude Code session.** Its env
   (`CLAUDECODE`, `CLAUDE_CODE_SDK_HAS_*_REFRESH`, `ANTHROPIC_*`, …) makes the
   wizard's spawned agent defer auth to the host → `apiKeySource: none` → **401
   auth-error**. The wizard-ci `--e2e` path strips these for the child, so the
   one command above is safe. If you ever invoke the harness directly, strip them
   yourself (see `STRIP_ENV` in `services/wizard-ci/e2e.ts`). A plain CI shell
   doesn't have these, so it never hits this.

2. **The test key is project-scoped.** `test-api-key.txt` only reads project
   **228144** ("cookiesssss", US). Without `--project-id 228144` (or
   `POSTHOG_WIZARD_PROJECT_ID`), bootstrap 403s ("Access denied while trying to
   fetch project data"). The key is still valid — it authenticates and works as
   the LLM gateway bearer; it just isn't scoped to the default team.

3. **Never run on the real fixture.** Always a `/tmp` copy (the harness does
   this). The runbook: after any accidental run on a real app, `git checkout` it.

4. **Runs are sequential, and minutes long.** The agent log is a single shared
   file (`/tmp/posthog-wizard.log`) — never run two at once. Launch with
   `run_in_background: true` and watch with a Monitor on the output file; don't
   block. Watch for: `screen →`, `assertions`, `E2E PASS/FAIL`, and `auth-error`.

## How to read the result

`/tmp/wizard-e2e-<app>.json` (and the stdout assertions):

| field | pass when |
|---|---|
| `runPhase` | `"completed"` (the agent finished) |
| `hasPosthogDep` / `envFile` | a posthog dep was added and/or a `.env*` written |
| `screenPath` | includes `keep-skills` (full flow walked) |
| `skillsComplete` | `true` (run reached its done-signal) |
| `skillsDeleted` | `true` when policy = delete |

Also eyeball the `/tmp/<app>` copy: `package.json` has `posthog-*`, an `.env*`
has `POSTHOG_*`, and framework-specific files exist (e.g. Next.js
`instrumentation-client.ts` with `posthog.init(...)`).

## How it's built (so you can change it)

```
wizard-ci --e2e (workbench/services/wizard-ci/{index,e2e}.ts)
  → spawns the wizard repo's headless harness (env-stripped, /tmp copy):
      wizard/scripts/e2e-full-run.no-jest.ts
        · real WizardStore + InkUI (never rendered) — no terminal, no browser
        · real runAgent → prod gateway (phx key as bearer, --project-id)
        · a concurrent WizardCiDriver drives each screen
  → reads E2E_RESULT_JSON and asserts
```

The driver is `wizard/src/lib/ci-driver/` — `WizardCiDriver` (read_state /
list_actions / perform_action), the screen→action registry, and the
`wizard-ci-tools` MCP server.

**To change what the run clicks**, edit the program's **e2e profile** — the UI
choices live ON the program, not in the harness:
the profile in `src/lib/programs/posthog-integration/e2e.ts` (wired in via
`ProgramConfig.e2e`), typed by `WizardE2eProfile`
(`src/lib/ci-driver/e2e-profile.ts`). The harness
asks `decideE2eAction(state, profile)` what to commit on each screen. To make a
*different* program e2e-drivable, give it an `e2e` profile too.

**The flow is snapshot-tested** offline (no agent, deterministic):
`src/lib/ci-driver/__tests__/e2e-flow-snapshot.test.ts` golden-checks the
(screen → decision) trace. If you change the flow or a profile, update with
`jest -u`. This is the structured-state analog of the TUI ANSI screenshots in
`scripts/__screenshots__/`.

## Record & replay (verify a run after the fact)

Every `--e2e` run is **recorded** as a timeline of key-moment frames — one each
time the store/router changes (a route change, a task-list update, a new status
line, a runPhase change, an overlay). The recording lands at
`/tmp/wizard-e2e-<app>.recording.json` and the run prints the replay command.

Replay reconstructs each frame's store and renders the **real Ink screen** back
to the terminal, so you (agent or human) can watch the run play back to verify it:

```bash
pnpm wizard-ci --replay /tmp/wizard-e2e-<app>.recording.json          # Enter ▸ step
pnpm wizard-ci --replay /tmp/wizard-e2e-<app>.recording.json --delay 1200  # auto
```

As an agent you can't sit in the interactive stepper, but you can: (a) read the
recording JSON directly (each frame has `triggers`, `screen`, `tasks`,
`statusMessages`, redacted `session`) to assert the run hit the right moments, or
(b) render specific frames to ANSI offline with `renderFrame()` from
`src/lib/ci-driver/replay.ts`. The access token is redacted, so recordings are
safe to share. Code: `recorder.ts` (capture) + `replay.ts` (render).

## Driving it as a true LLM loop (optional)

The `wizard-ci-tools` MCP server exposes `read_state` / `list_actions` /
`perform_action` to an external driver. To have an LLM (not a scripted profile)
play the user, connect a driver model to that server and loop
`read_state → reason → perform_action`. Proven working: a gateway model called
`perform_action {action:"confirm_setup"}` and advanced the real store. For
deterministic CI, prefer the scripted profile above; reserve the LLM loop for
fuzzing the flow. Auth caveat: a bare `query()` 401s on the follow-up turn
through the `/wizard` gateway — route through the wizard's real `initializeAgent`
for multi-turn (see `wizard-ci-tools-research.md`).
