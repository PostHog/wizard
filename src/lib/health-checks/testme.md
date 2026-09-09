# Health check tests

Run the focused suites without building or contacting live services:

```bash
pnpm exec vitest run src/lib/health-checks/__tests__ src/lib/agent/runner/shared/__tests__/bootstrap-health.test.ts src/ui/tui/__tests__/ink-ui-health.test.ts
```

Endpoint tests cover bounded retries, connection failures, malformed skill
menus, GitHub/AWS fallback, local context-mill targets, and the gateway
readiness route. Readiness tests cover the dependency matrix, pre-auth results,
the actual minted gateway target, and absence of unrelated provider warnings.
Bootstrap and UI tests cover cached skills checks and waiting for a fresh outage
dismissal after login.

| Dependency         | Probe                                                                              | Healthy response                     |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------ |
| LLM gateway        | `<minted gateway_url>/readyz`                                                      | HTTP 200; no bearer or model request |
| GitHub skills      | `https://github.com/PostHog/context-mill/releases/latest/download/skill-menu.json` | Downloadable, valid skill menu       |
| AWS skills mirror  | `https://context-mill.posthog.com/latest/skill-menu.json`                          | Downloadable, valid skill menu       |
| Local context-mill | `<configured skills base>/skill-menu.json`                                         | Downloadable, valid skill menu       |

The gateway is omitted before mint rather than guessed. Either release origin
working is sufficient; local targets are checked independently of production.
Provider status pages are not queried. No gateway readiness response body is
shown to the user.
