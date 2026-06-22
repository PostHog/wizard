<p align="center">
  <img alt="posthoglogo" src="https://user-images.githubusercontent.com/65415371/205059737-c8a4f836-4889-4654-902e-f302b187b6a0.png">
</p>


> have any feedback, please drop an email to **[wizard@posthog.com](mailto:wizard@posthog.com)**.

<h1>PostHog wizard ✨</h1>

The PostHog wizard helps you quickly add PostHog to your project using AI.

![Wizard clip](https://res.cloudinary.com/dmukukwp6/image/upload/q_auto,f_auto/pasted_image_2026_05_01_T19_53_26_002_Z_398f697f5c.png)

# Usage

To use the wizard, you can run it directly using:

```bash
npx @posthog/wizard
```

Currently the wizard can be used for over 16+ frameworks for frontend, backend, and mobile applications. If you have other integrations you would like the wizard to
support, please open a [GitHub issue](https://github.com/posthog/wizard/issues)!

Visit our [docs](https://posthog.com/docs/ai-engineering/ai-wizard) to learn more. 

## Privacy & data usage

The wizard uses **Anthropic Claude** (via PostHog's LLM gateway) to read your project's source files and integrate PostHog. A few things worth knowing up front:

- **Source files** are sent to Anthropic as part of the agent's context.
- **`.env*` files and secrets** stay on your machine. The wizard's security scanner blocks anything it identifies as a secret from being read by the agent.
- **Telemetry** (run metadata — phase, task list, planned events) is sent to PostHog by default. Pass `--no-telemetry` (or set `POSTHOG_WIZARD_NO_TELEMETRY=1`) to disable.
- **AI opt-in**: the wizard honors your PostHog organization's `is_ai_data_processing_approved` setting (the same toggle that gates Max). If your org has not opted in, the wizard explains how to enable it and exits without sending source to Anthropic.
- **Prefer your own AI?** The wizard's integration knowledge ships as a context-mill skill you can download and run inside your own agent.

The wizard's "Privacy & data usage" menu (intro screen) and the `[I]` shortcut on the auth screen surface the same information in-terminal.

## MCP Commands

The wizard also includes commands for managing PostHog MCP (Model Context
Protocol) servers:

```bash
# Install PostHog MCP server to supported clients
npx @posthog/wizard mcp add

# Remove PostHog MCP server from supported clients
npx @posthog/wizard mcp remove
```

## Audit

Audit an existing PostHog integration for correctness and best practices. The
`audit` command is a **family**. With no subcommand it runs the **events**
audit (the default); pass a subcommand to run a specific one:

```bash
# Runs the events audit (the default) — no subcommand needed
npx @posthog/wizard audit

# Or run a specific audit directly
npx @posthog/wizard audit events           # event capture quality + cost (default)
npx @posthog/wizard audit all              # comprehensive audit across every area
npx @posthog/wizard audit autocapture      # autocapture setup + cost
npx @posthog/wizard audit feature-flags    # feature flag usage + cost
npx @posthog/wizard audit identify         # your $identify implementation
npx @posthog/wizard audit session-replay   # session replay setup
npx @posthog/wizard audit web-analytics    # web analytics setup
```

Most audit subcommands resolve at runtime from the published skill registry, so
new audits appear without a wizard release (`web-analytics` is wizard-native).

> **`audit <subcommand>` chooses an audit area — it does not take a skill name.**
> The audit subcommands above *are* context-mill skills promoted to commands (via
> a `cli: role: command` block); [`wizard skill <skill-name>`](#run-a-single-skill)
> runs a skill that hasn't been promoted. Same machinery, two surfaces.
> (`wizard audit --help` still labels the positional `[skill]` — read it as "pick
> a subcommand.")

## Run a single skill

Run any context-mill skill directly by name, even if it isn't exposed as its own
command:

```bash
npx @posthog/wizard skill list              # list every available skill
npx @posthog/wizard skill <skill-name>      # run one by name
```

## Revenue Analytics

Wire up an existing PostHog + Stripe project for revenue analytics:

```bash
npx @posthog/wizard revenue-analytics
```

Requires PostHog and Stripe SDKs already installed. Supports `--ci` with the
same flags as the main wizard. (Renamed from `revenue` in the CLI overhaul.)

## Data Warehouse

Detect data sources your project already uses (Postgres, MySQL, MongoDB,
Snowflake, BigQuery, Stripe, …) and connect them to PostHog's data warehouse:

```bash
npx @posthog/wizard warehouse
```

The wizard scans your dependencies and `.env` key names (never the values) to
identify sources. Database and API-key sources are created from the terminal;
OAuth sources open the PostHog app's new-source flow in your browser.

## Headless signup + install (agents / CI)

> ⚠️ `--ci` is **not currently supported in published builds** (see [CI Mode](#ci-mode)).
> This flow works in development builds only.

For a fully non-interactive first-run (no existing PostHog account, no TTY,
no browser), combine `--ci --signup --email`. The wizard provisions a new
account, uses the returned personal API key to run the normal CI install,
and wires PostHog into the project at `--install-dir`:

```bash
npx @posthog/wizard --ci --signup \
  --email you@example.com \
  --install-dir .
```

Optional flags: `--name "Your Name"`, `--region eu` (default `us`),
`--integration nextjs` (else auto-detected).

### Provision only

If you just want credentials — for tests, pre-flight checks, or wiring up
PostHog yourself — use the `provision` subcommand, which emits a structured
`ProvisioningResult` and does nothing else:

```bash
# Human-readable (when stdout is a TTY)
npx @posthog/wizard provision --email user@example.com --region us

# Machine-readable — auto when stdout is piped, or force with --json
npx @posthog/wizard provision --email user@example.com --region eu --json
```

Success prints the full `ProvisioningResult` (`projectApiKey`, `host`,
`projectId`, `accountId`, `accessToken`, `refreshToken`, and
`personalApiKey` if present). Failure exits 1; in `--json` mode the error
is emitted to stderr as `{"error":"...","code":"..."}`, with `code` set to
`email_exists` when the address is already registered.

> ⚠️ **Output contains live credentials.** Pipe it into a secrets store —
> do not let it be captured by shared CI logs. Mask the step output or
> redirect stdout to a file your job reads and discards.

# Options

The following CLI arguments are available:

| Option            | Description                                                      | Type    | Default | Choices                                              | Environment Variable           |
| ----------------- | ---------------------------------------------------------------- | ------- | ------- | ---------------------------------------------------- | ------------------------------ |
| `--help`          | Show help                                                        | boolean |         |                                                      |                                |
| `--version`       | Show version number                                              | boolean |         |                                                      |                                |
| `--debug`         | Enable verbose logging                                           | boolean | `false` |                                                      | `POSTHOG_WIZARD_DEBUG`         |
| `--signup`        | Create a new PostHog account during setup                        | boolean | `false` |                                                      | `POSTHOG_WIZARD_SIGNUP`        |
| `--install-dir`   | Directory to install PostHog in                                  | string  |         |                                                      | `POSTHOG_WIZARD_INSTALL_DIR`   |
| `--ci`            | Enable CI mode for non-interactive execution                     | boolean | `false` |                                                      | `POSTHOG_WIZARD_CI`            |
| `--api-key`       | PostHog personal API key (phx_xxx) for authentication            | string  |         |                                                      | `POSTHOG_WIZARD_API_KEY`       |
| `--no-telemetry`  | Disable wizard run-state telemetry                               | boolean | `false` |                                                      | `POSTHOG_WIZARD_NO_TELEMETRY`  |


# CI Mode

> ⚠️ **CI mode is not currently supported in published builds.** PostHog's LLM
> gateway doesn't yet grant the scopes the wizard needs to personal API keys
> for most users, so non-interactive `--ci` runs fail at the gateway. The flag
> is disabled in the published package and exits with an error — run the wizard
> in an interactive terminal instead (`npx @posthog/wizard`). The notes below
> describe CI mode as it works in development builds.

Run the wizard non-interactive executions with `--ci`:

```bash
npx @posthog/wizard --ci --api-key $POSTHOG_PERSONAL_API_KEY --install-dir .
```

When running in CI mode (`--ci`):

- Bypasses OAuth login flow (uses personal API key directly)
- Auto-selects defaults for all prompts
- Skips MCP server installation
- Auto-continues on git warnings (uncommitted/untracked files)
- Auto-consents to AI usage

The CLI args override environment variables in CI mode.

### Required Flags for CI Mode

- `--api-key`: Personal API key (`phx_xxx`) from your [PostHog settings](https://app.posthog.com/settings/user-api-keys)
- `--install-dir`: Directory to install PostHog in (e.g., `.` for current directory)

### Required API Key Scopes

When creating your personal API key, ensure it has the following scopes enabled:

- `user:read` - Required to fetch user information
- `project:read` - Required to fetch project details and API token
- `llm_gateway:read` - Required for LLM gateway access
- `dashboard:write` - Required to create dashboards
- `insight:write` - Required to create insights

### OAuth app scope ceiling

The wizard's OAuth app on the PostHog side caps the scopes its tokens may
carry (`OAuthApplication.scopes`). Any scope requested in this repo (see
`src/lib/oauth/program-scopes.ts`) must be present in that list. Current
ceiling, for bookkeeping:

```
user:read,project:read,llm_gateway:read,dashboard:read,dashboard:write,insight:read,insight:write,query:read,notebook:read,notebook:write,health_issue:read,wizard_session:read,wizard_session:write,feature_flag:read,experiment:read,experiment_saved_metric:read,survey:read,session_recording:read,error_tracking:read,web_analytics:read,llm_analytics:read,cohort:read,person:read,annotation:read,annotation:write,activity_log:read,property_definition:read,event_definition:read,action:read,warehouse_table:read,warehouse_view:read,external_data_source:read,external_data_source:write,alert:read,subscription:read,feature_flag:write,integration:read,organization:read
```

# Command changes (CLI overhaul)

The CLI was overhauled to consolidate commands into a smaller, extensible
surface. If you used an older command, here's where it went:

| Old command | New command | What changed |
|---|---|---|
| `wizard integrate` | `wizard` (default flow) | Command removed; the default flow runs the integration |
| `wizard events-audit` | `wizard audit events` | Now an `audit`-family subcommand |
| `wizard audit` (single audit) | `wizard audit <subcommand>` | Now a family; see [Audit](#audit) for the subcommands |
| `wizard audit-3000` | *removed* | Retired |
| `wizard revenue` | `wizard revenue-analytics` | Renamed (old `revenue` removed) |
| `wizard upload-sourcemaps` | `wizard upload-source-maps` | Renamed; `upload-sourcemaps` still works as an alias |

> **Commands vs. programs:** `integrate` was the *command*; the program behind it
> is `posthog-integration`, which still exists and now powers the default flow.
> Other commands depend on it via `requires: ['posthog-integration']`. The
> program id is internal — it was never a command you typed.

# Steal this code

While the wizard works great on its own, we also find the approach used by this
project is
[a powerful way to improve AI agent coding sessions](https://posthog.com/blog/envoy-wizard-llm-agent).
Agents can run CLI tools, which means that conventional code like this can
participate in the AI revolution as well – with all the benefits and control
that conventional code implies.

If you want to use this code as a starting place for your own project, here's a
quick explainer on its structure.

## Entrypoint: `run.ts`

The entrypoint for this tool is `run.ts`. Use this file to interpret arguments
and set up the general flow of the application.

## Analytics

Did you know you can capture PostHog events even for smaller, supporting
products like a command line tool? `src/utils/analytics.ts` is a great example
of how to do it.

This file wraps `posthog-node` with some convenience functions to set up an
analytics session and log events. We can see the usage and outcomes of this
wizard alongside all of our other PostHog product data, and this is very
powerful. For example: we could show in-product surveys to people who have used
the wizard to improve the experience.

When the user authenticates, the wizard also streams live run state — current
phase, task list, planned events — to `POST /api/projects/{id}/wizard/sessions/`
so the PostHog web app can render real-time progress. Updates are debounced
(250ms) with phase changes flushed immediately; failures fall back silently to
the wizard's debug log without disturbing the TUI. Pass `--no-telemetry` (or
set `POSTHOG_WIZARD_NO_TELEMETRY=1`) to disable.

## Leave rules behind

Supporting agent sessions after we leave is important. There are plenty of ways
to break or misconfigure PostHog, so guarding against this is key.

`src/utils/rules/add-editor-rules.ts` demonstrates how to dynamically construct
rules files and store them in the project's `.cursor/rules` directory.

## Prompts and LLM interactions

LLM agent sessions are _anti-deterministic_: really, anything can happen.

But using LLMs for code generation is really advantageous: they can interpret
existing code at scale and then modify it reliably.

_If_ they are well prompted.

`src/lib/prompts.ts` demonstrates how to wrap a deterministic fence around a
chaotic process. Every wizard session gets the same prompt, tailored to the
specific files in the project.

These prompts are channeled using `src/utils/query.ts` to an LLM interface we
host. This gives us more control: we can be certain of the model version and
provider which interpret the prompts and modify the files. This way, we can find
the right tools for the job and again, apply them consistently.

This also allows us to pick up the bill on behalf of our customers.

When we make improvements to this process, these are available instantly to all
users of the wizard, no training delays or other ambiguity.

## Keep secrets out of the LLM

The wizard somtimes needs to move a secret. The agent
orchestrates that journey, but the raw value should _never_ enter the LLM
conversation, where it would be sent to the model provider, written to
transcripts, and captured in logs.

`src/lib/secret-vault.ts` is a small, reusable pattern for exactly this. It's a
session-scoped, in-memory vault: a tool that handles a secret calls `put()` to
store the raw value and hands the agent an opaque `secret:<uuid>` reference
instead. The agent passes that ref between tools as if it were the value; the
host resolves it back to the real secret only at the last moment, inside the
process, when it writes the file.

Two tools in `src/lib/wizard-tools.ts` form the ends of that pipe:

- `wizard_ask` with `sensitive: true` vaults the user's typed answer and returns
  `{ secretRef: "secret:..." }` to the agent rather than the string.
- `set_env_values` accepts `{ secretRef }` in place of a literal value and
  resolves it against the vault before writing — the value lands in the `.env`
  file but is never returned to the model.

The vault has no persistence and is dropped at the end of the run; refs minted
in one session can't be resolved in another. The net effect: the model gets to
drive the work end to end, but the only thing it ever sees is an opaque handle.

## Build system

Built with [tsdown](https://tsdown.dev/) (Rolldown). `pnpm build` bundles `bin.ts` into ESM chunks in `dist/`, inlining all local source and keeping npm dependencies external.

### Environment variables

**Build-time (locked).** `NODE_ENV` is replaced with `"production"` at compile time. It cannot be overridden at runtime. All URLs, OAuth client IDs, and dev-mode code paths resolve to their production values unconditionally.

To add a new build-time constant, add it to `env` in `tsdown.config.ts` and export it from `src/env.ts`.

**Runtime (allowlisted).** Runtime env reads go through `runtimeEnv()` in `src/env.ts`, which only accepts keys in the `RuntimeEnvKey` union:

| Variable | Purpose |
|---|---|
| `POSTHOG_WIZARD_BENCHMARK_CONFIG` | Path to benchmark config file |
| `POSTHOG_WIZARD_BENCHMARK_FILE` | Output path for benchmark results |
| `POSTHOG_WIZARD_LOG_DIR` | Log directory override |
| `POSTHOG_WIZARD_DEBUG` / `DEBUG` | Enable debug output |
| `MCP_URL` | Override MCP server URL |
| `POSTHOG_API_KEY` | API key for MCP subprocess auth |
| `TERM`, `TERM_PROGRAM`, `CI`, etc. | Terminal/platform detection |
| `APPDATA`, `XDG_CONFIG_HOME` | Platform path resolution |

To add a new runtime env var, add its key to `RuntimeEnvKey` in `src/env.ts`.

**Direct `process.env` access** is only used for subprocess environment writes (e.g. `agent-interface.ts` setting `ANTHROPIC_BASE_URL`), vendored code, and tests.

### Import aliases

Path aliases defined in `tsconfig.build.json`, resolved by tsdown:

| Alias | Maps to |
|---|---|
| `@env` | `src/env.ts` |
| `@lib/*` | `src/lib/*` |
| `@utils/*` | `src/utils/*` |
| `@ui/*` | `src/ui/*` |
| `@steps/*` | `src/steps/*` |
| `@frameworks/*` | `src/frameworks/*` |

## Running locally

### Quick test without linking

```bash
pnpm try --install-dir=[a path]
```

### Development with auto-rebuild

```bash
pnpm run dev
```

This builds, links globally, and watches for changes. Leave it running - any `.ts` file changes will auto-rebuild. Then from any project:

```bash
wizard --integration=nextjs

# Or use local MCP server:
wizard --integration=nextjs --local-mcp
```

## Testing

To run unit tests, run:

```bash
bin/test
```

To run E2E tests run:

```bash
bin/test-e2e
```

E2E tests are a bit more complicated to create and adjust due to to their mocked
LLM calls. See the `e2e-tests/README.md` for more information.

## Publishing your tool

To make your version of a tool usable with a one-line `npx` command:

1. Edit `package.json`, especially details like `name`, `version`
2. Run [`npm publish`](https://docs.npmjs.com/cli/v7/commands/npm-publish) from
   your project directory
3. Now you can run it with `npx yourpackagename`

# Health checks

`src/lib/health-checks/` checks external status pages and PostHog-owned
services before the wizard runs to decide whether it can proceed. The entry
point is `evaluateWizardReadiness()`, which returns one of three values:

| Decision            | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `yes`               | All services healthy — proceed normally.                        |
| `yes_with_warnings` | Some services degraded but no critical dependency is down.      |
| `no`                | A critical dependency is down or degraded — do not run.         |

### Module layout

| File | Responsibility |
| --- | --- |
| `types.ts` | Enums, interfaces (`ServiceHealthStatus`, `AllServicesHealth`, etc.) |
| `statuspage.ts` | Statuspage.io v2 API helpers + checks for Anthropic, PostHog, GitHub, npm, Cloudflare |
| `endpoints.ts` | Direct endpoint checks for LLM Gateway (`/_liveness`) and MCP (`/`) |
| `readiness.ts` | `checkAllExternalServices`, `evaluateWizardReadiness`, readiness config |
| `index.ts` | Barrel re-export |
| `testme.md` | Test running instructions and endpoint reference |

## What blocks a run

The `DEFAULT_WIZARD_READINESS_CONFIG` in `readiness.ts` controls this. It has
two arrays:

- **`downBlocksRun`** — if any of these report status **Down**, readiness is
  **No**.
- **`degradedBlocksRun`** — if any of these report **Degraded** (or worse),
  readiness is **No**.

### Current defaults

```ts
downBlocksRun: ['anthropic', 'posthogOverall', 'npmOverall', 'llmGateway', 'mcp'],
degradedBlocksRun: ['anthropic'],
```

## Smoke test helper (`scripts/smoke-test-ci.sh`)

This repo includes a helper script to run a full end‑to‑end smoke test of the wizard packaged in a tarball against a real app from [`posthog/wizard-workbench`](https://github.com/PostHog/wizard-workbench). This will catch certain packaging issues that might not be caught by other tests.

**Prerequisites**

- Point to a `wizard-workbench` checkout either by:
  - Setting `WIZARD_WORKBENCH_ROOT=/absolute/path/to/wizard-workbench`, or
  - Cloning `wizard-workbench` next to this repo (so it lives at `../wizard-workbench`).
- Set `POSTHOG_PERSONAL_API_KEY` either in your shell or in `../wizard-workbench/.env`.
- (Optional) Set `POSTHOG_PROJECT_ID` to target a specific PostHog project.

**Usage**

```bash
# Default app: next-js/15-app-router-todo
./scripts/smoke-test-ci.sh

# Specify a different app from wizard-workbench/apps
./scripts/smoke-test-ci.sh next-js/15-pages-router-saas

# With API key (and optional project ID) inline
POSTHOG_PERSONAL_API_KEY=phx_your_key_here \
POSTHOG_PROJECT_ID=12345 \
./scripts/smoke-test-ci.sh next-js/15-pages-router-saas

# Pointing at a custom wizard-workbench checkout
WIZARD_WORKBENCH_ROOT=/path/to/wizard-workbench \
./scripts/smoke-test-ci.sh
```

The script will:

- Build and pack the wizard
- Copy the selected app into a temp directory
- Install dependencies for the app
- Install the packed wizard tarball into an isolated temp project
- Run `wizard` in `--ci` mode against the copied app and perform basic post‑install checks
