# ci-driver — Headless e2e Control Plane

How an agent (or a script) drives a **real** wizard run end-to-end with no
terminal and no browser, and asserts it worked. This is the control-plane path:
it runs the WHOLE interactive flow headlessly via `wizard-ci-tools` and asserts
on structured state — not the classic `--ci` mode (LoggingUI, stdout-grep,
agent-only).

> If you're an agent that just wants to **run and explore the wizard** (drive
> it, view the screens, snapshot it), start with the runbook:
> [`EXPLORING-AS-AN-AGENT.md`](EXPLORING-AS-AN-AGENT.md). This doc is the _how
> it works_ underneath.

## The pieces

This whole harness lives in `e2e-harness/` at the repo root — deliberately OUT
of `src/` so none of it is part of the wizard's production source (nothing in
`src/` imports it; the tsdown bundle never includes it).

```
e2e-harness/
  wizard-ci-driver.ts   WizardCiDriver — read_state / list_actions / perform_action
  action-registry.ts    screen → the actions legal on it (+ NO_ACTION_SCREENS)
  wizard-ci-tools.ts     in-process MCP server exposing the driver to an external loop
  e2e-profile.ts        WizardE2eProfile + decideE2eAction — the scripted walk policy
  profiles.ts           per-program profiles + profileFor(programId)
  recorder.ts           captures a run as key-moment frames
  replay.ts             reconstructs a frame's store and renders the real Ink screen
```

The driver reads and mutates the **real** `WizardStore`: the router resolves the
active screen from session state, every action goes through a store setter, and
the render is a pure projection of that state. So driving the store headlessly
exercises exactly the code an interactive run would.

## Driving a run

A headless run wires a real `WizardStore` + `InkUI` (never rendered), a
concurrent `WizardCiDriver`, and the real `runAgent` against the gateway. The
loop is:

```
read_state → decideE2eAction(state, profile) → perform_action → repeat
```

`scripts/e2e-full-run.no-jest.ts` is the runnable harness; the
[wizard-workbench](https://github.com/PostHog/wizard-workbench)
`wizard-ci --e2e` command orchestrates it (copies the app to a scratch dir,
strips the host env, asserts on the result). Run shape:

```bash
POSTHOG_PERSONAL_API_KEY=… POSTHOG_REGION=us \
  npx tsx scripts/e2e-full-run.no-jest.ts   # APP_DIR, PROJECT_ID via env
```

### Four things that bite

1. **Running inside an agent session.** Host env (`CLAUDECODE`, `ANTHROPIC_*`,
   `CLAUDE_CODE_*`) makes the wizard's spawned agent defer auth to the host →
   `apiKeySource: none` → 401. The harness strips these for the child; if you
   invoke it directly, strip them yourself. A plain CI shell never has them.
2. **A project-scoped key needs its project id.** A personal key scoped to one
   team must be given that team's `--project-id` (or
   `POSTHOG_WIZARD_PROJECT_ID`), or bootstrap 403s on project-data fetch. The
   key still authenticates — it just isn't scoped to the default team.
3. **Never run on a real fixture.** Always a throwaway copy; the harness does
   this.
4. **Runs are sequential and minutes long** (~3–8 min, gateway round-trips
   dominate). The agent log is one shared file — never run two at once.

## Reading the result

The harness emits a JSON result; assert on:

| field                       | pass when                                        |
| --------------------------- | ------------------------------------------------ |
| `runPhase`                  | `"completed"` (the agent finished)               |
| `hasPosthogDep` / `envFile` | a posthog dep was added and/or a `.env*` written |
| `screenPath`                | includes `keep-skills` (full flow walked)        |
| `skillsComplete`            | `true` (run reached its done-signal)             |
| `skillsDeleted`             | `true` when policy = delete                      |

## Changing what the run does

The per-program UI choices are product knowledge, but they live in the harness
(`profiles.ts`, keyed by program id) — not on the program config — so this
machinery stays out of the wizard's production source. Edit the program's entry
in `profiles.ts` (typed by `WizardE2eProfile`). The harness asks
`decideE2eAction(state, profile)` what to commit on each screen. To make another
program e2e-drivable, add its profile to `profiles.ts`.

The flow is **snapshot-tested** offline (no agent, deterministic):
`__tests__/e2e-flow-snapshot.test.ts` golden-checks the (screen → decision)
trace. Update with `jest -u` after an intentional flow/profile change.

## Record & replay

Every run is recorded as a timeline of **key-moment frames** — one each time the
store/router changes (a route, a task-list update, a status line, a runPhase
change, an overlay). Replay reconstructs each frame's store and renders the real
Ink screen back to the terminal, so a run can be watched back to verify it:

A real `--e2e` run drops a recording at `/tmp/wizard-e2e-<app>.recording.json`.

```bash
npx tsx scripts/replay-e2e.no-jest.ts <recording.json> --step           # Enter ▸ step
npx tsx scripts/replay-e2e.no-jest.ts <recording.json> --delay 1200     # auto-play
```

An agent that can't sit in the stepper can instead read the recording JSON
directly (each frame has `triggers`, `screen`, `tasks`, `statusMessages`,
redacted `session`) or render specific frames to ANSI with `renderFrame()` from
`replay.ts`. The access token is redacted, so recordings are safe to share.
Code: `recorder.ts` (capture) + `replay.ts` (render).

## Visual-regression snapshots (the workbench flow)

[wizard-workbench](https://github.com/PostHog/wizard-workbench) drives this for
real-run **visual regression**: `pnpm wizard-ci-snapshots` runs each CI-e2e test
definition as a real `--e2e` run, renders every key-moment frame to a `.ans`
snapshot (via `scripts/render-snapshots.no-jest.ts` → `replay.ts`), and diffs
against a committed baseline, writing a side-by-side `report.html`. Run-to-run
agent differences (e.g. a different task enqueued) are surfaced for a human to
review, not asserted away. It needs `WIZARD_PATH` pointing at a checkout that
has this `e2e-harness/`, plus the e2e env (`POSTHOG_PERSONAL_API_KEY`,
`POSTHOG_WIZARD_PROJECT_ID`, `POSTHOG_REGION`). See
`services/wizard-ci/snapshots.ts` there.

## Driving it as a true LLM loop (optional)

`wizard-ci-tools.ts` exposes `read_state` / `list_actions` / `perform_action` as
an in-process MCP server. To have a model (not a scripted profile) play the
user, connect a driver model and loop `read_state → reason → perform_action`.
For deterministic CI prefer the scripted profile; reserve the LLM loop for
fuzzing the flow. Note: a multi-turn driver must route through the wizard's real
agent initialization for gateway auth — a bare `query()` 401s on the follow-up
turn.
