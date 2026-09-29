# e2e-harness — Headless e2e Control Plane

How an agent (or CI) drives a **real** wizard run end-to-end — the **real TUI**,
no browser, no keystrokes — and captures what it rendered. Both e2e routes share
one idea: run the real TUI host, `runTui` (the real ink render), and drive it by
**state manipulation** through its control target, then capture the real
rendered screen from a PTY.

> If you're an agent that just wants to run and explore the wizard, use the
> `exploring-the-wizard` skill
> ([`.claude/skills/exploring-the-wizard/SKILL.md`](../.claude/skills/exploring-the-wizard/SKILL.md)).
> This doc is the _how it works_ underneath.

## The pieces

The harness lives in `e2e-harness/` and `scripts/`, out of `src/`, with each
program's profile in `src/programs/<id>/test/e2e.json`. No production module
imports it, so the tsdown bundle never includes it. It imports the wizard only
through public entries (`@tui`, `@programs`, `@programs/<id>`, `@agent/types`,
`@shared/*` and the rest). Its own project, [`tsconfig.json`](tsconfig.json),
references every layer it imports, and `pnpm typecheck` fails a deeper `@tui/*`
import and any import of Ink or React. ESLint fails a deeper `@programs/*`,
`@agent/*` or `@cli/*` import and a relative import out of `e2e-harness/`.

```
e2e-harness/
  wizard-ci-driver.ts   WizardCiDriver — read_state / perform_action over the TUI's control target
  e2e-profile.ts        WizardE2eProfile + decideE2eAction — the scripted walk policy
  profiles.ts           reads every program's e2e.json: profileFor(programId) + resolveE2eProfile(profile, overrides)
  e2e-result.ts         the E2E_RESULT_JSON payload: E2eRunRecorder + buildE2eResult
  tui-capture.ts        run a command in a PTY (node-pty) + read its real screen (@xterm/headless)
scripts/
  tui-host.no-jest.ts   the real-TUI host: runTui + WizardCiDriver, MODE=fixed | serve
  tui-snapshots.no-jest.ts   CI route: host(fixed) in a PTY → per-screen real-TUI snapshots
  wizard-ci-mcp.no-jest.ts   agent route: MCP server proxying host(serve)
```

`runTui` hands the host its store's control target through `control.attach`, the
same target the control API serves: the projected state, the commits legal on
the current screen, and the named setters. The router resolves the active screen
from that state, every action commits through the store, and the render is a
pure projection of it. So a commit makes the real TUI react — the driver and the
renderer share one store and never conflict; you never touch the TUI's input.
The state is the control projection: no token, key or answer value, and
secret-named framework-context keys redacted.

The profile loader, the driver and the walk policy name no program.
`profiles.ts` reads each `src/programs/<id>/test/e2e.json` and keys it by the
file's `program` field, which must be a registered program id. The driver's
actions are the TUI control actions: the core screens' and overlays' own, each
program screen's from its TUI entry, and the shared `confirm_setup` on a
`*-intro` screen with none.

## Auth without a browser

The real TUI runs `ci: true`, with the phx personal key as its login
(`launch.credentials`): the run resolves it into project credentials and commits
them to the store, and the pre-issued gateway token rides on that login. Gateway
authentication then follows the shared runner path; see the
[runner policy](../.claude/skills/wizard-development/SKILL.md). The run starts
once the intro and the pre-run gates pass. In `MODE=serve` the host holds the
login until `run_agent` releases it.

The direct host reads `APP_DIR`, `PROJECT_ID`, and either
`POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE`. The MCP route accepts
`appDir`, `projectId`, and optional `keyFile` or `apiKey` through `open_app`.
Detection-only MCP runs never call `run_agent`, so they stop at `auth`.

Agent runs require `WIZARD_CI_GATEWAY_TOKEN_FILE` containing an already-issued
gateway bearer. CI uses it directly and never mints or refreshes it; missing or
rejected credentials fail the run. `WIZARD_CI_GATEWAY_URL` optionally overrides
`https://ai-gateway.<region>.posthog.com`. `POSTHOG_KEY_FILE` /
`POSTHOG_PERSONAL_API_KEY` are separate credentials for PostHog API and MCP. The
same gateway settings apply to development `--ci` runs.

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

`read_state` adds background `integration` and `integrationError` to the
driver's state: `idle` until `run_agent`, then the run's phase, `running`,
`done` once a run completes, or `failed` with the error outro's message. A
program that composes runs, such as self-driving, reads `done` after each one,
so read `currentScreen` as well. Framework identity is the separate
`session.integration`. `perform_action` returns only the driver's state, so read
again to refresh background status. Legal actions come from
`read_state.actions`; the MCP has no `list_actions` or `wait_for_change` tool.

Keep handling overlays while the agent runs. `runPhase=completed` ends the main
work, while `session.skillsComplete` ends the integration flow's follow-up
screens and the host with it. Recording MCP or keep-skills outcomes only commits
store state; it does not perform installation or cleanup. For failures, capture
the error outro before dismissing it: dismissing it ends the run.

## Current host limitations

- `open_app` accepts `region`, but `tui-host` currently builds a US session
  regardless of `POSTHOG_REGION`; this route cannot verify EU authentication.
- The host reads `POSTHOG_PERSONAL_API_KEY` before `POSTHOG_KEY_FILE`. An
  inherited personal key can therefore shadow an explicit MCP `keyFile`; unset
  that variable in the server's launch environment when using a key file.
- The fixed route computes its own detection picks for self-driving, error
  tracking and source maps and commits them as the MCP route's caller does:
  `pick_integration_target` on a screen that offers it (the self-driving and
  error-tracking detect screens), `pick_source_maps_project` on the source-maps
  one, with the path and framework or variant it chose.
- `tui-host` takes the control target in process and serves its own socket. The
  wizard's `--control-socket` API is a separate surface the harness doesn't use.

## Things that bite

1. **Inherited agent auth.** The launchers strip Claude/Anthropic environment
   variables so the legacy SDK does not defer authentication to an outer agent
   session. Direct host callers must arrange the same isolation.
2. **A project-scoped key needs its project id.** Use `PROJECT_ID` for the
   direct host or `projectId` for MCP; the CLI's `--project-id` is a different
   surface.
3. **Never run on a real fixture.** Always a throwaway copy.
4. **`run_agent` is minutes long and creates real resources** (a dashboard +
   insights) each run, so never run two at once. The agent log is one shared
   file unless each run sets `POSTHOG_WIZARD_LOG_FILE`.
5. **node-pty's spawn-helper.** When the package is extracted without running
   its build script (pnpm skips it), the prebuilt `spawn-helper` loses its
   execute bit and `pty.spawn` fails with `posix_spawnp failed`.
   `tui-capture.ts` restores it best-effort on each spawn.

## Changing what the run does

Per-program UI choices are the `profile` in `src/programs/<id>/test/e2e.json`
(typed by `WizardE2eProfile`), which `profiles.ts` finds by the file's `program`
field. Edit that `profile`; the fixed host asks
`decideE2eAction(state, profile)` what to commit on each screen. A core screen
has its own case. A program screen commits the first of its actions that
`PROGRAM_SCREEN_COMMITS` in `e2e-profile.ts` lists (`confirm_setup`,
`dismiss_outro`, `dismiss`, `confirm_self_driving_handoff` and `set_integrate`,
which takes `profile.integrate`), and waits when it offers none of them. The
(screen → decision) trace is snapshot-tested offline in `__tests__/` (Vitest
`--update` refreshes snapshots).

## Driving the agent-in-the-loop layer

Two decision points ask a person to act, and the harness stands in for them.

`wizard_ask` overlay. A `ci` session normally has no ask bridge at all. The host
always sets `WIZARD_ASK_AUTODRIVE=1`, which keeps the linear sequence's bridge.
`E2E_ASK=true` sets `session.e2eAsk`, which also keeps the orchestrator's bridge
and the seeded warehouse task (see `shouldDisableAsk`). In the fixed route, the
profile answers every question except the host's source-maps overrides
(`api-key`, `test-affordance`, `test-done`): `askAnswers` routes a question to a
value, else the first option, else the `'e2e'` sentinel. Route credentials with
`${ENV_VAR}` values, never literals.

Mark a credential rule `"secret": true`. The skill names its own questions, so a
rule matches text the agent controls — without the flag, a question called
`password` takes the value, and by omitting `sensitive: true` gets it back
unvaulted in plaintext. A secret rule answers only free text flagged sensitive
and refuses every other question shape; refusals land in the payload's
`refusedIds` / `refusedAsks`, so a run that withholds a credential says so
instead of looking like an ordinary sentinel.

Task-notice overlay. `profile.notice` decides `keep` or `decline`. `E2E_NOTICE`
overrides it per run.

`resolveE2eProfile` folds `E2E_NOTICE`, the extra rules in `E2E_ANSWERS_FILE`
(matched first) and `${VAR}` values into the profile, at load. `decideE2eAction`
must stay pure — it reads no env and no store.

In the MCP route, use `perform_action` for `answer_question` (a complete answers
map), `cancel_question`, or `resolve_notice` with `params: { keep }`. Read
`pendingQuestion` and `taskNotice` for the decision. Profiles do not answer
these overlays in `MODE=serve`.

## The result payload

A `MODE=fixed` run writes `E2E_RESULT_JSON`: the run phase and screens walked,
whether the app has a PostHog dependency, its new dependencies, the env file,
whether the skills step completed, every ask batch (answered, unanswered and
refused), every task notice, the task list and task outcomes, the detected
warehouse sources, the program's report file, and the abort reason.
`e2e-result.ts` builds it.

**Only question prompt text and question ids go in the payload. No answer value
ever does.** The decision function reports ids and a keep/decline verdict, so
the recorder never holds an answer. Keep it that way — the workbench scans the
file for its own injected credentials.

The report file is the one payload field that copies a file's text from the app
directory, which is a checkout the run does not control. `readReportFile` reads
only a regular file inside `appDir` — never a symlink, and never through a
parent that resolves outside `appDir` — so a committed
`posthog-warehouse-report.md` pointing at a host file cannot copy it into the
payload.

## Visual-regression snapshots (the workbench flow)

[wizard-workbench](https://github.com/PostHog/wizard-workbench) runs the CI
route for real-run visual regression: each test definition runs `tui-snapshots`,
the real-TUI screens are rasterized to a side-by-side baseline-vs-current
review, and run-to-run differences are surfaced for a human, not asserted away.
See `services/wizard-ci/` there.
