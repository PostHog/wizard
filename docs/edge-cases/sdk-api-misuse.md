# SDK APIs used wrongly

66 cases. Part of the [edge case catalogue](../edge-cases.md).

## Disabled Python client still raises on capture

**Problem.** Agents guard only the init block behind a missing-config flag and assume later calls are no-ops. posthog-python's module API raises when api\_key is None, even with disabled set.

**Impact.** The first capture raises ValueError('API key is required') and crashes the request (login) in exactly the opt-out case.

**Rule location.**

- [`context-mill: example-apps/flask/app/__init__.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/__init__.py) (current guard is incomplete and is the WRONG shape)
- no commandment covers the fix yet (context/commandments.yaml flask section only says init globally in create\_app)

**Sources.** [`context-mill: example-apps/flask/app/__init__.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/__init__.py), [`context-mill: example-apps/flask/app/main/routes.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/main/routes.py) (capture calls)

**Frameworks.** `flask`, `python`

**Wrong:**

```python
if not app.config['POSTHOG_DISABLED']:
    posthog.api_key = app.config['POSTHOG_PROJECT_TOKEN']
    posthog.host = app.config['POSTHOG_HOST']
# disabled: api_key stays None
capture('user_logged_in')  # ValueError: API key is required
```

**Fixed:**

```python
# disabled + a non-empty key makes every call a no-op
posthog.api_key = app.config['POSTHOG_PROJECT_TOKEN'] or 'unset'
posthog.host = app.config['POSTHOG_HOST']
posthog.disabled = (app.config['POSTHOG_DISABLED']
                    or not app.config['POSTHOG_PROJECT_TOKEN'])
```

## Replay enabled server-side but disabled in code

**Problem.** Turning the product on in project settings looks like the whole job, and the agent never checks the client init, where one flag silently overrides it.

**Impact.** Silent: no recordings flow and replay scanners sit idle.

**Rule location.**

- [`context-mill: context/skills/replay-vision-enable-replay/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-enable-replay/description.md)
- [`context-mill: context/agents/replay-vision/enable-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/replay-vision/enable-replay.md)

**Sources.** [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343), [PostHog/wizard-workbench#3504](https://github.com/PostHog/wizard-workbench/pull/3504), [`wizard-workbench: apps/replay-vision/next-js/artisan-ceramics/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/replay-vision/next-js/artisan-ceramics/README.md)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`, `angular`

**Wrong:**

```js
products-enable {"products": ["session_replay"]}   // done!
// app code still has:
posthog.init(token, { api_host, disable_session_recording: true })
```

**Fixed:**

```js
// server half: products-enable ('enabled' / 'already_enabled' both ok)
// client half, web apps only:
posthog.init(token, { api_host })   // removed disable_session_recording: true
// only edit allowed; can't find init? record a follow-up
```

## tracing\_headers set with host including port

**Problem.** window.location.host and hostname look interchangeable, but the extension matches hostname only, and the failure is silent.

**Impact.** In dev no tracing headers are sent, so frontend and backend sessions are not linked.

**Rule location.**

- [`context-mill: example-apps/astro-hybrid/src/components/posthog.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-hybrid/src/components/posthog.astro)
- [`context-mill: example-apps/tanstack-start/src/routes/__root.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/src/routes/__root.tsx)
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md)

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [context-mill@c502a8e](https://github.com/PostHog/context-mill/commit/c502a8e9), [context-mill@18193f6](https://github.com/PostHog/context-mill/commit/18193f6c), [context-mill@0d6d9b9](https://github.com/PostHog/context-mill/commit/0d6d9b9b119d3e128a6b63fe8d2e70be18e8b52a), [context-mill@708db41](https://github.com/PostHog/context-mill/commit/708db41c67acc4a93f9010c5b7aa9ab9c645e6f6), [PostHog/posthog-js#3715](https://github.com/PostHog/posthog-js/pull/3715), [PostHog/wizard-workbench#2800](https://github.com/PostHog/wizard-workbench/pull/2800), [PostHog/wizard-workbench#4401](https://github.com/PostHog/wizard-workbench/pull/4401), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611)

**Frameworks.** `astro`, `tanstack-start`, `react-router`, `nuxt`, `javascript-web`

**Wrong:**

```ts
posthog.init(key, {
  api_host: apiHost,
  tracing_headers: [window.location.host],  // 'localhost:4321' != 'localhost'
})
```

**Fixed:**

```ts
posthog.init(key, {
  api_host: apiHost,
  tracing_headers: typeof window !== 'undefined'
    ? [window.location.hostname] : [],   // SSR guard (TanStack Start)
})
```

## Session replay records bounces and test runs

**Problem.** The basic docs snippet just turns replay on. Minimum duration and test gating are optional settings the agent never adds.

**Impact.** Bounce sessions and synthetic CI/Playwright sessions inflate recording volume and cost.

**Rule location.** [`context-mill: context/skills/audit-session-replay/references/2-session-replay-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-session-replay/references/2-session-replay-fix.md) (Tasks A, C, D: replay-minimum-duration-set, replay-disabled-in-test-envs, replay-strict-minimum-duration)

**Sources.** [`context-mill: context/skills/audit-session-replay/references/2-session-replay-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-session-replay/references/2-session-replay-fix.md), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `react`, `vue`, `nextjs`

**Wrong:**

```ts
posthog.init(key, { session_recording: {} })
// runs under vitest, Playwright and CI; no minimum duration
```

**Fixed:**

```ts
posthog.init(key, {
  disable_session_recording: process.env.NODE_ENV === 'test' || !!process.env.CI,
  session_recording: { minimumDurationMilliseconds: 2000,
                       strictMinimumDuration: true },
})
```

## Wrapping the SDK in a guarded require

**Problem.** When install fails or the build is red, the quick way to get green is a try/catch `require` or an "if installed" check. It compiles, but the SDK is never initialized, so every capture silently does nothing.

**Impact.** The app builds and the check passes, but no events are ever sent.

**Rule location.** [`wizard: src/agent/runner/harness/pi/runtime-notes.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (SKILL\_STEPS, line 75 on main, was src/lib/agent/runner/harness/pi/runtime-notes.ts locally)

**Sources.** [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962), [PostHog/wizard#701](https://github.com/PostHog/wizard/pull/701)

**Frameworks.** `node`, `javascript`

**Wrong:**

```js
let posthog;
try { posthog = require('posthog-node') } catch {}
// later
posthog?.capture?.({ event: 'signed_up' })
```

**Fixed:**

```ts
import { PostHog } from 'posthog-node'
// initialize at the entry point of every runtime, before any capture
export const posthog = new PostHog(process.env.POSTHOG_KEY!, { host: process.env.POSTHOG_HOST })
```

## React Native logs hand-wired through OpenTelemetry

**Problem.** PostHog logs docs for other languages say to wire OpenTelemetry directly, so the agent generalizes that pattern. Only the React Native page says the SDK handles it.

**Impact.** A hand-built OTLP pipeline that misses the SDK's batching, offline persistence and app lifecycle handling.

**Rule location.**

- [`context-mill: context/skills/logs/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/logs/description.md) ("SDK-native logs" key principle: Android, React Native, iOS use the SDK logger/capture APIs, not a separate OTLP exporter)
- [`context-mill: context/skills/logs/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/logs/config.yaml) (react-native variant, docs\_url)

**Sources.** [PostHog/context-mill#122](https://github.com/PostHog/context-mill/pull/122), [posthog.com/docs/logs/installation/react-native](https://posthog.com/docs/logs/installation/react-native)

**Frameworks.** `react-native`, `expo`

**Wrong:**

```typescript
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
const exporter = new OTLPLogExporter({ url: '<posthog otlp logs endpoint>' })
// wired into a LoggerProvider by hand
```

**Fixed:**

```typescript
// posthog-react-native >= 4.44.0
posthog.logger.info('checkout started', { order_id })
posthog.logger.error('payment failed', { code: 'E001' })
// or full control: posthog.captureLog({ ... })
```

## Made-up PostHog wrapper client for AWS Bedrock

**Problem.** Every other provider uses a PostHog wrapper client, so the agent assumes one exists for boto3 bedrock-runtime and invents the import.

**Impact.** The import fails or nothing is captured. Bedrock still needs OpenTelemetry instrumentation of the AWS SDK.

**Rule location.** [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) (line 31 table row + line 34 paragraph)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `aws-bedrock`, `boto3`

**Wrong:**

```python
# app calls boto3.client('bedrock-runtime')
from posthog.ai.bedrock import BedrockRuntime  # no such wrapper
```

**Fixed:**

```text
AWS Bedrock has no wrapper client. It instruments the AWS SDK through
OpenTelemetry, so its package list differs from every other provider.
(Install table row: OTel packages the install doc names.)
```

## Init without defaults loses SPA pageviews

**Problem.** Agents write posthog.init from memory of older docs, which had no defaults option. Without it capture\_pageview stays on legacy behavior and nothing warns.

**Impact.** Only the initial load records a $pageview. Client-side router navigations produce none, and newer defaults stay at legacy values.

**Rule location.**

- [`context-mill: example-apps/react-react-router-6/src/main.jsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-6/src/main.jsx) (and 28 other example-apps using defaults: '2026-01-30')
- no commandment states it

**Sources.** [PostHog/context-mill#80](https://github.com/PostHog/context-mill/pull/80), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245#issuecomment-4994610950), [`posthog-js: packages/browser/src/posthog-core.ts`](https://github.com/PostHog/posthog-js/blob/HEAD/packages/browser/src/posthog-core.ts), [PostHog/context-mill#7](https://github.com/PostHog/context-mill/issues/7), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67), [PostHog/context-mill#64](https://github.com/PostHog/context-mill/pull/64), [PostHog/context-mill#66](https://github.com/PostHog/context-mill/pull/66), [PostHog/wizard#243](https://github.com/PostHog/wizard/pull/243), [PostHog/posthog.com#14922](https://github.com/PostHog/posthog.com/pull/14922), [PostHog/wizard-workbench#4430](https://github.com/PostHog/wizard-workbench/pull/4430), [PostHog/wizard-workbench#4471](https://github.com/PostHog/wizard-workbench/pull/4471), [PostHog/wizard-workbench#4472](https://github.com/PostHog/wizard-workbench/pull/4472), [PostHog/wizard-workbench#3800](https://github.com/PostHog/wizard-workbench/pull/3800)

**Frameworks.** `react-router`, `react`, `vue`, `nextjs`, `javascript_web`

**Wrong:**

```javascript
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
})
```

**Fixed:**

```javascript
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2026-01-30', // capture_pageview: 'history_change'
});
```

## Calling identify() on the Python SDK

**Problem.** Agents port the JS API to Python by analogy. The Python SDK has no identify(), and even the wizard's own outro text tells users to call it.

**Impact.** The call fails or does nothing, so server-side events stay personless.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (python section, line 79: Python SDK has NO identify(), use set() or identify\_context())
- wizard main: src/programs/frameworks/{flask,fastapi,python}/\*-wizard-agent.ts outro next steps still say identify()

**Sources.** [PostHog/wizard#234](https://github.com/PostHog/wizard/pull/234), [PostHog/wizard#251](https://github.com/PostHog/wizard/pull/251), [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254)

**Frameworks.** `python`, `flask`, `fastapi`, `django`

**Wrong:**

```python
posthog.identify(user.id, {'email': user.email})
# wizard outro still says: 'Use posthog.identify() to associate events with users'
```

**Fixed:**

```python
with posthog.new_context():
    posthog.identify_context(str(user.pk))
    posthog.capture('signed_in')
# person properties:
posthog.set(distinct_id=str(user.pk), properties={'email': user.email})
```

## Scaffolding features the Rust or Java SDK lacks

**Problem.** Training data and JS docs describe alias, replay, surveys and exception autocapture, so the agent assumes every SDK has them.

**Impact.** Code that does not compile or silently does nothing, and a report claiming capabilities the user lacks.

**Rule location.** [`context-mill: context/commandments.yaml#rust`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line ~93, 'no identify or alias helper', 'no surveys or session replay'), #java-server (line ~112, 'no automatic error tracking, surveys, or session replay')

**Sources.** [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270)

**Frameworks.** `rust`, `java-server`

**Wrong:**

```text
// Rust
client.alias(old_id, new_id)?;          // no alias in posthog-rs
// Java Spring
PostHog.builder(key).enableExceptionAutocapture(true)  // not in posthog-server
```

**Fixed:**

```text
Rust: no identify/alias helper, no surveys or session replay; set person props by inserting a $set property on an event.
Java server SDK: no automatic error tracking, surveys or session replay; do not promise or scaffold them. Identify via userProperty(...) on a capture; report failures as an explicit capture event.
```

## Enabling web vitals overwrites other performance options

**Problem.** To enable web vitals, the agent writes a fresh capture\_performance object. It replaces existing keys instead of merging.

**Impact.** Silent. Either no LCP, CLS or INP data, or other performance options such as network timing are lost.

**Rule location.** [`context-mill: context/skills/web-analytics/references/remediation.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/remediation.md) (web\_vitals\_coverage)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `posthog-js`

**Wrong:**

```ts
// before: capture_performance: { network_timing: true }
posthog.init(token, { capture_performance: { web_vitals: true } })   // network_timing dropped
```

**Fixed:**

```ts
posthog.init(token, {
  capture_performance: { network_timing: true, web_vitals: true },   // keep existing keys
})
```

## Ruby gem required by its package name

**Problem.** The gem is named posthog-ruby, so require 'posthog-ruby' looks correct. The library file is actually posthog.

**Impact.** LoadError at boot, a hard crash on the first line that touches PostHog.

**Rule location.** [`context-mill: context/commandments.yaml#ruby`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (first bullet, line ~195)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [PostHog/wizard#276](https://github.com/PostHog/wizard/pull/276), [wizard@26ac00d](https://github.com/PostHog/wizard/commit/26ac00d3)

**Frameworks.** `ruby`, `ruby-on-rails`

**Wrong:**

```ruby
# Gemfile: gem 'posthog-ruby'
require 'posthog-ruby'
```

**Fixed:**

```ruby
# Gemfile: gem 'posthog-ruby'
require 'posthog'   # NOT 'posthog-ruby'
```

## Unfiltered source catalog floods agent context

**Problem.** source\_type looks optional, so the agent calls the tool bare to explore. The reply is the whole catalog.

**Impact.** A reply of about 200 kB uses up the agent's context and forces file-grep workarounds. It was the top cause of aborted warehouse runs.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Tools, external-data-sources-wizard)

**Sources.** [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/posthog#67018](https://github.com/PostHog/posthog/pull/67018)

**Frameworks.** `all`

**Wrong:**

```javascript
external-data-sources-wizard({})
-> ~200 kB describing every source type
```

**Fixed:**

```javascript
// always call it for a kind before creating that kind, always pass source_type
external-data-sources-wizard({ "source_type": "Postgres,Stripe" })
```

## Low-level create used for SaaS sources

**Problem.** The generic create tool looks like it works for every source, and its own docs say schemas are optional. The server still requires them for SaaS sources.

**Impact.** Stripe, Resend and Sentry creates are rejected for a missing schemas array, so the source falls back to a browser link.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Tools, data-warehouse-source-setup and external-data-sources-create, An in-cli source step 5)

**Sources.** [PostHog/context-mill#336](https://github.com/PostHog/context-mill/pull/336)

**Frameworks.** `Stripe`, `Resend`, `Sentry`, `SaaS sources`

**Wrong:**

```javascript
external-data-sources-create({ "payload": {
  "source_type": "Stripe", "api_key": "rk_live_..."
}})   // no schemas
-> rejected: schemas required
```

**Fixed:**

```javascript
data-warehouse-source-setup({
  "source_type": "Stripe",
  "payload": { "api_key": "rk_live_..." }
})   // validates, discovers tables, applies sync defaults; pass no schemas
```

## Database schemas array placed outside payload

**Problem.** The tool description was unclear, and a top-level schemas argument next to payload looks natural.

**Impact.** The create is rejected or no tables are selected, so the database is never connected.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Tools, external-data-sources-create, An in-cli source step 5)

**Sources.** [PostHog/posthog#67018](https://github.com/PostHog/posthog/pull/67018), [PostHog/context-mill#336](https://github.com/PostHog/context-mill/pull/336)

**Frameworks.** `Postgres`, `MySQL`, `database sources`

**Wrong:**

```javascript
external-data-sources-create({
  "payload": { "source_type": "Postgres", "host": "..." },
  "schemas": [{ "name": "orders", "should_sync": true }]
})
```

**Fixed:**

```javascript
external-data-sources-create({ "payload": {
  "source_type": "Postgres", /* credential fields */
  "access_method": "warehouse",
  "schemas": [ /* incremental where a field exists, else full_refresh */ ]
}})   // schemas goes INSIDE payload
```

## Webhook pending inputs ignored after source setup

**Problem.** The setup call returns success, so the agent reports the source as connected. It does not read the nested webhook key that still needs input.

**Impact.** Silent: the source exists but its webhook is never registered, so the data goes stale.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Tools, data-warehouse-source-setup)

**Sources.** [PostHog/context-mill#336](https://github.com/PostHog/context-mill/pull/336)

**Frameworks.** `Stripe`, `webhook-capable sources`

**Wrong:**

```javascript
data-warehouse-source-setup({ "source_type": "Stripe", ... })
-> { "webhook": { "pending_inputs": ["signing_secret"] } }
"Connected Stripe"   // webhook never finished
```

**Fixed:**

```javascript
// read the `webhook` key in the response;
// if webhook.pending_inputs is non-empty, ask the user for those values
// and submit them before reporting the source as connected
```

## Credential question sent without question kind

**Problem.** The pi harness passes tool arguments through without validation. The agent marks a question sensitive but leaves out kind, and sensitive is only legal on text.

**Impact.** The whole batch is dropped, or the overlay shows a prompt with no input. Two dismissals send the remaining sources to browser setup.

**Rule location.** [`wizard: src/agent/tools/tools.ts#resolveAskQuestionKinds`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) WIZARD\_ASK\_KIND\_DESCRIPTION

**Sources.** [PostHog/wizard#1258](https://github.com/PostHog/wizard/pull/1258)

**Frameworks.** `all`

**Wrong:**

```javascript
wizard_ask({ "subject": "Stripe", "questions": [
  { "id": "api_key", "prompt": "Stripe restricted key", "sensitive": true } ] })
// no kind: batch refused
```

**Fixed:**

```javascript
// kind is optional; resolveAskQuestionKinds fills it in:
//   options supplied -> 'single', otherwise 'text'
wizard_ask({ "subject": "Stripe", "questions": [
  { "id": "api_key", "kind": "text", "sensitive": true, ... }] })
```

## Task handoff fields sent flat, not nested

**Problem.** Flat arguments are the default shape for tool calls, and the description did not say the fields nest under handoff.

**Impact.** Schema validation rejects the call, which wastes a turn on a task that already finished.

**Rule location.** [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts#COMPLETE_TASK_DESCRIPTION`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts)

**Sources.** [PostHog/wizard#1220](https://github.com/PostHog/wizard/pull/1220)

**Frameworks.** `all`

**Wrong:**

```javascript
complete_task({ "status": "done", "goals": "...", "did": "...", "forNextAgent": "..." })
-> schema validation error
```

**Fixed:**

```javascript
complete_task({ "status": "done",
  "handoff": { "goals": "...", "did": "...", "forNextAgent": "..." } })
// COMPLETE_TASK_DESCRIPTION names the nesting and the three required fields
```

## Browser SDK options on the Node client

**Problem.** The agent writes init options from memory, or copies the posthog-js options it just wrote, and blends posthog-js and posthog-node, which share a name but not an options type. It does not read the installed types in node\_modules.

**Impact.** next build fails type-check. In loosely typed projects the unknown option is silently ignored.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 13: source code is in node\_modules, line 14: check package.json type/build scripts), #javascript\_node (line 61: posthog-node vs posthog-js)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) line 36 ('Use the SDK that matches each runtime')
- [`context-mill: example-apps/next-app-router/src/lib/posthog-server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/lib/posthog-server.ts)
- `wizard: git` history of src/nextjs/docs.ts (commit 815538db)

**Sources.** [PostHog/wizard#61](https://github.com/PostHog/wizard/issues/61), [PostHog/wizard#73](https://github.com/PostHog/wizard/pull/73), [wizard@815538d](https://github.com/PostHog/wizard/commit/815538db), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `tanstack-start`, `astro`, `javascript_node`

**Wrong:**

```typescript
const posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  capture_pageviews: 'history_change',   // posthog-js option
  flushAt: 1,
  flushInterval: 0,
});
// Type error: 'capture_pageviews' does not exist in type 'PostHogOptions'
```

**Fixed:**

```typescript
// read node_modules/posthog-node/dist/types.d.ts, use only options that exist
const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  flushAt: 1,
  flushInterval: 0,
})
// pageview mode is a posthog-js init option (capture_pageview), never a posthog-node one
```

## Browser SDK imported in server code

**Problem.** posthog-js is the best-known package, and in SSR frameworks (Next.js, TanStack Start, SvelteKit) server routes sit next to client files, so the agent reuses one import everywhere. Nothing fails at build or import time. A lockfile-less static site can also be detected as Node, which installs a server SDK.

**Impact.** Silent or crashing: posthog-js has no window or init on the server, so backend events are lost. A Node SDK on a static site instruments a server that does not exist.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 51, 'posthog-js is browser-only'), #javascript\_node (line 61), #tanstack-start (line 175)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) line 36
- [`context-mill: example-apps/next-app-router/src/lib/posthog-server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/lib/posthog-server.ts)
- `context-mill: example-apps/tanstack-start/src/utils/posthog-server.ts.` Static-site detection: only proposed in closed wizard PR #999, not shipped

**Sources.** [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#89](https://github.com/PostHog/context-mill/pull/89), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#218](https://github.com/PostHog/context-mill/pull/218), [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67), [PostHog/wizard#61](https://github.com/PostHog/wizard/issues/61), [PostHog/wizard#999](https://github.com/PostHog/wizard/pull/999), [PostHog/wizard-workbench#2332](https://github.com/PostHog/wizard-workbench/pull/2332), [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml), [PostHog/context-mill#93](https://github.com/PostHog/context-mill/pull/93), [PostHog/wizard#252](https://github.com/PostHog/wizard/pull/252)

**Frameworks.** `nextjs`, `nuxt`, `tanstack-start`, `express`, `fastify`, `koa`, `javascript_web`, `javascript_node`

**Wrong:**

```typescript
// app/api/stripe/route.ts
import posthog from 'posthog-js'
export async function POST(req: Request) {
  posthog.capture('checkout_completed', { plan })
}
```

**Fixed:**

```typescript
import { PostHog } from 'posthog-node'
let posthogClient: PostHog | null = null
export function getPostHogClient() {
  if (!posthogClient) posthogClient = new PostHog(token,
    { host, flushAt: 1, flushInterval: 0 })
  return posthogClient
}
```

## Server SDK imported into client components

**Problem.** Once a posthog-node helper exists in the project, the agent reuses it everywhere, including in 'use client' files. The import path does not show that it is Node-only.

**Impact.** A Node-only SDK ends up in the browser bundle, which breaks the build or runtime, or client events never fire.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('posthog-js is browser-only') and #javascript\_node ('posthog-js is browser-only, so use posthog-node on the server')
- `context-mill: example-apps/next-app-router/src/lib/posthog-server.ts.` The explicit 'never import PostHogClient in client components' line existed only in the legacy wizard prompt, removed in wizard #214

**Sources.** [PostHog/wizard#94](https://github.com/PostHog/wizard/pull/94), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
'use client'
import { getPostHogClient } from '@/lib/posthog-server'   // posthog-node
const posthog = getPostHogClient()
posthog.capture({ distinctId: 'x', event: 'button_clicked' })
```

**Fixed:**

```typescript
'use client'
import posthog from 'posthog-js'
posthog.capture('button_clicked', { buttonId: 'submit' })
// posthog-node stays server-side only (route handlers, server actions)
```

## posthog-js call shape used in posthog-node

**Problem.** The agent knows posthog-js's capture(event, props) best and reuses it on the server, where capture takes one object with a required distinctId.

**Impact.** Wrong signature: a TypeScript error, or events dropped or attributed to the wrong person in JS.

**Rule location.**

- [`context-mill: example-apps/javascript-node/todo.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-node/todo.js) (trackEvent helper calling posthog.capture({ distinctId, event, properties }))
- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) only says to add posthog.capture() calls in route handlers, not the signature

**Sources.** [PostHog/context-mill#89](https://github.com/PostHog/context-mill/pull/89)

**Frameworks.** `javascript_node`, `express`

**Wrong:**

```javascript
app.post('/todos', (req, res) => {
  posthog.capture('todo_added', { todo_id: todo.id })
  res.status(201).json(todo)
})
```

**Fixed:**

```javascript
posthog.capture({
  distinctId: userId,
  event: 'todo_added',
  properties: { todo_id: todo.id },
})
```

## PostHog methods called before init runs

**Problem.** In plain JS, ES module imports run before the entry file's body. An init placed in main.js therefore runs after modules that capture on load.

**Impact.** Early events are dropped with only a console warning, so first-load tracking is lost.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('posthog.init() MUST be called before any other PostHog methods')
- [`context-mill: example-apps/javascript-web/src/posthog.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-web/src/posthog.js) (init and export the instance), src/main.js (imports it)

**Sources.** [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/wizard#701](https://github.com/PostHog/wizard/pull/701), [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962), [PostHog/wizard#888](https://github.com/PostHog/wizard/issues/888), [wizard@9730dfd](https://github.com/PostHog/wizard/commit/9730dfd9)

**Frameworks.** `javascript_web`, `vite`

**Wrong:**

```javascript
// main.js
import { setupTodos } from './todos.js'  // captures on load
import posthog from 'posthog-js'
posthog.init(key, { api_host: host })     // runs too late
```

**Fixed:**

```javascript
// src/posthog.js: init once and export the instance
import posthog from 'posthog-js'
posthog.init(projectToken, { api_host: apiHost })
export default posthog
// main.js and every other module: import posthog from './posthog.js'
```

## Two documented SDK setups mixed together

**Problem.** Docs show a global initializer and an explicit client side by side, and Python framework commandments still use module-level helpers while newer guidance uses a Posthog() instance. The agent takes wiring from one and calls from the other, and the code reads fine.

**Impact.** In Python, module-level helpers route to a hidden, never-configured default client, so every event is silently dropped. In other SDKs (for example iOS PostHogSDK.setup then calling methods on a never-built client) the code does not compile, because the initializer returns nothing to call methods on.

**Rule location.**

- [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) (Goal: 'Follow one of them the whole way through')
- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (constructor rule)
- #flask and #fastapi still say 'posthog.api\_key' on main, reconciliation in open PRs #249 and #277

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/context-mill#249](https://github.com/PostHog/context-mill/pull/249), [PostHog/context-mill#277](https://github.com/PostHog/context-mill/pull/277)

**Frameworks.** `python`, `django`, `flask`, `fastapi`, `ios`, `go`, `node`

**Wrong:**

```python
from posthog import Posthog, capture
posthog_client = Posthog(token, host=host)   # constructor client
capture('signup', distinct_id=uid)           # module-level helper: hidden default client, dropped
```

**Fixed:**

```python
# Follow ONE setup all the way through:
posthog_client = Posthog(token, host=host)
posthog_client.capture('signup', distinct_id=uid)
# or module config + module calls, never a mix
```

## Python configured through module globals

**Problem.** Older Python docs and training data set posthog.api\_key on the module. That still runs, so the agent has no signal to switch to the instance API.

**Impact.** Global mutable config, and instance options such as exception autocapture and an explicit shutdown target are never set up, so the code drifts from the instance-based examples the skill assumes.

**Rule location.**

- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Always use the Posthog() class constructor (instance-based API) instead of module-level posthog.api\_key config', plus enable\_exception\_autocapture=True)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) line 139 (Python)
- [`context-mill: example-apps/python/todo.py#initialize_posthog.`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py) Caveat: #flask/#fastapi commandments still say posthog.api\_key until PRs #249/#277 land

**Sources.** [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/wizard#272](https://github.com/PostHog/wizard/pull/272), [PostHog/context-mill#70](https://github.com/PostHog/context-mill/pull/70), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `python`, `flask`, `django`, `fastapi`

**Wrong:**

```python
import posthog
posthog.api_key = os.environ["POSTHOG_PROJECT_TOKEN"]
posthog.host = "https://us.i.posthog.com"
posthog.capture(distinct_id=uid, event="todo_added")
```

**Fixed:**

```python
from posthog import Posthog
posthog = Posthog(
    project_token,
    host=os.getenv('POSTHOG_HOST', 'https://us.i.posthog.com'),
    enable_exception_autocapture=True,
)
# one shared client, imported where needed
```

## Removed Python identify and positional capture

**Problem.** Training data predates Python SDK v6, which removed identify() and the positional capture(distinct\_id, event) shape, and copying the JS API also leads to identify(). Even PostHog's own FastAPI example and README had the old shape, and the agent does not read the source in site-packages.

**Impact.** AttributeError or TypeError on login and signup routes (500s), or person properties are silently never set.

**Rule location.**

- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('The Python SDK has NO identify() method')
- [`context-mill: context/skills/posthog-best-practices/description.md#Python`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('never identify()')
- [`context-mill: example-apps/fastapi/app/routers/main.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/routers/main.py)
- [`context-mill: example-apps/flask/app/main/routes.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/main/routes.py)

**Sources.** [PostHog/context-mill#216](https://github.com/PostHog/context-mill/pull/216), [context-mill@c0f290a](https://github.com/PostHog/context-mill/commit/c0f290a3), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#70](https://github.com/PostHog/context-mill/pull/70), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [context-mill@f6bf6e1](https://github.com/PostHog/context-mill/commit/f6bf6e1fa4d33f889d376083465eaae9b13368e4), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611), [`posthog-python: posthog/CHANGELOG.md`](https://github.com/PostHog/posthog-python/blob/master/posthog/CHANGELOG.md)

**Frameworks.** `python`, `fastapi`, `flask`, `django`

**Wrong:**

```python
posthog.identify(user.email, {"email": user.email})   # not in SDK v6+
posthog.capture(user.email, "user_logged_in",          # positional form removed
                properties={"is_new_user": is_new_user})
```

**Fixed:**

```python
from posthog import capture, identify_context, new_context
with new_context():
    identify_context(str(user.id))
    capture("user_logged_in", properties={
        "$set": {"email": user.email},
        "is_new_user": is_new_user})
# or posthog_client.set(distinct_id=..., properties={...})
```

## Tracing headers internal, hand-rolled, or silently no-op

**Problem.** Older examples used the internal \_\_add\_tracing\_headers name or a hand-written fetch wrapper, and README comments claimed session ids were forwarded. The public tracing\_headers option is ignored below posthog-js 1.380.0, and the install step says to leave an existing SDK alone, so even the right name can do nothing.

**Impact.** Silent: no X-POSTHOG-\* headers are sent, so server events never join the client session. Hand-rolled wrappers send only the session id and drift from the SDK.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('do not hand-roll a fetch wrapper')
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (browser+server bullet)
- [`context-mill: context/commandments.yaml#astro-ssr`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) and #astro-hybrid
- example-apps nuxt-3-6 (plugins/posthog.client.ts, package.json ^1.406.2), nuxt-4 (nuxt.config.ts), react-react-router-7-framework (app/entry.client.tsx), tanstack-start (src/routes/\_\_root.tsx), astro-ssr/astro-hybrid (src/components/posthog.astro)
- [`context-mill: context/skills/integration-v2/install/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/install/description.md) line 13 ('If the SDK is already installed, leave it') interacts

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [context-mill@0d6d9b9](https://github.com/PostHog/context-mill/commit/0d6d9b9b), [context-mill@d05b872](https://github.com/PostHog/context-mill/commit/d05b872a), [PostHog/context-mill#335](https://github.com/PostHog/context-mill/pull/335), [PostHog/posthog-js#3715](https://github.com/PostHog/posthog-js/pull/3715)

**Frameworks.** `tanstack-start`, `react-router`, `nuxt`, `astro`

**Wrong:**

```javascript
posthog.init(key, {
  __add_tracing_headers: ['your-backend-domain.com'],  // internal, deprecated
})
fetch('/api/login', { headers: { 'X-PostHog-Session-Id': posthog.get_session_id() } })
// package.json: "posthog-js": "^1.338.0" (via @posthog/react)
```

**Fixed:**

```javascript
posthog.init(key, {
  tracing_headers: [window.location.hostname],
})
// package.json: "posthog-js": "^1.406.2"   (option exists from 1.380.0)
// public tracing_headers, never __add_tracing_headers; no hand-rolled fetch wrapper
```

## SDK init cancels products enabled in project

**Problem.** The agent turns on Session Replay and Error Tracking in project settings and treats that as done. It never checks client init options that override the server switch.

**Impact.** Silent: the product shows as enabled but the client sends no recordings or exceptions, so the inbox stays empty.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/3-enable-products.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/3-enable-products.md) (step 2, Web app)
- `wizard: src/lib/programs/self-driving/prompt.ts` (STEP 3, Enable products)

**Sources.** [PostHog/wizard#776](https://github.com/PostHog/wizard/pull/776), [PostHog/context-mill#209](https://github.com/PostHog/context-mill/pull/209)

**Frameworks.** `javascript_web`, `nextjs`, `react`

**Wrong:**

```typescript
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  disable_session_recording: true,  // cancels the replay enable
  capture_exceptions: false,        // cancels the error-tracking enable
})
```

**Fixed:**

```text
products-enable { products: [session_replay, error_tracking, conversations] }
then find posthog.init(...):
- disable_session_recording: true -> remove (or false)
- capture_exceptions: false -> remove (or true)
- cannot locate the init confidently -> record a follow-up, do not guess
```

## Ruby capture and capture\_exception argument styles swapped

**Problem.** posthog-ruby takes keyword args for capture but positional args for capture\_exception. Agents assume one style for both, and the mistake usually sits inside a rarely run rescue block.

**Impact.** ArgumentError on Ruby 3 raised inside the rescue block, a Hash used as the distinct id, or exception events with no distinct id.

**Rule location.**

- `wizard: src/frameworks/ruby/ruby-wizard-agent.ts` (getAdditionalContextLines, '### 4. capture\_exception Takes Positional Args')
- [`context-mill: context/commandments.yaml#ruby`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 199-200) and #ruby-on-rails (line 210)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Ruby & Rails)

**Sources.** [PostHog/wizard#276](https://github.com/PostHog/wizard/pull/276), [wizard@26ac00d](https://github.com/PostHog/wizard/commit/26ac00d3), [PostHog/context-mill#152](https://github.com/PostHog/context-mill/pull/152), [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85)

**Frameworks.** `ruby`, `ruby-on-rails`

**Wrong:**

```ruby
client.capture('user_123', 'my_event', { key: 'value' })   # needs keywords
rescue StandardError => e
  posthog&.capture_exception(e, distinct_id: get_user_id)  # needs positional
```

**Fixed:**

```ruby
client.capture(distinct_id: 'user_123', event: 'my_event',
               properties: { key: 'value' })
rescue StandardError => e
  posthog&.capture_exception(e, get_user_id, { source: 'job' })  # positional
```

## PHP capture called with positional arguments

**Problem.** Most SDKs take (distinctId, event, props), so the agent writes the same shape. posthog-php takes one associative array through static methods, with camelCase 'distinctId'.

**Impact.** PostHog::capture(array $message) rejects a string first argument with a TypeError that fails the request or CLI run. Building a client per call instead of PostHog::init once also defeats the batch buffer.

**Rule location.**

- [`context-mill: context/commandments.yaml#php`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines about static methods and associative arrays), #laravel
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (PHP & Laravel: 'Pass associative arrays, not positional args')
- [`context-mill: example-apps/php/todo.php#trackEvent`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php)
- [`context-mill: example-apps/laravel/app/Services/PostHogService.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Services/PostHogService.php) (wraps positional signature, calls PostHog::capture(\[...\]))

**Sources.** [PostHog/context-mill#136](https://github.com/PostHog/context-mill/pull/136), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [`posthog-php: lib/PostHog.php`](https://github.com/PostHog/posthog-php/blob/4.2.0/lib/PostHog.php)

**Frameworks.** `php`, `laravel`, `wordpress`

**Wrong:**

```php
PostHog::init($token);
PostHog::capture($userId, 'order_created', ['total' => 42]);
// TypeError: capture() expects array, string given
```

**Fixed:**

```php
PostHog::init($token, ['host' => $host]); // once
PostHog::capture([
    'distinctId' => (string) $userId,
    'event' => 'order_created',
    'properties' => ['total' => 42],
]);
```

## Rails app builds its own PostHog::Client

**Problem.** Plain Ruby examples use PostHog::Client.new, so the agent does the same in Rails. posthog-rails expects PostHog.init and class-level calls.

**Impact.** Bypasses the lifecycle posthog-rails manages, so auto exception capture and ActiveJob instrumentation do not attach, and duplicate clients appear.

**Rule location.** [`context-mill: context/commandments.yaml#ruby-on-rails`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (example-apps/ruby-on-rails/config/initializers/posthog.rb)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [context-mill@5c513bf](https://github.com/PostHog/context-mill/commit/5c513bfd)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
# app/controllers/orders_controller.rb
client = PostHog::Client.new(api_key: ENV['POSTHOG_PROJECT_TOKEN'])
client.capture(distinct_id: current_user.id.to_s, event: 'order_created')
```

**Fixed:**

```ruby
# config/initializers/posthog.rb
PostHog.init do |config|
  config.api_key = ENV.fetch('POSTHOG_PROJECT_TOKEN', nil)
end
# anywhere else: class-level methods
PostHog.capture(distinct_id: current_user.posthog_distinct_id, event: 'order_created')
```

## Elixir code calls capture\_exception and identify

**Problem.** Other SDKs have capture\_exception and identify, so the agent assumes Elixir does too. posthog-elixir captures errors through a Logger handler and has neither function.

**Impact.** UndefinedFunctionError, or duplicates of what Logger already captures. Without in\_app\_otp\_apps, error grouping is noisy.

**Rule location.**

- [`context-mill: example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex) (trigger\_error and login docs), example-apps/elixir/README.md (no capture\_exception, no separate identify), example-apps/elixir/config/runtime.exs and config.exs
- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) only covers in\_app\_otp\_apps, Logger-based error tracking and distinct\_id

**Sources.** [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `elixir`

**Wrong:**

```elixir
rescue
  error ->
    PostHog.capture_exception(error)              # not in the SDK
PostHog.identify(user.id, %{email: user.email})   # no such function
```

**Fixed:**

```elixir
config :posthog,
  api_key: System.get_env("POSTHOG_PROJECT_TOKEN"),
  in_app_otp_apps: [:my_app]
# controller rescue: PostHog auto-captures this as an exception
Logger.error("Burrito profile error: #{Exception.message(error)}")
```

## Elixir capture without distinct\_id silently dropped

**Problem.** capture(event, props) looks complete, and Elixir returns an error tuple instead of raising. The ignored return value hides the failure.

**Impact.** When no distinct\_id is in the properties or in the process context, capture returns {:error, :missing\_distinct\_id} and sends nothing, so the event is silently dropped.

**Rule location.**

- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Server-side captures must include a stable distinct\_id ... or set it once per process/request with PostHog.set\_context/1')
- [`context-mill: example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex) (consider\_burrito)
- [`context-mill: example-apps/elixir/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/README.md)

**Sources.** [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `elixir`

**Wrong:**

```elixir
PostHog.capture("burrito_considered", %{total_considerations: count})
# => {:error, :missing_distinct_id}, ignored
```

**Fixed:**

```elixir
PostHog.capture("burrito_considered", %{
  distinct_id: current_distinct_id(conn),
  total_considerations: count
})
# distinct_id is required; every other key becomes an event property
```

## Rust async client in a crate without runtime

**Problem.** posthog-rs defaults to its async client, and a plain `cargo add` picks that up even when the crate has no tokio, async-std or smol. The agent then patches around build errors or adds tokio just for PostHog.

**Impact.** Build errors in a sync app, or an unrequested async runtime and refactor.

**Rule location.** `wizard: src/frameworks/rust/rust-wizard-agent.ts` (hasAsyncRuntime, getAdditionalContextLines)

**Sources.** [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947)

**Frameworks.** `rust`

**Wrong:**

```rust
# Cargo.toml has no tokio / async-std / smol
$ cargo add posthog-rs   # default async client
let client = posthog_rs::client(options).await; // main() is sync
```

**Fixed:**

```typescript
// harness: detect a runtime in Cargo.toml
asyncRuntime = /^\s*(tokio|async-std|smol)\s*[=.]/m.test(cargoToml)
// runtime present: cargo add posthog-rs (async client)
// none: cargo add posthog-rs --no-default-features (blocking client)
```

## Rust identify and replay assumed from other SDKs

**Problem.** Agents assume every SDK matches posthog-js, so they call identify() on posthog-rs or promise surveys and session replay. The crate has none of these.

**Impact.** Compile errors, or a setup report that promises features that never run.

**Rule location.**

- [`context-mill: context/commandments.yaml#rust`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 99 and 102: 'no identify or alias helper', 'no surveys or session replay')
- [`context-mill: example-apps/rust/src/main.rs`](https://github.com/PostHog/context-mill/blob/main/example-apps/rust/src/main.rs) (login handler, insert\_prop $set)

**Sources.** [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947)

**Frameworks.** `rust`

**Wrong:**

```rust
client.identify(&user_id, json!({ "email": email })).await?; // no such method
// setup report: "session replay enabled"
```

**Fixed:**

```rust
let mut event = Event::new("user_logged_in", &user_id);
let _ = event.insert_prop("$set", json!({ "email": email }));
client.capture(event);
// never promise or scaffold surveys or session replay
```

## Java error tracking invented for unsupported SDK

**Problem.** Agents copy exception autocapture settings and captureException calls from the Node and Python SDKs. posthog-server for Java has no automatic exception capture.

**Impact.** The code does not compile or records nothing, while the report says error tracking is set up.

**Rule location.**

- [`context-mill: context/commandments.yaml#java-server`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 120: no automatic error tracking, surveys or session replay)
- [`context-mill: example-apps/java-spring-boot/src/main/java/com/posthog/example/controller/BurritoController.java`](https://github.com/PostHog/context-mill/blob/main/example-apps/java-spring-boot/src/main/java/com/posthog/example/controller/BurritoController.java) profile()

**Sources.** [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270)

**Frameworks.** `java`

**Wrong:**

```java
PostHogConfig.builder(token).enableExceptionAutocapture(true) // borrowed API
@ExceptionHandler
void onError(Exception e) { posthog.captureException(e); }
```

**Fixed:**

```java
posthog.capture(userId, "error_occurred",
    PostHogCaptureOptions.builder()
        .property("error_type", e.getClass().getSimpleName())
        .property("source", "profile_view")
        .build());
// person props: .userProperty(k, v); never promise surveys or replay
```

## JVM backend gets the Android SDK

**Problem.** posthog-android is the most visible Java/Kotlin PostHog package, so an agent picks it for a Spring Boot service without checking the platform.

**Impact.** The backend gets an Android API surface (context, lifecycle), so calls fail or events never ship.

**Rule location.**

- `wizard: src/frameworks/java/java-wizard-agent.ts` (getAdditionalContextLines, lines ~125-126)
- src/lib/constants.ts (Integration.java ordered after kmp/swift/android)
- [`context-mill: context/commandments.yaml#java-server`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948), [wizard@c56a894](https://github.com/PostHog/wizard/commit/c56a894c)

**Frameworks.** `java`, `kotlin`, `spring-boot`

**Wrong:**

```kotlin
// build.gradle.kts of a Spring Boot service
implementation("com.posthog:posthog-android:3.+")
```

**Fixed:**

```kotlin
implementation("com.posthog:posthog-server:+")
// one client per process: PostHog.with(PostHogConfig.builder(token).host(host).build())
// close() on graceful shutdown; flush() before returning in serverless handlers
```

## Invented getInstance() accessor on Android SDK

**Problem.** Most Android SDKs use a singleton getInstance(), and the repo's own example README taught PostHog.getInstance(), an API that never existed in posthog-android.

**Impact.** Compile failure in the user's app. The diff looks complete but does not build.

**Rule location.**

- [`context-mill: example-apps/android/app/src/main/java/com/example/posthog/BurritoApp.kt`](https://github.com/PostHog/context-mill/blob/main/example-apps/android/app/src/main/java/com/example/posthog/BurritoApp.kt) (PostHogAndroid.setup) and viewmodel/AuthViewModel.kt (PostHog.capture), the correct shape
- [`context-mill: example-apps/android/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/android/README.md) still shows PostHog.getInstance() at lines 120-248 until PR #271 (open) merges

**Sources.** [PostHog/context-mill#271](https://github.com/PostHog/context-mill/pull/271), [PostHog/wizard-workbench#2964](https://github.com/PostHog/wizard-workbench/pull/2964), [PostHog/wizard-workbench#4282](https://github.com/PostHog/wizard-workbench/pull/4282)

**Frameworks.** `android`

**Wrong:**

```kotlin
import com.posthog.android.PostHogAndroid

fun capturePostHogEvent(event: String, properties: Map<String, Any> = emptyMap()) {
    PostHogAndroid.getInstance().capture(event, properties)
}
// README variant: val posthog = PostHog.getInstance()
```

**Fixed:**

```kotlin
// com.posthog.android is only for setup(), in Application.onCreate
PostHogAndroid.setup(this, config)

import com.posthog.PostHog   // everywhere else: the static object
PostHog.capture(
    event = "burrito_considered",
    properties = mapOf("total_considerations" to count)
)
```

## KMP uses native imports and wrong context

**Problem.** The native Android package com.posthog looks right, and shared-code instinct says to build the context once. The agent does not know that PostHogContext needs the Application on Android and no argument elsewhere.

**Impact.** Fails to compile, or the Android target starts without the Application and has no usable SDK, or other targets get the wrong context.

**Rule location.**

- [`context-mill: context/commandments.yaml#kmp`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 323 'All PostHog APIs live in the com.posthog.kmp package', line 326 'PostHogContext is platform-specific')
- [`context-mill: context/skills/integration/description-kmp-docs-only.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description-kmp-docs-only.md) (steps 4-5)

**Sources.** [PostHog/context-mill#240](https://github.com/PostHog/context-mill/pull/240)

**Frameworks.** `Kotlin Multiplatform`

**Wrong:**

```kotlin
import com.posthog.PostHog                  // native package, not com.posthog.kmp
// androidMain
PostHog.setup(config, PostHogContext())    // needs the Application on Android
```

**Fixed:**

```kotlin
import com.posthog.kmp.PostHog
import com.posthog.kmp.PostHogConfig
import com.posthog.kmp.PostHogContext
// once, early
PostHog.setup(config, PostHogContext(application))   // androidMain
PostHog.setup(config, PostHogContext())              // iosMain / web
```

## Exception middleware swallows errors instead of rethrowing

**Problem.** A capture-and-respond-500 middleware looks complete. The agent does not see that it short-circuits the app's own error pipeline.

**Impact.** The app's developer page, exception handlers and logging are bypassed, so behavior changes silently.

**Rule location.** [`context-mill: context/commandments.yaml#aspnetcore`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145)

**Frameworks.** `aspnetcore`

**Wrong:**

```csharp
app.Use(async (ctx, next) => {
    try { await next(); }
    catch (Exception ex) {
        posthog.CaptureException(ex, distinctId);
        ctx.Response.StatusCode = 500; // chain bypassed
    }
});
```

**Fixed:**

```csharp
catch (Exception ex)
{
    posthog.CaptureException(ex, distinctId);
    throw; // existing ASP.NET Core error handling still runs
}
```

## Flutter captureException called without named args

**Problem.** Other PostHog SDKs take the error as a positional argument, so an agent carries that shape over to Dart.

**Impact.** A compile error. Without an explicit stackTrace the captured exception has no real trace for the uploaded symbols to resolve against.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (test affordance, Flutter bullet, line ~360)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `flutter`

**Wrong:**

```dart
Posthog().captureException(Exception("PostHog source maps test"));
```

**Fixed:**

```dart
Posthog().captureException(
  error: Exception("PostHog source maps test"),
  stackTrace: StackTrace.current,
);
```

## Anthropic stream() bypasses the PostHog LLM wrapper

**Problem.** messages.stream() is the idiomatic Anthropic streaming call, but the @posthog/ai wrapper only intercepts create(). No build or type-check catches it, and a smoke test of the non-streaming path passes.

**Impact.** Runtime TypeError 'withResponse is not a function' on streaming paths, or streaming calls send no $ai\_generation events, while non-streaming paths work.

**Rule location.**

- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (Before you merge, LLM analytics item, line ~47)
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (line ~110). The create({stream:true}) guidance itself is not in any current rule

**Sources.** [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174)

**Frameworks.** `@posthog/ai`, `Anthropic SDK`, `nextjs`, `node`

**Wrong:**

```typescript
const client = new PostHogAnthropic({ apiKey, posthog })
const stream = await client.messages.stream({ model, messages, max_tokens })
// TypeError: messages.create(...).withResponse is not a function
```

**Fixed:**

```typescript
// Fix reported in issue 447 (not yet a skill rule): the wrapper only
// intercepts create(), so stream through it
const stream = await client.messages.create({
  model, messages, max_tokens, stream: true,
})
// Encoded today: the report checklist says to trigger each instrumented
// LLM call path and confirm $ai_generation events appear
```

## Stale instrument(server.server) workaround kept

**Problem.** The project already has the workaround and it looks deliberate, so the agent leaves it. The old compatibility check it worked around (versions before @posthog/mcp 0.11.2) has since been fixed.

**Impact.** The project keeps a workaround for a check that no longer exists, instrumenting the low-level handle instead of the supported instrument(server) call that works on both SDK majors.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 4 Path A, v2 reminders, line ~153)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344)

**Frameworks.** `mcp-typescript-sdk`

**Wrong:**

```typescript
const server = new McpServer({ name: "my-mcp-server", version: "1.0.0" })
const analytics = instrument(server.server, posthog)   // old workaround kept
```

**Fixed:**

```typescript
const server = new McpServer({ name: "my-mcp-server", version: "1.0.0" })
const analytics = instrument(server, posthog)   // change server.server back
// v2 tools register with registerTool(); server.tool() was removed
```

## Custom MCP dispatcher forwards raw tool arguments

**Problem.** Forwarding request.params.arguments is the obvious dispatcher code. The agent does not know the MCP analytics SDK injects an llm\_model argument that its prepare helpers strip and advertise.

**Impact.** The injected llm\_model argument reaches tool handlers, tools/list never advertises it, and model ownership breaks across replicas.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (Path C, custom dispatcher, lines ~187-217)

**Sources.** [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372)

**Frameworks.** `mcp-server`, `typescript`

**Wrong:**

```typescript
const result = await runTool(request.params.name, request.params.arguments)
posthog.captureToolCall({ toolName: request.params.name,
  parameters: request.params.arguments, response: result, durationMs, isError: false })
```

**Fixed:**

```typescript
const advertisedTools = posthog.prepareToolList(serverTools) // return from tools/list
const { args, intent, llmModel } =
  posthog.prepareToolCall(name, request.params.arguments, { originalTool })
const result = await runTool(name, args) // cleaned args, never raw
```

## First-touch properties written with $set

**Problem.** identify(id, props) is the obvious place for user attributes, and its second argument is $set. Agents rarely know about the third, $set\_once, argument.

**Impact.** Every later identify() overwrites the original value, which corrupts attribution data.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/2-attribution-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/2-attribution-fix.md) (Task C, attribution-first-touch-set-once, lines ~115-147)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `all`

**Wrong:**

```javascript
posthog.identify(user.id, {
  signup_landing_page: landingPath,
  original_partner_id: partnerId,
})
```

**Fixed:**

```javascript
posthog.identify(user.id, { plan: user.plan }, {
  signup_landing_page: landingPath,   // $set_once
  original_partner_id: partnerId,
})
```

## Server events overwrite client person properties

**Problem.** Server SDK capture calls look harmless, but with default person processing they attach the server's runtime metadata to the person profile.

**Impact.** Silent corruption, for example $os becoming 'Linux' on about 24% of profiles of macOS users.

**Rule location.** [`context-mill: context/skills/audit-identify/references/5-server-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/5-server-sdk.md) (Task A, server-process-person-profile, intro line 13 and Task A background)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [`context-mill: context/skills/audit-attribution/references/engagement-provenance.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/engagement-provenance.md)

**Frameworks.** `javascript_node`, `python`, `ruby`, `go`, `php`, `java`

**Wrong:**

```javascript
// runs on a Linux server
posthog.capture({ distinctId: userId, event: 'subscription_upgraded' })
```

**Fixed:**

```javascript
// transactional server event that must not touch the person profile
posthog.capture({
  distinctId: userId,
  event: 'subscription_upgraded',
  properties: { $process_person_profile: false },
})
```

## group() called with unstable key on render

**Problem.** The agent puts group() in a render or mount path, sometimes with a throwaway id. The SDK accepts any key without complaint.

**Impact.** Groups multiply per session, group properties churn, and $groupidentify events inflate the bill.

**Rule location.**

- [`context-mill: context/skills/audit-identify/references/3-identify-lifecycle.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/3-identify-lifecycle.md) (Task C, identify-groupidentify-correctness: stable groupKey, call placement)
- 4-identify-optimize.md (Task D, identify-duplicate-groupidentify-per-session)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130 (originally added under transformation-config/skills/audit-identify))

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```tsx
function Layout() {
  posthog.group('organization', crypto.randomUUID())   // every render, new key
  return <Outlet />
}
```

**Fixed:**

```tsx
// on login or org switch only, with the stable org id
posthog.group('organization', org.id, { name: org.name, plan: org.plan })
// groupIdentify only when group properties actually change
```

## person\_profiles 'always' on mostly anonymous traffic

**Problem.** 'always' sounds like the complete, safe choice, and the cost difference is not visible in code.

**Impact.** Every anonymous event creates a person profile and is billed as identified, at roughly four times the price.

**Rule location.** [`context-mill: context/skills/audit-identify/references/4-identify-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/4-identify-optimize.md) (Task A identify-person-profiles-mode)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
posthog.init(key, {
  api_host: '/ingest',
  person_profiles: 'always',
})
```

**Fixed:**

```javascript
posthog.init(key, { api_host: '/ingest' })
// default 'identified_only'; keep 'always' only when identified traffic >= 90%
```

## Copy and dead-click autocapture switched on

**Problem.** The agent enables extra autocapture options as 'more signal' without knowing each one is a billed event that heatmaps already cover.

**Impact.** Every copy or dead click becomes a billed event, although heatmaps collect dead-click coordinates for free.

**Rule location.** [`context-mill: context/skills/audit-autocapture/references/3-autocapture-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-autocapture/references/3-autocapture-optimize.md) (Tasks B, C)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
posthog.init(key, {
  capture_copied_text: true,
  capture_dead_clicks: true,
})
```

**Fixed:**

```javascript
posthog.init(key, { api_host: '/ingest' })
// leave capture_copied_text / capture_dead_clicks unset;
// heatmaps already get dead-click coordinates free
```

## Statsig config mapped to a flag return value

**Problem.** A one-to-one rename from getConfig to getFeatureFlag looks right. getFeatureFlag returns a variant key or boolean, not a bag of values.

**Impact.** Config values come back undefined, so the defaults silently win.

**Rule location.** [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (Dynamic configs and experiments)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `javascript_node`

**Wrong:**

```javascript
const limit = statsig.getConfig('checkout').get('limit', 10)
// migrated to:
const limit = posthog.getFeatureFlag('checkout').limit ?? 10
```

**Fixed:**

```javascript
const limit = (posthog.getFeatureFlagResult('checkout')?.payload ?? {})['limit'] ?? 10
// experiment variant: posthog.getFeatureFlag('my-exp') ?? fallback
// React: useFeatureFlagPayload / useFeatureFlagVariantKey
```

## Statsig logEvent value dropped in migration

**Problem.** capture(name, props) has no slot for the positional value, so the agent drops it or renames the event to look tidier.

**Impact.** Numeric value metrics disappear and event names stop matching history. Nothing reports it.

**Rule location.** [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (Event logging)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142)

**Frameworks.** `javascript_web`, `react`, `javascript_node`, `python`

**Wrong:**

```diff
- statsig.logEvent('purchase', 49.99, { sku })
+ posthog.capture('purchase', { sku })   // value dropped
```

**Fixed:**

```javascript
posthog.capture('purchase', { value: 49.99, sku })
// logEvent({ eventName, value, metadata }) -> capture(eventName, { value, ...metadata })
// event names pass through verbatim
```

## Server logs sent as analytics events

**Problem.** posthog.capture is the API the agent already knows, so forwarding log lines through it seems natural. PostHog logs actually ingest over OTLP.

**Impact.** Logs land as analytics events (billed and queried as events), not in PostHog Logs, so log search does not find them.

**Rule location.** [`context-mill: context/skills/logs/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/logs/description.md) (Key principles: OpenTelemetry, Structured logging)

**Sources.** [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61)

**Frameworks.** `nextjs`, `nodejs`, `python`, `go`, `java`

**Wrong:**

```javascript
// winston logger piped into analytics events
logger.on('data', (l) =>
  posthog.capture({ distinctId: 'server', event: 'app_log', properties: l }))
```

**Fixed:**

```javascript
// Configure an OTLP log exporter pointed at PostHog's logs ingest endpoint
// (token and endpoint from env vars); prefer structured key-value logging
```

## OTLP exporter added to mobile apps

**Problem.** The generic answer for PostHog logs is OTLP, so the agent adds an OpenTelemetry exporter to mobile apps too. The mobile SDKs have their own log capture.

**Impact.** An extra dependency and a parallel logging path next to the SDK's own log capture.

**Rule location.**

- [`context-mill: context/skills/logs/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/logs/description.md) (Key principles: SDK-native logs)
- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (commandments.ios, 'For iOS logs' bullet)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `android`, `react-native`

**Wrong:**

```text
// iOS/Android/RN app
// add OpenTelemetry SDK + OTLP exporter
endpoint = "https://us.i.posthog.com/i/v1/logs"
```

**Fixed:**

```swift
// posthog-ios >= 3.58.0: set config.logs fields before setup,
PostHogSDK.shared.setup(config)
// then capture with PostHogSDK.shared.logger or captureLog
```

## Generic OpenTelemetry instead of posthog-node traces

**Problem.** Told to add tracing, the agent reaches for the OpenTelemetry SDK from general knowledge. It cannot know that posthog-node 5.52.0 and later exports spans itself.

**Impact.** Needless OTel dependencies and wiring when the installed client already exports spans.

**Rule location.**

- [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Choose the capture path)
- not present in the older local checkout, exists on main

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391)

**Frameworks.** `node`, `nextjs`

**Wrong:**

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
# manual NodeSDK + exporter wiring, though posthog-node >= 5.52.0 is installed
```

**Fixed:**

```typescript
// posthog-node >= 5.52.0: set the `traces` option on the existing client
const posthog = new PostHog(token, { host, traces: { serviceName: 'api' } })
// wrap operations in withSpan (startSpan when a callback can't wrap)
// OTel already in project: point its OTLP exporter at /i/v1/traces
```

## OTel exporter added where Python native spans exist

**Problem.** The tracing skill used to say only posthog-node could send spans without OpenTelemetry, so Python installs always got an OTel exporter pipeline. AsyncPosthog has no span API, which makes this easy to get wrong in either direction.

**Impact.** Needless OTel dependencies and config on the sync client, or a broken setup if native spans are used on AsyncPosthog.

**Rule location.**

- [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Choose the capture path, Python bullet, Key principles)
- on main, not in the older local checkout

**Sources.** [PostHog/context-mill#399](https://github.com/PostHog/context-mill/pull/399)

**Frameworks.** `python`

**Wrong:**

```python
# posthog >= 7.58.0, sync Posthog client already in use
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint=f"{host}/i/v1/traces",
    headers={"Authorization": f"Bearer {token}"})))
```

**Fixed:**

```python
# posthog >= 7.58.0, sync client (AsyncPosthog has no span API: keep OTel)
posthog = Posthog(token, host=host, traces={"service_name": "api"})
with posthog.start_span("charge_card"):
    ...
```

## Hand-built OpenTelemetry metrics instead of posthog.metrics

**Problem.** posthog.metrics is new, so the agent improvises an OTel meter and exporter even when a PostHog SDK is already installed.

**Impact.** Needless packages and auth setup, a parallel metrics pipeline, and drift from the supported API.

**Rule location.**

- [`context-mill: context/skills/omnibus/instrument-metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-metrics/description.md) (Step 2, 'Prefer the SDK')
- [`context-mill: context/skills/metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/metrics/description.md) (Configure the client, Metric types)

**Sources.** [PostHog/context-mill#255](https://github.com/PostHog/context-mill/pull/255)

**Frameworks.** `javascript_web`, `javascript_node`, `python`

**Wrong:**

```python
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
exporter = OTLPMetricExporter(endpoint="https://us.i.posthog.com/i/v1/metrics")
meter = MeterProvider(...).get_meter("app")   # posthog SDK already installed
```

**Fixed:**

```python
# PostHog SDK present: posthog.metrics (count / gauge / histogram),
# no OTel packages, metrics={"service_name": ...} at client init.
# OTLP only when the code already exports OTel metrics or the language has no SDK.
```

## OpenTelemetry chosen over PostHog LLM wrapper

**Problem.** Older PostHog AI docs and the wider ecosystem push OTel instrumentors for LLM tracing. The docs themselves did this until posthog#75976, and the skill followed the docs.

**Impact.** Single generations arrive, but the session > trace > span > generation tree is hard to build and maintain, and the project gains extra OTel dependencies.

**Rule location.**

- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md) (Key principles: 'The SDK wrapper is the default, not OpenTelemetry')
- references/2-install.md ('Do not add OpenTelemetry packages')
- references/3-instrument.md ('Swap the client')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/posthog#75976](https://github.com/PostHog/posthog/pull/75976)

**Frameworks.** `python`, `node`, `openai`, `anthropic`

**Wrong:**

```python
provider = TracerProvider(resource=Resource(attributes={SERVICE_NAME: 'my-app'}))
provider.add_span_processor(PostHogSpanProcessor(
    api_key=os.environ['POSTHOG_API_KEY'], host=os.environ['POSTHOG_HOST']))
trace.set_tracer_provider(provider)
OpenAIInstrumentor().instrument()
```

**Fixed:**

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI
posthog = Posthog(os.environ['POSTHOG_API_KEY'], host=os.environ['POSTHOG_HOST'])
client = OpenAI(posthog_client=posthog)  # existing calls unchanged
# install only `posthog` (or @posthog/ai + posthog-node), no opentelemetry-*
```

## LLM wrapper on pinned pre-1.0 openai emits nothing

**Problem.** The PostHog wrapper and OTel instrumentors target openai>=1.x. The agent does not check the pinned version, and an install with nothing to patch raises no error.

**Impact.** Silent: zero AI events. Upgrading openai instead would break the app's own openai.ChatCompletion calls.

**Rule location.** [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) ('Watch the pinned major version', on main)

**Sources.** [PostHog/context-mill#398](https://github.com/PostHog/context-mill/pull/398)

**Frameworks.** `python`, `openai`

**Wrong:**

```python
# requirements.txt: openai==0.27.5
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
OpenAIInstrumentor().instrument()   # patches the 1.x client only
resp = openai.ChatCompletion.create(model="gpt-4", messages=msgs)
```

**Fixed:**

```python
# openai pinned below 1.0: do not upgrade, use manual capture
resp = openai.ChatCompletion.create(model=model, messages=msgs)
posthog.capture(distinct_id=user_id, event="$ai_generation", properties={
    "$ai_model": model, "$ai_trace_id": trace_id,
    "$ai_session_id": session_id})
```

## Generic instrumentor used instead of Agents SDK processor

**Problem.** An OpenAI app looks like a job for OpenAIInstrumentor. The OpenAI Agents SDK traces through its own layer, so the instrumentor installs and builds cleanly while capturing nothing.

**Impact.** Silent: the install succeeds, the build passes, instrumentation reports success, and no trace tree or AI events are captured.

**Rule location.**

- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md) ('never swap a framework's own tracing hook for an instrumentor')
- references/1-begin.md (rule 2, framework wins)
- references/3-instrument.md ('Do not substitute an OTel instrumentor')
- [`wizard-workbench: apps/ai-observability/openai-agents/python-travel-triage/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/openai-agents/python-travel-triage/README.md)

**Sources.** [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/openai-agents/python-travel-triage/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/openai-agents/python-travel-triage/README.md)

**Frameworks.** `openai-agents`, `opentelemetry`, `python`

**Wrong:**

```python
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
OpenAIInstrumentor().instrument()     # Agents SDK traces elsewhere; captures nothing
```

**Fixed:**

```python
from posthog.ai.openai_agents import instrument
instrument(client=posthog_client, properties={'$ai_session_id': session_id})
# the SDK's tracing layer emits the whole tree; no OTel, no manual spans
```

## Wrapped Gemini client used instead of ADK plugin

**Problem.** The model-wrapper pattern works for plain provider calls, so agents apply it to Google ADK too, or hand-write spans. ADK ships a PostHog plugin that already emits the agent structure.

**Impact.** The run structure is lost: no agent or tool spans, no per-invocation trace and no identity taken from ADK.

**Rule location.** [`wizard-workbench: apps/ai-observability/google-adk/node-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/google-adk/node-weather/README.md) (Expected outcome and Fail list)

**Sources.** [PostHog/wizard-workbench#3711](https://github.com/PostHog/wizard-workbench/pull/3711), [wizard-workbench@f544505](https://github.com/PostHog/wizard-workbench/commit/f54450583), [PostHog/posthog-js#4687](https://github.com/PostHog/posthog-js/pull/4687)

**Frameworks.** `google-adk`, `node`

**Wrong:**

```typescript
import { GoogleGenAI } from '@posthog/ai/gemini'
const genai = new GoogleGenAI({ apiKey, posthog })  // wrapped Gemini client
// model calls only: loses ADK's agent, tool and invocation structure
const runner = new Runner({ agent: new LlmAgent({ name, model, tools }), appName, sessionService })
```

**Fixed:**

```typescript
import { PostHogADKPlugin } from '@posthog/ai/adk'
const runner = new Runner({ agent, appName, sessionService,
  plugins: [new PostHogADKPlugin({ client: posthog })] })
// plugin emits $ai_trace, agent/tool $ai_span, $ai_generation
// userId -> distinct id, sessionId -> $ai_session_id; flush with posthog.shutdown()
```

## Extra PostHog client or doubled AI instrumentation

**Problem.** General rules about the Posthog() constructor, shutdown and flushing are always in context, so the agent adds a client on OTel and framework-hook paths that export without one, or next to an existing client. It may also stack the wrapper client and an OTel instrumentor on one provider.

**Impact.** Dead client scaffolding and atexit shutdowns, a second sender next to the span processor, and double-reported generations.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (ai\_observability carve-out 'only the wrapper-client and manual-capture install paths construct a PostHog client')
- [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) ('Do not add OpenTelemetry to a wrapper variant')
- references/1-begin.md ('reuse its env-var names and its client')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [context-mill@b3c0dec](https://github.com/PostHog/context-mill/commit/b3c0deca), [PostHog/context-mill#251](https://github.com/PostHog/context-mill/pull/251)

**Frameworks.** `python`, `node`, `opentelemetry`, `openai`, `openai-agents`, `claude-agent-sdk`, `anthropic`, `langchain`, `llamaindex`, `vercel-ai`

**Wrong:**

```python
# OTel path: the span processor needs only token + host
posthog = Posthog(token, host=host)      # app already has a client, or none is needed
atexit.register(posthog.shutdown)
# plus the wrapper client AND an OTel instrumentor on the same provider
```

**Fixed:**

```text
# Only wrapper-client and manual-capture paths construct a PostHog client.
# OTel/framework-hook paths: register the span processor or hook only; the
# Posthog() constructor, shutdown and flush rules do not apply. Never invent
# a client. If the project already has one, reuse it and its env-var names.
# Wrapper variants: do not add OpenTelemetry packages.
```

## Vercel AI calls without experimental\_telemetry enabled

**Problem.** The agent wires NodeSDK with the PostHog span processor and stops. Vercel AI emits spans only when each call opts in, and the flag's 'experimental' name makes it easy to skip.

**Impact.** No generations reach PostHog, silently.

**Rule location.**

- [`wizard-workbench: apps/ai-observability/vercel-ai/nextjs-support-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/vercel-ai/nextjs-support-chat/README.md) (Expected outcome)
- [`context-mill: context/skills/ai-observability/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/config.yaml) (vercel-ai variant docs\_urls -> posthog.com/docs/ai-observability/installation/vercel-ai.md). No longer spelled out in context-mill's own references

**Sources.** [PostHog/context-mill#251](https://github.com/PostHog/context-mill/pull/251), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/vercel-ai/nextjs-support-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/vercel-ai/nextjs-support-chat/README.md)

**Frameworks.** `vercel-ai`

**Wrong:**

```typescript
const result = await generateText({ model: openai('gpt-5-mini'), prompt })
// NodeSDK + PostHogSpanProcessor configured, but no spans are emitted
```

**Fixed:**

```typescript
const result = await generateText({
  model: openai('gpt-5-mini'),
  prompt,
  experimental_telemetry: { isEnabled: true, functionId: 'my-ai-function' },
})
// NodeSDK started once in instrumentation.ts with PostHogSpanProcessor only
```

## AI spans silently dropped by the PostHog filter

**Problem.** Naming a span after the app's operation is normal OTel practice. The PostHog AI span processor forwards only spans whose name or an attribute starts with gen\_ai. llm. ai. or traceloop. and drops the rest silently.

**Impact.** No error. Generations arrive with no root trace and tool-run spans disappear.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (### The OpenTelemetry path, lines ~27-32, 'Capture tool calls as spans' ~line 68)
- references/4-verify.md (failure table: 'A trace with no root, on the OTel path')
- [`wizard-workbench: apps/ai-observability/opentelemetry/go-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/opentelemetry/go-weather/README.md)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373), [PostHog/wizard-workbench#3675](https://github.com/PostHog/wizard-workbench/pull/3675), [`wizard-workbench: apps/ai-observability/opentelemetry/go-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/opentelemetry/go-weather/README.md)

**Frameworks.** `go`, `opentelemetry`, `node`, `python`

**Wrong:**

```go
ctx, span := tracer.Start(ctx, "handle turn") // dropped: no gen_ai./llm./ai./traceloop. prefix
// tool run recorded as a plain span named after the tool
```

**Fixed:**

```go
ctx, span := tracer.Start(ctx, "gen_ai.turn")  // or ai.ask, or a gen_ai.* attribute
span.SetAttributes(attribute.String("$ai_session_id", sessionID))
// tool run: child span of the turn with gen_ai.* attributes
// ForceFlush/Shutdown the provider before exit; verify no 'trace with no root'
```

## Go code imports an AI wrapper that doesn't exist

**Problem.** PostHog ships OpenAI and Anthropic wrappers for JS and Python, so the agent assumes posthog-go has them too.

**Impact.** Compile errors, and no AI events reach PostHog.

**Rule location.**

- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md) (Go is the exception: no wrapper SDK, use the opentelemetry-go bridge)
- references/3-instrument.md (no wrapper on opentelemetry-\* variants)
- [`wizard-workbench: apps/ai-observability/opentelemetry/go-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/opentelemetry/go-weather/README.md)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373), [`wizard-workbench: apps/ai-observability/opentelemetry/go-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/opentelemetry/go-weather/README.md), [PostHog/wizard-workbench#3675](https://github.com/PostHog/wizard-workbench/pull/3675)

**Frameworks.** `go`, `opentelemetry`

**Wrong:**

```go
import "github.com/posthog/posthog-go/ai/openai"   // no such wrapper in Go
```

**Fixed:**

```go
import posthogotel "github.com/posthog/posthog-go/otel"
// posthogotel.NewSpanProcessor on a TracerProvider;
// hand-authored gen_ai.* spans pass the AI filter;
// ForceFlush/Shutdown the provider before exit
```

## Raw thread id fails session id validation

**Problem.** Passing the app's existing conversation id straight through is the natural choice. The restricted character set of $ai\_session\_id is easy to miss, and failures are silent.

**Impact.** Silent: ids with a slash or a hash fail validation, so session grouping is lost for those conversations.

**Rule location.** [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (## Attach identity to every call, line ~52: '$ai\_session\_id accepts letters, numbers, and - \_ ~ . @ ( ) ! ' : |')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `all`

**Wrong:**

```python
posthog_properties={'$ai_session_id': thread.id}  # e.g. 'team/room#42'
```

**Fixed:**

```python
# $ai_session_id allows letters, numbers and - _ ~ . @ ( ) ! ' : | only
session_id = re.sub(r"[^A-Za-z0-9\-_~.@()!':|]", "-", thread.id)
posthog_properties={'$ai_session_id': session_id}
```

## Test-only init flags copied into app code

**Problem.** The agent copies the whole example init, including e2e-only flags. Those flags look like ordinary config.

**Impact.** Production ships with bot detection off, so crawlers count as users, and with one HTTP request per event.

**Rule location.**

- [`context-mill: scripts/plugins/ignore-block.js`](https://github.com/PostHog/context-mill/blob/main/scripts/plugins/ignore-block.js) scripts/plugins/ignore-file.js, scripts/lib/example-processor.js
- markers in example-apps/next-\*/instrumentation-client.ts

**Sources.** [context-mill@cf14d09](https://github.com/PostHog/context-mill/commit/cf14d09a)

**Frameworks.** `nextjs-app-router`, `nextjs-pages-router`

**Wrong:**

```ts
posthog.init(token, {
  api_host: "/ingest",
  request_batching: false,
  opt_out_useragent_filter: true,  // This disables bot detection
})
```

**Fixed:**

```ts
  // @ignoreBlockStart
  // Disable request batching in test environment
  request_batching: false,
  opt_out_useragent_filter: true,
  // @ignoreBlockEnd
// skill build strips this block (and @ignoreFile test files) from the example the agent reads
```
