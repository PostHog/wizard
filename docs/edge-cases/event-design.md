# Events that mislead analysis

38 cases. Part of the [edge case catalogue](../edge-cases.md).

## First PR instruments every possible event

**Problem.** The agent finds many valuable events and adds them all, since more coverage looks better.

**Impact.** A first integration PR that touches everything is hard to review, and the event plan only keeps 50 events.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) (paragraph 'Around ten to fifteen is a rough guide')
- `wizard: src/lib/task-stream/event-plan-watcher.ts` (MAX\_EVENT\_COUNT 50)

**Sources.** [context-mill@4431889](https://github.com/PostHog/context-mill/commit/44318898)

**Frameworks.** `all`

**Wrong:**

```text
45 capture() calls across 30 files in the first integration diff,
no list of what was left out
```

**Fixed:**

```text
Around ten to fifteen events is a rough guide, not a quota.
More than fifteen valuable events is fine, but do not put them
all in this run. Instrument the core set now, and record the rest
as suggestions for the setup report.
```

## Dashboard insights use guessed event names

**Problem.** The agent writing insights picks plausible names ('Signup Completed') from memory instead of the exact strings the capture step sent, and nothing errors when an insight filters on an event that never fires.

**Impact.** Silent: funnels and trends stay empty forever because the names never match what the code sends.

**Rule location.**

- [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md) (opening paragraph)
- [`context-mill: context/agents/integration-v2/dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/dashboard.md) (frontmatter dependsOn: \[capture\])

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md), [`context-mill: context/agents/integration-v2/dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/dashboard.md)

**Frameworks.** `all`

**Wrong:**

```json
"series": [
  { "kind": "EventsNode", "event": "Signup Completed" },
  { "kind": "EventsNode", "event": "checkout_done" }
]
// code actually sends user_signed_up / order_placed
```

**Fixed:**

```text
# dashboard.md frontmatter: dependsOn: [capture]
# insight skill: "Use the exact event names from the capture step's handoff;
# never invent events that were not instrumented."
"series": [{ "kind": "EventsNode", "event": "user_signed_up" }]
```

## Cleanup pass renames events the dashboard uses

**Problem.** A reviewer tidying code treats event names and properties as ordinary identifiers it can 'improve', not as a contract that a dashboard and report were already built on.

**Impact.** Silent: insights filtering on the old name go empty after the rename.

**Rule location.** [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (lines ~60-62)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@4431889](https://github.com/PostHog/context-mill/commit/44318898)

**Frameworks.** `all`

**Wrong:**

```diff
- posthog.capture('subscription_change_requested', { plan_tier: tier })
+ posthog.capture('plan_changed', { tier })   // 'cleaner'; dashboard filters the old name
```

**Fixed:**

```text
You never change what is captured — event names, properties, and where events fire
are a contract the dashboard and report are built on. Refactor how, and kill bad
changes; never alter the what.
```

## Planned events invisible in headless runs

**Problem.** The agent writes its event plan to a file, but only the interactive TUI read it. Headless and cloud runs dropped the plan with no error.

**Impact.** Custom events from the wizard did not appear in PostHog until real traffic arrived.

**Rule location.**

- `wizard: src/lib/task-stream/event-plan-watcher.ts` (MAX\_EVENT\_COUNT 50, MAX\_EVENT\_NAME\_LENGTH 400)
- src/lib/programs/posthog-integration/index.ts:204 (eventPlanFile)

**Sources.** [PostHog/wizard#891](https://github.com/PostHog/wizard/pull/891)

**Frameworks.** `all`

**Wrong:**

```text
// agent writes .posthog-events.json: [{"event_name": "todo_created", ...}]
// headless run: nothing reads it -> no event definitions until the first real event
```

**Fixed:**

```ts
eventPlanFile: EVENT_PLAN_FILE,   // posthog-integration program
// shared runner watcher: first valid non-empty plan captured, bounded final
// refresh before the terminal session push; <=50 events, name <=400 chars
```

## User actions captured from effects or render

**Problem.** Watching state in a useEffect (or calling capture in the component body) is a common React habit and the quickest way to bolt tracking on without touching handlers. The duplicate fires from StrictMode, re-renders and restored state are silent.

**Impact.** Silent over-counting: events fire on mount, on reload for a restored user, on re-render and twice under StrictMode, so page loads are logged as logins and some events have no user action behind them.

**Rule location.**

- [`context-mill: context/commandments.yaml#react`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Add analytics capture in event handlers where user actions occur, NOT in useEffect reacting to state changes')
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('Avoid effect-driven inference for user actions')
- [`context-mill: example-apps/next-app-router/src/app/burrito/page.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/app/burrito/page.tsx) (capture inside handleConsideration)

**Sources.** [context-mill@4ac58f5](https://github.com/PostHog/context-mill/commit/4ac58f5a), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#388](https://github.com/PostHog/context-mill/pull/388), [PostHog/wizard#94](https://github.com/PostHog/wizard/pull/94), [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Frameworks.** `react`, `nextjs`, `react-vite`, `react-router`, `react-router-7`, `tanstack-router`, `vue`

**Wrong:**

```tsx
useEffect(() => {
  if (user) {
    posthog.identify(user.username)
    posthog.capture('user_logged_in')   // every mount, refresh, StrictMode run
  }
}, [user])
```

**Fixed:**

```tsx
const success = await login(username, password)   // submit handler
if (success) {
  posthog.identify(username, { name: username })
  posthog.capture('user_logged_in')
}
```

## Client-side route changes send no pageviews

**Problem.** A plain posthog.init looks complete because the first load produces a $pageview. The agent never tests a soft navigation, and older docs taught a hand-rolled PostHogPageView component.

**Impact.** Silent: only the first hard load generates a $pageview. Later router or View Transition navigations are lost.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro-view-transitions`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ("Set capture\_pageview option to 'history\_change' ... during soft navigation")
- also #javascript\_web (SPAs without a router: capture\_pageview history\_change)

**Sources.** [PostHog/wizard-workbench#4379](https://github.com/PostHog/wizard-workbench/pull/4379), [PostHog/wizard#50](https://github.com/PostHog/wizard/pull/50), [PostHog/wizard#73](https://github.com/PostHog/wizard/pull/73)

**Frameworks.** `javascript_web`, `astro`, `nextjs`, `react-router`, `vue`

**Wrong:**

```javascript
posthog.init(token, { api_host: host })
// router push / View Transitions produce no $pageview
```

**Fixed:**

```javascript
posthog.init(token, {
  api_host: host,
  capture_pageview: 'history_change',   // or defaults: '2026-01-30'
})
```

## Manual pageview on top of automatic pageviews

**Problem.** Older docs and training data show a PostHogPageView component or a $pageview effect on route change. The agent copies it without noticing that defaults already turn on history\_change pageviews.

**Impact.** Silent: every navigation counts twice, inflating traffic, funnels and paths.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) ('Track actions, not pageviews, wherever this SDK autocaptures them')
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md) ('Track actions only, not pageviews')
- `wizard: git` history of src/nextjs/docs.ts (commits aed8bf19, 815538db)
- planned audit check event-double-capture (context-mill issue 407, open)

**Sources.** [PostHog/wizard#50](https://github.com/PostHog/wizard/pull/50), [PostHog/wizard#73](https://github.com/PostHog/wizard/pull/73), [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`, `sveltekit`, `astro`

**Wrong:**

```tsx
posthog.init(token, { api_host: host, defaults: '2025-05-24' })
useEffect(() => {
  posthog.capture('$pageview')   // history_change already captures this
}, [pathname])
```

**Fixed:**

```tsx
posthog.init(token, { api_host: host, defaults: '2025-05-24' })
// history_change pageviews; no PostHogPageView component, no manual $pageview
// capture actions only
posthog.capture('invite_sent', { role })
```

## Custom page\_viewed events on mount

**Problem.** 'Track key screens' reads to an agent like 'add a viewed event per page'. It does not know PostHog already captures pageviews.

**Impact.** Duplicates automatic pageviews and floods the project with noise events instead of user actions.

**Rule location.**

- [`context-mill: context/skills/omnibus/instrument-product-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-product-analytics/description.md) (STEP 5, Plan event tracking)
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md)

**Sources.** [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `react`, `nextjs`, `all web`

**Wrong:**

```tsx
useEffect(() => {
  posthog.capture('checkout_page_viewed', { path: location.pathname })
}, [location.pathname])
```

**Fixed:**

```tsx
// track actions only; pageviews are automatic
// (exception: a 'viewed' event at the top of a conversion funnel)
<button onClick={() => posthog.capture('checkout_submitted', { cart_size })}>
```

## Events captured with no properties

**Problem.** capture('invoice\_created') is the shortest call that works, the docs' first example has no properties, and it passes every check that only looks for capture calls. The agent does not think about how the event will be broken down later.

**Impact.** Silent: events can only be counted, never segmented, filtered or broken down.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line ~63, 'track an event with contextual properties')
- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) ('useful properties')
- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md)

**Sources.** [PostHog/wizard-workbench#4282](https://github.com/PostHog/wizard-workbench/pull/4282), [PostHog/wizard-workbench#4339](https://github.com/PostHog/wizard-workbench/pull/4339), [PostHog/wizard-workbench#2964](https://github.com/PostHog/wizard-workbench/pull/2964), [PostHog/wizard-workbench#4457](https://github.com/PostHog/wizard-workbench/pull/4457), [PostHog/wizard-workbench#4440](https://github.com/PostHog/wizard-workbench/pull/4440), [PostHog/wizard-workbench#4221](https://github.com/PostHog/wizard-workbench/pull/4221), [PostHog/wizard-workbench#4366](https://github.com/PostHog/wizard-workbench/pull/4366), [PostHog/wizard-workbench#4409](https://github.com/PostHog/wizard-workbench/pull/4409), [PostHog/wizard-workbench#4410](https://github.com/PostHog/wizard-workbench/pull/4410)

**Frameworks.** `android`, `angular`, `javascript_node`, `nextjs`, `tanstack-router`

**Wrong:**

```kotlin
PostHog.capture("user_logged_in")
PostHog.capture("message_sent")
PostHog.capture("chat_selected")
```

**Fixed:**

```javascript
posthog.capture({
  distinctId: req.userId,
  event: 'todo_created',
  properties: { todo_count: todos.length, has_due_date: Boolean(todo.dueDate) },
})
```

## Filler events invented to hit a count

**Problem.** Told to pick 10 to 15 events, the agent treats the range as a quota and pads a small app with actions nobody performs, or instruments everything in one huge first PR.

**Impact.** Silent: noise in every insight built on those events. Oversized first PRs are hard to review.

**Rule location.** [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) (Choose and record)

**Sources.** [context-mill@7f88084](https://github.com/PostHog/context-mill/commit/7f8808404cc31e65a80e73136f271baf828d6e91), [context-mill@4431889](https://github.com/PostHog/context-mill/commit/443188982a5f624e98bd15a847dc909b09120825), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`

**Wrong:**

```ts
// app has 4 meaningful actions; instructions said "10-15 events"
posthog.capture('settings_opened')
posthog.capture('sidebar_toggled')
posthog.capture('footer_link_clicked')   // invented to reach 10
```

**Fixed:**

```text
Around ten to fifteen is a rough guide, not a quota. Fewer is right when a small
project has only a few actions that matter — instrument those and stop; never
invent an event to reach a number, since an event nobody performs is noise in
every insight built on it. More than fifteen genuinely valuable events (auth,
payment, and the like) is also fine, but do not put them all in this run — a
first integration PR that touches everything is hard to review. Instrument the
core set now, and record the rest as suggestions for the setup report.
```

## New event names ignore the project's existing ones

**Problem.** The agent applies its own naming habit (Title Case, PascalCase, camelCase or its preferred snake\_case verb) without scanning for capture calls already in the repo, so it adds twins for actions already tracked. Splitting a metric across two names never fails a build.

**Impact.** Silent: funnels and retention split across near-duplicate events, and existing dashboards and insights miss the new data.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) ("analytics contract: reuse the existing names")
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md)
- [`context-mill: context/skills/omnibus/instrument-integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-integration/description.md) (Analytics contract)
- `wizard: src/lib/agent/commandments.ts`
- src/lib/agent/runner/harness/pi/runtime-notes.ts (SNAKE\_CASE)
- src/rules-stubs/universal.md (Naming)

**Sources.** [context-mill@9476dae](https://github.com/PostHog/context-mill/commit/9476dae5), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306)

**Frameworks.** `all`

**Wrong:**

```ts
// existing: analytics.track('Sign Up Completed', { plan })
posthog.capture('user_signed_up', { plan })   // twin, same action
posthog.capture('UserSignedUp', { 'Plan Type': plan })
```

**Fixed:**

```ts
// First scan for capture calls the project already makes, note how names are
// formatted: "reuse the existing names ... don't duplicate events that already exist"
posthog.capture('Sign Up Completed', { plan })   // existing name reused, no twin
// greenfield only: snake_case, never spaces (todo_created)
```

## Audit migrates a consistent naming convention

**Problem.** Asked to improve naming, the agent recommends renaming everything to PostHog's snake\_case even when the project is already coherent.

**Impact.** Historical continuity breaks and saved insights stop matching the renamed events.

**Rule location.** [`context-mill: context/skills/audit-events/references/2-events-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-events/references/2-events-fix.md) (Task B event-naming-standardization, step 3)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `all`

**Wrong:**

```diff
- posthog.capture('Added To Cart')
+ posthog.capture('cart_item_added')   // 40 events renamed, project was 90% consistent
```

**Fixed:**

```text
If 80%+ of names share a pattern, the project HAS a convention.
If it is somewhat compliant with PostHog's AND own compliance is >=80%,
recommend sticking with their convention and tightening to 100%. Don't force a migration.
If incompatible OR own compliance <80%, recommend migrating toward PostHog's standard.
```

## Event names built from variables

**Problem.** Interpolating an id or label into the name feels expressive, DRY and type-checks fine. Nothing warns that each distinct string becomes its own event definition.

**Impact.** Silent: unbounded event and property definitions that cannot be charted, funneled or cleaned up, and audits cannot resolve what is captured.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md) ('Never generate event names or property keys dynamically', error)
- [`context-mill: context/skills/audit/references/4-event-capture.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/4-event-capture.md) and audit-events/references/2-events-fix.md (Task A capture-event-names-static)
- `wizard: src/lib/programs/audit/seed.ts` (capture-event-names-static)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314), [PostHog/wizard#736](https://github.com/PostHog/wizard/issues/736)

**Frameworks.** `all`

**Wrong:**

```ts
posthog.capture(`clicked_${button.id}`, {
  [`${field}_value`]: value,
})
posthog.capture('plan_selected', { [`plan_${id}`]: true })
```

**Fixed:**

```ts
posthog.capture('button_clicked', {
  button_id: button.id,
  field_name: field,
  value,
})
// "Never generate event names or property keys dynamically. Put variable data in property values."
```

## Payment, webhook and auth events only in the browser

**Problem.** The agent follows the client SDK quickstart and instruments UI handlers. API routes, webhooks and Server Actions have no visible button, so it never opens them.

**Impact.** Silent: business-critical events such as payments and signups are lost to ad blockers, closed tabs, and flows that never touch the browser.

**Rule location.**

- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md) ('Server-side events are REQUIRED')
- [`context-mill: context/skills/omnibus/instrument-product-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-product-analytics/description.md) (STEP 5)
- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) ('Server-side events matter most')
- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (flush rules)

**Sources.** [context-mill@d6a7a18](https://github.com/PostHog/context-mill/commit/d6a7a18f), [context-mill@6e3c882](https://github.com/PostHog/context-mill/commit/6e3c882a), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314)

**Frameworks.** `nextjs`, `javascript_node`, `express`, `django`, `laravel`, `fastapi`, `nuxt`, `sveltekit`, `astro`

**Wrong:**

```ts
// Checkout.tsx
posthog.capture('checkout_clicked')
// app/api/webhooks/stripe/route.ts -> no PostHog call at all
```

**Fixed:**

```ts
// payment webhook handler
const posthog = getPostHogClient()   // posthog-node
posthog.capture({ distinctId: userId, event: 'payment_succeeded',
  properties: { plan } })
await posthog.flush() // shared client in a per-request handler
```

## Same milestone captured in browser and API

**Problem.** Being thorough, or after being told to add server-side events, the agent captures in the API route without removing the browser capture for the same action. Nothing errors when the conversion counts twice.

**Impact.** Silent: each conversion counts twice and may split across two person profiles.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md) (warning rules)
- [`context-mill: context/skills/events-audit/references/5-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/5-report.md) (Overview panel 7, duplicate captures)

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407)

**Frameworks.** `javascript_web`, `javascript_node`, `python`, `nextjs`, `all`

**Wrong:**

```ts
// checkout.tsx
posthog.capture('purchase_completed', { total })
// api/checkout.ts
client.capture({ distinctId: 'server', event: 'purchase_completed' })
```

**Fixed:**

```ts
// accuracy-critical milestone: capture once, on the backend
posthogServer.capture({ distinctId: id, event: 'purchase_completed' })
// client keeps UI journey events only
posthog.capture('checkout_form_viewed')
// audit: "fires from posthog-js at file:line and posthog-node at file:line, risks 2x counting"
```

## Same number sent as number and string

**Problem.** Webhook payloads and form values arrive as strings, and the agent passes them straight through at one site while another sends numbers. Nothing fails at capture time.

**Impact.** Silent: sum and average aggregates drop or zero the string rows.

**Rule location.** [`context-mill: context/skills/events-audit/references/5-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/5-report.md) (Overview panel 5 'Type drift', line ~117)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```js
posthog.capture('purchase', { revenue: 49.99 })    // cart.ts
posthog.capture('purchase', { revenue: '49.99' })  // webhook.ts
```

**Fixed:**

```js
posthog.capture('purchase', { revenue: Number(payload.amount) })
// audit type-drift bullet format:
// "revenue — number at cart.ts:41, string at webhook.ts:12 — silently zeros aggregates"
// checked keys: revenue, amount, price, count, duration_*, quantity
```

## Signup and purchase left to autocapture

**Problem.** Asked to add analytics, the agent instruments visible UI clicks or leans on autocapture, assuming it covers the main journey. The missing signup, activation and purchase events fail silently.

**Impact.** Silent: funnels and retention have no business milestones to anchor on, and autocapture dominates billing volume.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/product-analytics.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/product-analytics.md)
- [`context-mill: context/skills/audit/references/4-event-capture.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/4-event-capture.md) (Task C, capture-growth-events)
- [`wizard: src/programs/audit/seed.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/audit/seed.ts)

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425)

**Frameworks.** `all`

**Wrong:**

```ts
async function handleSubscribe() {
  await api.subscribe(plan)   // no capture; relies on $autocapture click
}
posthog.capture('button_clicked', { id: 'nav-pricing' })
```

**Fixed:**

```ts
posthog.capture('user_signed_up', { signup_method: 'email' })
posthog.capture('project_created')              // activation
async function handleSubscribe() {
  await api.subscribe(plan)
  posthog.capture('subscription_started', { plan })
}
```

## Captures on repository and service methods

**Problem.** In layered backends like ASP.NET the agent instruments every method it touches, mirroring code structure instead of user actions.

**Impact.** Noisy, high-volume events and duplicated counts that drown the real funnel steps.

**Rule location.** [`context-mill: context/commandments.yaml#aspnetcore`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('route, controller, or handler boundaries ... do not track every low-level method call')

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145)

**Frameworks.** `aspnetcore`, `dotnet`

**Wrong:**

```csharp
public Order Save(Order o)
{
    _posthog.Capture(userId, "repository_save_called");
    return _db.Save(o);
}
```

**Fixed:**

```csharp
[HttpPost("orders")]
public async Task<IActionResult> Create(OrderDto dto)
{
    var order = await _orders.CreateAsync(dto);
    _posthog.Capture(userId, "order_created", new() { ["total"] = order.Total });
    return Ok(order);
}
```

## Pageleave capture off or missing in SPAs

**Problem.** capture\_pageleave looks like an optional extra, and an agent may leave it off or explicitly set false. For SPAs, route changes do not fire pageleave unless history-based pageview capture is on. The cost to bounce rate and session duration is invisible in code.

**Impact.** Silent. Bounce rate and session duration under-report for that domain (doctor Check 3 flags a low $pageleave to $pageview ratio per host).

**Rule location.**

- [`context-mill: context/skills/web-analytics/references/remediation.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/remediation.md) (### pageleave\_coverage, line 23-37)
- detection in checks.md (Checks 3 & 4)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `posthog-js`, `nextjs`, `react`

**Wrong:**

```ts
posthog.init(token, { api_host, capture_pageleave: false })
```

**Fixed:**

```ts
posthog.init(token, {
  api_host,
  capture_pageleave: true,
  capture_pageview: 'history_change', // SPA: fire on route changes
})
// remediation.md says: change only this option, don't touch unrelated init config
```

## Same page tracked under several hosts

**Problem.** The agent installs the snippet on every domain it finds and does not check whether the same path renders under multiple $host values (marketing site and app subdomain, www and apex, proxy).

**Impact.** Silent. One path's analytics split across $host values, for example /pricing under two hosts, so per-page numbers are halved.

**Rule location.** [`context-mill: context/skills/web-analytics/references/checks.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/checks.md) (Check 5, line 131) and remediation.md (duplicate\_canonical\_urls row, manual)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `posthog-js`, `all web`

**Wrong:**

```text
// same snippet on www.example.com and example.com, no canonical/redirect
// /pricing -> $host 'www.example.com' and $host 'example.com'
```

**Fixed:**

```text
# Check 5 (Info), fix type manual, no automatic code change:
# report the path and its hosts, recommend reviewing $current_url/$host
# capture, reverse proxy and canonicalization across all domains
```

## Ad click ids never captured

**Problem.** PostHog auto-captures UTM parameters, so the agent assumes attribution is covered. gclid, fbclid and msclkid are not captured automatically.

**Impact.** Conversion APIs and ROAS measurement cannot credit specific ad clicks.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/2-attribution-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/2-attribution-fix.md) (Task D, attribution-custom-click-ids, line 155, fires only when paid-acquisition signals are detected)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `react`, `nextjs`

**Wrong:**

```ts
// site loads gtag() / fbq(); PostHog only auto-captures utm_*
posthog.init(KEY, { api_host: HOST })
```

**Fixed:**

```ts
const p = new URLSearchParams(location.search)
const ids = Object.fromEntries(
  ['gclid', 'fbclid', 'msclkid'].map(k => [k, p.get(k)]).filter(([, v]) => v)
)
if (Object.keys(ids).length) {
  posthog.setPersonProperties({}, ids)   // set-once, on landing
}
```

## Conversion events carry no attribution

**Problem.** Person-level $initial\_utm\_\* properties exist, so the agent assumes conversions are attributed. The event itself carries none of those values.

**Impact.** Event insights cannot slice signups or purchases by utm\_campaign or referring domain at event time. Only a person-property breakdown works, losing event-time fidelity.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/2-attribution-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/2-attribution-fix.md) (Task E, attribution-on-conversion-events, line 196)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `all`

**Wrong:**

```ts
posthog.capture('signed_up', { plan })
```

**Fixed:**

```ts
const a = getAttribution()   // utm_*, gclid, referrer read at landing
posthog.capture('signed_up', {
  plan,
  utm_source: a.utm_source,
  utm_campaign: a.utm_campaign,
  gclid: a.gclid,
})
```

## Metrics tagged with user IDs or raw URLs

**Problem.** The agent treats metrics like events and attaches user ids, emails and full URLs for detail, not knowing each distinct attribute combination is a new series and there is a per-flush cap.

**Impact.** Series explode and hit the per-flush series cap. Per-user data and PII leak into metric series.

**Rule location.**

- [`context-mill: context/skills/metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/metrics/description.md) (lines 29-30: Low cardinality only, No per-user context)
- [`context-mill: context/skills/omnibus/instrument-metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-metrics/description.md) (STEP 5 line 32, Low cardinality line 59, no email/URL/cap wording)

**Sources.** [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342), [PostHog/context-mill#255](https://github.com/PostHog/context-mill/pull/255)

**Frameworks.** `python`, `javascript_node`, `javascript_web`

**Wrong:**

```python
posthog.metrics.count("http.requests", 1, attributes={
    "user_id": current_user.id,
    "email": current_user.email,
    "url": request.url,          # /orders/8841?token=...
})
```

**Fixed:**

```python
posthog.metrics.count("http.requests", 1, attributes={
    "route": request.url_rule.rule,   # route pattern, bounded
    "status_class": "2xx",
})
# bounded sets only; 'which user did X' is capture(), not a metric
```

## Metrics hand-added to every route

**Problem.** Adding a count call next to each handler is the most local change, so the agent repeats it per route with ad hoc names.

**Impact.** Inconsistent metric names and gaps. Every new route needs its own call.

**Rule location.** [`context-mill: context/skills/metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/metrics/description.md) (Where to instrument, item 1, closing line 'Prefer a few well-placed metrics at choke points'). context/agents/metrics/instrument-metrics.md only delegates placement to this skill

**Sources.** [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342), [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355)

**Frameworks.** `python`, `javascript_node`

**Wrong:**

```python
@app.get("/orders")
def list_orders():
    posthog.metrics.count("orders.list.requests")
@app.post("/orders")
def create_order():
    posthog.metrics.count("orders.create.requests")
```

**Fixed:**

```python
@app.after_request
def record(resp):
    posthog.metrics.count("http.requests", attributes={"route": request.url_rule.rule})
    posthog.metrics.histogram("http.request.duration", elapsed_ms, unit="ms")
    return resp
```

## Ids in span names and spans everywhere

**Problem.** Interpolating the real path makes a span look precise, and wrapping every function feels thorough. Neither error shows until the Tracing UI fails to group.

**Impact.** Every request gets its own span name, so operations do not aggregate, and noise swamps the real choke points.

**Rule location.** [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Where to instrument, items 1-3 and closing line, Key principles, 'Span names' bullet)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391), [PostHog/context-mill#399](https://github.com/PostHog/context-mill/pull/399)

**Frameworks.** `all`

**Wrong:**

```python
with posthog.start_span(f"GET /users/{user_id}"):
    return load_user(user_id)
# plus a hand-written span around every function and route
```

**Fixed:**

```python
with posthog.start_span("GET /users/:id"):   # values go in attributes
    return load_user(user_id)
# one server span per request in middleware; outbound calls and jobs at choke points
```

## Outbound calls drop the traceparent header

**Problem.** Each service traces fine when tested alone. Trace propagation only matters across services, which a single-repo agent rarely runs.

**Impact.** Silent. Downstream spans start new traces instead of joining one.

**Rule location.** [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Key principles, 'Context propagation' bullet)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391)

**Frameworks.** `all`

**Wrong:**

```ts
await fetch('http://billing/charge', { method: 'POST', body })   // no traceparent
```

**Fixed:**

```ts
await fetch('http://billing/charge', {
  method: 'POST', body,
  headers: { traceparent },   // W3C header, so spans join one trace
})
```

## Demo events seeded with no cleanup marker

**Problem.** To give an empty project something to show, an agent sends sample events with real-looking ids and the current time. It does not know PostHog events are immutable and cannot be removed later.

**Impact.** Fake funnel data mixes with real analytics forever and cannot be filtered out. Self-hosted hosts may not ingest it at all.

**Rule location.**

- wizard main: src/tui/tools/mcp/services/seed-events.ts (buildSeedEvents, seedDemoEvents)
- src/tui/tools/mcp/services/mcp-project-profile.ts (isKnownCloudHost)
- gate used in src/tui/tools/mcp/screens/McpSuggestedPromptsScreen.tsx

**Sources.** [PostHog/wizard#600](https://github.com/PostHog/wizard/pull/600)

**Frameworks.** `all`

**Wrong:**

```ts
for (let i = 0; i < 12; i++)
  client.capture({ distinctId: `user${i}`, event: 'signed_up' })   // now, no marker
```

**Fixed:**

```ts
{ event: 'signed_up',
  distinctId: `wizard-demo-user-${i + 1}`,
  timestamp: at(now, daysAgo, hour),          // backdated within 7 days
  properties: { ...properties, wizard_seed: true } }
// offered only for an empty project when isKnownCloudHost(apiHost); $exception not seeded
```

## New trace id minted for every model call

**Problem.** The wrapper works without posthog\_trace\_id, so the agent leaves it out or mints uuid4() inline per call. The SDK then gives each generation its own trace and the split traces look fine one at a time.

**Impact.** Silent: one user turn splits into several single-generation traces, the tool-use turn has no depth, and the AI Observability tree never forms while the diff looks right.

**Rule location.**

- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md) ('Cardinality is what gets graded')
- references/3-instrument.md ('Attach identity to every call')
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (ph\_trace\_groups\_the\_request)
- apps/ai-observability/README.md

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/context-mill#403](https://github.com/PostHog/context-mill/pull/403), [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/README.md)

**Frameworks.** `openai`, `anthropic`, `groq`, `gemini`, `python`, `javascript_node`

**Wrong:**

```python
r1 = client.messages.create(**req1, posthog_distinct_id=uid)    # tool_use call
r2 = client.messages.create(**req2, posthog_distinct_id=uid)    # final answer: new trace
client.chat.completions.create(model=m, messages=msgs, posthog_distinct_id=uid,
    posthog_trace_id=str(uuid.uuid4()))                         # new per call
```

**Fixed:**

```python
trace_id = str(uuid.uuid4())   # one per turn
r1 = client.messages.create(**req1, posthog_distinct_id=uid,
    posthog_trace_id=trace_id, posthog_properties=props)
r2 = client.messages.create(**req2, posthog_distinct_id=uid,
    posthog_trace_id=trace_id, posthog_properties=props)
```

## AI session id minted per call or skipped

**Problem.** The agent reaches for uuid4() wherever an id is needed, or skips $ai\_session\_id when the app has no conversation field. Both look reasonable and neither errors.

**Impact.** Silent: every trace gets its own session, which groups nothing and is worse than omitting it.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) ('Cardinality is what gets graded', 'Do not mint a session id per call or per turn')
- references/1-begin.md (Conversation fact)
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (ph\_session\_cardinality\_correct)

**Sources.** [`wizard-workbench: apps/ai-observability/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/README.md), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `anthropic`, `openai`, `groq`, `python`, `javascript_node`

**Wrong:**

```python
props = {"$ai_session_id": str(uuid.uuid4())}   # new id every ask()
```

**Fixed:**

```python
session_id = thread_id or RUN_SESSION_ID   # one per conversation, never skipped
props = {"$ai_session_id": session_id}
# no conversation field: the process run is the session; never skip the step
```

## AI session id under a misspelled key

**Problem.** Keys like session\_id or ai\_session\_id look plausible and ingest drops them silently.

**Impact.** Silent: no session grouping at all.

**Rule location.**

- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (ph\_session\_id\_correct\_key)
- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (shows the literal $ai\_session\_id key in posthog\_properties)

**Sources.** [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md)

**Frameworks.** `openai`, `anthropic`, `python`, `javascript_node`

**Wrong:**

```python
posthog_properties={'session_id': thread_id}            # dropped by ingest
posthog_properties={'ai_session_id': thread_id}         # dropped by ingest
```

**Fixed:**

```python
posthog_properties={'$ai_session_id': conversation.thread_id}   # literal key, one id per conversation
```

## OTel session id set on the resource

**Problem.** A conversation id seems like a resource-level attribute, so the agent sets it once. PostHog's filter reads only span attributes, and a $-prefixed key does not satisfy it alone.

**Impact.** Silent. Conversations do not group in AI Observability.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (OpenTelemetry variants paragraph, the $ai\_session\_id bullet)
- 3-instrument.md (Capture tool calls as spans, OTel paragraph)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `go`, `opentelemetry`

**Wrong:**

```go
res := resource.NewWithAttributes(semconv.SchemaURL,
    attribute.String("$ai_session_id", sessionID))
// spans carry no session attribute
```

**Fixed:**

```go
// on EVERY span in the conversation; span attributes only
span.SetAttributes(
    attribute.String("$ai_session_id", sessionID),
    attribute.String("gen_ai.operation.name", "chat"), // turn span must pass the gen_ai./ai. filter
)
// carry posthog.distinct_id as the install doc shows; one trace per turn
```

## LLM tool calls never captured as spans

**Problem.** The agent instruments the model call and assumes an OTel instrumentor covers tools. Vendor instrumentors patch only SDK methods and record tool use as attributes, never child spans.

**Impact.** Silent. Traces show generations with no tool spans, so there is no depth under each turn.

**Rule location.** [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (Capture tool calls as spans, on OpenTelemetry variants the tool run is a child span with gen\_ai.\* attributes instead)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `openai`, `anthropic`, `python`, `node`

**Wrong:**

```python
for call in reply.tool_calls:
    result = TOOLS[call.function.name](**json.loads(call.function.arguments))
    # nothing records the tool run
```

**Fixed:**

```python
for call in reply.tool_calls:
    result = TOOLS[call.function.name](**json.loads(call.function.arguments))
    posthog.capture(distinct_id=user_id, event='$ai_span', properties={
        '$ai_trace_id': trace_id,   # the turn's trace, so the span joins it
        '$ai_span_name': call.function.name,
    })
```

## Fabricated or duplicate LLM spans

**Problem.** To get a richer trace tree, or once told to capture tool spans, the agent wraps helpers in manual spans everywhere, including apps with no tools and frameworks that already emit tool spans themselves.

**Impact.** Fabricated or duplicated spans clutter the trace tree, misreport what the app does, and app code is edited needlessly.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (Capture tool calls as spans, Do not list: 'Do not add spans when the app registers no tools')
- [`wizard-workbench: apps/ai-observability/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/README.md) (Conventions)
- services/pr-evaluator/prompts/evaluation-ai-observability.md (ph\_no\_hand\_authored\_spans)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [`wizard-workbench: apps/ai-observability/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/README.md)

**Frameworks.** `openai`, `anthropic`, `google-adk`, `openai-agents`, `vercel-ai-sdk`, `claude-agent-sdk`, `langchain`, `langgraph`

**Wrong:**

```python
# agent framework already emits tool spans; app registers no tools
with tracer.start_as_current_span('get_weather'):   # wrapper around a plain helper
    result = get_weather(city)
posthog.capture(distinct_id=uid, event='$ai_span',
                properties={'$ai_span_name': 'chat_turn'})   # invented span
```

**Fixed:**

```python
# Registered tools on the wrapper path: one $ai_span next to the existing dispatch
result = TOOLS[call.function.name](**args)
posthog.capture(distinct_id=uid, event='$ai_span', properties={
    '$ai_trace_id': trace_id, '$ai_span_name': call.function.name})
# Agent frameworks and the Vercel AI SDK emit tool spans on their own: add nothing.
# An app that registers no tools has no spans: a complete result, not a gap.
```

## Incomplete LLM payloads on streaming routes

**Problem.** The agent hooks every inference route, but streaming and WebSocket paths need their own output parsing. Build and response tests still pass when payloads are wrong.

**Impact.** Successful generations are recorded as errors, without output or tokens, or without role, while the evaluator still scored 5/5.

**Rule location.**

- NOT YET IN main: context-mill PR #406 (OPEN/WIP, adds 'inference coverage ledger' to the ai-observability skill and bundles references/manual-capture.md)
- role guidance depends on posthog.com #20409 (open)

**Sources.** [PostHog/wizard#1353](https://github.com/PostHog/wizard/issues/1353), [PostHog/context-mill#406](https://github.com/PostHog/context-mill/pull/406), [PostHog/wizard-workbench#4154](https://github.com/PostHog/wizard-workbench/pull/4154)

**Frameworks.** `node`, `openai`, `ollama`

**Wrong:**

```ts
// WebSocket success
capture({ $ai_is_error: true })              // no output, no tokens
$ai_output_choices: [{ content }]            // role missing
// SSE parser breaks on valid JSON whitespace
```

**Fixed:**

```ts
$ai_output_choices: [{ role: 'assistant', content }]
// every successful generation on JSON, SSE, NDJSON and WebSocket routes;
// write an inference coverage ledger listing each route group
```

## Groq calls attributed to OpenAI

**Problem.** The app calls Groq through the OpenAI SDK with a baseURL override. Swapping in the PostHog OpenAI wrapper while keeping baseURL looks complete, but the wrapper hardcodes the provider as openai whatever host it calls.

**Impact.** Events carry $ai\_provider 'openai' with a Groq model name, so PostHog's price lookup by model plus provider is wrong or fails, and cost and provider breakdowns are wrong. No error is raised.

**Rule location.** [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (section 'A gateway must name its provider', also 1-begin.md rule 3, 'An openai client with a base URL override means a gateway')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/posthog-python#822](https://github.com/PostHog/posthog-python/pull/822), [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md)

**Frameworks.** `groq`, `openai`, `python`, `javascript_node`

**Wrong:**

```python
client = OpenAI(posthog_client=posthog, base_url="https://api.groq.com/openai/v1")
client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=messages,
    posthog_distinct_id=user_id,
)  # event goes out with $ai_provider = "openai"
```

**Fixed:**

```python
client = OpenAI(posthog_client=posthog, base_url="https://api.groq.com/openai/v1")
client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=messages,
    posthog_distinct_id=user_id,
    posthog_properties={"$ai_session_id": session_id, "$ai_provider": "groq"},
)
```

## MCP 2026-07-28 traffic splits every request

**Problem.** Default instrumentation relies on the initialize handshake and Mcp-Session-Id header. The 2026-07-28 MCP revision removed both, which postdates most training data, so the default instrument() call looks complete.

**Impact.** Silent: every request becomes its own $session\_id, so conversations never group.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 4, '@modelcontextprotocol/server (v2), any path, sessions and protocol revisions', Python Path P1)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344), [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372), [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md)

**Frameworks.** `mcp-typescript-sdk`, `mcp-typescript-sdk-v2`, `mcp-python-sdk-2`

**Wrong:**

```typescript
const analytics = instrument(server, posthog)
// 2026-07-28 traffic: no initialize, no Mcp-Session-Id -> $session_id per request
```

**Fixed:**

```typescript
const analytics = instrument(server, posthog, {
  captureModel: true,
  enableConversationId: true,   // enable on supported v2 wrapping paths
})
// instrument once; never branch on the protocol revision
// Python mcp 2.x: MCPAnalyticsOptions(enable_conversation_id=True)
```

## Fabricated MCP initialize and hardcoded protocol version

**Problem.** In a custom dispatcher, calling captureInitialize per connection with a fixed protocolVersion is the simplest way to fill the fields. The agent does not know the newer revision has no initialize at all.

**Impact.** Fake initialize events on a revision that has none, and wrong revision labels on every event.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (Path C and P2, custom dispatcher)

**Sources.** [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372)

**Frameworks.** `mcp-custom-dispatcher`, `fastapi`, `hono`, `edge`

**Wrong:**

```ts
posthog.captureInitialize({ clientName, clientVersion, distinctId,
  protocolVersion: '2025-11-25' })   // every client, any revision
```

**Fixed:**

```ts
// only on a real 2025-11-25 initialize handshake: captureInitialize(...)
// every capture: protocolVersion from session state (2025-11-25)
//   or the request's MCP-Protocol-Version header (2026-07-28)
// neither available -> omit it; never hardcode
```

## Report promises MCP events that never exist

**Problem.** Names like $mcp\_tool\_failed or $mcp\_prompt\_get sound plausible, so the agent captures or promises them without checking the SDK's event list.

**Impact.** Silent. The report and dashboards reference events that never arrive.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 7 verify and report)

**Sources.** [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372)

**Frameworks.** `mcp-analytics`, `typescript`, `python`

**Wrong:**

```ts
posthog.capture('$mcp_tool_failed', { tool, error })
// report: "you'll see $mcp_resources_list and $mcp_prompt_get events"
```

**Fixed:**

```text
Check every event name in the final report against events.md.
Failed tools stay $mcp_tool_call with $mcp_is_error = true (maybe a sibling $exception).
Resource and prompt events are reserved, not emitted yet.
```
