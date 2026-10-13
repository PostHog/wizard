# Wrong PostHog region or host

11 cases. Part of the [edge case catalogue](../edge-cases.md).

## Host defaults to US Cloud for EU projects

**Problem.** Docs and almost every example use us.i.posthog.com, and the agent has no rule for picking a region, so it writes the US host. The failure is silent because the SDK accepts the token and drops events on the wrong cluster.

**Impact.** An EU project's events go to the US ingest host and never appear. Nothing errors until a human notices.

**Rule location.**

- `context-mill: context/skills/omnibus/instrument-*/description.md` (host URL step: projects-get region, then ask, do not assume US Cloud), context/skills/integration/references/2-edit.md (use the wizard-supplied region, never guess)
- [`wizard: src/shared/host-resolution.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/host-resolution.ts) (HostResolution.fromRegion), src/programs/posthog-integration/index.ts and src/agent/agent-prompt-loader.ts (PostHog Host prompt line)

**Sources.** [PostHog/context-mill#217](https://github.com/PostHog/context-mill/pull/217), [PostHog/context-mill#116](https://github.com/PostHog/context-mill/pull/116), [PostHog/wizard#934](https://github.com/PostHog/wizard/pull/934), [PostHog/wizard#3](https://github.com/PostHog/wizard/pull/3), [`context-mill: example-apps/next-app-router/next.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/next.config.ts), [`context-mill: example-apps/sveltekit/src/hooks.server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.server.ts), [`context-mill: example-apps/ruby/todo.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby/todo.rb), [PostHog/context-mill#156](https://github.com/PostHog/context-mill/pull/156), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176), [PostHog/wizard#211](https://github.com/PostHog/wizard/pull/211), [PostHog/wizard#216](https://github.com/PostHog/wizard/pull/216)

**Frameworks.** `all`

**Wrong:**

```ts
# project actually lives on EU Cloud
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

posthog.init(token, { api_host: 'https://us.i.posthog.com' })
```

**Fixed:**

```ts
// harness: region comes from the OAuth token response (posthog_region), resolved once
HostResolution.fromRegion(region) // apiHost https://eu.i.posthog.com
// prompt: - PostHog Host: ${ctx.host.apiHost}
// skill: read `region` from projects-get: US -> us.i.posthog.com, EU -> eu.i.posthog.com
// unknown: ask "Are you on PostHog US Cloud or EU Cloud?" Do not assume US Cloud.
```

## Tracing and metrics endpoints hardcoded to US

**Problem.** OTLP exporters take a full URL. Agents paste the US /i/v1/traces or /i/v1/metrics example and do not reuse the host the project already has configured.

**Impact.** Spans and metrics for an EU or self-hosted project go to the wrong region and never show up.

**Rule location.**

- [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Key principles: Region, line 29, env vars, line 28)
- [`context-mill: context/skills/omnibus/instrument-metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-metrics/description.md) (STEP 6, lines 39-40)
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) (use wizard-supplied region, never guess one)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391), [PostHog/context-mill#399](https://github.com/PostHog/context-mill/pull/399), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [PostHog/context-mill#255](https://github.com/PostHog/context-mill/pull/255)

**Frameworks.** `all`, `opentelemetry`, `python`

**Wrong:**

```js
const exporter = new OTLPTraceExporter({
  url: 'https://us.i.posthog.com/i/v1/traces',
})
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://us.i.posthog.com/i/v1/metrics
```

**Fixed:**

```js
// tracing skill: host from the project's existing PostHog config, via env
const exporter = new OTLPTraceExporter({
  url: `${process.env.POSTHOG_HOST}/i/v1/traces`,
})
// metrics skill: /i/v1/metrics on the us or eu host that matches the projects-get region
// no config and no region: ask US vs EU. Do not assume US Cloud.
```

## Reverse proxy targets copied as US hosts

**Problem.** The example apps hardcode us.i.posthog.com and us-assets.i.posthog.com in their rewrites and ui\_host, and the agent copies them as-is. The assets origin is a third host that it does not think to switch.

**Impact.** An EU project's events and SDK assets are proxied to the US cluster. Ingestion fails or data lands in the wrong place, and nothing errors.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (route /static and /array to us-assets or eu-assets)
- [`context-mill: context/skills/omnibus/instrument-integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-integration/description.md) (STEP 6 region rule)

**Sources.** [PostHog/context-mill#217](https://github.com/PostHog/context-mill/pull/217), [PostHog/context-mill#103](https://github.com/PostHog/context-mill/pull/103), [`context-mill: example-apps/next-app-router/next.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/next.config.ts), [`context-mill: example-apps/react-react-router-7-framework/vite.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/vite.config.ts), [`context-mill: example-apps/sveltekit/src/hooks.server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.server.ts)

**Frameworks.** `nextjs`, `sveltekit`, `react-router-7-framework`, `tanstack-router`, `vite`

**Wrong:**

```ts
// project lives on EU Cloud
{ source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
{ source: "/ingest/:path*",        destination: "https://us.i.posthog.com/:path*" },
posthog.init(token, { api_host: '/ingest', ui_host: 'https://us.posthog.com' })
```

**Fixed:**

```ts
// region from projects-get, or ask "US Cloud or EU Cloud?"
{ source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
{ source: "/ingest/array/:path*",  destination: "https://eu-assets.i.posthog.com/array/:path*" },
{ source: "/ingest/:path*",        destination: "https://eu.i.posthog.com/:path*" },
posthog.init(token, { api_host: '/ingest', ui_host: 'https://eu.posthog.com' })
```

## App host used as the SDK host

**Problem.** us.posthog.com and us.i.posthog.com look nearly identical, and some examples put the UI host in the HOST env var. The agent copies that into api\_host and gets no error.

**Impact.** Events go to the app host instead of the ingestion route or proxy. This is wrong and fragile, and mostly silent.

**Rule location.**

- [`context-mill: example-apps/angular/src/app/app.component.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/src/app/app.component.ts) (api\_host '/ingest', ui\_host from env) and example-apps/angular/.env.example (NG\_APP\_POSTHOG\_HOST is the app host)
- [`wizard: src/shared/host-resolution.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/host-resolution.ts) (apiHost vs appHost, getUiHostFromHost)

**Sources.** [PostHog/wizard-workbench#2048](https://github.com/PostHog/wizard-workbench/pull/2048), [PostHog/wizard#600](https://github.com/PostHog/wizard/pull/600), [PostHog/wizard-workbench#1427](https://github.com/PostHog/wizard-workbench/pull/1427), [PostHog/wizard-workbench#1170](https://github.com/PostHog/wizard-workbench/pull/1170)

**Frameworks.** `angular`, `all`

**Wrong:**

```ts
posthog.init(environment.posthogKey, {
  api_host: environment.posthogHost || 'https://us.posthog.com',
})
```

**Fixed:**

```ts
posthog.init(environment.posthogKey, {
  api_host: '/ingest',  // same-origin proxy, or the ingestion host (us.i / eu.i.posthog.com)
  ui_host: environment.posthogHost || 'https://us.posthog.com', // app host belongs only in ui_host
})
// harness: HostResolution keeps apiHost (ingestion) and appHost (web app) as separate fields
```

## Browser link built from the ingestion host

**Problem.** The only host in the agent's context was labelled 'PostHog Host', and it was the ingestion origin. So the agent built app links from it. The ingestion host does not serve app pages, and the agent cannot see the broken link.

**Impact.** The deep link for the warehouse-source fallback is a dead end. The user is lost at the exact moment the fallback should rescue the run. Without utm params, sources finished on the web also cannot be tied back to the wizard.

**Rule location.**

- `wizard: src/lib/agent/agent-prompt-loader.ts` (projectContext appHost line), src/lib/host-resolution.ts
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (A deep-link source, step 2)

**Sources.** [PostHog/wizard#1097](https://github.com/PostHog/wizard/pull/1097), [wizard@10c9cb7](https://github.com/PostHog/wizard/commit/10c9cb71), [PostHog/context-mill#338](https://github.com/PostHog/context-mill/pull/338), [PostHog/context-mill#230](https://github.com/PostHog/context-mill/pull/230)

**Frameworks.** `all`

**Wrong:**

```ts
// apiHost = https://eu.i.posthog.com
const link = `${apiHost}/project/${id}/data-warehouse/new-source?kind=Stripe`
```

**Fixed:**

```text
Project context:
- PostHog Host: https://eu.i.posthog.com
- PostHog app URL (base for any link you show the user in a browser): https://eu.posthog.com
-> https://eu.posthog.com/project/123/data-warehouse/new-source?kind=Stripe&utm_source=wizard&utm_campaign=warehouse-source
# skill: host = Base URL from the MCP active-environment block, never PostHog Host
```

## App link missing the project id

**Problem.** App URLs look like they work without a team id, and no doc shows the /project/&lt;id>/ segment as required. The broken link is only seen when a person clicks it.

**Impact.** The URL matches no route and opens the PostHog 404 page.

**Rule location.**

- `wizard: src/utils/urls.ts` (warehouseSourceUrl)
- src/lib/programs/posthog-integration/index.ts

**Sources.** [PostHog/wizard#1087](https://github.com/PostHog/wizard/pull/1087)

**Frameworks.** `all`

**Wrong:**

```text
https://app.posthog.com/project/data-warehouse/new-source?kind=Stripe
```

**Fixed:**

```ts
const url = `${host.appHost}/project/${projectId}/data-warehouse/new-source?kind=${encodeURIComponent(kind)}`
// one link per detected source, capped at 3 plus a count
```

## Host hardcoded as a literal in init

**Problem.** Pasting the host string is the shortest working code, and the agent cannot tell a region literal from a proxy. A bare literal freezes the region, and an unknown domain quietly receives every event, identify call and replay.

**Impact.** The region or proxy is baked into source. EU or self-hosted projects send to the wrong endpoint, and an unknown host collects all user data.

**Rule location.**

- [`wizard: src/agent/runner/harness/pi/runtime-notes.ts#NO_LITERAL_URL`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (prompt rule only), src/agent/yara-hooks.ts (policy over warlock rules)
- warlock 0.2.4: src/scanner/rules/posthog\_hardcoded\_unknown\_api\_host.yar (warn). Historical: hardcoded\_posthog\_host in the wizard's deleted src/lib/yara-scanner.ts

**Sources.** [PostHog/wizard#818](https://github.com/PostHog/wizard/pull/818), [PostHog/wizard#804](https://github.com/PostHog/wizard/pull/804), [PostHog/wizard#135](https://github.com/PostHog/wizard/issues/135), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard#3](https://github.com/PostHog/wizard/pull/3), [PostHog/wizard#701](https://github.com/PostHog/wizard/pull/701)

**Frameworks.** `all`

**Wrong:**

```ts
posthog.init('phc_AbCdEf123456', {
  api_host: 'https://us.i.posthog.com', // project is EU
})
posthog.init(key, { api_host: 'https://t.metrics-edge.example' }) // unknown host
```

**Fixed:**

```ts
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com', // env wins
})
// pi runtime note NO_LITERAL_URL: never write a PostHog URL or token as a literal; read env vars
// warlock posthog_hardcoded_unknown_api_host (warn): api_host outside *.posthog.com/localhost/127.0.0.1
// (the old hardcoded_posthog_host block rule was deleted with the legacy scanner in #804)
```

## Region guessed by racing both clouds

**Problem.** Calling /api/users/@me/ on both US and EU and taking the first answer looks like a clever way to detect the region. It also overrides a region that was passed in explicitly, and it fails under latency.

**Impact.** Valid logins fail on slow connections (~430 since March). Under load the wrong region can win, and the project fetch then hangs about 120s before it fails.

**Rule location.**

- [`wizard: src/programs/oauth/tokens.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/oauth/tokens.ts) (OAuthTokenResponseSchema)
- src/shared/host-resolution.ts
- src/utils/setup-utils.ts (getOrAskForProjectData CI branch)
- src/shared/utils/urls.ts (detectRegion fallback)

**Sources.** [PostHog/wizard#934](https://github.com/PostHog/wizard/pull/934), [PostHog/wizard#763](https://github.com/PostHog/wizard/pull/763), [PostHog/wizard#926](https://github.com/PostHog/wizard/pull/926)

**Frameworks.** `all`

**Wrong:**

```ts
const [us, eu] = await Promise.allSettled([
  axios.get('https://us.posthog.com/api/users/@me/', { headers }),
  axios.get('https://eu.posthog.com/api/users/@me/', { headers }),
]);
if (us.status === 'fulfilled') return 'us';
```

**Fixed:**

```ts
// token response already says where it was issued
posthog_region: z.enum(['us', 'eu']).optional().catch(undefined),
HostResolution.fromAccessToken(token, { region: tokenResponse.posthog_region });
// CI: trust --region; probe only as a fallback (self-hosted)
const cloudRegion = _options.region ?? (await detectRegionFromToken(_options.apiKey))
```

## EU users sent to US MCP login

**Problem.** There is one documented MCP URL, and OAuth region discovery looks automatic. But Claude Code ignores authorization\_servers, so EU users get sent to the US login.

**Impact.** OAuth tokens are tied to a region, so EU users never authenticate the PostHog MCP server.

**Rule location.**

- `wizard: src/lib/host-resolution.ts` (MCP\_PROD\_URL, region routing now server-side)
- src/steps/add-mcp-server-to-clients/defaults.ts

**Sources.** [PostHog/wizard#220](https://github.com/PostHog/wizard/pull/220), [PostHog/wizard#240](https://github.com/PostHog/wizard/pull/240), [PostHog/wizard#308](https://github.com/PostHog/wizard/pull/308)

**Frameworks.** `all`, `claude-code`

**Wrong:**

```bash
claude mcp add --transport http posthog https://mcp.posthog.com/mcp -s user
# EU project: OAuth redirects to the US login page
```

**Fixed:**

```typescript
const host = region === 'eu'
  ? 'https://mcp-eu.posthog.com'   // #240 workaround
  : 'https://mcp.posthog.com'
// #220 first tried ?region=eu; #308 removed both once oauth.posthog.com routed regions
```

## Region detected by substring match

**Problem.** host.includes('eu.posthog.com') is the obvious one-liner, and it passes every normal test. Lookalike hosts get through anyway.

**Impact.** A host like eu.posthog.com.attacker.com is routed as EU, and CodeQL flags it as incomplete URL substring sanitization.

**Rule location.**

- [`wizard: src/agent/gateway-session.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/gateway-session.ts) (URL-parsed origin allowlist). Original #500 code (src/utils/urls.ts) was removed in #755
- substring includes('eu.i.posthog.com') still remains in src/shared/utils/urls.ts#getUiHostFromHost and src/shared/host-resolution.ts

**Sources.** [PostHog/wizard#500](https://github.com/PostHog/wizard/pull/500), [PostHog/wizard#755](https://github.com/PostHog/wizard/pull/755)

**Frameworks.** `all`

**Wrong:**

```ts
const isEu = host.includes('eu.posthog.com')
return isEu ? EU_URL : US_URL
```

**Fixed:**

```ts
// PR #500 (since removed in #755): parse, then exact / subdomain match
const hostname = new URL(host).hostname.toLowerCase()
const isEu = hostname === 'eu.posthog.com' || hostname.endsWith('.eu.posthog.com')
// current main, gateway-session.ts: parse URL, then compare exact origins
if (url.hostname.endsWith('.posthog.com')) {
  return url.origin === 'https://ai-gateway.us.posthog.com' ||
         url.origin === 'https://ai-gateway.eu.posthog.com'
}
```

## Custom stack URL not carried to every host

**Problem.** Each call site derived its own host from the region, so a --base-url local or custom stack reached some origins and not others. Nothing errors when one origin still points at cloud.

**Impact.** On a custom stack, events, links, the gateway or the MCP server go to the wrong origin with no error.

**Rule location.**

- [`wizard: src/shared/host-resolution.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/host-resolution.ts) (HostResolution)
- src/programs/posthog-integration/index.ts (prompt host line)

**Sources.** [PostHog/wizard#746](https://github.com/PostHog/wizard/pull/746), [PostHog/wizard#749](https://github.com/PostHog/wizard/pull/749), [PostHog/wizard#755](https://github.com/PostHog/wizard/pull/755)

**Frameworks.** `all`

**Wrong:**

```shell
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   # same for EU and local --base-url stacks
```

**Fixed:**

```ts
const host = HostResolution.fromRegion(region, { baseUrl }) // --base-url pins every origin
host.apiHost   // SDK host written to .env
host.appHost   // user-facing links
// also assetHost, gatewayUrl, mcpUrl, all resolved once per run
```
