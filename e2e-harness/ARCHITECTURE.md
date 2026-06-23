# e2e-harness — Headless e2e Control Plane

How an agent (or CI) drives a **real** wizard run end-to-end — the **real TUI**,
no browser, no keystrokes — and captures what it rendered. Both e2e routes share
one idea: run the real `startTUI` (the real ink render) and drive its store by
**state manipulation**, then capture the real rendered screen from a PTY.

> If you're an agent that just wants to run and explore the wizard, use the
> `exploring-the-wizard` skill
> ([`.claude/skills/exploring-the-wizard/SKILL.md`](../.claude/skills/exploring-the-wizard/SKILL.md)).
> This doc is the _how it works_ underneath.

## The pieces

This whole harness lives in `e2e-harness/` at the repo root — deliberately OUT of
`src/` so none of it is part of the wizard's production source (nothing in `src/`
imports it; the tsdown bundle never includes it).

```
e2e-harness/
  wizard-ci-driver.ts   WizardCiDriver — read_state / perform_action over the store
  action-registry.ts    screen → the actions legal on it (+ NO_ACTION_SCREENS)
  e2e-profile.ts        WizardE2eProfile + decideE2eAction — the scripted walk policy
  profiles.ts           per-program profiles + profileFor(programId)
  tui-capture.ts        run a command in a PTY (node-pty) + read its real screen (@xterm/headless)
scripts/
  tui-host.no-jest.ts   the real-TUI host: startTUI + WizardCiDriver, MODE=fixed | serve
  tui-snapshots.no-jest.ts   CI route: host(fixed) in a PTY → per-screen real-TUI snapshots
  wizard-ci-mcp.no-jest.ts   agent route: MCP server proxying host(serve)
```

The driver reads and mutates the **real** `WizardStore` that the TUI renders from:
the router resolves the active screen from session state, every action goes
through a store setter, and the render is a pure projection of that state. So
manipulating the store makes the real TUI react — the driver and the renderer
share one store and never conflict; you never touch the TUI's input.

## Auth without a browser

The real TUI runs `ci: true`, and auth is satisfied by **state manipulation**:
`getOrAskForProjectData({ ci: true, apiKey })` resolves the phx personal key into
credentials, and `store.setCredentials(...)` sets them — the same bearer path an
OAuth token takes, so the auth screen advances with no browser and no keystrokes.
(`run_agent` does the same bootstrap as part of the real integration.)

## The two routes

- **CI snapshots** — `tui-snapshots.no-jest.ts` spawns `tui-host` (`MODE=fixed`)
  in a PTY. The host self-drives the fixed profile (`decideE2eAction`) and signals
  each new screen; the parent writes the real rendered screen to
  `SNAP_OUT/NN-<screen>.txt`. `RUN_AGENT=1` runs the real agent through to outro.
- **Agent** — `wizard-ci-mcp.no-jest.ts` is a stdio MCP server that spawns
  `tui-host` (`MODE=serve`) and proxies: `read_state` / `perform_action` /
  `run_agent` forward over a unix socket; `render_screen` returns the real
  captured frame. The agent decides each screen itself.

## Things that bite

1. **Running inside an agent session.** Host env (`CLAUDECODE`, `ANTHROPIC_*`,
   `CLAUDE_CODE_*`) makes the wizard's spawned agent defer auth to the host →
   `apiKeySource: none` → 401. The harness strips these for the child. A plain CI
   shell never has them.
2. **A project-scoped key needs its project id.** Pass the team's `--project-id`
   (or `POSTHOG_WIZARD_PROJECT_ID`), or bootstrap 403s on project-data fetch.
3. **Never run on a real fixture.** Always a throwaway copy.
4. **`run_agent` is minutes long and creates real resources** (a dashboard +
   insights) each run; the agent log is one shared file — never run two at once.
5. **node-pty's spawn-helper.** When the package is extracted without running its
   build script (pnpm skips it), the prebuilt `spawn-helper` loses its execute
   bit and `pty.spawn` fails with `posix_spawnp failed`. `tui-capture.ts` restores
   it best-effort on each spawn.

## Changing what the run does

Per-program UI choices live in the harness (`profiles.ts`, keyed by program id) —
not on the program config — so this machinery stays out of production source. Edit
the program's entry (typed by `WizardE2eProfile`); the host asks
`decideE2eAction(state, profile)` what to commit on each screen. The (screen →
decision) trace is snapshot-tested offline in `__tests__/` (`jest -u` to update).

## Visual-regression snapshots (the workbench flow)

[wizard-workbench](https://github.com/PostHog/wizard-workbench) runs the CI route
for real-run visual regression: each test definition runs `tui-snapshots`, the
real-TUI screens are rasterized to a side-by-side baseline-vs-current review, and
run-to-run differences are surfaced for a human, not asserted away. See
`services/wizard-ci/` there.
