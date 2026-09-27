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

This whole harness lives in `e2e-harness/` at the repo root — deliberately OUT
of `src/` so none of it is part of the wizard's production source (nothing in
`src/` imports it; the tsdown bundle never includes it).

```
e2e-harness/
  wizard-ci-driver.ts   WizardCiDriver — read_state / perform_action over the store
  action-registry.ts    screen → the actions legal on it (+ NO_ACTION_SCREENS)
  e2e-profile.ts        WizardE2eProfile + decideE2eAction — the scripted walk policy
  profiles.ts           per-program profiles + profileFor(programId) + resolveE2eProfile(env)
  e2e-result.ts         the E2E_RESULT_JSON payload: E2eRunRecorder + buildE2eResult
  tui-capture.ts        run a command in a PTY (node-pty) + read its real screen (@xterm/headless)
scripts/
  tui-host.no-jest.ts   the real-TUI host: startTUI + WizardCiDriver, MODE=fixed | serve
  tui-snapshots.no-jest.ts   CI route: host(fixed) in a PTY → per-screen real-TUI snapshots
  wizard-ci-mcp.no-jest.ts   agent route: MCP server proxying host(serve)
```

The driver reads and mutates the **real** `WizardStore` that the TUI renders
from: the router resolves the active screen from session state, every action
goes through a store setter, and the render is a pure projection of that state.
So manipulating the store makes the real TUI react — the driver and the renderer
share one store and never conflict; you never touch the TUI's input.

## Auth without a browser

The real TUI runs `ci: true`. `run_agent` enters the normal program bootstrap,
which resolves the phx personal key into project credentials and commits them to
the store. Gateway authentication then follows the shared runner path; see the
[runner policy](../.claude/skills/wizard-development/SKILL.md).

The direct host reads `APP_DIR`, `PROJECT_ID`, and either
`POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE`. The MCP route accepts
`appDir`, `projectId`, and optional `keyFile` or `apiKey` through `open_app`.
Detection-only MCP runs omit the key and stop at `auth`. The internal socket's
`set_credentials` command is not exposed as an MCP tool.

Agent runs require `WIZARD_CI_GATEWAY_TOKEN_FILE` containing an already-issued
gateway bearer. CI uses it directly and never mints or refreshes it; missing or
rejected credentials fail the run. `WIZARD_CI_GATEWAY_URL` optionally overrides
`https://ai-gateway.<region>.posthog.com`. `POSTHOG_KEY_FILE` /
`POSTHOG_PERSONAL_API_KEY` remain separate credentials for PostHog API and MCP.
The same gateway settings apply to development `--ci` runs.

## The two routes

- **CI snapshots** — `tui-snapshots.no-jest.ts` spawns `tui-host` (`MODE=fixed`)
  in a PTY. The host self-drives the fixed profile (`decideE2eAction`) through
  the real agent run and signals each key moment; the parent writes the real
  rendered screen to `SNAP_OUT/NN-<screen>.ans`, preserving colors and
  attributes.
- **Agent** — `wizard-ci-mcp.no-jest.ts` is a stdio MCP server that spawns
  `tui-host` (`MODE=serve`) and proxies: `read_state` / `perform_action` /
  `run_agent` forward over a unix socket; `render_screen` returns the captured
  frame as plain text with ANSI removed. The agent decides each screen itself.

Both routes use a 180×50 PTY by default; `PTY_COLS` and `PTY_ROWS` override it.
Snapshots capture screen transitions and within-screen progress, not just the
final outro.

## Run selection and state

`PROGRAM` selects a program id and defaults to `posthog-integration`.
`SNAP_HARNESS`, `SNAP_SEQUENCE`, and `SNAP_MODEL` feed the development
switchboard overrides. Omitted values use normal flag and binding resolution;
the host does not force Pi or orchestration. For new exploration, follow the
[runner policy](../.claude/skills/wizard-development/SKILL.md) and set the
server's launch environment accordingly. These inputs are not `open_app`
arguments; there is no MCP effort or system-prompt override.

`read_state` adds background `integration` (`idle`, `running`, `done`, `failed`)
and `integrationError` to the driver's state. Framework identity is the separate
`session.integration`. `perform_action` returns only the driver's state, so read
again to refresh background status. Legal actions come from
`read_state.actions`; the MCP has no `list_actions` or `wait_for_change` tool.

Keep handling overlays while the agent runs. `runPhase=completed` ends the main
work, while `session.skillsComplete` ends the integration flow's follow-up
screens. Recording MCP or keep-skills outcomes only commits store state; it does
not perform installation or cleanup. For failures, capture the error outro
before dismissing it: `wizardAbort` can wait there with background status still
`running`, then exit the host instead of returning `integration=failed`.

## Current host limitations

- `open_app` accepts `region`, but `tui-host` currently builds a US session
  regardless of `POSTHOG_REGION`; this route cannot verify EU authentication.
- The host reads `POSTHOG_PERSONAL_API_KEY` before `POSTHOG_KEY_FILE`. An
  inherited personal key can therefore shadow an explicit MCP `keyFile`; unset
  that variable in the server's launch environment when using a key file.
- Some interactive pickers are not represented by driver actions. The fixed
  route supplies its own detection picks for self-driving and source maps; those
  conveniences do not automatically apply to the MCP route.

## Things that bite

1. **Inherited agent auth.** The launchers strip Claude/Anthropic environment
   variables so the legacy SDK does not defer authentication to an outer agent
   session. Direct host callers must arrange the same isolation.
2. **A project-scoped key needs its project id.** Use `PROJECT_ID` for the
   direct host or `projectId` for MCP; the CLI's `--project-id` is a different
   surface.
3. **Never run on a real fixture.** Always a throwaway copy.
4. **`run_agent` is minutes long and creates real resources** (a dashboard +
   insights) each run; the agent log is one shared file — never run two at once.
5. **node-pty's spawn-helper.** When the package is extracted without running
   its build script (pnpm skips it), the prebuilt `spawn-helper` loses its
   execute bit and `pty.spawn` fails with `posix_spawnp failed`.
   `tui-capture.ts` restores it best-effort on each spawn.

## Changing what the run does

Per-program UI choices live in the harness (`profiles.ts`, keyed by program id)
— not on the program config — so this machinery stays out of production source.
Edit the program's entry (typed by `WizardE2eProfile`); the fixed host asks
`decideE2eAction(state, profile)` what to commit on each screen. The (screen →
decision) trace is snapshot-tested offline in `__tests__/` (Vitest `--update`
refreshes snapshots).

## Driving the agent-in-the-loop layer

Two decision points ask a person to act, and the harness stands in for them.

`wizard_ask` overlay. A `ci` session normally has no ask bridge at all. The host
sets `session.e2eAsk` from `E2E_ASK=true`, which keeps the bridge wired (see
`shouldDisableAsk`). In the fixed route, the profile answers every question:
`askAnswers` routes a question to a value, else the first option, else the
`'e2e'` sentinel. Route credentials with `${ENV_VAR}` values, never literals.

Mark a credential rule `"secret": true`. The skill names its own questions, so a
rule matches text the agent controls — without the flag, a question called
`password` takes the value, and by omitting `sensitive: true` gets it back
unvaulted in plaintext. A secret rule answers only free text flagged sensitive
and refuses every other question shape; refusals land in the payload's
`refusedIds` / `refusedAsks`, so a run that withholds a credential says so
instead of looking like an ordinary sentinel.

Task-notice overlay. `profile.notice` decides `keep` or `decline`. `E2E_NOTICE`
overrides it per run.

Both env inputs are folded into the profile by `resolveE2eProfile`, at load.
`decideE2eAction` must stay pure — it reads no env and no store.

In the MCP route, use `perform_action` for `answer_question` (a complete answers
map), `cancel_question`, or `resolve_notice` with `params: { keep }`. Read
`pendingQuestion` and `taskNotice` for the decision. Profiles do not answer
these overlays in `MODE=serve`.

## The result payload

A `MODE=fixed` run writes `E2E_RESULT_JSON`: the run phase and screens walked,
plus every ask batch, every task notice, the task list, the detected warehouse
sources, the program's report file, and the abort reason. `e2e-result.ts` builds
it.

**Only question prompt text and question ids go in the payload. No answer value
ever does.** The decision function reports ids and a keep/decline verdict, so
the recorder never holds an answer. Keep it that way — the workbench scans the
file for its own injected credentials.

The report file is the one payload field whose _content_ comes from the app
directory, which is a checkout the run does not control. `readReportFile` reads
only a regular file inside `appDir` — never a symlink, and never through a
symlinked parent — so a committed `posthog-warehouse-report.md` pointing at a
host file cannot copy it into the payload.

## Visual-regression snapshots (the workbench flow)

[wizard-workbench](https://github.com/PostHog/wizard-workbench) runs the CI
route for real-run visual regression: each test definition runs `tui-snapshots`,
the real-TUI screens are rasterized to a side-by-side baseline-vs-current
review, and run-to-run differences are surfaced for a human, not asserted away.
See `services/wizard-ci/` there.
