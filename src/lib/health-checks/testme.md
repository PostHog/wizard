# Health Checks — Testing Guide

## Running unit tests

```bash
# From the wizard/ root — runs only health-check tests (fast, no build step)
npx jest src/lib/health-checks/__tests__/health-checks.test.ts

# Watch mode
npx jest src/lib/health-checks/__tests__/health-checks.test.ts --watch

# With coverage
npx jest src/lib/health-checks/__tests__/health-checks.test.ts --coverage
```

## Running health checks live

To hit all 10 endpoints for real and see the full readiness result:

```bash
# From the wizard/ root
npx tsx -e "import { evaluateWizardReadiness } from './src/lib/health-checks/index'; evaluateWizardReadiness().then(r => console.log(JSON.stringify(r, null, 2)))"
```

## How the tests work

All external HTTP calls are mocked via a global `fetch` override in
`beforeEach`. No network access is required. Mock data is modelled on real
responses captured from production endpoints on 2026-03-05.

## Endpoints tested

| Service                 | URL                                                    | Healthy response                      |
| ----------------------- | ------------------------------------------------------ | ------------------------------------- |
| Anthropic               | `https://status.claude.com/api/v2/status.json`         | `{"status":{"indicator":"none",...}}` |
| PostHog                 | `https://www.posthogstatus.com/api/v2/status.json`     | Same shape                            |
| PostHog (components)    | `https://www.posthogstatus.com/api/v2/summary.json`    | Adds `components[]` array             |
| GitHub                  | `https://www.githubstatus.com/api/v2/status.json`      | Same shape                            |
| npm                     | `https://status.npmjs.org/api/v2/status.json`          | Same shape                            |
| npm (components)        | `https://status.npmjs.org/api/v2/summary.json`         | Adds `components[]` array             |
| Cloudflare              | `https://www.cloudflarestatus.com/api/v2/status.json`  | Same shape                            |
| Cloudflare (components) | `https://www.cloudflarestatus.com/api/v2/summary.json` | Adds `components[]` array             |
| LLM Gateway             | `https://gateway.us.posthog.com/_liveness`             | `{"status":"alive"}` (HTTP 200)       |
| MCP                     | `https://mcp.posthog.com/`                             | HTML landing page (HTTP 200)          |

### Statuspage.io API v2 reference

- Docs: <https://metastatuspage.com/api>
- `status.json` — page-level rollup; `indicator` is one of: `none`, `minor`,
  `major`, `critical`
- `summary.json` — same rollup + `components[]`; component `status` is one of:
  `operational`, `degraded_performance`, `partial_outage`, `major_outage`,
  `under_maintenance`
- Component docs:
  <https://support.atlassian.com/statuspage/docs/show-service-status-with-components>

### LLM Gateway

- Source: `posthog/services/llm-gateway/src/llm_gateway/api/health.py`
- `GET /` → `{"service":"llm-gateway","status":"running"}`
- `GET /_liveness` → `{"status":"alive"}` (no DB dependency)
- `GET /_readiness` → `{"status":"ready"}` (checks Postgres with `SELECT 1`)

### MCP

- Source: `posthog/services/mcp/src/index.ts`
- `GET /` → HTML landing page (200)
- No dedicated `/health` endpoint; 200 on `/` confirms the Cloudflare Worker is
  running.
