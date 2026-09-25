# Local development targets

Running the wizard against local servers. Four things can independently be
local, and this doc is the catalog of how to control each.

## Credentials for local CI and headless runs

Local `--ci` runs, smoke tests, and full headless/snapshot agent runs need
**two separate secrets**, plus the target project ID:

| Input | Purpose | How to pass it |
|---|---|---|
| PostHog personal API key (`phx_...`) | PostHog API and MCP authentication | CLI: `--api-key` / `POSTHOG_WIZARD_API_KEY`; smoke helper: `POSTHOG_PERSONAL_API_KEY`; headless host: `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE` |
| Already-issued AI gateway bearer | Model calls | `WIZARD_CI_GATEWAY_TOKEN_FILE`, an absolute path to a file containing only the token |
| Target project ID | Project selection and gateway attribution | CLI: `--project-id` / `POSTHOG_WIZARD_PROJECT_ID`; headless host: `PROJECT_ID` (MCP: `projectId`) |

The personal API key is not the gateway token. CI reads the gateway token
from the file and uses it directly; it does not mint or refresh one. Keep the
file outside the repo, restrict its permissions (`chmod 600`), and supply a
valid token for the gateway being used. Missing, expired, or rejected tokens
fail the run.

With your personal API key already exported and gateway token saved locally:

```bash
export WIZARD_CI_GATEWAY_TOKEN_FILE="$HOME/.config/posthog/wizard-gateway-token"
export POSTHOG_WIZARD_PROJECT_ID=12345
export POSTHOG_WIZARD_REGION=us

pnpm try --ci --api-key "$POSTHOG_PERSONAL_API_KEY" \
  --project-id "$POSTHOG_WIZARD_PROJECT_ID" \
  --region "$POSTHOG_WIZARD_REGION" --install-dir=/absolute/path/to/test-app
```

`WIZARD_CI_GATEWAY_URL` optionally sets the gateway origin (no `/v1`);
otherwise CI uses `https://ai-gateway.<region>.posthog.com`. The local service
flags below do not override this CI gateway setting.

For the `wizard-ci` MCP server, set `WIZARD_CI_GATEWAY_TOKEN_FILE` in the
server's environment before launch; restart an existing server after changing
it. It is not an `open_app` argument. Pass the personal key via `keyFile` or
`apiKey` and the project via `projectId`. Detection-only runs that stop at
`auth` do not need either secret.

[Smoke-test CI](../.github/workflows/smoke-test.yml) supplies these credentials:
`GH_APP_POSTHOG_WIZARD_CI_BOT_POSTHOG_PERSONAL_KEY` becomes
`POSTHOG_PERSONAL_API_KEY`, while
`GH_APP_POSTHOG_WIZARD_CI_BOT_POSTHOG_GATEWAY_TOKEN` is written to a temporary
file referenced by `WIZARD_CI_GATEWAY_TOKEN_FILE`. CI also supplies
`GH_APP_POSTHOG_WIZARD_CI_BOT_TARGET_PROJECT_ID` as
`POSTHOG_WIZARD_PROJECT_ID`.

Interactive runs authenticate normally and mint their gateway token through
PostHog; they do not require this CI token file. Published builds reject
`--ci`; use source, a development build, or `pnpm build:ci` for these recipes.

## The four dimensions

| # | What | Local target | How you control it |
|---|---|---|---|
| 1 | The wizard binary | your checkout | how you invoke it — see [Running the wizard](#running-the-wizard) |
| 2 | context-mill (skills) | `http://localhost:8765` | `--local-context-mill` |
| 3 | PostHog MCP server | `http://localhost:8787/mcp` | `--local-mcp` |
| 4 | PostHog app / API | `http://localhost:8010` | `--local-posthog` |

Select the skills, MCP, and PostHog servers independently. For example, CI
runs local skills against production MCP and PostHog.

## Flags

These flags are available in dev/test builds. Published builds reject them.

| Flag | Env | Effect |
|---|---|---|
| `--local-dev` | `POSTHOG_WIZARD_LOCAL_DEV` | all three below |
| `--local-context-mill` | `POSTHOG_WIZARD_LOCAL_CONTEXT_MILL` | skills → `:8765` |
| `--local-mcp` | `POSTHOG_WIZARD_LOCAL_MCP` | MCP → `:8787` |
| `--local-posthog` | `POSTHOG_WIZARD_LOCAL_POSTHOG` | PostHog origins → `:8010` |
| `--task-stream-log[=path]` | `POSTHOG_WIZARD_TASK_STREAM_LOG` | dump every attempted task-stream sync as JSONL (default `/tmp/posthog-wizard-task-stream.jsonl`) |

`--local-posthog` is sugar over `--base-url`. It pins the API host, app host,
and OAuth server. The backend supplies the LLM gateway URL when it mints a
token. If a local PostHog API advertises `host.docker.internal`, the Wizard
uses `localhost` on the same gateway port for its host-side model calls.

`--task-stream-log` records what the run published, one JSON line per push,
truncated per run. It rides beside the PostHog destination rather than
replacing it, so a logged run is the same run the backend sees. A line means
the payload was attempted, not accepted — `[task-stream] wizard/sessions push
ok: 201` in the debug log is the delivery signal. `--ci` dumps to the default
path on every run and never pushes, since a synthetic run would otherwise
create a session row in a real project.

### Precedence

Most specific wins:

```
MCP_URL / --base-url                                       (explicit URL)
  > --local-mcp / --local-context-mill / --local-posthog   (explicit boolean)
  > --local-dev                                            (umbrella)
  > IS_DEV implicit localhost:8010                         (dev builds, dim. 4 only)
  > production defaults
```

A specific flag overrides the umbrella in both directions.
`--local-dev --no-local-mcp` selects local skills and PostHog with production
MCP, as does `--local-context-mill --local-posthog`.

### Recipes

```bash
wizard --local-dev                             # everything local
wizard --local-context-mill                    # local skills, prod MCP + PostHog  ← what CI runs
wizard --local-context-mill --local-posthog    # local skills + PostHog, prod MCP
MCP_URL=http://localhost:9000/mcp wizard       # MCP at a non-standard port
```

## If a local server isn't running

Every `--local-*` flag is preflighted before the run starts. If the server it
asks for isn't listening, the wizard stops with the port, the flag that
requested it, and how to start it:

```
✖ Local services are not running:

  context-mill — nothing listening at http://localhost:8765
    requested by --local-context-mill
    start it with: npm run dev  (in the context-mill repo)

Start the missing services, or drop the flag to use production.
```

Preflight runs **before authentication** and stops both interactive and CI
runs when a requested local service is unreachable.

Only reachability is checked. Any HTTP reply counts, including 404 and 405.

## Selecting local MCP and skills servers

`--local-mcp` selects the MCP server at `localhost:8787`.
`--local-context-mill` selects the skills server at `localhost:8765`.
Pass both flags to use both local services, or `--local-dev` to include local
PostHog as well.

## Editor MCP configuration

`wizard mcp add --local` writes a `posthog-local` server entry into your
editor's MCP config (Cursor, Claude Code, Codex, Zed, VS Code), pointing at
`localhost:8787`. It sits alongside the normal `posthog` entry.
`wizard mcp remove --local` removes the `posthog-local` entry.

Use this command to develop the MCP server in `posthog/services/mcp` through
your editor. The command-scoped `--local` option is available in published
builds and independent of the wizard run's `--local-*` flags.

## Running the wizard

Choose the wizard binary through its invocation:

| Mode | Command | Build |
|---|---|---|
| From source | `pnpm try --install-dir=<path>` | dev (`IS_DEV`) |
| Globally linked | `pnpm dev`, then `wizard` | dev, rebuilt on change |
| Workbench harness | `WIZARD_PATH=<repo>` → `$WIZARD_PATH/dist/bin.js` | whatever you last built |
| Published | `npx @posthog/wizard` | production |

To confirm what a run actually used, pass `--debug` and look for the
`[agent-runner] targets` line in `/tmp/posthog-wizard.log` — it prints the build,
skills url, MCP url, and PostHog host together.

## Implementation

`src/shared/local-dev.ts` defines the endpoints and precedence. Downstream code
reads the resolved targets.

The three service flags have no yargs default. An absent flag is `undefined`
and inherits the umbrella setting; an explicit `false` overrides it.

## WizardRun synchronization

The multivariate `wizard-run-sync` flag selects the remote transport:
`wizard-session` publishes WizardSession state; `wizard-run` publishes WizardRun
tasks and local lifecycle updates. Missing, disabled, or unknown variants use
`wizard-session`. The publisher uses the existing authenticated flag snapshot
and fixes the selection for the execution; there is no extra flag request or
polling. A synchronization failure does not switch transports. File output is
independent of the flag.

The CLI evaluates this flag in PostHog's internal flags project. A local
PostHog web app evaluates its own copy, so changing the flag in the local app
does not change the CLI's selection. To exercise WizardRun from a development
build without changing the internal flag, start an interactive workbench run
with:

```bash
WIZARD_CI_FLAG_OVERRIDES='{"wizard-run-sync":"wizard-run"}' pnpm exec tsx services/wizard-run/index.ts
```

This override is stripped from published builds. An already completed
WizardSession run is not converted; start a new execution after setting the
override.

With `wizard-run`, an authenticated interactive execution creates one local
WizardRun when the agent starts. Creation uses the selected top-level
`ProgramConfig.id`, the resolved API host and project, the target folder's
basename as its display name, and the package version. Program IDs must exist in the backend registry and
support local folders; a rejected configuration disables run synchronization
without selecting a different program. The analytics `run_id`, session
`session_id`, and cloud analytics `task_run_id` remain separate identities.

The shared task publisher sends ordered, immutable full snapshots to
`PUT /api/projects/{project_id}/wizard/runs/{run_id}/tasks/`. Only task names
and statuses are sent; PostHog owns all timestamps. Native task IDs are scoped
to their agent execution, and names are frozen at first observation. Duplicate
subjects receive stable numeric suffixes, including when names are shortened to
255 characters. The snapshot represents the shared task panel (orchestrator
queue tasks for orchestrated runs), not the session stream's extra audit-area
rollups. Completed and failed tasks from earlier composed agents remain in that
panel; omitted tasks from the same agent disappear. An empty agent list retains
earlier terminal tasks; explicitly clearing the authoritative panel sends an
empty snapshot. Unavailable state does not clear it.

Snapshots support at most 100 tasks. Oversized lists, blank names, duplicate
identities, and unexpected statuses reject that snapshot with a sanitized
file-log diagnostic; no partial list is sent. Later valid snapshots can still
sync. `pending` maps to `created`,
`in_progress` to `running`, and `skipped` to `completed`. Completed and failed
states retain their meaning. Cancellation preserves unfinished task states.
Identical snapshots are skipped; distinct transitions are queued before the
legacy session publisher's debounce, so a brief running state is retained.

At execution completion, the CLI drains run tasks and sends one local terminal
status: `completed`, `failed`, or `cancelled`. The existing signal and abort
paths share this shutdown, including Ink Ctrl-C, SIGINT and handled SIGTERM. The
two-second shutdown budget reserves its last quarter for finalization; requests
and retry timers are aborted when their budget expires. Individual requests time
out after five seconds. Task and terminal writes use at most three attempts for
network/server failures and at most one rate-limit retry, with `Retry-After`
capped at 60 seconds outside shutdown. Exhausted task delivery stops later task
writes but still permits local finalization. SIGKILL cannot flush.
Synchronization failure does not change the installation result.

Local creation includes a fresh UUID idempotency key for each execution. **POST
retries are disabled** until an integration check against the deployed backend
confirms that two identical local creation requests return the same ID. The
backend store currently applies supplied keys to local creation, while the
serializer help text describes cloud creation. No run ID is persisted for reuse.

### Cloud assignment and deployment requirements

`POSTHOG_WIZARD_RUN_ID` is the explicit UUID assignment for a WizardRun-backed
cloud execution. The strict CLI parser accepts it as the hidden `--run-id`
option. The authenticated launcher's API host and project are fixed for that
execution. Invalid assignments stop synchronization; they never trigger a local
POST or session fallback. Assigned cloud executions only publish tasks: the
worker owns terminal status after artifact publication. The assignment is not
written to project files or passed to nested agent environments.

Headless invocations without an assignment remain on the legacy WizardSession
transport. `POSTHOG_TASK_RUN_ID` is an analytics compatibility alias and is
**never** interpreted as a WizardRun assignment. Headless mode alone cannot
create a local run. The flag selects one remote transport for local and assigned
cloud executions. Legacy headless launches retain session publishing regardless
of the variant. `--no-telemetry` disables both remote transports; synthetic `--ci`
uses local output only.

The PostHog worker now supplies `POSTHOG_WIZARD_RUN_ID` alongside the existing
analytics alias and handoff path. Its default Wizard version is still 2.74.1,
which does not parse this input. The worker must use a released version that
accepts the assignment, or gate the new environment variable by version, before
the handoff can work for default cloud runs. A WizardRun launcher using a
compatible CLI must provide the assignment; absence denotes legacy mode.

The interactive and cloud Wizard OAuth apps must allow `wizard_run:write` in
each deployed region. The CLI requests this write scope without requesting
`wizard_run:read`. Existing tokens require renewed authorization to gain a new
grant; refresh does not widen permissions. Known missing grants suppress writes,
refreshable expiry uses the existing OAuth refresh path, and permanent 401/403
responses stop further run writes. Personal/project API keys cannot substitute
for a user's Wizard OAuth token on this transport. Session publishing remains
independent when run publishing is disabled.

For deployment validation, run a supported program in a synthetic workspace
using the configured OAuth app. Check one local run, task transitions and server
timestamps, task removal, intentional clear, and all three terminal outcomes.
Repeat the same creation payload/key to verify local idempotency. After
deploying the worker handoff, check that cloud tasks attach to the pre-created
ID and the worker finalizes after artifact publication. Use an authenticated
browser for the Wizard page/SSE, or a read-scoped token for task GET; general
run GET/list/SSE do not accept OAuth. Keep real credentials, paths, and customer
tasks out of validation artifacts.
