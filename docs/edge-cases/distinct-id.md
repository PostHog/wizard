# Wrong or shared person ids

25 cases. Part of the [edge case catalogue](../edge-cases.md).

## Email used as the distinct id

**Problem.** Email is the one field always in scope, and PostHog's own server docs examples passed session.user.email or identify\_context(user.email), so the agent copies it even when a primary key exists. Nothing fails at runtime.

**Impact.** Silent: PII becomes every event's identity, a changed email splits one person in two, and server events never merge with the frontend's id-based person.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) (first bullet, 'not an email or display name')
- [`context-mill: context/agents/integration-v2/identify.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/identify.md)
- [`context-mill: context/skills/posthog-best-practices/description.md#Next.js`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('Do not copy that')
- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #rust, #java-server, #elixir
- [`context-mill: example-apps/flask`](https://github.com/PostHog/context-mill/tree/main/example-apps/flask) fastapi
- [`context-mill: example-apps/flutter/lib/auth/auth_state.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/lib/auth/auth_state.dart)
- `wizard: src/lib/agent/commandments.ts` (PII commandment)

**Sources.** [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101), [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [PostHog/context-mill#63](https://github.com/PostHog/context-mill/pull/63), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa39), [context-mill@d45736f](https://github.com/PostHog/context-mill/commit/d45736ff), [context-mill@236d613](https://github.com/PostHog/context-mill/commit/236d6133), [PostHog/wizard#431](https://github.com/PostHog/wizard/pull/431), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611), [`wizard-workbench: services/pr-evaluator/prompts/evaluation.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation.md)

**Frameworks.** `flask`, `fastapi`, `django`, `laravel`, `nextjs`, `node`, `ruby-on-rails`, `go`, `flutter`, `all`

**Wrong:**

```typescript
posthog.identify(user.email)
// server
posthog.capture({ distinctId: session.user.email, event: 'checkout_started' })
# python
with new_context():
    identify_context(user.email)
    tag('email', user.email)
```

**Fixed:**

```typescript
// stable id from auth as the distinct id, PII as person properties
posthog.identify(String(user.id), { email: user.email, name: user.name })
# python
with new_context():
    identify_context(str(user.id))
    capture('user_logged_in', properties={'$set': {'email': user.email}})
```

## Marketing site and app split identity

**Problem.** Identical init on both hosts looks correct. The split into two anonymous profiles is silent. Caveat: posthog-js usually defaults cross\_subdomain\_cookie to true, so the split mainly appears when it is off, on a public-suffix host, or the cookie domain is set too narrowly. The audit rule does not state this.

**Impact.** UTMs on the marketing host never reach the app-side signup.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/3-attribution-config.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/3-attribution-config.md) (Task A, attribution-cross-subdomain-cookie, suggestion when unset on a multi-subdomain project, warning when cookie\_domain is too narrow)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `next-js`, `react`

**Wrong:**

```js
// example.com and app.example.com
posthog.init(KEY, { api_host: HOST })
```

**Fixed:**

```js
posthog.init(KEY, {
  api_host: HOST,
  cross_subdomain_cookie: true,
})   // if cookie_domain is set, use the parent: .example.com
```

## Coerced missing id becomes the string undefined

**Problem.** Wrapping the id in String() or a cast looks like type hygiene and keeps the call running. The agent never notices the result is the literal 'undefined' shared by everyone.

**Impact.** Every user is identified as 'undefined' (or '') and pooled onto one person. Silent.

**Rule location.** [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('never pass a value that can be undefined')

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `laravel`, `inertia`, `react`, `vue`

**Wrong:**

```typescript
onSuccess: (page) => {
  const user = page.props.auth?.user
  if (user) posthog.identify(String(user.id))   // user exists, id absent -> 'undefined'
}
```

**Fixed:**

```typescript
// never pass a value that can be undefined; never substitute an email
if (!user?.id) return
posthog.identify(user.id, { email: user.email })
```

## Literal anonymous fallback pools all users

**Problem.** A ?? 'anonymous' fallback or a constant 'server'/'backend' id satisfies the SDK's required distinctId and the type checker, so it looks like defensive coding and never errors. The pooled person only shows up later in data.

**Impact.** Silent: every logged-out visitor or unattributed server event lands on one giant person, corrupting counts, funnels, retention and person merges.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) ('never fabricate a placeholder id like anonymous')
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md)
- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #rust, #java-server (avoid anonymous or literal IDs)
- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md) (disable person processing instead of sharing one identifier)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa39), [context-mill@0bf2d8a](https://github.com/PostHog/context-mill/commit/0bf2d8a1), [context-mill@8092ddb](https://github.com/PostHog/context-mill/commit/8092ddbf), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611)

**Frameworks.** `nextjs`, `next-auth`, `go`, `rust`, `java-server`, `node`, `python`, `all`

**Wrong:**

```typescript
signIn: async ({ user, account }) => {
  const distinctId = user?.id ?? user?.email ?? "anonymous";
  posthog.identify({ distinctId, properties: { name: user?.name, email: user?.email } });
  posthog.capture({ distinctId, event: "server_sign_in" });
}
// go
client.Enqueue(posthog.Capture{DistinctId: "server", Event: "order_created"})
```

**Fixed:**

```typescript
callbacks: {
  session({ session, token }) {
    if (session.user && typeof token.sub === "string") session.user.id = token.sub;
    return session;
  },
},
// identify only when the stable id is a string; otherwise skip and stay anonymous
if (typeof session.user?.id === 'string') posthog.identify(session.user.id, { email: session.user.email })
// truly system-level: no person profile
posthog.capture({ distinctId: 'cron', event: 'nightly_sync', properties: { $process_person_profile: false } })
```

## Visible placeholder when no stable id reaches

**Problem.** When accounts exist but the id is not in scope at a call site (jobs, webhooks), the agent guesses email or 'unknown' to finish the task, and then mentions it only as a vague caveat, if at all.

**Impact.** Events attach to the wrong person or nobody, and the user cannot find which call sites to fix.

**Rule location.**

- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (placeholder paragraph)
- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (unresolved-handoff, DISTINCT\_ID paragraph)

**Sources.** [context-mill@e58875b](https://github.com/PostHog/context-mill/commit/e58875b959486d1ebfc068e316d251e83b58ec1d), [context-mill@8592324](https://github.com/PostHog/context-mill/commit/85923242ed654b3bd0804eecf0305f78440583ee), [context-mill@0bf2d8a](https://github.com/PostHog/context-mill/commit/0bf2d8a1), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `all`

**Wrong:**

```typescript
posthog.capture({
  distinctId: user?.email ?? 'unknown',
  event: 'export_started',
});
// report: "Note: some events may not be fully attributed to users."
```

**Fixed:**

```typescript
// identity exists, no stable id reaches this call site
posthog.capture({ distinctId: 'DISTINCT_ID', event: 'invoice_paid' });
// report, own issue:
// Replace DISTINCT_ID in src/jobs/billing.ts:42, src/jobs/mail.ts:17
// Cost if left alone: those events belong to nobody.
```

## Accountless apps get personless events, not fake ids

**Problem.** Docs examples always pass a distinctId and agents treat identify as a required step, so for an app with no login the agent invents identify('user'), a constant 'anonymous', or ships the DISTINCT\_ID placeholder instead of capturing personless.

**Impact.** Silent: every visitor collapses into one made-up person, identification is claimed that does not exist, or a placeholder ships to production.

**Rule location.**

- [`context-mill: context/agents/integration-v2/identify.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/identify.md) ('If the app has no auth or user concept, say so and stop.', near the end)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (personless paragraph, 'Capture plainly, with no id and no placeholder')
- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md)
- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md) (disable person processing)

**Sources.** [context-mill@8092ddb](https://github.com/PostHog/context-mill/commit/8092ddbf0d58548bf07886423ca888dd0fbd7096), [context-mill@0bf2d8a](https://github.com/PostHog/context-mill/commit/0bf2d8a18796dbaf75bbe099d5b90072d4c15f66), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `all`

**Wrong:**

```typescript
// app has no accounts or login
posthog.identify('user')                                   // invented
posthog.capture({ distinctId: 'anonymous', event: 'newsletter_subscribed' })
// or a placeholder shipped to production
posthog.capture({ distinctId: 'DISTINCT_ID', event: 'file_uploaded' })
```

**Fixed:**

```typescript
// App has no accounts: identify says so and stops; capture is personless
posthog.capture({ distinctId: randomUUID(), event: 'newsletter_subscribed',
  properties: { $process_person_profile: false } })
// handoff: events are personless because the app has no identity
// DISTINCT_ID placeholder only when identity exists but no stable id reaches the call site
```

## Example READMEs still teach email ids

**Problem.** The agent anchors on shipped example READMEs, which still pass user.email even though most of the Flask/FastAPI example code was fixed, so the reference contradicts the commandment. Laravel code itself still uses email too.

**Impact.** The agent may pick the README shape and ship PII distinct ids. Silent.

**Rule location.**

- `context-mill: example-apps/{laravel,flask,fastapi}/README.md` and example-apps/{flask,fastapi}/app/templates/{burrito,profile,signup}.html (stale email ids)
- [`context-mill: example-apps/laravel/app`](https://github.com/PostHog/context-mill/tree/main/example-apps/laravel/app) (Login.php, Register.php, Dashboard.php, PostHogService.php still use $user->email). Not covered by context/skip-patterns.yaml, so shipped in references/EXAMPLE.md

**Sources.** [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101), [`context-mill: context/skip-patterns.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skip-patterns.yaml)

**Frameworks.** `laravel`, `flask`, `fastapi`

**Wrong:**

```php
// example-apps/laravel/README.md (ships into references/EXAMPLE.md)
$posthog->identify($user->email, $user->getPostHogProperties());
$posthog->capture($user->email, 'user_logged_in');
# example-apps/fastapi/README.md
identify_context(user.email)
```

**Fixed:**

```python
# the code in the same Python examples
identify_context(str(user.id))          # fastapi app/middleware.py, routers/main.py
identify_context(str(current_user.id))  # flask app/api/routes.py
```

## Per-login or per-session id passed to identify

**Problem.** Session ids and UUIDs are always in scope and unique, so they look like valid user ids. Mock auth objects even hand the agent a crypto.randomUUID() per login. The reset happens later and silently.

**Impact.** Every login, session or device creates a new person, so retention, per-user funnels and cross-device counts break. Silent.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('Use a stable unique id')
- [`context-mill: context/skills/audit-identify/references/2-identify-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/2-identify-fix.md) and context/skills/audit/references/3-identification.md (identify-stable-distinct-id)
- `wizard: src/lib/programs/audit/seed.ts`

**Sources.** [PostHog/wizard-workbench#4430](https://github.com/PostHog/wizard-workbench/pull/4430), [PostHog/wizard-workbench#772](https://github.com/PostHog/wizard-workbench/pull/772), [PostHog/wizard-workbench#1252](https://github.com/PostHog/wizard-workbench/pull/1252), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa3), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425)

**Frameworks.** `angular`, `all`

**Wrong:**

```typescript
// mock auth: credentials.id = crypto.randomUUID() on each login
this.posthogService.posthog.identify(credentials.id, {
  username: credentials.username,
  email: credentials.email,
})
// also: posthog.identify(session.sessionId), posthog.identify(req.cookies.sid)
```

**Fixed:**

```typescript
// stable app id (primary key, uuid, resource name), never regenerated per login
posthog.identify(stableUserId, { username, email })
// audit: error when the id sources from a session, request or device id that resets
```

## Hand-rolled session header instead of tracing\_headers

**Problem.** get\_session\_id() is the documented, familiar API, so the agent writes a fetch wrapper with X-PostHog-Session-Id and does not know tracing\_headers injects both the session and distinct id automatically.

**Impact.** Silent: only the session id travels, so server events join the browser session but split off into a different person.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('do not hand-roll a fetch wrapper', tracing\_headers paragraph)
- [`context-mill: context/commandments.yaml#astro-ssr`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #astro-hybrid
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md)
- [`context-mill: example-apps/astro-hybrid`](https://github.com/PostHog/context-mill/tree/main/example-apps/astro-hybrid) astro-ssr, tanstack-start

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#335](https://github.com/PostHog/context-mill/pull/335), [context-mill@d45736f](https://github.com/PostHog/context-mill/commit/d45736ff), [context-mill@e6532e0](https://github.com/PostHog/context-mill/commit/e6532e0d), [context-mill@0e7f287](https://github.com/PostHog/context-mill/commit/0e7f2870), [context-mill@18193f6](https://github.com/PostHog/context-mill/commit/18193f6c)

**Frameworks.** `astro`, `tanstack-start`, `nextjs`, `nuxt`, `react-router`, `javascript_web`

**Wrong:**

```typescript
const sessionId = window.posthog?.get_session_id?.() || null
await fetch('/api/events/burrito', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-PostHog-Session-Id': sessionId || '' } })
```

**Fixed:**

```typescript
posthog.init(apiKey, { api_host: apiHost, defaults: '2026-01-30',
  tracing_headers: [window.location.hostname] })
await fetch('/api/events/burrito', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
// SDK adds X-POSTHOG-SESSION-ID and X-POSTHOG-DISTINCT-ID itself
```

## Server events use a different id than the browser

**Problem.** Server SDKs require a distinctId on each call, so the agent fills it from whatever is local (username, IP, body field, email, random UUID) and never forwards the browser's distinct id and session id.

**Impact.** Silent: one user becomes two persons and server events are missing from the browser session and its replay.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) (tracing\_headers paragraph: X-POSTHOG-DISTINCT-ID and X-POSTHOG-SESSION-ID)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (attribution rules 1 and 2)
- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md)
- [`context-mill: example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts) and app/routes/api.burrito.consider.ts (the snippet shape)
- [`context-mill: example-apps/nuxt-4/server/api/burrito/consider.post.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/server/api/burrito/consider.post.ts) (explicit-header variant: distinctId from header plus $session\_id property)
- `wizard: src/lib/programs/audit/seed.ts` (cross-runtime-distinct-id)

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67), [context-mill@e512ef8](https://github.com/PostHog/context-mill/commit/e512ef8d), [PostHog/context-mill#335](https://github.com/PostHog/context-mill/pull/335), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425)

**Frameworks.** `nuxt`, `nextjs`, `astro`, `sveltekit`, `tanstack-start`, `react-router`, `express`, `django`, `fastapi`, `flask`, `laravel`

**Wrong:**

```typescript
// client identifies with user.id
fetch('/api/checkout', { method: 'POST' })
// server
posthog.capture({ distinctId: crypto.randomUUID(), event: 'checkout_completed' })
// or distinctId: username / req.ip / user.email / a body field
```

**Fixed:**

```typescript
// browser: init with tracing_headers: ['api.example.com'] adds both headers
// middleware: bind the browser's ids once per request
const sessionId = request.headers.get('X-POSTHOG-SESSION-ID')
const distinctId = request.headers.get('X-POSTHOG-DISTINCT-ID')
return posthog.withContext(
  { sessionId: sessionId ?? undefined, distinctId: distinctId ?? undefined }, next)
// route handler: no distinctId argument
posthog.capture({ event: 'burrito_considered' })
```

## Form API route keys events on submitted email

**Problem.** On a marketing site with no login, the submitted email is the only identifier in the handler, so the agent uses it (or 'anonymous', or omits distinctId) instead of reading the forwarded browser id.

**Impact.** Server events fragment across emails or pool onto one person, never join the browser person, and with no distinctId the capture fails.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) (Instrument: use the authenticated id, else a personless event, 'never fabricate a placeholder id like anonymous')
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) (tracing\_headers, stable id, not email)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (attribution rules 2 and 3)

**Sources.** [PostHog/wizard-workbench#1120](https://github.com/PostHog/wizard-workbench/pull/1120), [PostHog/wizard-workbench#4451](https://github.com/PostHog/wizard-workbench/pull/4451), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa3)

**Frameworks.** `astro`

**Wrong:**

```typescript
posthog.capture({
  distinctId: distinctId || data.email || 'anonymous',
  event: 'contact_form_received',
  properties: { name: data.name },
})
```

**Fixed:**

```typescript
const distinctId = request.headers.get('X-POSTHOG-DISTINCT-ID') ?? undefined;
const sessionId = request.headers.get('X-POSTHOG-SESSION-ID') ?? undefined;
// ids come from the browser's tracing_headers; never email, 'anonymous' or a random UUID
posthog.withContext({ distinctId, sessionId }, () =>
  posthog.capture({ event: 'contact_form_received', properties: { source: 'api' } }))
```

## Capture instrumented before identity is settled

**Problem.** Event instrumentation and identify look independent, so they run in parallel. Capture then invents its own attribution at each call site because it never saw how identity is bound.

**Impact.** Silent: some events are double-wrapped, others personless or under a guessed id, depending on ordering.

**Rule location.**

- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (frontmatter dependsOn, Goal)
- [`context-mill: context/agents/integration-v2/integrate-posthog.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/integrate-posthog.md) (seed graph)
- wizard renders handoffs into later agents' context

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@e0d688f](https://github.com/PostHog/context-mill/commit/e0d688f6d2553e15581d757ebbe6ec2e2d559280), [context-mill@881ca9f](https://github.com/PostHog/context-mill/commit/881ca9f764362c02802b037dc4ff550d44156f69), [PostHog/context-mill#27](https://github.com/PostHog/context-mill/issues/27), [PostHog/wizard#935](https://github.com/PostHog/wizard/pull/935)

**Frameworks.** `all`

**Wrong:**

```yaml
# seed graph before
identify  dependsOn: [install, init]
capture   dependsOn: [install, init]   # races identify
# capture writes bare calls or its own identify_context per call
```

**Fixed:**

```yaml
# capture.md frontmatter
dependsOn: [install, init, identify]
# read the identify handoff first: identity established -> plain capture;
# not established -> tag the call with distinct id and session id;
# identity exists but no id reaches -> DISTINCT_ID placeholder and say so
```

## Audit wrongly demands identify() on server SDKs

**Problem.** Client SDK habits make an auditor expect an identify() call, but server SDKs identify per call. The real failure is a literal or missing distinctId, which the auditor can overlook.

**Impact.** False findings push agents to add pointless server identify calls while literal 'server' ids that pool all events go unflagged.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/5-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/5-report.md) (e. Analyze identity, server branch)
- 3-enrich-subagent-prompt.md (distinct\_id\_kind)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `javascript-node`, `python`, `ruby`, `go`, `php`, `dotnet`, `elixir`

**Wrong:**

```typescript
client.capture({ distinctId: 'server', event: 'invoice_paid' })
// auditor: "FAIL: no identify() call found on server"
```

**Fixed:**

```typescript
client.capture({ distinctId: user.id, event: 'invoice_paid' })
// server SDKs identify per call: pass if most rows have distinct_id_kind == variable;
// fail when the dominant pattern is "missing" or "literal"
```

## Rails posthog\_distinct\_id returns the email

**Problem.** posthog-rails auto-detects identity from a posthog\_distinct\_id method, and its docs, the old example app and the commandment itself showed it returning user.email, so the agent copies a sanctioned-looking shape.

**Impact.** Silent: every exception and event is keyed on PII, an email change splits the person, and email-or-Integer fallbacks fragment people further.

**Rule location.**

- [`context-mill: example-apps/ruby-on-rails/app/models/user.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/app/models/user.rb) (fixed, id.to\_s) and its README (shared distinct\_id section)
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('a stable unique id ... not an email')
- `context-mill: context/agents/integration-v2/identify.md.` STALE: context/commandments.yaml#ruby-on-rails still shows posthog\_distinct\_id ->(user) { user.email } in the ActiveJob DSL bullet and should be fixed to the primary key

**Sources.** [context-mill@e6fe850](https://github.com/PostHog/context-mill/commit/e6fe8501), [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101), [PostHog/wizard-workbench#1064](https://github.com/PostHog/wizard-workbench/pull/1064)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
# app/models/user.rb
def posthog_distinct_id
  identity&.email_address || id   # email, else Integer pk
end
// frontend: posthog.identify(user.email)
```

**Fixed:**

```ruby
# The primary key, not the email: an email can change, which would split one
# person's history in two, and it is PII on every event's identity.
def posthog_distinct_id
  id.to_s
end
// frontend: posthog.identify(user.id.to_s)
```

## Rails job errors carry no user

**Problem.** posthog-rails auto-captures job failures, so the agent assumes attribution is automatic and never adds the posthog\_distinct\_id DSL to the job.

**Impact.** Silent: failed-job and exception events reach Error Tracking with no person attached.

**Rule location.**

- [`context-mill: example-apps/ruby-on-rails/app/jobs/example_job.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/app/jobs/example_job.rb)
- [`context-mill: context/commandments.yaml#ruby-on-rails`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (ActiveJob DSL bullet)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
class ExampleJob < ApplicationJob
  def perform(distinct_id, should_fail: false)
    raise 'Job failed'   # captured, but with no user attached
  end
end
```

**Fixed:**

```ruby
class ExampleJob < ApplicationJob
  posthog_distinct_id ->(distinct_id, *) { distinct_id }
  def perform(distinct_id, should_fail: false)
    raise StandardError, 'Example job failure' if should_fail
  end
end
# ExampleJob.perform_later(current_user.posthog_distinct_id)
```

## CLI generates a new id every run

**Problem.** A CLI has no login, so the agent reaches for uuid4() per call or the OS username, not realising the id must be persisted once per install.

**Impact.** Every invocation is a new person, so retention and per-user counts are meaningless. OS usernames add PII.

**Rule location.**

- [`context-mill: example-apps/python/todo.py#get_user_id`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py)
- [`context-mill: example-apps/php/todo.php#getUserId`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php)

**Sources.** [`context-mill: example-apps/python/todo.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py), [`context-mill: example-apps/php/todo.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php)

**Frameworks.** `python`, `php`

**Wrong:**

```python
posthog.capture(
    distinct_id=str(uuid.uuid4()),   # new person on every call
    event="todo_added",
)
```

**Fixed:**

```python
def get_user_id():
    """Uses a UUID stored in the data file to represent this user."""
    if DATA_FILE.exists():
        data = json.loads(DATA_FILE.read_text())
        if 'user_id' in data:
            return data['user_id']
    return f"user_{uuid.uuid4().hex[:8]}"   # persist on first save
```

## Stripe metadata gets a different id than identify

**Problem.** Stripe code already has a customer id, org id, client\_reference\_id or email in scope, and the agent assumes one of them is the PostHog distinct id instead of finding what posthog.identify() is called with. It often also never captures in the webhook.

**Impact.** Silent: revenue never joins to the person who paid, Top Customers and persons\_revenue\_analytics stay empty or wrong, and the bad metadata blocks correct identification later.

**Rule location.**

- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Tenets 1-2, 'How to find the PostHog distinct\_id' incl. the Watch out note, 'Stripe Checkout special case')
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md) (ph\_distinct\_id\_in\_stripe\_metadata, ph\_distinct\_id\_matches\_existing\_usage)

**Sources.** [PostHog/context-mill#106](https://github.com/PostHog/context-mill/pull/106), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [PostHog/wizard-workbench#1114](https://github.com/PostHog/wizard-workbench/pull/1114), [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md)

**Frameworks.** `stripe`, `nextjs`, `javascript-node`, `posthog-js`, `posthog-node`, `posthog-python`

**Wrong:**

```typescript
// app calls posthog.identify(user.email, ...)
const session = await stripe.checkout.sessions.create({
  client_reference_id: org.id,
  metadata: { posthog_person_distinct_id: user.stripeCustomerId },
})
// or: posthog_person_distinct_id: user.distinct_id || user.email
// webhook: console.log(event.type)   // no posthog.capture
```

**Fixed:**

```typescript
// find it first: posthog.identify(<first arg>, ...) is the distinct_id
// never infer it from client_reference_id (it MAY NOT be the distinct_id)
const session = await stripe.checkout.sessions.create({
  client_reference_id: distinctId,   // set so webhooks can read it
  metadata: { posthog_person_distinct_id: distinctId }, // threaded from a caller
})
// webhook (posthog-node)
posthog.capture({ distinctId, event: 'invoice_paid',
  properties: { revenue: invoice.amount_paid, currency: invoice.currency } })
```

## Placeholder distinct id written to Stripe

**Problem.** A TODO string keeps the code compiling and looks like a helpful marker, and an earlier skill version even suggested it.

**Impact.** Silent: every customer is tagged with the same fake id, nothing joins, and the missing identity is hidden.

**Rule location.**

- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Tenet 1, Tenet 2, 'How to find the PostHog distinct\_id' abort line, Step 1 skip-with-TODO bullet)
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md) (ph\_distinct\_id\_in\_stripe\_metadata)

**Sources.** [PostHog/context-mill#112](https://github.com/PostHog/context-mill/pull/112), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md)

**Frameworks.** `stripe-node`, `stripe-python`

**Wrong:**

```typescript
const customer = await stripe.customers.create({
  email,
  metadata: { posthog_person_distinct_id: 'TODO_POSTHOG_DISTINCT_ID' },
})
```

**Fixed:**

```typescript
// distinct_id not in scope: thread it from a caller as an optional parameter.
// No caller has it: skip the call site and leave a TODO comment.
// No distinct_id anywhere: [ABORT] Could not find a PostHog distinct_id
// (Tenet 1 still says a TODO_POSTHOG_DISTINCT_ID string is the fallback)
```

## Revenue setup aborts when users are never identified

**Problem.** Asked to tag Stripe customers, a generic agent invents an id mapping (often email) even though the app never calls identify, so the tag points at no real person.

**Impact.** Revenue data never joins to real persons. Wrong data, no error.

**Rule location.**

- wizard (main): src/programs/revenue-analytics/detect.ts (REVENUE\_ABORT\_CASES)
- src/agent/agent-interface.ts (\[ABORT\] detector)
- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Abort statuses)

**Sources.** [PostHog/wizard#389](https://github.com/PostHog/wizard/pull/389)

**Frameworks.** `revenue-analytics`, `javascript-node`, `python`

**Wrong:**

```javascript
stripe.customers.create({
  email,
  metadata: { posthog_distinct_id: email },   // invented, no identify() anywhere
})
```

**Fixed:**

```text
[ABORT] Could not find a PostHog distinct_id
-> "Your users must be identified in PostHog before they can be tagged in Stripe."
[ABORT] Could not find a Stripe integration
```

## Elixir context lost in spawned processes

**Problem.** PostHog.set\_context looks like request-wide state, but it is Logger metadata scoped to one BEAM process, which agents from other runtimes don't expect.

**Impact.** Silent: captures from a Task or job carry no distinct\_id or request context, and capture returns an error nobody checks.

**Rule location.**

- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (set\_context process-scoped bullet)
- [`context-mill: example-apps/elixir`](https://github.com/PostHog/context-mill/tree/main/example-apps/elixir) (explicit distinct\_id on every capture)

**Sources.** [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `elixir`, `phoenix`

**Wrong:**

```elixir
PostHog.set_context(%{distinct_id: user.id})   # plug process
Task.start(fn ->
  PostHog.capture("export_finished")           # other process: no context
end)
```

**Fixed:**

```elixir
Task.start(fn ->
  PostHog.set_context(%{distinct_id: user.id}) # set in the capturing process
  PostHog.capture("export_finished")
end)
# or pass distinct_id explicitly on the capture
```

## Spans not joined to person or replay

**Problem.** Tracing works without identity, so spans show up and look fine. Joining them needs posthogDistinctId/sessionId attributes or reading the browser's tracing headers, which generic OTel setup never does.

**Impact.** Silent: spans appear in Tracing but cannot be tied to a person or a Session Replay recording.

**Rule location.** [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Key principles, People and sessions)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391), [PostHog/context-mill#399](https://github.com/PostHog/context-mill/pull/399)

**Frameworks.** `python`, `django`, `node`, `opentelemetry`

**Wrong:**

```python
with posthog.start_span("checkout"):   # no context: no distinct id, no session id
    process_order(order)
```

**Fixed:**

```python
with posthog.new_context():
    posthog.identify_context(user_id)
    posthog.set_context_session(session_id)
    with posthog.start_span("checkout"):
        process_order(order)
# Django: contexts middleware does this per request
# OTel: set attrs from X-POSTHOG-DISTINCT-ID / X-POSTHOG-SESSION-ID headers
```

## Per-request identity on OTel Resource attributes

**Problem.** OTel examples put attributes on the Resource, so the agent places userId and threadId there, or starts the SDK inside the handler to get them in scope.

**Impact.** Silent: every request in the process shares one identity, or the SDK is re-created per request.

**Rule location.**

- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (ph\_identity\_scope\_correct, ph\_instrumentation\_initialized\_once)
- apps/ai-observability/vercel-ai/nextjs-support-chat/README.md

**Sources.** [`wizard-workbench: apps/ai-observability/vercel-ai/nextjs-support-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/vercel-ai/nextjs-support-chat/README.md), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358)

**Frameworks.** `vercel-ai`, `nextjs`, `opentelemetry`

**Wrong:**

```typescript
// inside POST /api/chat
new NodeSDK({ resource: resourceFromAttributes({
  'posthog.distinct_id': userId, '$ai_session_id': threadId,
}) }).start()
```

**Fixed:**

```typescript
// instrumentation.ts: PostHogSpanProcessor started once, no identity on the Resource
// route handler: identity per request
generateText({ model, prompt,
  experimental_telemetry: { isEnabled: true,
    metadata: { posthog_distinct_id: userId, $ai_session_id: threadId } } })
```

## Hardcoded user id on LLM events

**Problem.** The skill's own manual-capture example hardcoded distinct\_id='user\_123', and agents copy it when no user is in scope.

**Impact.** Silent: every generation attributes to one fake person, corrupting person-level LLM analytics.

**Rule location.** [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (Attach identity to every call)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `all`

**Wrong:**

```python
posthog.capture(
    distinct_id='user_123',
    event='$ai_generation',
    properties={'$ai_model': 'gpt-4', '$ai_provider': 'openai'},
)
```

**Fixed:**

```text
| posthog_distinct_id | the user | the person |

If the app has no user id, leave `posthog_distinct_id` out.
Anonymous is a finding for the report. Do not invent an id.
```

## Invented ids for MCP tool calls

**Problem.** Stateless MCP transports have no obvious user in scope, so the agent fills distinctId with a constant and sessionId with a fresh UUID to satisfy the call.

**Impact.** Silent: every call goes to one fake person, or each call becomes a new session, so per-user MCP analytics are wrong.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 4, Path B identify block, Path C 'omit them rather than inventing values')

**Sources.** [PostHog/context-mill#202](https://github.com/PostHog/context-mill/pull/202)

**Frameworks.** `mcp-handler`, `mcp`, `custom-http`

**Wrong:**

```typescript
posthog.captureToolCall({
  toolName: request.params.name,
  distinctId: 'anonymous',
  sessionId: crypto.randomUUID(),   // new session every call
})
```

**Fixed:**

```typescript
// Path B, stateless mcp-handler: group calls by user
instrument(server, posthog, {
  identify: async (request, extra) => {
    const token = getRequestHeaders(extra)?.["authorization"]
    return token ? { distinctId: await resolveUserId(token) } : null
  },
})
// Path C custom dispatcher: resolve from existing auth/session; omit rather than invent
```

## Stripe person link only on Customer creation

**Problem.** Adding metadata to Customer.create looks like it links the person everywhere. Revenue rows come from PaymentIntents, Subscriptions, Invoices and webhook-created customers, which are separate objects.

**Impact.** Silent. Revenue created through the untouched objects has no person link, so most revenue never joins.

**Rule location.** [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Step 2 REQUIRED, Stripe Checkout special case)

**Sources.** [PostHog/context-mill#106](https://github.com/PostHog/context-mill/pull/106), [PostHog/wizard-workbench#1114](https://github.com/PostHog/wizard-workbench/pull/1114)

**Frameworks.** `stripe-node`, `stripe-python`

**Wrong:**

```python
customer = stripe.Customer.create(email=email,
    metadata={'posthog_person_distinct_id': distinct_id})
intent = stripe.PaymentIntent.create(amount=amount, currency='usd', customer=customer.id)
sub = stripe.Subscription.create(customer=customer.id, items=items)
```

**Fixed:**

```python
meta = {'posthog_person_distinct_id': distinct_id}
intent = stripe.PaymentIntent.create(amount=amount, currency='usd',
    customer=customer.id, metadata=meta)
sub = stripe.Subscription.create(customer=customer.id, items=items, metadata=meta)
```
