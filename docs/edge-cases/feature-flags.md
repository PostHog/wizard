# Feature flags read wrongly

31 cases. Part of the [edge case catalogue](../edge-cases.md).

## Unloaded flag treated as off in React

**Problem.** The hook returns undefined until /flags answers, and a ternary quietly treats that as false. Nothing errors, so the flash of the old UI looks like normal behavior.

**Impact.** Silent: users see the control UI flash before the new one, and experiments log exposure to the wrong variant.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/feature-flags.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/feature-flags.md) (error rule)
- [`context-mill: context/commandments.yaml#nextjs-feature-flags`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Avoiding flicker)

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `react`, `nextjs`, `javascript-web`

**Wrong:**

```tsx
const on = useFeatureFlagEnabled('new-nav')
return on ? <NewNav /> : <OldNav />   // undefined -> OldNav flashes
```

**Fixed:**

```tsx
const on = useFeatureFlagEnabled('new-nav')
if (on === undefined) return <NavSkeleton />   // unevaluated, not false
return on ? <NewNav /> : <OldNav />
// flags that affect first paint: evaluate server-side or bootstrap
```

## Flag read right after init

**Problem.** isFeatureEnabled looks synchronous, so reading it right after init seems fine. Before onFeatureFlags fires it returns the loading default, and nothing logs an error.

**Impact.** Silent: the value is frozen at undefined or false for the whole session, so the gated feature never turns on.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/2-feature-flags-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/2-feature-flags-fix.md) (Task B ff-await-readiness)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `react`, `vue`, `nextjs`

**Wrong:**

```js
posthog.init(KEY, { api_host: HOST })
const timerOn = posthog.isFeatureEnabled('quiz-timer-enabled')   // before flags arrive
```

**Fixed:**

```js
posthog.init(KEY, { api_host: HOST })
posthog.onFeatureFlags(() => {
  timerOn = Boolean(posthog.isFeatureEnabled('quiz-timer-enabled'))
})
// or set bootstrap.featureFlags in init
```

## Flag copied into state instead of hook

**Problem.** Copying a value into state from useEffect is a generic React habit. The agent does not know posthog-js/react hooks track loading and later flag updates.

**Impact.** Silent: the effect can run before flags load, so the UI sticks on the default and never follows later flag changes.

**Rule location.** [`context-mill: context/commandments.yaml#react`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (first rule)

**Sources.** [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61)

**Frameworks.** `react`, `nextjs`

**Wrong:**

```tsx
const [on, setOn] = useState(false)
useEffect(() => {
  setOn(!!posthog.isFeatureEnabled('new-nav'))   // may run before flags load
}, [])
```

**Fixed:**

```tsx
import { useFeatureFlagEnabled } from 'posthog-js/react'

const on = useFeatureFlagEnabled('new-nav')   // handles loading and updates
```

## No bootstrap when the server knows flags

**Problem.** The agent copies the plain posthog.init snippet from the install docs. Bootstrap is an optional setting that only matters when SSR already has the values.

**Impact.** First render has no flag values and waits for a /flags round trip, so the UI flickers.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/2-feature-flags-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/2-feature-flags-fix.md) (Task A ff-bootstrap-when-known-set)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `react`, `javascript-web`

**Wrong:**

```js
// server already computed initialFlags and passed them as props
posthog.init(key, { api_host: '/ingest' })
```

**Fixed:**

```js
posthog.init(key, {
  api_host: '/ingest',
  bootstrap: { distinctID: userId, featureFlags: initialFlags },
})
```

## Server and client evaluate the same flag

**Problem.** Each side has its own working SDK call, so evaluating in both places looks harmless. The two sides use different distinct ids and timing, so they can disagree.

**Impact.** Hydration mismatch or a visible swap after load, and rollout percentages that disagree between server and client.

**Rule location.**

- [`context-mill: context/commandments.yaml#nextjs-feature-flags`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (pass flag values from server to client as props)
- [`context-mill: context/skills/feature-flags/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/feature-flags/description.md) ('Server-side when possible')

**Sources.** [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#378](https://github.com/PostHog/context-mill/pull/378)

**Frameworks.** `nextjs`, `react`

**Wrong:**

```tsx
// Server Component
const on = await posthog.isFeatureEnabled('banner', serverDistinctId)
return <ClientBanner />
// ClientBanner: useFeatureFlagEnabled('banner') with the anonymous browser id
```

**Fixed:**

```tsx
// Server Component evaluates once and passes the value down
const flags = await posthog.getAllFlags(distinctId)
return <Banner enabled={flags['banner']} />
```

## React flag hooks in Server Components

**Problem.** The posthog-js/react hook is the most common flag example, so the agent uses it everywhere. It forgets that App Router pages are Server Components by default.

**Impact.** Build or render error, because hooks cannot run on the server.

**Rule location.** [`context-mill: context/commandments.yaml#nextjs-feature-flags`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5)

**Frameworks.** `nextjs`

**Wrong:**

```tsx
// app/page.tsx (Server Component)
export default function Page() {
  const enabled = useFeatureFlagEnabled('new-checkout')
  return enabled ? <New /> : <Old />
}
```

**Fixed:**

```tsx
const posthog = new PostHog(key, { host })
const enabled = await posthog.getFeatureFlag('new-checkout', distinctId)
await posthog.shutdown()
return <ClientBlock enabled={Boolean(enabled)} />
```

## Bulk flag reads record no experiment exposure

**Problem.** getAllFlags returns the same values with one call, so it looks like the efficient choice. The docs barely mention that only per-flag reads emit $feature\_flag\_called.

**Impact.** Silent: users are left out of experiment results because no exposure event is recorded. The wizard excluded its own runs this way.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/experiments.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/experiments.md) (error rule)
- [`wizard: src/shared/utils/analytics.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/analytics.ts) (getAllFlagsForWizard via evaluateFlags)

**Sources.** [PostHog/wizard#980](https://github.com/PostHog/wizard/pull/980), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#190](https://github.com/PostHog/context-mill/pull/190)

**Frameworks.** `javascript-web`, `react`, `nextjs`, `node`, `posthog-node`

**Wrong:**

```ts
const flags = await client.getAllFlagsAndPayloads(distinctId)
if (flags.featureFlags['new-checkout']) renderNewCheckout()
// browser: posthog.getAllFlags()['checkout-test']
```

**Fixed:**

```ts
const snapshot = await client.evaluateFlags(distinctId)
if (snapshot.getFlag('new-checkout')) renderNewCheckout()   // emits $feature_flag_called
// browser: posthog.getFeatureFlag('checkout-test')
// React: useFeatureFlagVariantKey('checkout-test')
```

## Flag value or payload used with no default

**Problem.** Examples show the happy path. The agent does not plan for undefined during loading, an unreachable PostHog, quota limits or an unset payload.

**Impact.** Broken or empty UI, a TypeError on payload fields, or the literal word 'undefined' rendered to users.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/2-feature-flags-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/2-feature-flags-fix.md) (Task C ff-default-values)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript-web`, `react`, `nextjs`

**Wrong:**

```tsx
<Banner variant={posthog.getFeatureFlag('banner-variant')} />
const limit = posthog.getFeatureFlagPayload('limits').max   // TypeError on undefined
`Tip: ${posthog.getFeatureFlagPayload('quiz-difficulty')?.tip}`   // prints undefined
```

**Fixed:**

```tsx
<Banner variant={posthog.getFeatureFlag('banner-variant') ?? 'control'} />
const isBeta = posthog.isFeatureEnabled('beta') ?? false
`Tip: ${posthog.getFeatureFlagPayload('quiz-difficulty')?.tip ?? ''}`
```

## Code checks a flag that does not exist

**Problem.** The SDK returns false for unknown keys with no error or log, so a typo or deleted flag looks like a flag that is just off.

**Impact.** Silent: any branch gated on the missing key never runs for anyone.

**Rule location.** no matching rule in context-mill main (grep for drift/ghost finds nothing under context/skills/audit-feature-flags)

**Frameworks.** `javascript-web`, `react`

**Wrong:**

```js
posthog.isFeatureEnabled('quiz-hint-enabled')   // no such flag: false for everyone
```

**Fixed:**

```text
// drift audit: every key in code must exist in the live flag roster
// unknown key -> report it, do not assume the flag is just off
```

## Deprecated per-flag helpers instead of one snapshot

**Problem.** Training data is full of IsFeatureEnabled and GetFeatureFlag. The newer EvaluateFlags snapshot API in Go, Rust, Java and Elixir came after most examples were written.

**Impact.** One /flags request per call, values that can disagree within one request, no exposure deduplication, and deprecated APIs.

**Rule location.**

- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #rust, #java-server, #elixir
- [`context-mill: example-apps/go/handlers.go`](https://github.com/PostHog/context-mill/blob/main/example-apps/go/handlers.go)

**Sources.** [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270), [`posthog-rs: src/client/async_client.rs`](https://github.com/PostHog/posthog-rs/blob/main/src/client/async_client.rs)

**Frameworks.** `go`, `rust`, `java`, `elixir`

**Wrong:**

```go
on, _ := client.IsFeatureEnabled(posthog.FeatureFlagPayload{
	Key: "new-dashboard", DistinctId: uid})
payload, _ := client.GetFeatureFlagPayload(posthog.FeatureFlagPayload{
	Key: "new-dashboard", DistinctId: uid})
```

**Fixed:**

```go
flags, err := client.EvaluateFlags(posthog.EvaluateFlagsPayload{
	DistinctId: uid,
	FlagKeys:   []string{"new-dashboard"},
})
if err == nil && flags.IsEnabled("new-dashboard") { /* ... */ }
// Java: posthog.evaluateFlags(id); Rust: evaluate_flags; Elixir: evaluate_flags/1
```

## Gated events lack the flag snapshot

**Problem.** Capture works fine without flags attached, and older code used SendFeatureFlags, which re-evaluates flags. The agent does not know to attach the snapshot the code branched on.

**Impact.** Silent: events are not linked to the flags the user actually saw, so flag breakdowns and experiments have no signal or the wrong one.

**Rule location.** [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #elixir (set\_in\_context/1)

**Sources.** [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154), [`posthog-go: capture.go`](https://github.com/PostHog/posthog-go/blob/main/capture.go)

**Frameworks.** `go`, `elixir`

**Wrong:**

```go
if flags.IsEnabled("new-checkout") {
	client.Enqueue(posthog.Capture{
		DistinctId: id, Event: "checkout", SendFeatureFlags: true, // re-evaluates
	})
}
```

**Fixed:**

```go
client.Enqueue(posthog.Capture{
	DistinctId: id,
	Event:      "checkout",
	Flags:      flags.OnlyAccessed(), // the snapshot the code used
})
// Elixir: PostHog.FeatureFlags.set_in_context(flags)
```

## Flag evaluation failure takes the page down

**Problem.** evaluateFlags reads like a local lookup, so the agent calls it inline, unwraps the result or pattern-matches only success. It is a network call that throws when PostHog is slow or down.

**Impact.** A PostHog outage turns the page into a 500, a Rust panic or an Elixir MatchError instead of falling back to the flag being off.

**Rule location.**

- [`context-mill: example-apps/java-spring-boot/src/main/java/com/posthog/example/controller/BurritoController.java`](https://github.com/PostHog/context-mill/blob/main/example-apps/java-spring-boot/src/main/java/com/posthog/example/controller/BurritoController.java) (dashboard)
- [`context-mill: example-apps/go/handlers.go`](https://github.com/PostHog/context-mill/blob/main/example-apps/go/handlers.go) (dashboard, err branch)
- [`context-mill: example-apps/rust/src/main.rs`](https://github.com/PostHog/context-mill/blob/main/example-apps/rust/src/main.rs) (dashboard, Err branch)
- [`context-mill: example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex) (case with fail-safe \_error clause)

**Sources.** [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `java`, `go`, `rust`, `elixir`

**Wrong:**

```java
PostHogFeatureFlagEvaluations flags = posthog.evaluateFlags(userId);
model.addAttribute("showNewFeature", flags.isEnabled("new-dashboard-feature"));
// Rust: .await.unwrap()   Elixir: {:ok, snapshot} = evaluate_flags(id)
```

**Fixed:**

```java
boolean show = false;
try {
    show = posthog.evaluateFlags(userId).isEnabled("new-dashboard-feature");
} catch (RuntimeException e) {
    log.warn("feature flag evaluation failed", e);   // fall back to off
}
```

## Server flag check without await

**Problem.** Browser isFeatureEnabled is synchronous, and the agent carries that habit into posthog-node, where it returns a Promise. A Promise is always truthy, so the branch quietly always runs.

**Impact.** Silent: the gated feature is on for everyone.

**Rule location.**

- [`context-mill: example-apps/javascript-node/todo.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-node/todo.js) /stats
- [`context-mill: context/skills/omnibus/instrument-feature-flags/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-feature-flags/description.md)

**Sources.** [PostHog/context-mill#89](https://github.com/PostHog/context-mill/pull/89), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87), [`context-mill: example-apps/javascript-node/todo.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-node/todo.js)

**Frameworks.** `javascript_node`

**Wrong:**

```javascript
app.get('/stats', (req, res) => {
  if (posthog.isFeatureEnabled('detailed-analytics', userId)) {
    stats.todos = buildBreakdown()
  }
})
```

**Fixed:**

```javascript
app.get('/stats', async (req, res) => {
  const showDetailed = await posthog.isFeatureEnabled('detailed-analytics', userId)
  if (showDetailed) stats.todos = buildBreakdown()
})
```

## PHP person properties passed as groups

**Problem.** The third positional argument looks like it should take properties, but in posthog-php it is $groups. Even the Laravel example app gets this wrong.

**Impact.** Person-property targeting is ignored, so the flag can evaluate wrong. A null return also breaks typed bool properties.

**Rule location.** [`context-mill: example-apps/laravel/app/Http/Livewire/Dashboard.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Http/Livewire/Dashboard.php) (still wrong, needs fixing)

**Sources.** [`posthog-php: lib/PostHog.php`](https://github.com/PostHog/posthog-php/blob/4.2.0/lib/PostHog.php), [`context-mill: example-apps/laravel/app/Http/Livewire/Dashboard.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Http/Livewire/Dashboard.php)

**Frameworks.** `laravel`, `php`

**Wrong:**

```php
$this->showNewFeature = PostHog::isFeatureEnabled(
    'new-dashboard-feature',
    $user->email,
    $user->getPostHogProperties()   // lands in $groups
);
```

**Fixed:**

```php
// isFeatureEnabled($key, $distinctId, $groups, $personProperties, ...)
$this->showNewFeature = PostHog::isFeatureEnabled(
    'new-dashboard-feature',
    $user->email,
    [],
    $user->getPostHogProperties()
) ?? false;   // returns ?bool
```

## Server flags baked into cached WordPress pages

**Problem.** Server-side evaluation is usually the recommended way to avoid flicker. Behind a full-page cache, though, the first visitor's result is stored and served to everyone.

**Impact.** Silent: every visitor gets the first visitor's variant, so targeting and rollouts are wrong.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/feature-flags/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/feature-flags/config.yaml) (wordpress variant)
- [`context-mill: example-apps/wordpress/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/README.md)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279), [context-mill@87149b5](https://github.com/PostHog/context-mill/commit/87149b55)

**Frameworks.** `wordpress`, `php`

**Wrong:**

```php
<?php if (PostHog::isFeatureEnabled('new-hero', $distinct_id)) : ?>
  <section class="hero-new">...</section>
<?php endif; ?>
<!-- cached by Varnish / batcache / WP Super Cache -->
```

**Fixed:**

```javascript
// evaluate client-side on cacheable pages
posthog.onFeatureFlags(function () {
  if (posthog.isFeatureEnabled('new-hero')) showNewHero()
})
```

## Feature Management without a PostHog user context

**Problem.** AddFeatureManagement() is the standard Microsoft setup and compiles fine. Nothing tells PostHog who the current user is.

**Impact.** Silent: flags evaluate without a distinct id, person properties or groups, so targeting returns defaults for everyone.

**Rule location.**

- [`context-mill: context/commandments.yaml#aspnetcore`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 140, 'For Microsoft.FeatureManagement, call UseFeatureManagement&lt;TContextProvider>() ...')
- [`context-mill: context/skills/feature-flags/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/feature-flags/config.yaml) (aspnetcore-feature-management variant, docs-only)

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145), [posthog.com/docs/libraries/dotnet.md](https://posthog.com/docs/libraries/dotnet.md)

**Frameworks.** `aspnetcore`

**Wrong:**

```csharp
builder.Services.AddFeatureManagement();
// [FeatureGate("beta")] evaluated with no distinct id
```

**Fixed:**

```csharp
builder.AddPostHog(options => {
    options.UseFeatureManagement<AppFlagContext>();
});

public class AppFlagContext(IHttpContextAccessor http) : PostHogFeatureFlagContextProvider
{
    protected override string? GetDistinctId() => http.HttpContext?.User.Identity?.Name;
    // override GetFeatureFlagOptionsAsync for person properties and groups
}
```

## Local evaluation inside edge or Lambda handlers

**Problem.** Local evaluation is documented as the fast option, so the agent adds a personal API key without noticing the client is rebuilt per invocation.

**Impact.** Every invocation re-downloads flag definitions, defeating the polling cache and inflating flag cost drastically.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/3-feature-flags-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/3-feature-flags-optimize.md) (Task C ff-local-eval-in-edge-handlers, severity error)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `nextjs`, `javascript-node`, `python`, `aws-lambda`, `cloudflare-workers`

**Wrong:**

```ts
export const runtime = 'edge'
export async function GET() {
  const ph = new PostHog(KEY, { personalApiKey: PERSONAL_KEY })
  return Response.json(await ph.getAllFlags(userId))
}
```

**Fixed:**

```ts
const ph = new PostHog(KEY, { host })   // no personalApiKey: remote evaluation
await ph.getAllFlags(userId)
// or share definitions via an external cache
```

## Local evaluation left on 30-second polling

**Problem.** The default polling interval is invisible in the init call, and its credit cost is not on the page the agent copies from.

**Impact.** Silent cost: a long-running server spends about 864,000 flag-definition credits a month.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/3-feature-flags-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/3-feature-flags-optimize.md) (Task B ff-local-eval-polling-interval)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript-node`, `python`, `ruby`, `go`, `php`

**Wrong:**

```ts
const posthog = new PostHog(key, { personalApiKey })   // polls every 30s, 10 credits each
```

**Fixed:**

```ts
const posthog = new PostHog(key, {
  personalApiKey,
  featureFlagsPollingInterval: 300_000,   // 5 min unless real-time changes are needed
})
```

## Flag polling keeps Durable Objects awake

**Problem.** The generic posthog-node local-evaluation setup works in a Durable Object, and the timer cost only shows up on the bill.

**Impact.** Silent cost: polling timers stop the object hibernating or being evicted, extending billable duration.

**Rule location.**

- posthog.com docs page https://posthog.com/docs/libraries/cloudflare-workers.md, section 'Durable Objects and local evaluation'
- context-mill only references it via context/docs.yaml#cloudflare-workers (urls list, release\_asset: true), so the rule text is not in the repo

**Sources.** [posthog.com/docs/libraries/cloudflare-workers.md](https://posthog.com/docs/libraries/cloudflare-workers.md), [PostHog/context-mill#104](https://github.com/PostHog/context-mill/pull/104)

**Frameworks.** `cloudflare-workers`, `posthog-node`

**Wrong:**

```javascript
const posthog = new PostHog(env.POSTHOG_PROJECT_TOKEN, {
  host: env.POSTHOG_HOST,
  secretKey: env.POSTHOG_FEATURE_FLAGS_SECURE_API_KEY,   // default polling timer
})
```

**Fixed:**

```javascript
const posthog = new PostHog(env.POSTHOG_PROJECT_TOKEN, {
  host: env.POSTHOG_HOST,
  secretKey: env.POSTHOG_FEATURE_FLAGS_SECURE_API_KEY,
  featureFlagsPollingInterval: null,   // posthog-node >= 5.55.0
})
// refresh deliberately: await posthog.reloadFeatureFlags()
```

## Bootstrap uses a different or random distinct id

**Problem.** bootstrap.distinctID looks like any id field, so the agent fills it with a per-request UUID. The SDK then believes it is already identified.

**Impact.** Silent: flags re-evaluate for a different person, users flip variants, and the later identify() cannot merge anonymous activity, leaving orphan profiles.

**Rule location.**

- [`context-mill: context/skills/audit-feature-flags/references/2-feature-flags-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/2-feature-flags-fix.md) (ff-bootstrap-distinct-id-mismatch)
- posthog-best-practices/references/feature-flags.md ('Resolve identity before evaluation')

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `javascript-web`, `react`

**Wrong:**

```ts
posthog.init(KEY, {
  bootstrap: { distinctID: crypto.randomUUID(), featureFlags },
})
posthog.identify(user.id)   // different id
```

**Fixed:**

```ts
posthog.init(KEY, {
  bootstrap: { distinctID: user.id, featureFlags },  // stable, equals identify id
})
// audit: volatile id = warning; different id then identify = error
```

## Person-targeted flag read before login

**Problem.** The flag works in testing for logged-in users. With identified\_only, anonymous visitors have no person profile, so the flag falls back to its default without any error.

**Impact.** Silent: the variant meant for anonymous traffic on landing, pricing or signup pages never fires.

**Rule location.** [`context-mill: context/skills/audit-feature-flags/references/2-feature-flags-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/2-feature-flags-fix.md) (ff-identified-only-pre-auth-targeting)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `react`, `nextjs`

**Wrong:**

```ts
// pricing page, anonymous, person_profiles: 'identified_only'
const show = posthog.getFeatureFlag('pro-only-cta')   // targets plan = pro
```

**Fixed:**

```ts
// pre-auth: pass person property overrides at evaluation time,
posthog.setPersonPropertiesForFlags({ plan: planFromCookie })
// or bootstrap server-computed flags, or move the check behind auth
```

## Anonymous flag snapshot kept after login

**Problem.** Caching the flag result looks like a cheap optimization. Nothing reminds the agent that the snapshot belongs to one identity and must be dropped on identify.

**Impact.** Silent: email- or person-targeted flags never match, because the anonymous result keeps being served.

**Rule location.** [`wizard: src/shared/utils/analytics.ts#identifyUser`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/analytics.ts) / flagPersonProperties

**Sources.** [PostHog/wizard#620](https://github.com/PostHog/wizard/pull/620)

**Frameworks.** `node`, `posthog-node`

**Wrong:**

```ts
const flags = await client.getAllFlagsAndPayloads(anonId, {
  personProperties: { $app_name: 'wizard' },
})   // cached as activeFlags before login
client.identify({ distinctId, properties: { $set: { email } } })
```

**Fixed:**

```ts
this.personProperties = props;   // email, name
this.client.identify({ distinctId, properties: { $set: props } });
this.activeFlags = null;         // snapshot is per identity
// flag calls: personProperties: { $app_name, ...this.personProperties }
```

## Flags evaluated under a different id than events

**Problem.** Email is right there and works as a distinct id, so the agent passes it to the flag call. Elsewhere events are identified by user id, and nothing flags the mismatch.

**Impact.** Silent: the flag decision and its exposure land on an email-keyed person, so targeting and experiment analysis do not match the tracked user.

**Rule location.**

- [`context-mill: example-apps/django/core/views.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/views.py) (dashboard\_view)
- [`context-mill: example-apps/fastapi/app/routers/main.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/routers/main.py) (still uses email)
- posthog-best-practices/references/feature-flags.md

**Sources.** [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [`context-mill: example-apps/fastapi/app/routers/main.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/routers/main.py), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101)

**Frameworks.** `fastapi`, `django`

**Wrong:**

```python
identify_context(str(user.id))   # middleware: events keyed by id
show = posthog.feature_enabled(
    "new-dashboard-feature",
    current_user.email,          # flag keyed by email
    person_properties={"email": current_user.email})
```

**Fixed:**

```python
user_id = str(request.user.id)
show = posthog.feature_enabled(
    'new-dashboard-feature',
    distinct_id=user_id,         # same id as events
    person_properties={'email': request.user.email},
)
```

## Deprecated payload getter evaluates the flag twice

**Problem.** isFeatureEnabled plus getFeatureFlagPayload is the shape in older docs and training data. GetFeatureFlagResult is newer.

**Impact.** A deprecated client API and two evaluations per read. Skill examples drift from posthog.com docs.

**Rule location.**

- [`context-mill: context/skills/creating-product-tours/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/creating-product-tours/description.md)
- [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md)

**Sources.** [PostHog/context-mill#190](https://github.com/PostHog/context-mill/pull/190), [PostHog/posthog-js#3889](https://github.com/PostHog/posthog-js/pull/3889)

**Frameworks.** `javascript-web`, `react`, `react-native`

**Wrong:**

```ts
if (!posthog.isFeatureEnabled(flagKey)) return;
const payload = posthog.getFeatureFlagPayload(flagKey) as {
  steps?: TourStep[];
} | null;
```

**Fixed:**

```ts
const result = posthog.getFeatureFlagResult(flagKey);
if (!result?.enabled) return;
const payload = result.payload as { steps?: TourStep[] } | null;
```

## New flag created live at 100%

**Problem.** An agent asked to 'create a flag' with an MCP tool turns it on so the code path can be seen working. It also recreates flags that already exist.

**Impact.** Unfinished flagged code or a product tour goes live for every user at once, and a shared flag can be overwritten.

**Rule location.**

- [`wizard-workbench: services/wizard-ci/feature-flag-checks.ts`](https://github.com/PostHog/wizard-workbench/blob/main/services/wizard-ci/feature-flag-checks.ts) (remoteFlagChecks)
- `wizard: feature-flags` program create-flag prompt
- [`context-mill: context/skills/creating-product-tours/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/creating-product-tours/description.md) (Step 2)

**Sources.** [PostHog/wizard#1322](https://github.com/PostHog/wizard/pull/1322), [PostHog/wizard-workbench#4189](https://github.com/PostHog/wizard-workbench/pull/4189), [PostHog/wizard-workbench#4136](https://github.com/PostHog/wizard-workbench/pull/4136), [PostHog/context-mill#135](https://github.com/PostHog/context-mill/pull/135), [PostHog/context-mill#405](https://github.com/PostHog/context-mill/pull/405)

**Frameworks.** `nextjs`, `django`, `rails`, `react`, `javascript-web`

**Wrong:**

```json
create-feature-flag { key: 'wizard-example-backend-flag', active: true,
  filters: { groups: [{ rollout_percentage: 100 }] } }
```

**Fixed:**

```text
create-flag: one example flag per side, inactive at 0% rollout.
An existing flag with the same key is reused unchanged.
Tours: leave the flag disabled; the user enables it when ready.
// grader: Flags API shows active === false, every group rollout === 0
```

## Flag key repeated as literals across files

**Problem.** Inlining the key string at each call site is the shortest edit, and every doc example does it.

**Impact.** A typo in one place silently checks a different flag, and renaming or removing the flag means grepping strings.

**Rule location.**

- [`wizard: src/rules-stubs/universal.md`](https://github.com/PostHog/wizard/blob/main/src/rules-stubs/universal.md) (# Feature flags)
- [`wizard-workbench: services/wizard-ci/feature-flag-checks.ts`](https://github.com/PostHog/wizard-workbench/blob/main/services/wizard-ci/feature-flag-checks.ts) (codeChecks)

**Sources.** [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard-workbench#4189](https://github.com/PostHog/wizard-workbench/pull/4189), [PostHog/wizard#1322](https://github.com/PostHog/wizard/pull/1322)

**Frameworks.** `nextjs`, `django`, `rails`, `all`

**Wrong:**

```typescript
// app/page.tsx
posthog.isFeatureEnabled('wizard-example-frontend-flag')
// app/api/items/route.ts
await posthog.isFeatureEnabled('wizard-example-frontend-flag', userId)
```

**Fixed:**

```typescript
// lib/feature-flags.ts: the only file holding the key
export const FRONTEND_FLAG = 'wizard-example-frontend-flag'
// app/page.tsx
import { FRONTEND_FLAG } from '@/lib/feature-flags'
posthog.isFeatureEnabled(FRONTEND_FLAG)
```

## Flag added to a side the app lacks

**Problem.** With only SDK install docs, the agent guesses where flags go. It adds a browser snippet to apps whose templates load no JavaScript, or checks only one side of a full-stack app.

**Impact.** Made-up client code and a flag nothing evaluates, or a full-stack app with flags on only one side.

**Rule location.**

- `wizard: feature-flags` seed prompt (wizard#1322)
- [`context-mill: context/skills/integration-v2/feature-flags-step/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/feature-flags-step/config.yaml)
- [`wizard-workbench: apps/feature-flags/django/django3-saas/.wizard-ci/feature-flags.json`](https://github.com/PostHog/wizard-workbench/blob/main/apps/feature-flags/django/django3-saas/.wizard-ci/feature-flags.json)

**Sources.** [PostHog/wizard#1322](https://github.com/PostHog/wizard/pull/1322), [PostHog/wizard-workbench#4189](https://github.com/PostHog/wizard-workbench/pull/4189), [PostHog/context-mill#405](https://github.com/PostHog/context-mill/pull/405)

**Frameworks.** `django`, `flask`, `laravel`, `rails`, `nextjs`

**Wrong:**

```text
Django templates load no scripts
agent: adds posthog-js snippet to base.html + wizard-example-frontend-flag
```

**Fixed:**

```text
A side counts only when the app already has code there: the frontend is
JavaScript the app owns and loads. Server-rendered templates that load none
are backend-only: one flag, one server-side evaluation.
# feature-flags-step variants carry per-side docs (react.md + nodejs.md)
```

## Product tour hidden when PostHog isn't loaded

**Problem.** Gating on isFeatureEnabled looks right, but it returns false when the SDK never loaded, for example in local dev with no token or with an ad blocker. So the tour never shows.

**Impact.** Silent: the tour never renders in local dev, so nobody can build or demo it.

**Rule location.** [`context-mill: context/skills/creating-product-tours/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/creating-product-tours/description.md) (Local development)

**Sources.** [PostHog/context-mill#177](https://github.com/PostHog/context-mill/pull/177)

**Frameworks.** `react`, `posthog-js`

**Wrong:**

```typescript
useEffect(() => {
  if (localStorage.getItem(key) === 'done') return
  if (!posthog.isFeatureEnabled(flagKey)) return   // false when PostHog never loaded
  setActive(true)
}, [flagKey, key])
```

**Fixed:**

```typescript
const ready = Boolean((posthog as any).__loaded)
if (ready) { if (!posthog.isFeatureEnabled(flagKey)) return }
else if (requireFlag) return   // strict mode
// else fail open with inline staticSteps
setActive(true)
```

## Stale flags disabled before code removal

**Problem.** PostHog labels a flag STALE, so bulk-disabling it looks safe. Removing only the code also feels finished, even though the flag keeps billing.

**Impact.** Disabling a flag that code still checks turns a live path off for everyone. Removing only the code leaves an active flag that keeps billing.

**Rule location.** `context-mill: audit-feature-flags/references/3-feature-flags-optimize.md` (Task A ff-active-but-unreferenced)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [`posthog: products/feature_flags/skills/cleaning-up-stale-feature-flags/SKILL.md`](https://github.com/PostHog/posthog/blob/master/products/feature_flags/skills/cleaning-up-stale-feature-flags/SKILL.md)

**Frameworks.** `all`

**Wrong:**

```text
for flag in feature-flag-get-all(active: "STALE"):
    update-feature-flag(flag.key, active=false)   # no grep, no experiment check
```

**Fixed:**

```text
Read-only. For each STALE flag: grep the key in source, inspect experiment_set,
then classify safe-to-disable | needs-review | unknown.
Hand the operator a prompt; order: remove from code -> deploy -> disable.
```

## Security switch turns off when flags fail

**Problem.** 'Enabled only if the flag is true' is the natural way to write a flag gate. When a fetch fails, the empty flag map reads as false.

**Impact.** Silent: a network blip returns an empty map and turns off security scanning for that run.

**Rule location.** [`wizard: src/agent/agent-interface.ts#isWarlockDisabled`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts)

**Sources.** [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597), [PostHog/wizard#828](https://github.com/PostHog/wizard/pull/828)

**Frameworks.** `all`

**Wrong:**

```ts
const scanEnabled = flags['wizard-warlock-enabled'] === 'true'
// flag fetch fails -> {} -> scanEnabled === false -> no scanning
```

**Fixed:**

```ts
export function isWarlockDisabled(flags: Record<string, string> = {}): boolean {
  return (
    flags[WIZARD_WARLOCK_DISABLED_FLAG_KEY] === 'true' ||
    runtimeEnv('POSTHOG_WIZARD_WARLOCK_DISABLED') === 'true'
  )   // missing flag or empty map leaves scanning on
}
```

## Migrated server flag checks lose the user id

**Problem.** Statsig server calls take a user object while PostHog takes a distinct\_id string, so a mechanical rewrite drops the user or passes the whole object.

**Impact.** Flags evaluate for no user or the wrong one, so targeting silently returns wrong results.

**Rule location.** [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (Feature flags > Server side, paragraph after the table, User updates)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `statsig`, `javascript-node`, `python`, `ruby`, `go`, `java`

**Wrong:**

```diff
- Statsig.checkGate(user, 'my-gate')
+ posthog.isFeatureEnabled('my-gate')         // no distinct id
+ posthog.isFeatureEnabled('my-gate', user)   // object, not a string
```

**Fixed:**

```javascript
posthog.isFeatureEnabled('my-gate', user.userID)   // Statsig userID -> distinct_id
// per-call custom props -> personProperties; set only at init -> mark warning
```
