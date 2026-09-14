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

`--local-posthog` is sugar over `--base-url`. It pins the API host, app host,
OAuth server, and the LLM gateway derived from them.

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

`src/lib/local-dev.ts` defines the endpoints and precedence. Downstream code
reads the resolved targets.

The three service flags have no yargs default. An absent flag is `undefined`
and inherits the umbrella setting; an explicit `false` overrides it.
