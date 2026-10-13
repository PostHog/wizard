# Reverse proxy missing or broken

11 cases. Part of the [edge case catalogue](../edge-cases.md).

## Vite proxy has one catch-all /ingest rule

**Problem.** The common Vite proxy recipe is a single '/ingest' entry, and it works for capture, so nothing signals that SDK bundles and remote config need the assets host.

**Impact.** Static SDK assets and /array config load through the API origin, which strips cache-control, so stale config breaks flags, replay conditions and sampling.

**Rule location.**

- [`context-mill: example-apps/tanstack-start/vite.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/vite.config.ts) react-react-router-7-framework/vite.config.ts, react-tanstack-router-\*/vite.config.ts
- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#103](https://github.com/PostHog/context-mill/pull/103), [context-mill@cef5030](https://github.com/PostHog/context-mill/commit/cef5030d), [PostHog/posthog.com#16081](https://github.com/PostHog/posthog.com/pull/16081)

**Frameworks.** `vite`, `react-router`, `tanstack-router`, `tanstack-start`, `vue`

**Wrong:**

```typescript
server: { proxy: {
  '/ingest': {
    target: 'https://us.i.posthog.com',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/ingest/, ''),
  },
} }
```

**Fixed:**

```typescript
proxy: {
  '/ingest/static': { target: 'https://us-assets.i.posthog.com', changeOrigin: true, rewrite: p => p.replace(/^\/ingest/, '') },
  '/ingest/array':  { target: 'https://us-assets.i.posthog.com', changeOrigin: true, rewrite: p => p.replace(/^\/ingest/, '') },
  '/ingest':        { target: 'https://us.i.posthog.com', changeOrigin: true, rewrite: p => p.replace(/^\/ingest/, '') },
}
```

## SvelteKit proxy hook only handles /static

**Problem.** SvelteKit has no rewrites, so the agent hand-writes a handle() proxy and picks the host with one startsWith check. Docs and old examples only checked /static.

**Impact.** Silent: /ingest/array/ remote config is served from the API origin without cache-control and goes stale in browsers. If assets aren't split at all, the SDK script fails.

**Rule location.**

- [`context-mill: example-apps/sveltekit/src/hooks.server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.server.ts)
- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#72](https://github.com/PostHog/context-mill/pull/72), [PostHog/context-mill#103](https://github.com/PostHog/context-mill/pull/103), [PostHog/posthog.com#16081](https://github.com/PostHog/posthog.com/pull/16081)

**Frameworks.** `sveltekit`

**Wrong:**

```typescript
if (pathname.startsWith('/ingest')) {
  const hostname = pathname.startsWith('/ingest/static/')
    ? 'us-assets.i.posthog.com'
    : 'us.i.posthog.com' // /ingest/array/* lands here
```

**Fixed:**

```typescript
const useAssetHost = pathname.startsWith('/ingest/static/')
  || pathname.startsWith('/ingest/array/')
const hostname = useAssetHost
  ? 'us-assets.i.posthog.com'
  : 'us.i.posthog.com'
```

## Browser SDK sends straight to PostHog, no proxy

**Problem.** The quickstart snippet uses the public ingest host and works on the agent's machine. Ad-blocker loss only shows up as under-counting in production.

**Impact.** Silent: ad and tracking blockers drop a meaningful share of browser events, flags and replay.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (line 47, 'In production, use a reverse proxy')
- [`context-mill: context/skills/audit/references/4-event-capture.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/4-event-capture.md) (capture-uses-proxy)
- [`wizard: src/programs/audit/seed.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/audit/seed.ts)
- example apps with proxy: next-\*, react-react-router-7-framework, react-tanstack-router-\*, tanstack-start, sveltekit

**Sources.** [PostHog/wizard-workbench#4409](https://github.com/PostHog/wizard-workbench/pull/4409), [PostHog/wizard-workbench#4446](https://github.com/PostHog/wizard-workbench/pull/4446), [PostHog/wizard-workbench#4468](https://github.com/PostHog/wizard-workbench/pull/4468), [PostHog/wizard-workbench#4472](https://github.com/PostHog/wizard-workbench/pull/4472), [PostHog/wizard-workbench#4450](https://github.com/PostHog/wizard-workbench/pull/4450), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425), [PostHog/wizard#1212](https://github.com/PostHog/wizard/issues/1212), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript_web`, `nextjs`, `react-router`, `tanstack-router`, `sveltekit`, `astro`, `vue`, `angular`

**Wrong:**

```typescript
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: 'https://us.i.posthog.com', // blocked by ad blockers
})
```

**Fixed:**

```typescript
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
})
// plus framework rewrites: /ingest/static, /ingest/array -> assets origin; /ingest -> us.i.posthog.com
```

## Proxy configured only for the dev server

**Problem.** The examples proxy through Vite server.proxy or Angular proxy.conf.json, which work during local testing. Neither exists in a production build, and nothing warns about it.

**Impact.** Silent in production: the static build has no /ingest route, so ingestion and SDK asset requests 404 and no events arrive.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (line 47, 'In production, use a reverse proxy')
- [`context-mill: example-apps/tanstack-start/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/README.md) ('Vite dev server proxy'), react-tanstack-router-\*/README.md, angular/proxy.conf.json (dev-only, single /ingest rule). No rule currently tells the agent to add a production proxy route

**Sources.** [PostHog/wizard-workbench#4409](https://github.com/PostHog/wizard-workbench/pull/4409), [PostHog/wizard-workbench#4450](https://github.com/PostHog/wizard-workbench/pull/4450), [PostHog/posthog.com#16081](https://github.com/PostHog/posthog.com/pull/16081), [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67), [PostHog/context-mill#74](https://github.com/PostHog/context-mill/pull/74), [`context-mill: example-apps/react-tanstack-router-code-based/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-tanstack-router-code-based/README.md), [`context-mill: example-apps/tanstack-start/vite.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/vite.config.ts)

**Frameworks.** `vite`, `tanstack-start`, `tanstack-router`, `react-router`, `angular`

**Wrong:**

```typescript
// vite.config.ts (vite dev / preview only)
server: { proxy: { '/ingest': { target: 'https://us.i.posthog.com', changeOrigin: true } } }
// app
posthog.init(token, { api_host: '/ingest' }) // no /ingest route in prod
```

**Fixed:**

```text
# vercel.json / netlify / nginx / CDN, same three routes as dev
/ingest/static/*  -> https://us-assets.i.posthog.com/static/*
/ingest/array/*   -> https://us-assets.i.posthog.com/array/*
/ingest/*         -> https://us.i.posthog.com/*
```

## Proxied api\_host without ui\_host

**Problem.** ui\_host looks redundant once api\_host is set, so the agent leaves it out or drops it while tidying init. Capture keeps working, so nothing shows the break.

**Impact.** Toolbar, replay and 'view in PostHog' links resolve against the proxy path instead of the PostHog app.

**Rule location.**

- [`context-mill: example-apps/next-app-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/instrumentation-client.ts) next-pages-router/instrumentation-client.ts (also sveltekit, angular, tanstack-start examples)
- no commandment states it, and wizard src has no ui\_host rule (wizard only has the e2e fixture)

**Sources.** [PostHog/wizard#1121](https://github.com/PostHog/wizard/issues/1121), [wizard@307cd12](https://github.com/PostHog/wizard/commit/307cd121), [posthog.com/docs/advanced/proxy](https://posthog.com/docs/advanced/proxy), [PostHog/wizard#1212](https://github.com/PostHog/wizard/issues/1212), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214), [wizard@0431750](https://github.com/PostHog/wizard/commit/04317501)

**Frameworks.** `nextjs`, `react-router`, `tanstack-start`, `javascript_web`

**Wrong:**

```typescript
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  // ui_host dropped
})
```

**Fixed:**

```typescript
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com', // eu.posthog.com for EU
})
```

## Next.js proxy without skipTrailingSlashRedirect

**Problem.** Rewrites alone look sufficient, and Next.js's default trailing-slash redirect is invisible until a capture request with a trailing slash is redirected.

**Impact.** PostHog's trailing-slash API paths such as /ingest/e/ get 308-redirected, so proxied capture requests fail and events are lost without a visible error.

**Rule location.** [`context-mill: example-apps/next-app-router/next.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/next.config.ts) next-pages-router/next.config.ts

**Sources.** [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214), [wizard@307cd12](https://github.com/PostHog/wizard/commit/307cd121), [wizard@0431750](https://github.com/PostHog/wizard/commit/04317501)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
const nextConfig: NextConfig = {
  async rewrites() { return [ /* ingest rewrites */ ] },
}
```

**Fixed:**

```typescript
const nextConfig: NextConfig = {
  async rewrites() { return [ /* static, array, then catch-all */ ] },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}
```

## Hand-written proxy forwards the original headers unchanged

**Problem.** Passing the request through with fetch looks like a faithful proxy. But the Host header, the client IP and Node's streaming-body rules all need explicit handling, and no error points at them.

**Impact.** Requests fail or lose geolocation. Host still names the app, every event gets the server's IP, and Node fetch throws on a streamed body without duplex.

**Rule location.** [`context-mill: example-apps/sveltekit/src/hooks.server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.server.ts)

**Sources.** [PostHog/context-mill#72](https://github.com/PostHog/context-mill/pull/72), [PostHog/wizard-workbench#2009](https://github.com/PostHog/wizard-workbench/pull/2009), [posthog.com/docs/advanced/proxy/sveltekit](https://posthog.com/docs/advanced/proxy/sveltekit)

**Frameworks.** `sveltekit`

**Wrong:**

```typescript
return fetch('https://us.i.posthog.com' + pathname.replace('/ingest', ''), {
  method: event.request.method,
  headers: event.request.headers, // Host is the app's; client IP lost
  body: event.request.body,       // Node fetch needs duplex: 'half'
})
```

**Fixed:**

```typescript
const headers = new Headers(event.request.headers)
headers.set('host', hostname)
headers.set('accept-encoding', '')
const clientIp = event.request.headers.get('x-forwarded-for') || event.getClientAddress()
if (clientIp) headers.set('x-forwarded-for', clientIp)
return fetch(url.toString(), { method: event.request.method, headers,
  body: event.request.body, duplex: 'half' })
```

## Reverse proxy wired into the server SDK

**Problem.** Browser guidance says 'use a reverse proxy', and the agent applies it to posthog-node too, not knowing ad blockers only affect client-side JavaScript.

**Impact.** Server events go to a relative or self-hosted path that is not a valid PostHog host, or needless proxy plumbing adds failure modes.

**Rule location.** [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (reverse proxy not needed server-side)

**Sources.** [PostHog/context-mill#89](https://github.com/PostHog/context-mill/pull/89), [context-mill@e393145](https://github.com/PostHog/context-mill/commit/e393145c)

**Frameworks.** `javascript_node`

**Wrong:**

```typescript
app.use('/ingest', createProxyMiddleware({ target: 'https://us.i.posthog.com' }));
const client = new PostHog(token, { host: 'http://localhost:3000/ingest' });
```

**Fixed:**

```typescript
// the reverse proxy is only for client-side posthog-js
const client = new PostHog(projectToken, {
  host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
});
```

## PHP first-party loader fatals when served standalone

**Problem.** The agent writes the loader script as if it ran inside the app's bootstrap, so app helpers and config look available when the web server serves the file directly.

**Impact.** The script hits an undefined function or constant and fatals, so no PostHog script loads and no events ever arrive.

**Rule location.** [`context-mill: context/commandments.yaml#php`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@bb3f77d](https://github.com/PostHog/context-mill/commit/bb3f77d1), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245 (benchmark comment: freshrss row and footnote 3)), [context-mill@bb3f77d](https://github.com/PostHog/context-mill/commit/bb3f77d1 (adds the php commandment))

**Frameworks.** `php`

**Wrong:**

```php
<?php
// posthog.js.php, served directly by the web server
header('Content-Type: application/javascript');
echo file_get_contents(config('posthog.script_url')); // config() undefined
```

**Fixed:**

```php
<?php
require_once __DIR__ . '/constants.php'; // load own config explicitly
header('Content-Type: application/javascript');
echo file_get_contents(POSTHOG_SCRIPT_URL);
```

## Proxy set up on one host, not the others

**Problem.** The agent proxies the app it is editing and misses a second site or subdomain in the same project. Per-host gaps don't show up without grouping events by host.

**Impact.** Silent: ad blockers drop events only from the direct host, so one domain under-reports.

**Rule location.**

- [`context-mill: context/skills/web-analytics/references/checks.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/checks.md) (Check 1, partial reverse proxy audit query)
- remediation.md (partial\_reverse\_proxy: manual guidance, links posthog.com/docs/advanced/proxy)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `javascript_web`, `nextjs`

**Wrong:**

```typescript
// app.example.com
posthog.init(key, { api_host: '/ingest', ui_host: 'https://us.posthog.com' })
// go.example.com (same project)
posthog.init(key, { api_host: 'https://us.i.posthog.com' })
```

**Fixed:**

```sql
countIf(coalesce(properties.$lib_custom_api_host,'') = ''
  OR coalesce(properties.$lib_custom_api_host,'') LIKE '%posthog.com%') AS direct,
countIf(coalesce(properties.$lib_custom_api_host,'') != ''
  AND coalesce(properties.$lib_custom_api_host,'') NOT LIKE '%posthog.com%') AS proxied
-- GROUP BY $host HAVING total >= 100
```

## Proxy asset routes left on US for EU

**Problem.** The agent switches the main /ingest target to EU but copies the example's us-assets.i.posthog.com rules unchanged. Examples hardcode the US assets origin, and the split is easy to miss.

**Impact.** An EU project proxies /static and /array requests to the US assets origin while ingestion goes to EU, so SDK config or scripts may fail to load (inferred, no failing run).

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (first bullet: /static/\* AND /array/\* route to us-assets or eu-assets origin)
- `context-mill: example-apps/{react-react-router-7-framework,react-tanstack-router-code-based,react-tanstack-router-file-based,tanstack-start}/vite.config.ts` and example-apps/{next-app-router,next-pages-router}/next.config.ts hardcode us-assets

**Sources.** [PostHog/context-mill#103](https://github.com/PostHog/context-mill/pull/103), [`context-mill: example-apps/react-react-router-7-framework/vite.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/vite.config.ts), [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Frameworks.** `react-router-7-framework`, `tanstack-router`, `nextjs`, `vite`

**Wrong:**

```ts
'/ingest/array': { target: 'https://us-assets.i.posthog.com', changeOrigin: true }, // project is EU
'/ingest':       { target: 'https://eu.i.posthog.com', changeOrigin: true },
```

**Fixed:**

```ts
// route /static/* AND /array/* to the region's assets origin
const strip = (p: string) => p.replace(/^\/ingest/, '')
'/ingest/static': { target: 'https://eu-assets.i.posthog.com', changeOrigin: true, rewrite: strip },
'/ingest/array':  { target: 'https://eu-assets.i.posthog.com', changeOrigin: true, rewrite: strip },
'/ingest':        { target: 'https://eu.i.posthog.com', changeOrigin: true, rewrite: strip },
// ui_host: https://eu.posthog.com
```
