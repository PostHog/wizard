# e2e-harness: the headless control plane

How an agent or CI drives a **real** wizard run end to end: the real TUI, no
browser, no keystrokes, and a capture of what it rendered. The wizard serves a
control API over a unix socket; the harness is one of its clients.

> If you are an agent that wants to run and explore the wizard, use the
> `exploring-the-wizard` skill
> ([`.claude/skills/exploring-the-wizard/SKILL.md`](../.claude/skills/exploring-the-wizard/SKILL.md)).
> This document is the _how it works_ underneath.

## The pieces

The harness lives in `e2e-harness/` at the repo root, out of `src/`, so none of
it ships. The control API itself ships with the wizard, in
[`src/store/control/`](../src/store/control/), because published headless runs
use it.

```
src/store/control/
  server.ts             attachControlServer: HTTP/1.1 over a unix socket, one store
  client.ts             ControlClient: the parent's side of the same API
  actions.ts            generic actions per flow key; programs add controlActions
  state.ts              the secret-free projection GET /state returns
  driver.ts             ControlDriver: read and act on one store in process
  runs.ts               the run ledger behind POST /runs and GET /runs
e2e-harness/
  launch.ts             buildLaunch: the argv and env that start a controlled wizard
  picks.ts              the detection picks a headless run supplies to picker screens
  e2e-profile.ts        WizardE2eProfile and decideE2eAction: the scripted walk policy
  profiles.ts           per-program profiles, profileFor(programId), resolveE2eProfile(env)
  e2e-result.ts         the E2E_RESULT_JSON payload: E2eRunRecorder and buildE2eResult
  tui-capture.ts        run a command in a PTY (node-pty) and read its real screen
scripts/
  tui-snapshots.no-jest.ts   CI route: the wizard in a PTY, driven over the socket, per-screen snapshots
  wizard-ci-mcp.no-jest.ts   agent route: an MCP server that proxies the same API
```

The server reads and mutates the **real** `WizardStore` the TUI renders from.
The router resolves the active screen from session state, every action goes
through a store setter, and the render is a pure projection of that state. So a
commit over the socket makes the real TUI react, and the parent never touches
the TUI's input.

## Launching a controlled wizard

`buildLaunch` in `launch.ts` produces the command. Every program launches under
its own command word (`self-driving`, `audit all`, `upload-source-maps`); the
default flow has none. The flags are `--ci` (API-key auth, no browser),
`--control-socket <path>`, `--install-dir`, `--project-id`, `--region`, and
`--e2e-ask` when the parent answers the agent's questions. Switchboard overrides
map to `--harness`, `--sequence`, and `--model`.

The personal API key travels as `POSTHOG_WIZARD_API_KEY` in the child's
environment, never in argv. The launcher strips `CLAUDE*`, `ANTHROPIC*`, and
`AI_AGENT*` variables so the wizard's agent never defers to an outer agent
session, and sets `WIZARD_ASK_AUTODRIVE=1` for the linear sequence.

Published builds accept `--control-socket` only together with the experimental
headless flag; a published TUI refuses it, and its bundle never contains the
server (`scripts/smoke-test.sh` audits both).

## The control API

JSON in and out. Success is `{ ok: true, ... }`; failure is
`{ ok: false, error }` with 400 (bad body, missing param, unknown action or
program), 404 (unknown route), 409 (a run is in flight), 413 (body over 64 KB),
415 (not JSON), 500 (a hook failed), or 501 (the other surface's route).

| Route                                                                       | Behavior                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health`                                                               | `{ ok, version, surface, pid, program }`                                                    |
| `GET /state`                                                                | `{ ok, state }`, the projection below                                                       |
| `GET /state?wait=<ms>&since=<version>`                                      | Long poll: resolves on the first commit with `version > since`, or after `wait` ms          |
| `POST /actions/<id>` body `{ params }`                                      | Applies one action legal on the current screen through its store setter, returns the state  |
| `POST /credentials`                                                         | Resolves the API key into project credentials and commits them, advancing `auth`            |
| `POST /run`                                                                 | TUI surface: releases the runner's agent start. Idempotent                                  |
| `POST /detect` body `{ programId?, installDir? }`                           | Headless surface: runs detection through the store's setters                                |
| `POST /runs` body `{ programId, installDir?, frameworkContext?, skillId? }` | Headless surface: one independent agent run; 409 while one runs                             |
| `GET /runs`                                                                 | The run ledger: `runId`, `programId`, `installDir`, `status`, `error`, timestamps, `result` |
| `POST /shutdown`                                                            | Flushes and exits. Idempotent                                                               |

`state` carries `version`, `currentScreen`, `hasOverlay`, `runPhase`,
`run: { status, error }`, a session whitelist (credentials reduce to
`hasCredentials` and `projectId`), `tasks`, `statusMessages`, `eventPlan`,
`pendingQuestion`, `taskNotice`, `setupQuestions`, `actions`, `dashboardUrl`,
`notebookUrl`, `handoffText`, a reduced `outroData`, and `frameworkContext` as
`{ keys, digest, values }` after redaction: `secret:<id>` refs become
`[secret-ref]` and secret-looking keys become `[redacted]`. No access token, API
key, user record, or answer value is ever projected.

The socket is created mode 0600 in a directory the caller owns. A stale socket
file is replaced; a live one is refused. The wizard unlinks it on exit.

## Auth without a browser

The TUI runs `ci: true`. `POST /run` releases the normal program bootstrap,
which resolves the phx personal key into project credentials and commits them to
the store; `POST /credentials` does the same commit without starting a run,
which is how a detection-only exploration advances past `auth`. Gateway
authentication follows the shared runner path; see the
[runner policy](../.claude/skills/wizard-development/SKILL.md).

The snapshot route reads `APP_DIR`, `PROJECT_ID`, `POSTHOG_REGION`, and either
`POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE` (the inline key wins). The MCP
route takes `appDir`, `projectId`, `region`, and optional `keyFile` or `apiKey`
through `open_app`. Detection-only MCP runs omit the key and stop at `auth`.

Agent runs need `WIZARD_CI_GATEWAY_TOKEN_FILE` with an already-issued gateway
bearer. CI uses it directly and never mints or refreshes it.
`WIZARD_CI_GATEWAY_URL` optionally overrides
`https://ai-gateway.<region>.posthog.com`.

## Run it

Every route needs a throwaway copy of an app, the PostHog project id, and for a
full run the personal API key plus the issued gateway bearer in
`WIZARD_CI_GATEWAY_TOKEN_FILE` (no run ever mints). Detection-only walks need
neither secret.

```bash
# Snapshot route: the fixed profile, frames, and the result payload
PROGRAM=posthog-integration E2E_ASK=true \
POSTHOG_KEY_FILE=/path/to/phx-key.txt WIZARD_CI_GATEWAY_TOKEN_FILE=/path/to/token.txt \
PROJECT_ID=<id> POSTHOG_REGION=us APP_DIR=/tmp/app \
SNAP_OUT=/tmp/snaps E2E_RESULT_JSON=/tmp/snaps/result.json \
npx tsx scripts/tui-snapshots.no-jest.ts
ls /tmp/snaps            # 01-intro.ans … NN-keep-skills.ans
jq .screenPath /tmp/snaps/result.json

# MCP route: open an app, confirm setup, read state, print one frame
APP_DIR=/tmp/app PROJECT_ID=<id> POSTHOG_KEY_FILE=/path/to/phx-key.txt \
npx tsx scripts/wizard-ci-explore.no-jest.ts

# Controlled headless: detect, independent runs, the ledger, shutdown
POSTHOG_WIZARD_API_KEY=phx_... WIZARD_CI_GATEWAY_TOKEN_FILE=/path/to/token.txt \
npx tsx scripts/controlled-headless-smoke.no-jest.ts --app /tmp/app --project-id <id> posthog-integration metrics

# Process specs: the real binary on both surfaces, no credentials, no agent run
pnpm test:harness                       # WIZARD_PTY_TESTS=0 skips the PTY spec
```

`SNAP_HARNESS`, `SNAP_SEQUENCE`, `SNAP_MODEL` override the switchboard;
`E2E_NOTICE`, `E2E_ANSWERS_FILE`, `INTEGRATE`, `TASK_STREAM_LOG`,
`SOURCE_MAPS_RUN_BUILD`, and `SOURCE_MAPS_CLI_KEY` keep their meanings from the
workbench contract. `PTY_COLS` and `PTY_ROWS` size the terminal.

## The two routes

- **CI snapshots.** `tui-snapshots.no-jest.ts` spawns the wizard in a PTY,
  releases the run with `POST /run`, and drives the fixed profile
  (`decideE2eAction`) over the socket. It long polls `GET /state` and writes the
  real rendered screen to `SNAP_OUT/NN-<screen>.ans` on every screen change,
  task update, run-phase change, or in-place context change, colors preserved.
- **Agent.** `wizard-ci-mcp.no-jest.ts` is a stdio MCP server that spawns the
  wizard the same way and proxies `read_state`, `perform_action`, and
  `run_agent` to the API; `render_screen` returns the captured frame as plain
  text. The agent decides each screen itself.

A run that fails parks the TUI on the handoff screen (flow key `mint-failure`,
any failed run, not only a gateway mint). The snapshot route exits from it and
the result payload carries the abort reason from the outro.

Both routes use a 180x50 PTY by default; `PTY_COLS` and `PTY_ROWS` override it.

## Run selection and state

`PROGRAM` selects a program id and defaults to `posthog-integration`.
`SNAP_HARNESS`, `SNAP_SEQUENCE`, and `SNAP_MODEL` feed the switchboard
overrides. Omitted values use normal flag and binding resolution. These are
launcher environment inputs, not `open_app` arguments.

`read_state` adds `integration` (`idle`, `running`, `done`, `failed`) and
`integrationError`, copied from `state.run`. Framework identity is the separate
`session.integration`. `perform_action` returns the state without those two
fields, so read again to refresh the run status. Legal actions come from
`state.actions`; there is no `list_actions` tool.

Keep handling overlays while the agent runs. `runPhase=completed` ends the main
work; `session.skillsComplete` ends the integration flow's follow-up screens.
Recording MCP or keep-skills outcomes only commits store state; it does not
install or delete anything. For failures, capture the error outro before
dismissing it.

## Picker screens

Three screens resolve a pick the real TUI takes from an interactive list. The
program declares the commit as a control action, and the harness computes the
value client side in `picks.ts`:

- `self-driving-integration-detect` and `error-tracking-detect` take
  `pick_integration_target { path, integration }`: the repo root for a single
  app, else the first instrumentable sub-app under `apps/` or `packages/`.
- `source-maps-detect` takes `pick_source_maps_project { variant, path }`: the
  static prerequisite detector's variant, else the native platform its manifest
  names (Go, Rust, Flutter, iOS, Android).

The MCP route offers the same actions; the agent supplies the values.

## Things that bite

1. **Inherited agent auth.** `buildLaunch` strips Claude and Anthropic
   variables. A direct caller must do the same.
2. **A project-scoped key needs its project id.** `PROJECT_ID` for the snapshot
   route, `projectId` for MCP.
3. **Never run on a real fixture.** Always a throwaway copy.
4. **A run is minutes long and creates real resources** (a dashboard and
   insights). The agent log is one shared file; never run two at once.
5. **node-pty's spawn-helper.** When the package is extracted without its build
   script, the prebuilt helper loses its execute bit and `pty.spawn` fails with
   `posix_spawnp failed`. `tui-capture.ts` restores it on each spawn.

## Changing what the run does

Per-program UI choices live in the harness (`profiles.ts`, loaded from each
program's `test/e2e.json`), not on the program config. Edit the program's entry
(typed by `WizardE2eProfile`); the snapshot route asks
`decideE2eAction(state, profile)` what to commit on each screen. The (screen,
decision) trace is snapshot-tested offline in `__tests__/` against the store's
`ControlDriver`; Vitest `--update` refreshes goldens after an intended flow
change.

## Driving the agent-in-the-loop layer

Two decision points ask a person to act, and the harness stands in for them.

`wizard_ask` overlay. A `ci` session normally has no ask bridge. `--e2e-ask`
keeps it wired (see `shouldDisableAsk`); the routes pass the flag when
`E2E_ASK=true`. In the snapshot route the profile answers every question:
`askAnswers` routes a question to a value, else the first option, else the
`'e2e'` sentinel. Route credentials with `${ENV_VAR}` values, never literals.

Mark a credential rule `"secret": true`. The skill names its own questions, so a
rule matches text the agent controls. A secret rule answers only free text
flagged sensitive and refuses every other question shape; refusals land in the
payload's `refusedIds` and `refusedAsks`.

Task-notice overlay. `profile.notice` decides `keep` or `decline`. `E2E_NOTICE`
overrides it per run.

Both env inputs are folded into the profile by `resolveE2eProfile`, at load.
`decideE2eAction` stays pure: no env, no store, no socket.

In the MCP route, use `perform_action` with `answer_question` (a complete
answers map), `cancel_question`, or `resolve_notice` with `params: { keep }`.

## The result payload

The snapshot route writes `E2E_RESULT_JSON`: the run phase and screens walked,
every ask batch, every task notice, the task list, the detected warehouse
sources, the program's report file, and the abort reason. `e2e-result.ts` builds
it from the control state.

**Only question prompt text and question ids go in the payload. No answer value
ever does.** The decision function reports ids and a keep or decline verdict, so
the recorder never holds an answer. The workbench scans the file for its own
injected credentials.

The report file is the one payload field whose content comes from the app
directory. `readReportFile` reads only a regular file inside `appDir`, never a
symlink, and never through a symlinked parent.

## Visual-regression snapshots (the workbench flow)

[wizard-workbench](https://github.com/PostHog/wizard-workbench) runs the CI
route for real-run visual regression: each test definition runs `tui-snapshots`,
the real-TUI screens are rasterized to a side-by-side baseline-vs-current
review, and run-to-run differences are surfaced for a human, not asserted away.
See `services/wizard-ci/` there.
