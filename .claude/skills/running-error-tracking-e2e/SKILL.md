---
name: running-error-tracking-e2e
description:
  Run `wizard error-tracking` headlessly end to end on a throwaway copy of a
  workbench app, judge the run, then build the app to check that the integration
  compiles. Use to test the error-tracking program or its context-mill flow
  against a real project.
compatibility:
  Designed for coding agents working on the PostHog wizard codebase, with
  wizard-workbench checked out beside it.
metadata:
  author: posthog
  version: '1.0.0'
---

# Running error tracking end to end

This drives the `error-tracking` program (`wizard error-tracking`), not the
standalone `error-tracking-upload-source-maps` program. It uses the fixed e2e
route:
[`scripts/tui-snapshots.no-jest.ts`](../../../scripts/tui-snapshots.no-jest.ts)
runs the real TUI host in a PTY with `MODE=fixed`, and the program's
[e2e profile](../../../src/programs/error-tracking/test/e2e.json) answers every
screen and `wizard_ask`. No questions come back to you. For a run where you
decide each screen yourself, use
[exploring-the-wizard](../exploring-the-wizard/SKILL.md); for how the host
works, see the [harness architecture](../../../e2e-harness/ARCHITECTURE.md).

A run calls the real model gateway and writes to the real PostHog project. Run
one at a time: the wizard log is one shared file.

## Prerequisites

1. `pnpm install` in this repo. Stale dependencies make the host die before it
   logs anything; see [troubleshooting](#troubleshooting).
2. Credentials. [`scripts/run.sh`](scripts/run.sh) reads each from the
   environment, else from `../wizard-workbench/.env` (override the workbench
   path with `WIZARD_WORKBENCH`). Never print or commit them.

| Variable                       | What it is                                                       |
| ------------------------------ | ---------------------------------------------------------------- |
| `POSTHOG_PERSONAL_API_KEY`     | `phx_` key; logs the run in, PostHog API and MCP                 |
| `POSTHOG_WIZARD_PROJECT_ID`    | The US project the key is scoped to                              |
| `WIZARD_CI_GATEWAY_TOKEN_FILE` | Absolute path to a file holding only the `phs_` gateway key      |
| `SOURCE_MAPS_CLI_KEY`          | `phx_` key the profile gives the flow's `api-key` ask (optional) |

See
[local credential setup](../../../docs/local-dev.md#credentials-for-local-ci-and-headless-runs)
if any are missing. The host runs in the US region only.

## Pick an app

Fixtures live in `wizard-workbench/apps/error-tracking/`; its `README.md` lists
what every run must do and the expectations for the release-linking apps. Read
the app's own README too.

| Fixture kind                                      | Exercises                                                     |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `react-vite`, `next`, `nuxt-*`                    | PostHog present: exception capture and source-map upload      |
| `no-posthog-*`                                    | Install and init first, then capture (and source maps on web) |
| `node-*`, `cicd-*-node-*`                         | Upload wired into a bundler or a CI pipeline                  |
| `cicd-*-python-*`, `-ruby-`, `-php-`              | Release linking in the production deploy, no source maps      |
| `go`, `rust`, `android`, `ios-*`, `react-native*` | posthog-cli pre-install and debug-symbol upload               |

## Run

From the repo root, in the background (`react-vite` and `no-posthog-next` each
take about 5 minutes):

```bash
.claude/skills/running-error-tracking-e2e/scripts/run.sh error-tracking/react-vite
```

The argument is a path under `wizard-workbench/apps/` or any app directory. The
script copies the app to `/tmp/wizard-et-<name>` (excluding `.git`, dependency
and build directories), commits a git baseline there, runs the host with
`PROGRAM=error-tracking` and `E2E_ASK=true`, and prints a summary. Outputs:

| Path                      | Contents                                                |
| ------------------------- | ------------------------------------------------------- |
| `/tmp/wizard-et-<name>`   | The app after the run; `git diff` shows the run's edits |
| `…-snaps/NN-<screen>.txt` | Plain-text TUI frames (`.ans` keeps the colors)         |
| `….json`                  | `E2E_RESULT_JSON`: phase, screens, tasks, asks, abort   |
| `…-run.out`               | The snapshot driver's stdout                            |
| `…-wizard.log`            | This run's slice of `/tmp/posthog-wizard.log`           |

Optional environment:

- `SNAP_SEQUENCE=linear` runs the profile's `linear-fallback` variation; the
  default is the program's binding (orchestrator on Pi). `SNAP_HARNESS` and
  `SNAP_MODEL` override the rest of the binding.
- `E2E_APP_DIR` changes the copy's location; it must stay under `/tmp`.

To follow a run, watch `…-run.out` for `snap ->` lines and read the newest
`.ans` frame with ANSI stripped (`perl -pe 's/\e\[[0-9;?]*[A-Za-z]//g'`). The
run screen's task list shows progress, such as `Progress: 3/7 completed`.

## Judge the run

A passing run has all of these:

- Host exit 0, `runPhase` `completed` and `abort` `null` in the result JSON.
- Screens
  `error-tracking-intro > auth > error-tracking-detect > run > outro > keep-skills`,
  with a `wizard-ask` entry for each answered ask.
- Every task `completed`, or `skipped` when the flow found it not required. For
  example, `Wire upload in CI` is skipped on an app with no pipeline, and the
  report then lists the CI steps for the user.
- Asks `api-key` and `test-affordance` answered, and `unansweredAsks` and
  `refusedAsks` 0. The profile answers `test-affordance` with `no`, so the agent
  never builds the app; you do that below.
- `reportFile.exists` true: `posthog-error-tracking-report.md` in the app.

Then review `git -C /tmp/wizard-et-<name> diff` and new files against the
fixture README:

- Capture is set up in one place with the SDK's own mechanism, not manual
  `captureException` calls spread across files.
- On web and native platforms, source-map or symbol upload is wired into the
  production build and CI, with credentials read from the environment.
- Every dependency the run adds is imported somewhere.
- No secret is written into a tracked file. The agent writes real values to a
  gitignored `.env` and placeholders to `.env.example`.
- `.claude/skills/<framework>/` remains: the orchestrator keeps the framework
  reference docs by design, and the harness's keep-skills choice only records
  the answer. It is not part of the integration.

## Build the app

A run that edits files but does not build is a failed integration. Build the
copy the way its project builds for production:

| Ecosystem         | Build check                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| npm / pnpm / yarn | Install with the lockfile's manager (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`), then `npm run build`         |
| Python            | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`, then `.venv/bin/python -m compileall -q .` and import the app module |
| Ruby              | `bundle install`, then `bundle exec ruby -c` on the edited files                                                                           |
| PHP / Laravel     | `composer install`, then `php -l` on edited files and `php artisan config:cache`                                                           |
| Go / Rust         | `go build ./...` / `cargo build --release`                                                                                                 |
| Docker / CI       | `docker build .`; check workflow YAML parses                                                                                               |

Install from scratch (`rm -rf node_modules` first): the agent's own install can
hide a lockfile that no longer matches. Run builds in a clean environment,
`env -i PATH="$PATH" HOME="$HOME" CI=true npm run build`, so no `POSTHOG_*`
variable from your shell leaks in.

Build twice for apps with build-time upload:

1. **Without upload credentials**: move `.env` and `.env.local` aside, build,
   and put them back. The build should pass with upload skipped or a warning. A
   failure means a teammate or a pull-request build without the secrets cannot
   build, so report it with the error. For example, a Vite
   `@posthog/rollup-plugin` or Next.js `withPostHogConfig` setup that always
   enables source maps fails with
   `projectId is required when sourcemaps are enabled`.
2. **With credentials**, as CI would run it: keep the run's `.env`, or export
   the variables the report names. The log should show a release created and
   `Upload summary: N chunk(s) uploaded`. Check that the built JS carries the
   injected ID (`grep -rl 'chunkId=' dist/assets` on Vite, `.next/static/chunks`
   on Next.js) and that `.map` files were removed if the config deletes them
   after upload. This writes a release and symbol sets to the project.

Report the build commands, results and the relevant log lines, not only a
verdict.

## Clean up

Remove `/tmp/wizard-et-<name>*` after you record the results. A run can leave
symbol sets and other resources in the PostHog project; mention them.

## Troubleshooting

- **`host exited 1`, 0 snapshots, nothing logged.** Start the host outside a PTY
  to see its stderr. It ends with `stdin is not a TTY` once it loads; anything
  before that, such as `ERR_MODULE_NOT_FOUND`, is the real error (usually fixed
  by `pnpm install`):

  ```bash
  PROGRAM=error-tracking APP_DIR=/tmp/wizard-et-<name> PROJECT_ID=1 MODE=fixed \
    SNAP_CTRL=/tmp/ctrl node_modules/.bin/tsx --tsconfig tsconfig.base.json \
    scripts/tui-host.no-jest.ts < /dev/null
  ```

- **Log location.** The wizard always logs to `/tmp/posthog-wizard.log` here.
  `POSTHOG_WIZARD_LOG_FILE` applies only when `NODE_ENV=development`, which also
  points PostHog at `localhost:8010`, so do not set it. The script slices the
  log by byte offset instead.
- **Credentials.** `tui-snapshots` strips `CLAUDE*` and `ANTHROPIC*` variables,
  so an outer agent session does not leak into the run. The gateway token is
  never minted or refreshed here: an expired or rejected one fails the run.
- **Detection.** The host picks the project itself: the repo root, or the first
  framework app under `apps/` or `packages/`. A run that exits at
  `error-tracking-detect` found no supported framework there.
