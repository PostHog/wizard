# SDK started in the wrong place

23 cases. Part of the [edge case catalogue](../edge-cases.md).

## Next.js init written from memory in lib file

**Problem.** Fast or low-effort models write Next.js boilerplate from training data instead of reading the installed reference. They pick an older file convention, guess the env var name and leave out current SDK options, and the build still passes, so nothing flags it.

**Impact.** Silent: init lands in a file nothing imports at app start, reads an env var nobody set, and has no defaults (no history\_change pageviews), so capture can be dead while the diff looks complete.

**Rule location.**

- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) (model\_pi/effort\_pi pinned to terra low)
- [`context-mill: context/skills/integration-v2/init/description.md#Init`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) point
- [`context-mill: context/skills/integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) 'Match the example'
- [`context-mill: example-apps/next-app-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/instrumentation-client.ts) next-pages-router/instrumentation-client.ts
- [`context-mill: context/commandments.yaml#nextjs`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245#issuecomment-4994610950), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@8a649f9](https://github.com/PostHog/context-mill/commit/8a649f9c), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#293](https://github.com/PostHog/context-mill/pull/293)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
// lib/posthog.ts  (luna low, written from model memory)
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
})   // no defaults; nothing imports this at startup
export default posthog
```

**Fixed:**

```typescript
// instrumentation-client.ts (Next 15.3+, app and pages router)
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
  capture_exceptions: true,
})
```

## instrumentation-client.ts on Next.js older than 15.3

**Problem.** Current docs and the skill's own Next.js guidance point at instrumentation-client.ts without a version gate, and the agent does not check the installed next version. Older Next silently ignores the file, so it compiles and builds cleanly.

**Impact.** Silent: the file is never executed, client-side PostHog never initializes and no event ever fires.

**Rule location.**

- `wizard: src/frameworks/nextjs/nextjs-wizard-agent.ts` (detection.minimumVersion 15.3.0)
- src/lib/detection/context.ts (checkFrameworkVersion)
- src/ui/tui/screens/PostHogIntegrationIntroScreen.tsx (unsupported message)
- [`context-mill: context/skills/posthog-best-practices/description.md#Next.js`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('Below 15.3 that file is never executed')
- [`context-mill: context/commandments.yaml#nextjs`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) says only 'For Next.js 15.3+' with no fallback

**Sources.** [PostHog/context-mill#236](https://github.com/PostHog/context-mill/pull/236), [context-mill@7f88084](https://github.com/PostHog/context-mill/commit/7f880840), [PostHog/wizard#50](https://github.com/PostHog/wizard/pull/50), [PostHog/wizard#61](https://github.com/PostHog/wizard/issues/61), [PostHog/wizard#46](https://github.com/PostHog/wizard/issues/46), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214), [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
// package.json: "next": "14.2.5"
// instrumentation-client.ts  (never loaded on Next < 15.3)
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
})
```

**Fixed:**

```typescript
// wizard harness: src/frameworks/nextjs/nextjs-wizard-agent.ts
detection: { packageName: 'next', minimumVersion: '15.3.0',
  getInstalledVersion: (o) => Promise.resolve(getInstalledPackageVersion('next', o.installDir)) }
// below it the intro screen says "Version 14.2.5 is not supported by the wizard.
// Please upgrade to 15.3.0 or later." with a manual-setup docs link
// skill (posthog-best-practices#Next.js): "Check the installed version before choosing"
// >= 15.3: instrumentation-client.ts
// <  15.3: 'use client' provider in the root layout (app router) or _app (pages router)
```

## instrumentation-client file gets the wrong extension

**Problem.** Agents carry component habits (.tsx/.jsx) to a Next.js file convention, and the wizard's own prompt listed the extensions in conflicting order. Next gives no error for a file it does not recognise.

**Impact.** Inconsistent runs: sometimes the init file is not picked up as the instrumentation-client convention and PostHog never initializes, silently.

**Rule location.**

- [`context-mill: example-apps/next-app-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/instrumentation-client.ts) and example-apps/next-pages-router/instrumentation-client.ts (no explicit extension rule remains in commandments.yaml or posthog-best-practices)
- `wizard: legacy` src/nextjs/docs.ts, removed in #214

**Sources.** [PostHog/wizard#72](https://github.com/PostHog/wizard/pull/72), [wizard@ce4d052](https://github.com/PostHog/wizard/commit/ce4d052e), [PostHog/wizard#50](https://github.com/PostHog/wizard/pull/50)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
// instrumentation-client.tsx   (or .js in a TS project)
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, { api_host: '/ingest' })
```

**Fixed:**

```typescript
// Fix in wizard #72: the prompt named one extension per project language.
// That prompt (src/nextjs/docs.ts) was later removed; today the shape comes
// from the example apps, which ship instrumentation-client.ts at the project root.
// instrumentation-client.ts
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest', defaults: '2026-01-30',
})
```

## Next.js init inside a useEffect provider

**Problem.** Older posthog-js docs and most blog posts show a 'use client' PostHogProvider or \_app.tsx that calls posthog.init in useEffect, often with a dynamic import to dodge SSR. Agents reproduce it from training data even when instrumentation-client.ts is available.

**Impact.** Init waits for hydration, so the first pageview and captures or flag reads made before the effect runs are dropped or throw. Every caller needs init guards and flags flicker. A workbench evaluator rated it CRITICAL.

**Rule location.**

- [`context-mill: context/commandments.yaml#nextjs`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #nextjs-feature-flags ('Do NOT wrap components in PostHogProvider just for feature flags'), #javascript\_web ('posthog.init() MUST be called before any other PostHog methods')
- [`context-mill: example-apps/next-pages-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-pages-router/instrumentation-client.ts)

**Sources.** [PostHog/wizard-workbench#4397](https://github.com/PostHog/wizard-workbench/pull/4397), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [context-mill@a0bf8af](https://github.com/PostHog/context-mill/commit/a0bf8af0), [context-mill@4f95b8f](https://github.com/PostHog/context-mill/commit/4f95b8fd), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `nextjs`

**Wrong:**

```tsx
export function PostHogInitializer() {
  useEffect(() => {
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.init(token, { api_host: host })
      window.posthogInitialized = true
      window.dispatchEvent(new Event('posthog_initialized'))
    })
  }, [])
}   // pages call posthog.capture() with no init guard
```

**Fixed:**

```typescript
// instrumentation-client.ts runs before any component renders
import posthog from 'posthog-js'
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  defaults: '2026-01-30',
})
// components: useFeatureFlagEnabled('flag') works without PostHogProvider
```

## PostHog provider or init added twice

**Problem.** Agents add a PostHogProvider or init by reflex without searching for an existing provider or instrumentation-client.ts init, because most React examples pair init with a provider, including for flag hooks. Double init throws no error.

**Impact.** Two browser inits race to stamp $set\_once properties like $initial\_pathname, corrupting attribution and double-capturing pageviews. One multi-SDK customer saw about 165k blocked merges per day.

**Rule location.**

- [`context-mill: context/skills/audit/references/2-init.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/2-init.md) (init-not-duplicated)
- [`context-mill: context/commandments.yaml#nextjs-feature-flags`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (hooks work WITHOUT PostHogProvider)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('Initialize it once and do it early')
- [`context-mill: example-apps/next-app-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/instrumentation-client.ts) (IMPORTANT comment)
- `wizard: src/lib/agent/commandments.ts` (no PostHogProvider unless the skill requires it)

**Sources.** [PostHog/wizard#46](https://github.com/PostHog/wizard/issues/46), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [PostHog/context-mill#84](https://github.com/PostHog/context-mill/pull/84), [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5)

**Frameworks.** `nextjs`, `react`, `javascript-web`

**Wrong:**

```tsx
// instrumentation-client.ts
posthog.init(KEY, { api_host: '/ingest' })
// app/providers.tsx (always mounted)
useEffect(() => { posthog.init(KEY, { api_host: '/ingest' }) }, [])
// app/layout.tsx: <PHProvider>{children}</PHProvider>
// and <PostHogProvider> added again in the providers list
```

**Fixed:**

```tsx
// instrumentation-client.ts: the one browser init
//IMPORTANT: Never combine this approach with other client-side PostHog
// initialization approaches, especially components like a PostHogProvider.
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, { api_host: '/ingest' })

// components: hooks use the singleton, no provider needed
const on = useFeatureFlagEnabled('promo')
// audit init-not-duplicated: warning on 2+ browser inits, error if confirmed on one page
```

## Migration swaps old provider for a second PostHog one

**Problem.** When removing a vendor provider such as StatsigProvider, the natural edit is a like-for-like swap, so the agent inserts a PostHog provider without noticing the integration step already installed one.

**Impact.** PostHog initializes twice in the same runtime: duplicate pageviews and captures, and identity races.

**Rule location.**

- [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (Initialization)
- [`context-mill: context/skills/migrate/references/3-plan.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/3-plan.md)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `react`, `nextjs`, `javascript-web`, `statsig`

**Wrong:**

```diff
- <StatsigProvider sdkKey={KEY} user={user}>
+ <PostHogProvider apiKey={KEY}>   // integration step already added one
    <App />
- </StatsigProvider>
+ </PostHogProvider>
```

**Fixed:**

```diff
- <StatsigProvider sdkKey={KEY} user={user}>
    <App />
- </StatsigProvider>
// The PostHog provider from Step 2 takes its place. Before planning, scan for
// posthog.init / capture / identify Step 2 added; Step 4 must not duplicate them.
```

## React SPA init inside a component effect

**Problem.** React habit puts side effects in useEffect, so agents init there. React runs child effects before parent effects, and posthog-js calls made before init are dropped with a console error, so nothing visibly breaks.

**Impact.** Captures or identify calls fired from child effects before the init effect runs are dropped, and StrictMode runs the init effect twice in dev (second init warns and is ignored). Silent.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('posthog.init() MUST be called before any other PostHog methods')
- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) (Init point, item 1: 'One init, running once in the browser, at the app's entry or its provider')
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (React: 'Keep initialization global')
- [`context-mill: example-apps/react-vite/src/main.jsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-vite/src/main.jsx)

**Sources.** [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92)

**Frameworks.** `react`, `react-vite`, `react-router`, `javascript_web`

**Wrong:**

```jsx
function App() {
  useEffect(() => {
    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, { api_host: '/ingest' })
  }, [])
  return <Routes />
}
```

**Fixed:**

```jsx
// main.jsx: init once at module scope, before render
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2026-01-30',
})
ReactDOM.createRoot(root).render(
  <StrictMode><PostHogProvider client={posthog}>
    <PostHogErrorBoundary><App /></PostHogErrorBoundary>
  </PostHogProvider></StrictMode>)
```

## PostHog script tags cause hydration errors

**Problem.** Agents copy a minimal posthog.init without the defaults date, unaware that older defaults append lazy-loaded scripts into body, where they interleave with the router's server-rendered DOM.

**Impact.** Hydration mismatch errors in SSR React apps. The app still renders, so it looks like an unrelated framework bug.

**Rule location.**

- `context-mill: no` commandment or skill rule
- encoded only as `defaults: '2026-01-30'` in example-apps/react-react-router-7-framework/app/entry.client.tsx, example-apps/react-tanstack-router-code-based/src/main.tsx, example-apps/react-tanstack-router-file-based/src/routes/\_\_root.tsx (example-apps/tanstack-start still '2025-05-24')

**Sources.** [PostHog/posthog-js#2781](https://github.com/PostHog/posthog-js/issues/2781)

**Frameworks.** `tanstack-router`, `tanstack-start`, `react-router-7-framework`

**Wrong:**

```typescript
posthog.init(token, { api_host: host })   // no defaults: scripts appended to <body>
```

**Fixed:**

```typescript
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2026-01-30',   // implies external_scripts_inject_target: 'head'
})
```

## SvelteKit init runs during server render

**Problem.** +layout.ts and the module script of +layout.svelte look like client app-root code, but SvelteKit executes them on the server too, and posthog-js is browser-only.

**Impact.** Unguarded init or identify runs during SSR (no-op or error), a universal load can re-run on navigation, and events from the server pass are lost. Silent.

**Rule location.**

- [`context-mill: example-apps/sveltekit/src/hooks.client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.client.ts) example-apps/sveltekit/src/lib/auth.svelte.ts (`browser` guard)
- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('posthog-js is browser-only'), applied to SvelteKit via tags in context/skills/integration/config.yaml
- #sveltekit has no init rule

**Sources.** [PostHog/context-mill#72](https://github.com/PostHog/context-mill/pull/72), [PostHog/wizard#248](https://github.com/PostHog/wizard/pull/248), [PostHog/wizard#261](https://github.com/PostHog/wizard/pull/261), [PostHog/wizard-workbench#4472](https://github.com/PostHog/wizard-workbench/pull/4472)

**Frameworks.** `sveltekit`

**Wrong:**

```typescript
// src/routes/+layout.ts  (also runs on the server)
import posthog from 'posthog-js'
posthog.init(PUBLIC_POSTHOG_KEY, { api_host: PUBLIC_POSTHOG_HOST })
// same problem in +layout.svelte <script>: module scope runs during SSR
```

**Fixed:**

```typescript
// src/hooks.client.ts: runs once, in the browser, at app start
export async function init() {
  posthog.init(PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: '/ingest', ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30', capture_exceptions: true,
  })
}
// src/lib/auth.svelte.ts
if (browser) { posthog.identify(username, { username }) }
```

## Angular init runs on the server render

**Problem.** Constructors, ngOnInit and app config also execute during Angular SSR, and agents call posthog-js there directly or import it in components instead of one DI service with a platform check.

**Impact.** Server render throws on missing window/document or breaks hydration, server-side calls hit an uninitialized client, and init is scattered across components.

**Rule location.**

- [`context-mill: example-apps/angular/src/app/services/posthog.service.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/src/app/services/posthog.service.ts) (isPlatformBrowser guard, no-op Proxy), app.component.ts (second isPlatformBrowser check before init)
- [`context-mill: context/commandments.yaml#angular`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) only mandates a singleton root PosthogService via inject(), not the platform check

**Sources.** [PostHog/context-mill#74](https://github.com/PostHog/context-mill/pull/74), [PostHog/wizard#264](https://github.com/PostHog/wizard/pull/264), [PostHog/wizard-workbench#1011](https://github.com/PostHog/wizard-workbench/pull/1011), [PostHog/wizard-workbench#1046](https://github.com/PostHog/wizard-workbench/pull/1046)

**Frameworks.** `angular`

**Wrong:**

```typescript
export class AppComponent implements OnInit {
  ngOnInit() {
    // also executes during the server render
    posthog.init(environment.posthogKey, { api_host: '/ingest' })
  }
}
// other components import posthog-js and call capture directly
```

**Fixed:**

```typescript
@Injectable({ providedIn: 'root' })
export class PostHogService {
  init(apiKey: string, options: Partial<PostHogConfig>) {
    if (isPlatformBrowser(this.platformId) && !this.initialized) {
      posthog.init(apiKey, options); this.initialized = true
    }
  }
  get posthog() { /* real client in browser, no-op Proxy on the server */ }
}
```

## Nuxt components assume a PostHog client exists

**Problem.** Agents import posthog-js directly in a component or call usePostHog().capture() without a guard, not realising there is no client during server render or when the token is unset.

**Impact.** Unguarded calls throw during SSR or in event handlers, breaking the page for the sake of analytics.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (posthog-js is browser-only, generic not Nuxt-specific)
- [`context-mill: example-apps/nuxt-4/nuxt.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/nuxt.config.ts) (@posthog/nuxt module provides usePostHog)
- `context-mill: example-apps/nuxt-4/app/pages/{burrito,index,profile}.vue` app/components/AppHeader.vue

**Sources.** [PostHog/context-mill#62](https://github.com/PostHog/context-mill/pull/62), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83)

**Frameworks.** `nuxt`, `vue`

**Wrong:**

```vue
<script setup>
import posthog from 'posthog-js'   // browser-only, also runs during SSR
posthog.capture('burrito_considered')
</script>
```

**Fixed:**

```typescript
const posthog = usePostHog()
posthog?.capture('burrito_considered', {
  total_considerations: response.user.burritoConsiderations,
})
posthog?.captureException(err)
```

## Nuxt plugin also runs on the server

**Problem.** plugins/posthog.ts looks client-side, but Nuxt runs unsuffixed plugins in Nitro SSR too. Only the .client filename makes it browser-only.

**Impact.** SSR throws 'window is not defined' or initializes a browser SDK on the server.

**Rule location.**

- [`context-mill: example-apps/nuxt-3-6/plugins/posthog.client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-3-6/plugins/posthog.client.ts)
- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (posthog-js is browser-only)

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [`context-mill: example-apps/nuxt-3-6/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-3-6/README.md)

**Frameworks.** `nuxt`, `vue-3`

**Wrong:**

```typescript
// plugins/posthog.ts   (runs on server and client)
export default defineNuxtPlugin(() => {
  posthog.init(runtimeConfig.public.posthog.publicKey, {
    tracing_headers: [window.location.hostname],
  })
})
```

**Fixed:**

```typescript
// plugins/posthog.client.ts   (client-only by filename)
export default defineNuxtPlugin((nuxtApp) => {
  const posthogClient = posthog.init(runtimeConfig.public.posthog.publicKey, {
    api_host: runtimeConfig.public.posthog.host,
    tracing_headers: [window.location.hostname],
  })
  return { provide: { posthog: posthogClient as PostHog } }
})
```

## One init pattern applied to every rendering mode

**Problem.** Agents treat a framework as one install shape, but Astro static/SSR/hybrid/view-transitions, Nuxt 3.0-3.6 vs 3.7+/4, and TanStack file- vs code-based routing each need a different init. A plain Astro script tag is bundled and type-checked, so the snippet throws TypeScript errors.

**Impact.** Init breaks at build time or never runs for the project's actual mode or version.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (astro-static/view-transitions/ssr/hybrid ids at ~line 326, nuxt-3-6 vs nuxt-4, react-tanstack-router-file-based vs code-based)
- [`context-mill: context/commandments.yaml#astro`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (is:inline, PUBLIC\_ prefix, posthog.astro component)
- [`context-mill: example-apps/astro-static/src/components/posthog.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-static/src/components/posthog.astro)

**Sources.** [PostHog/context-mill#64](https://github.com/PostHog/context-mill/pull/64), [PostHog/context-mill#68](https://github.com/PostHog/context-mill/pull/68), [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73)

**Frameworks.** `astro`, `nuxt`, `tanstack-router`

**Wrong:**

```astro
<!-- Layout.astro: Astro processes this script -->
<script>
  import posthog from 'posthog-js'
  posthog.init(import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN, { api_host })
</script>
```

**Fixed:**

```astro
<!-- src/components/posthog.astro, imported in the Layout -->
<script is:inline define:vars={{ apiKey: import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN, apiHost: import.meta.env.PUBLIC_POSTHOG_HOST }}>
  /* browser snippet */
  posthog.init(apiKey || '', { api_host: apiHost || 'https://us.i.posthog.com', defaults: '2026-01-30' })
</script>
```

## Next.js router guessed instead of detected

**Problem.** Most current examples assume the App Router, so an agent applies app/providers.tsx and layout wiring to a Pages Router project.

**Impact.** The provider is created but nothing mounts it, so PostHog never initializes and nothing errors.

**Rule location.**

- `wizard: src/frameworks/nextjs/utils.ts` (getNextJsRouter), src/frameworks/nextjs/nextjs-wizard-agent.ts (setup.questions, prompts.getAdditionalContextLines)
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (variants nextjs-app-router, nextjs-pages-router)

**Sources.** [`wizard: src/frameworks/nextjs/utils.ts`](https://github.com/PostHog/wizard/blob/main/src/frameworks/nextjs/utils.ts), [`wizard: src/frameworks/nextjs/nextjs-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/frameworks/nextjs/nextjs-wizard-agent.ts), [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml)

**Frameworks.** `nextjs`

**Wrong:**

```tsx
// Pages Router project (pages/_app.tsx exists), App Router recipe applied
// app/providers.tsx
'use client'
export function PHProvider({ children }) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
} // nothing mounts it
```

**Fixed:**

```typescript
// getNextJsRouter: pages/_app.* XOR app/**/layout.* decides;
// both or neither -> null -> ask the user
setup.questions = [{ key: 'router', message: 'Which Next.js router are you using?',
  options: [App Router, Pages Router], detect: getNextJsRouter }]
// getAdditionalContextLines -> ['Router: pages']
// context-mill ships variants nextjs-app-router / nextjs-pages-router
```

## Unguarded window access in SSR provider options

**Problem.** Options like tracing\_headers look like plain config, but the root shell component also renders on the server where window does not exist.

**Impact.** SSR throws 'window is not defined' on every server render.

**Rule location.** [`context-mill: example-apps/tanstack-start/src/routes/__root.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/src/routes/__root.tsx)

**Sources.** [context-mill@18193f6](https://github.com/PostHog/context-mill/commit/18193f6c), [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265)

**Frameworks.** `tanstack-start`, `react`, `nextjs`

**Wrong:**

```tsx
<PostHogProvider apiKey={key} options={{
  api_host: '/ingest',
  tracing_headers: [window.location.hostname],
}}>
```

**Fixed:**

```tsx
// Guarded for SSR, where `window` is undefined.
tracing_headers:
  typeof window !== 'undefined' ? [window.location.hostname] : [],
```

## Server SDK client built in every request

**Problem.** Constructing the client next to the capture call is the shortest diff and works in a quick test. The leak and dropped events only show under real traffic or on exit.

**Impact.** A client with its own queue and timers leaks per request, and buffered events are lost when the request ends. Nothing errors.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md#Init`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) point (3. Server)
- [`context-mill: context/commandments.yaml#tanstack-start`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) and #go
- [`context-mill: example-apps/tanstack-start/src/utils/posthog-server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/src/utils/posthog-server.ts)
- `wizard: src/frameworks/astro/astro-wizard-agent.ts` (SSR/HYBRID branch)

**Sources.** [context-mill@96107f8](https://github.com/PostHog/context-mill/commit/96107f89), [context-mill@15c547c](https://github.com/PostHog/context-mill/commit/15c547c0), [PostHog/wizard#267](https://github.com/PostHog/wizard/pull/267), [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945), [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948), [`context-mill: context/commandments.yaml#flask`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml), [`context-mill: example-apps/flask/app/__init__.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/__init__.py), [PostHog/context-mill#202](https://github.com/PostHog/context-mill/pull/202), [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `astro`, `express`, `tanstack-start`

**Wrong:**

```typescript
// app/api/checkout/route.ts  (or src/pages/api/signup.ts in Astro SSR)
export async function POST(req: Request) {
  const posthog = new PostHog(process.env.POSTHOG_KEY!)   // new client every request
  posthog.capture({ distinctId, event: 'checkout_completed' })
  return Response.json({ ok: true })
}
```

**Fixed:**

```typescript
// utils/posthog-server.ts: module singleton reused by every handler
let client: PostHog | null = null
export function getPostHogClient() {
  if (!client) client = new PostHog(process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
    host: process.env.VITE_PUBLIC_POSTHOG_HOST, flushAt: 1, flushInterval: 0,
  })
  return client
}
```

## Django client created outside AppConfig.ready

**Problem.** Configuring PostHog at the top of settings.py or views.py, or creating a client inside a view, is the obvious Python move. Django's autoreloader and lack of a shutdown hook hide the cost, and agents forget the signals module only registers if something imports it.

**Impact.** Duplicate clients and consumer threads per request, import or autoreload, import-order problems at startup, no single shutdown to flush, and the user\_logged\_in receiver is never registered, so login events are lost or personless.

**Rule location.**

- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 144 'Initialize PostHog in AppConfig.ready() with api\_key and host from environment variables', plus the user\_logged\_in / identify\_context rule)
- [`context-mill: example-apps/django/core/apps.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/apps.py)

**Sources.** [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [`context-mill: example-apps/django/core/apps.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/apps.py), [`context-mill: example-apps/django/core/signals.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/signals.py)

**Frameworks.** `django`

**Wrong:**

```python
# settings.py, import time
import posthog
posthog.api_key = os.environ['POSTHOG_PROJECT_TOKEN']
# views.py
def create_order(request):
    client = Posthog(settings.POSTHOG_API_KEY, host=settings.POSTHOG_HOST)
    client.capture("order_created", distinct_id=str(request.user.pk))
# core/signals.py is never imported, so user_logged_in has no receiver
```

**Fixed:**

```python
class CoreConfig(AppConfig):
    def ready(self):
        import posthog   # inside to avoid startup import issues
        posthog.api_key = settings.POSTHOG_PROJECT_TOKEN
        posthog.host = settings.POSTHOG_HOST
        if settings.POSTHOG_DISABLED:
            posthog.disabled = True
        from . import signals  # noqa: F401  registers the login receiver
```

## Full-stack app gets only the browser SDK

**Problem.** The agent stops after one working SDK, usually the browser one, without noticing the app has a server runtime with its own flows and errors (or the reverse on server-first stacks like Rails).

**Impact.** Server-side events, exceptions and server-only flows are never captured. No error shown.

**Rule location.** [`wizard: src/agent/runner/harness/pi/runtime-notes.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (SKILL\_STEPS, on main, was src/lib/agent/runner/harness/pi/runtime-notes.ts)

**Sources.** [PostHog/wizard#853](https://github.com/PostHog/wizard/pull/853)

**Frameworks.** `javascript_web`, `javascript_node`, `rails`, `nextjs`

**Wrong:**

```text
// Outline (React + Koa, TS)
// client: posthog.init(...) in the app entry
// server: no posthog-node anywhere, no reverse proxy
```

**Fixed:**

```text
INITIALIZE it at the framework's entry point for every runtime the integration targets
(typically both client and server) - BEFORE adding any event capture.
```

## Second PostHog client built just for metrics

**Problem.** Adding a new feature in a new file with its own client is the self-contained diff. The agent does not look for the working client already in the project, and may tidy identify or capture setup while there.

**Impact.** Two clients with divergent config and lifecycles. Existing identify and capture behaviour can be disturbed.

**Rule location.** [`context-mill: context/agents/metrics/verify-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/verify-sdk.md) (check 3)

**Sources.** [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355), [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342)

**Frameworks.** `python`, `javascript_node`

**Wrong:**

```python
# lib/metrics.py, next to an existing lib/posthog.py client
metrics_client = Posthog(os.environ["POSTHOG_PROJECT_TOKEN"], host=HOST)
metrics_client.metrics.count("orders.placed")
```

**Fixed:**

```python
# lib/posthog.py: add the metrics config to the EXISTING client's init
posthog = Posthog(token, host=HOST, metrics={"service_name": "orders-api"})
# never construct a second client; never touch identify, capture or other init options
```

## Logs setup replaces the AI tracing provider

**Problem.** Each product's setup is written in isolation and creates its own OTel SDK or provider in the shared init file, unaware another step already registered a span processor there.

**Impact.** AI Observability's span processor is dropped or the init files conflict, and traces silently stop arriving.

**Rule location.**

- context-mill (origin/main): context/agents/integration-v2/integrate-posthog.md
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md)
- scripts/lib/tests/integration-observability-flow.test.js

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `opentelemetry`, `node`, `python`

**Wrong:**

```typescript
// instrumentation.ts: AIO step registered PostHogSpanProcessor on the provider
// logs step then adds, in the same file:
const sdk = new NodeSDK({ logRecordProcessors: [/* PostHog logs */] })
sdk.start()   // replaces the provider AIO configured
```

**Fixed:**

```text
queue: capture -> ai-observability -> logs -> review (sequential, same entry/init files)
logs.md: "Preserve any tracing provider AIO configured in the previous step."
logs.md: name packages in the handoff; "leave installation, manifest and lockfile updates, builds, and lint to review"
```

## iOS SDK set up inside a SwiftUI view

**Problem.** SwiftUI code puts side effects in onAppear, which looks like an app-start hook, but views appear many times and after early events.

**Impact.** Setup runs repeatedly or after the first capture, so early and lifecycle events drop silently and repeated setup can reinitialize the SDK with a different identity state.

**Rule location.**

- [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (setup exactly once, as early as possible)
- [`context-mill: example-apps/swift-xcodegen/BurritoStand/BurritoStandApp.swift`](https://github.com/PostHog/context-mill/blob/main/example-apps/swift-xcodegen/BurritoStand/BurritoStandApp.swift)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `swift`, `swiftui`

**Wrong:**

```swift
struct HomeView: View {
    var body: some View {
        Text("Home").onAppear {
            PostHogSDK.shared.setup(PostHogConfig(apiKey: key, host: host))
        }
    }
}
```

**Fixed:**

```swift
@main
struct BurritoStandApp: App {
    init() {
        let config = PostHogConfig(apiKey: posthogProjectToken, host: posthogHost)
        PostHogSDK.shared.setup(config)   // once, early
    }
}
```

## Flutter native auto-init left on beside Dart setup

**Problem.** The Flutter SDK auto-initializes natively from the token in AndroidManifest.xml and Info.plist, and the agent follows that path or adds Dart setup without disabling it. Replay and surveys options are not available through auto-init, and nothing errors.

**Impact.** Double initialization with config split across Dart and native files. The native SDK starts before Dart config applies, so session replay and surveys silently never start.

**Rule location.**

- [`wizard: src/programs/frameworks/flutter/flutter-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/flutter/flutter-wizard-agent.ts) (getAdditionalContextLines)
- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/flutter`](https://github.com/PostHog/context-mill/tree/main/example-apps/flutter) (lib/posthog/posthog.dart, AndroidManifest.xml, ios/macos Info.plist)

**Sources.** [PostHog/wizard#942](https://github.com/PostHog/wizard/pull/942), [wizard@8e5537b](https://github.com/PostHog/wizard/commit/8e5537b8), [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266)

**Frameworks.** `flutter`

**Wrong:**

```xml
<!-- android/app/src/main/AndroidManifest.xml: native auto-init still on -->
<meta-data android:name="com.posthog.posthog.PROJECT_TOKEN" android:value="phc_xxx"/>
// main.dart: second init path
config.sessionReplay = true;   // ignored by native auto-init
await Posthog().setup(config);
```

**Fixed:**

```dart
<meta-data android:name="com.posthog.posthog.AUTO_INIT" android:value="false"/>
<!-- ios/Runner/Info.plist and macos/Runner/Info.plist: AUTO_INIT = <false/> -->
// main.dart: one place for all config
WidgetsFlutterBinding.ensureInitialized();
final config = PostHogConfig(const String.fromEnvironment('POSTHOG_PROJECT_TOKEN'));
config.sessionReplay = true;
await Posthog().setup(config); // before runApp()
```

## Flutter setup not awaited before runApp

**Problem.** Fire-and-forget setup after runApp looks harmless in Dart, and the SDK does not complain when early events arrive before it is ready.

**Impact.** Events from the first frames are lost and setup options may not take effect. Silent.

**Rule location.** [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150)

**Frameworks.** `flutter`

**Wrong:**

```dart
void main() {
  runApp(const MyApp());
  Posthog().setup(config); // not awaited, after runApp
}
```

**Fixed:**

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = PostHogConfig('<token>');
  await Posthog().setup(config);
  runApp(const MyApp());
}
```
