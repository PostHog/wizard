# Wizard run mechanics

97 cases. Part of the [edge case catalogue](../edge-cases.md).

## Localhost database host offered to PostHog

**Problem.** The agent copies the host from the local DATABASE\_URL and forgets that PostHog connects from its own network. It also gives no warning about IP allowlists on managed databases.

**Impact.** PostHog cannot reach or rejects the host, and the user wastes a round trip of credentials.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Pre-flight, host bullet)

**Sources.** [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/posthog#67018](https://github.com/PostHog/posthog/pull/67018), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [PostHog/context-mill#339](https://github.com/PostHog/context-mill/pull/339), [PostHog/context-mill#361](https://github.com/PostHog/context-mill/pull/361)

**Frameworks.** `Postgres`, `MySQL`, `managed databases`

**Wrong:**

```text
wizard_ask: host = localhost   # or 127.0.0.1, 10.0.3.7, 192.168.1.20
external-data-sources-db-schema(...) -> unreachable / rejected
# managed Postgres behind an allowlist, no warning given
```

**Fixed:**

```markdown
The host must be reachable from PostHog's network. localhost, 127.0.0.1 and
private hosts (10.x, 192.168.x, 172.16-31.x) are rejected. If the database is
not publicly reachable, go straight to the deep-link path.
```

## Prompt placeholders copied literally into output

**Problem.** Prompt templates show `<full https url>` and wrapper tags as shape hints, and a model following the template closely reproduces them verbatim instead of substituting values.

**Impact.** The outro gets '&lt;full https url>' instead of the dashboard URL, and the setup report is wrapped in a stray tag instead of being valid markdown starting with an H1.

**Rule location.** [`wizard: src/agent/runner/harness/pi/runtime-notes.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (ANGLE\_PLACEHOLDERS, pushed for linear tasks)

**Sources.** [PostHog/wizard#868](https://github.com/PostHog/wizard/pull/868), [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962)

**Frameworks.** `all`

**Wrong:**

```text
[DASHBOARD_URL] <full https url>
<wizard-report>
# PostHog setup report
...
</wizard-report>
```

**Fixed:**

```text
- Angle-bracket placeholders in prompts are fill-ins: substitute the real
  value and never emit the literal `<...>` text. Markers carry the real value
  (`[DASHBOARD_URL]` gets the actual URL, not `<full https url>`), and the
  setup report is valid markdown starting with an H1 heading, with no
  `<wizard-report>` wrapper tags.
```

## Report shortened to get past notebook errors

**Problem.** When a tool call fails with 'Bad control character', the obvious fix is to send less text, but the real fault is JSON encoding of the markdown, so the content loss is silent.

**Impact.** The PostHog notebook carries a two-line summary instead of the full setup report.

**Rule location.** [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (section 'Mirror it yourself on older wizards', new wizards create the notebook inside publish\_handoff)

**Sources.** [PostHog/context-mill#288](https://github.com/PostHog/context-mill/pull/288), [context-mill@0bf2d8a](https://github.com/PostHog/context-mill/commit/0bf2d8a1), [PostHog/context-mill#423](https://github.com/PostHog/context-mill/pull/423)

**Frameworks.** `all`

**Wrong:**

```text
notebooks-create-markdown {"title": "PostHog setup (wizard)",
  "markdown": "## Summary\nPostHog installed. See the repo for details.\n"}
# 13KB report cut to 2 lines after 'Bad control character'
```

**Fixed:**

```text
// Never trim the report just to make it parse. Bare JSON on one line,
// newlines and quotes escaped (\n, \"):
call notebooks-create-markdown {"title": "PostHog setup (wizard) – acme-shop", "markdown": "## Events captured\n\n..."}
// still failing? create with the first sections, then append the rest:
call notebooks-add-cell {"notebook_id": "AbCdEfGh", "cell_type": "markdown", "markdown": "## Next steps\n\n..."}
```

## Notebook shows the report title twice

**Problem.** The report starts with an H1 for publish\_handoff, and nothing tells the agent the notebook API already renders the title as the leading heading.

**Impact.** Silent cosmetic defect: the notebook opens with the same heading twice.

**Rule location.** [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (older-wizard fallback, notebooks-create-markdown bullet)

**Sources.** [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356)

**Frameworks.** `all`

**Wrong:**

```text
notebooks-create-markdown {"title": "PostHog setup (wizard) - acme-shop",
  "markdown": "# PostHog setup (wizard) - acme-shop\n\n## Events captured ..."}
```

**Fixed:**

```text
// The title becomes the notebook's leading `# heading`: start the markdown
// at the first section below it.
notebooks-create-markdown {"title": "PostHog setup (wizard) – acme-shop",
  "markdown": "## Events captured\n\n..."}
```

## Notebook link written as prose, not marker

**Problem.** A markdown link is the natural way to report a URL, and agents build it from the ingestion host they configured, but the wizard only parses an exact marker line with the app host.

**Impact.** Silent: the wizard does not pick up the link, so the end screen shows no notebook, or the link points at the ingestion host.

**Rule location.**

- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (older-wizard fallback, last paragraph)
- [`wizard: src/agent/signals.ts#NOTEBOOK_URL`](https://github.com/PostHog/wizard/blob/main/src/agent/signals.ts)

**Sources.** [PostHog/context-mill#232](https://github.com/PostHog/context-mill/pull/232), [PostHog/wizard#882](https://github.com/PostHog/wizard/pull/882), [PostHog/context-mill#423](https://github.com/PostHog/context-mill/pull/423)

**Frameworks.** `all`

**Wrong:**

```text
Notebook: [PostHog setup (wizard)](https://us.i.posthog.com/project/2/notebooks/AbCdEfGh)
```

**Fixed:**

```text
[NOTEBOOK_URL] https://us.posthog.com/project/2/notebooks/AbCdEfGh
# <posthog host>/project/<project id>/notebooks/<short_id>, one plain line, marker first
```

## Many sources packed into one credential prompt

**Problem.** Batching questions looks efficient and an earlier skill (#337) even told agents to batch across sources, but one call has a fixed field cap that several sources overflow, while one call per source without a subject tripped the adjacency nudge.

**Impact.** Five sources need 15-25 fields. Agents gave up and fell back to browser links, so about 65% of 'completed' warehouse tasks created no source.

**Rule location.**

- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 2)
- [`wizard: src/agent/tools/tools.ts#WIZARD_ASK_SUBJECT_DESCRIPTION`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts)

**Sources.** [PostHog/context-mill#337](https://github.com/PostHog/context-mill/pull/337), [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/wizard#1146](https://github.com/PostHog/wizard/pull/1146)

**Frameworks.** `all`

**Wrong:**

```js
wizard_ask({ "questions": [
  { "id": "pg_host" }, { "id": "pg_password" }, ...,
  { "id": "stripe_key" }, { "id": "mysql_host" }, ...
] })   // three sources, ~20 fields, no subject
```

**Fixed:**

```js
wizard_ask({ subject: "Postgres", questions: [host, port, database, user, password] })
// create Postgres, then:
wizard_ask({ subject: "Stripe", questions: [restricted_api_key] })
// one subject per call, never two sources in one call; the guard counts per subject
// a kind with more than 8 fields: two calls with the same subject
```

## Credentials asked one field at a time

**Problem.** Asking each field separately feels conversational, and an earlier skill said both 'single call' and 'one source, one prompt' with no cancellation rule, but the ask tool counts calls per run and nudges after repeats.

**Impact.** The user bounces through many prompts, the batching nudge fires, and the agent gets stuck and aborts.

**Rule location.**

- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (tenet 2)
- [`wizard: src/agent/tools/tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) (ASK\_BATCH\_THRESHOLD = 3)
- [`wizard-workbench: services/wizard-ci/warehouse-checks.ts`](https://github.com/PostHog/wizard-workbench/blob/main/services/wizard-ci/warehouse-checks.ts) (askMaxBatchesPerSubject)

**Sources.** [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157), [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/wizard-workbench#3672](https://github.com/PostHog/wizard-workbench/pull/3672), [PostHog/wizard-workbench#3616](https://github.com/PostHog/wizard-workbench/pull/3616)

**Frameworks.** `data-warehouse`

**Wrong:**

```text
wizard_ask({ questions: [host] })
wizard_ask({ questions: [port] })
wizard_ask({ questions: [password] })   // one source, three calls
// cancelled ask retried and counted against the cap
```

**Fixed:**

```text
wizard_ask({
  subject: "Postgres",
  questions: [host, port, database, user, password, schema]
})
// ONE ask per source (up to 8 questions); a follow-up only after a validation failure.
// Cancelled/timed-out ask = declined: deep link for that source, not counted.
// 3 calls in a row on one subject earn a one-time retryable nudge (ASK_BATCH_THRESHOLD)
```

## Retryable batch nudge treated as a hard stop

**Problem.** A tool response saying 'too many calls in a row, batch your questions' reads like a refusal or a spent budget, so a cautious agent stops and picks the fallback path.

**Impact.** Each nudge cost a source connection even though the next call would have gone through. In self-driving, wanted steps like custom scouts were silently dropped as follow-ups.

**Rule location.**

- [`wizard: src/agent/tools/tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) (createAskAccounting, normaliseAskSubject, ASK\_BATCH\_THRESHOLD = 3)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 2)
- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (batch-nudge bullet)
- [`context-mill: context/skills/self-driving/references/6b-tailor-scouts.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6b-tailor-scouts.md)

**Sources.** [PostHog/wizard#1096](https://github.com/PostHog/wizard/pull/1096), [PostHog/wizard#1146](https://github.com/PostHog/wizard/pull/1146), [wizard@ba774ab](https://github.com/PostHog/wizard/commit/ba774ab2), [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/context-mill#238](https://github.com/PostHog/context-mill/pull/238), [PostHog/context-mill#195](https://github.com/PostHog/context-mill/pull/195), [PostHog/context-mill#200](https://github.com/PostHog/context-mill/pull/200)

**Frameworks.** `warehouse-source`, `self-driving`

**Wrong:**

```text
wizard_ask #3 -> error: too many in a row, batch your questions
# agent: "question budget used up"
-> browser links for remaining sources / custom scouts recorded as follow-up
```

**Fixed:**

```ts
wizard_ask({ subject: 'Postgres', questions: [host, port, database, user, password] })
// adjacency is counted per subject; one call per source is never interrupted
// soft nudge ("Not an error ... not sent"): re-issue the same call once and it goes through.
// Only `cap reached (N calls)` means the budget is spent.
// Cancelled or timed-out asks do not count. Never drop a step to save calls.
```

## Tracking parameters stripped from setup links

**Problem.** Agents tidy URLs and treat utm parameters as noise. Nothing breaks visibly when they are removed.

**Impact.** Silent: sources finished in the browser after a handoff cannot be attributed to the wizard, so handoff conversion is unmeasurable.

**Rule location.**

- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (deep-link source, step 2)
- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (deep-link template)

**Sources.** [PostHog/context-mill#230](https://github.com/PostHog/context-mill/pull/230)

**Frameworks.** `all`

**Wrong:**

```text
https://us.posthog.com/project/2/data-warehouse/new-source?kind=Stripe
```

**Fixed:**

```text
https://us.posthog.com/project/2/data-warehouse/new-source?kind=Stripe&utm_source=wizard&utm_campaign=warehouse-source
# keep the utm_* parameters exactly as written
```

## Key files asked through a terminal prompt

**Problem.** A service-account key looks like any other secret, but it is a multi-line JSON file upload (or an OAuth flow) and the single-line terminal prompt submits on Enter.

**Impact.** The step dead-ends at source creation. Firebase was offered many times and completed almost never.

**Rule location.**

- [`wizard: src/programs/warehouse-sources/registry.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/warehouse-sources/registry.ts) (BigQuery, Firebase mode), src/programs/warehouse-sources/types.ts (SourceCreationMode)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 5, deep-link source)

**Sources.** [PostHog/wizard#1149](https://github.com/PostHog/wizard/pull/1149), [PostHog/wizard#1262](https://github.com/PostHog/wizard/pull/1262), [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157)

**Frameworks.** `Firebase`, `BigQuery`, `OAuth sources`

**Wrong:**

```js
wizard_ask({ subject: "BigQuery", questions: [
  { id: "service_account_json", kind: "text",
    prompt: "Paste your service account JSON key" } ] })
{ kind: 'BigQuery', mode: 'in-cli' }
```

**Fixed:**

```text
{ kind: 'BigQuery', label: 'BigQuery', mode: 'deep-link' }   // also Firebase
[STATUS] BigQuery needs browser setup
<app-host>/project/<id>/data-warehouse/new-source?kind=BigQuery&utm_source=wizard&utm_campaign=warehouse-source
// the web form has a file-upload field; give the URL and stop, collect no credentials
```

## One declined prompt ends all credential collection

**Problem.** Agents generalize a single 'no' into 'the user does not want this', or re-ask out of persistence. Neither matches how users answer per source.

**Impact.** Sources the user never saw are silently dropped, or the user is nagged. Runs with a cancelled ask created a source 17% of the time versus 47% without.

**Rule location.**

- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 7)
- [`context-mill: context/agents/integration-v2/warehouse.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/warehouse.md)

**Sources.** [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [PostHog/wizard#770](https://github.com/PostHog/wizard/pull/770), [PostHog/wizard#872](https://github.com/PostHog/wizard/pull/872)

**Frameworks.** `all`

**Wrong:**

```text
wizard_ask({ subject: "Postgres", ... }) -> cancelled
"The user declined; skipping credential prompts for Stripe and Resend too."
```

**Fixed:**

```js
// a decline answers that one source: give it its deep link, do not re-ask
wizard_ask({ subject: "Stripe", ... })   // still ask the next source
// stop asking only after two cancellations in a row
```

## First failed source aborts remaining sources

**Problem.** The old skill step said to emit \[ABORT\] on create failure, and agents treat any failure as run-fatal by default.

**Impact.** One source that will not connect ends the run. Later sources are never attempted.

**Rule location.**

- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (in-cli step 6)
- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (step 7)

**Sources.** [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333)

**Frameworks.** `all`

**Wrong:**

```text
external-data-sources-create(Postgres) -> error
[ABORT] Source creation failed   # Stripe and Resend never attempted
```

**Fixed:**

```text
// on failure: record the error, give that source its deep link, move on
[STATUS] Connected Stripe
// [ABORT] only when every in-cli source failed
```

## One rejected credential abandons the whole source

**Problem.** A 'never re-ask' rule meant to stop duplicate questions is read as absolute, even when the API rejected a fixable value the user would gladly correct.

**Impact.** A source the user agreed to connect is lost to the browser fallback over one mistyped or under-scoped field.

**Rule location.**

- [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) (wizard\_ask block, last rule)
- src/agent/tools/tools.ts (ASK\_CANCELLED\_NOTE, ASK\_TIMED\_OUT\_NOTE)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 2)

**Sources.** [PostHog/wizard#1367](https://github.com/PostHog/wizard/pull/1367), [PostHog/wizard#1146](https://github.com/PostHog/wizard/pull/1146), [PostHog/wizard#872](https://github.com/PostHog/wizard/pull/872)

**Frameworks.** `all`

**Wrong:**

```text
data-warehouse-source-setup({ Stripe, key }) -> 400 key lacks read access to Invoices
"Credential rejected; I may not re-ask. Handing the user the browser link."
```

**Fixed:**

```js
// exception: a value the API rejected
wizard_ask({ subject: "Stripe",   // same subject
  questions: [{ id: "api_key", prompt: "Key lacks Invoices read. Need rk_live_ with read scope" }] })
// only the wrong fields; stop after a couple of attempts
// a dismissed or timed-out ask is a decline: fall back, do not re-ask
```

## Timed-out prompt confused with user dismissal

**Problem.** Cancelled answers came back as sentinel strings, so the agent could not tell 'user said no' from 'nobody is at the terminal' and kept asking.

**Impact.** With nobody present each later prompt waited out the full allowance.

**Rule location.**

- [`wizard: src/agent/tools/tools.ts#describeAskCancellation`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) (ASK\_TIMED\_OUT\_NOTE, ASK\_CANCELLED\_NOTE)
- src/agent/wizard-ask-bridge.ts (timedOut in AskResponse)
- src/shared/ask-policy.ts (LONGER\_ASK\_TIMEOUT\_MS)

**Sources.** [PostHog/wizard#1218](https://github.com/PostHog/wizard/pull/1218), [PostHog/wizard#1214](https://github.com/PostHog/wizard/pull/1214), [PostHog/wizard#872](https://github.com/PostHog/wizard/pull/872)

**Frameworks.** `all`

**Wrong:**

```json
{ "answers": { "host": "__cancelled__", "password": "__cancelled__" } }
// agent guesses, asks the next source, waits 20 more minutes
```

**Fixed:**

```json
{ "answers": { ... },
  "cancelled": { "reason": "user-cancelled" | "timed-out",
                 "questionIds": ["host", "password"],
                 "note": "what to do next" } }
// timed-out note: stop asking, hand over links
// credential asks get LONGER_ASK_TIMEOUT_MS (20 min)
```

## Long credential form times out mid-entry

**Problem.** A single timer per request is the obvious design, but a nine-field form needs far longer than one question.

**Impact.** A user partway through a database form loses every typed field, and the agent is told nobody is there and stops asking.

**Rule location.**

- [`wizard: src/agent/wizard-ask-bridge.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/wizard-ask-bridge.ts) (createWizardAskBridge, armTimeout, onAnswer)
- src/tui/screens/WizardAskScreen.tsx (noteAskProgress)

**Sources.** [PostHog/wizard#1368](https://github.com/PostHog/wizard/pull/1368)

**Frameworks.** `warehouse-source`

**Wrong:**

```ts
// one timer armed when the request opens
setTimeout(() => resolve(CANCELLED_ALL), perQuestionTimeout)
// 9-field form gets the same allowance as 1 question
```

**Fixed:**

```ts
// host calls onAnswer after each question; the bridge re-arms the timer
showQuestion(pending, {
  signal: controller.signal,
  onAnswer: () => { answeredCount += 1; armTimeout() },
})
// WizardAskScreen: store.noteAskProgress() after each non-final answer
// cancelled event carries questions_answered (count, never a value)
```

## Timed-out question blocks every later question

**Problem.** The natural implementation counts each ask up front and resolves the tool on timeout without clearing the host's pending state.

**Impact.** One dismissed or timed-out prompt burns the budget or blocks the overlay, so later credentials (Stripe, Resend) fall back to deep links.

**Rule location.**

- [`wizard: src/agent/wizard-ask-bridge.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/wizard-ask-bridge.ts) (timeout + controller.abort, isFullyCancelled)
- src/programs/session/interaction.ts (dismissOnAbort)
- src/agent/tools/mcp.ts and src/agent/runner/harness/pi/tools.ts (askAccounting.refund)

**Sources.** [PostHog/wizard#770](https://github.com/PostHog/wizard/pull/770), [PostHog/wizard#872](https://github.com/PostHog/wizard/pull/872)

**Frameworks.** `warehouse-source`

**Wrong:**

```ts
askCallCount += 1                          // slot taken up front
const answers = await askBridge.request({ questions })
// timeout resolves agent, host pending state stays set:
// wizard_ask #2 throws "requestQuestion called while another
//   wizard_ask request is pending"
```

**Fixed:**

```ts
timer = setTimeout(() => {
  timedOut = true
  resolve(buildCancelledAnswers(questions))
  controller.abort()   // interaction.ts: store.cancelPendingQuestion()
}, timeoutMs)
// mcp.ts / pi tools.ts:
if (isFullyCancelled(answers)) askAccounting.refund(args.subject)
// catch path: askAccounting.refund(args.subject)
```

## Stepping away treated as declining

**Problem.** A timeout and an explicit decline both resolve to the same cancelled value, so a skill that aborts on decline also aborts on timeout.

**Impact.** Users who just stepped away have the run killed as if they refused, after paying full agent startup.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/2-read-context.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/2-read-context.md) (next\_step chain)
- [`wizard: src/tui/programs/self-driving/screens/SelfDrivingGitHubScreen.tsx`](https://github.com/PostHog/wizard/blob/main/src/tui/programs/self-driving/screens/SelfDrivingGitHubScreen.tsx)

**Sources.** [PostHog/context-mill#371](https://github.com/PostHog/context-mill/pull/371)

**Frameworks.** `self-driving`

**Wrong:**

```text
3. On cant (at any point): emit exactly
   [ABORT] github connection declined
   and stop.
// wizard_ask timeout resolves to the same __cancelled__ as a decline
```

**Fixed:**

```text
# 2-read-context.md front matter (old step 3 removed)
next_step: 3-enable-products.md
# wizard flow: ... auth -> self-driving-github screen -> agent run
# GitHub App gate runs BEFORE the agent starts:
# cheap, unambiguous, un-timeoutable
```

## Question times out during slow user work

**Problem.** A 5-minute ask default looks generous until the user must create an API key, install a GitHub App, or run a production build.

**Impact.** The question is cancelled mid-task. The agent reads cancelled answers as a decline and wraps up or aborts.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/index.ts)
- src/programs/self-driving/index.ts
- src/agent/runner/sequence/linear.ts
- src/agent/runner/shared/types.ts (askTimeoutMs)

**Sources.** [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651), [PostHog/wizard#642](https://github.com/PostHog/wizard/pull/642)

**Frameworks.** `all`

**Wrong:**

```ts
createAskBridge(interaction, {
  getSource: () => input.skillId,
  // timeoutMs unset: DEFAULT_ASK_TIMEOUT_MS (5 min)
  // timeout -> every field "__cancelled__"
});
```

**Fixed:**

```ts
// programs/error-tracking-upload-source-maps, self-driving
askTimeoutMs: 30 * 60 * 1000,
// linear.ts
createAskBridge(interaction, { ..., timeoutMs: run.askTimeoutMs })
```

## Blank required credential accepted as an answer

**Problem.** An empty string looks like a valid answer to the agent, which cannot tell a blank Enter from a deliberate decline.

**Impact.** Source creation runs on empty credentials and dead-ends with no sign the user declined.

**Rule location.** [`wizard: src/tui/screens/WizardAskScreen.tsx`](https://github.com/PostHog/wizard/blob/main/src/tui/screens/WizardAskScreen.tsx) (isRequiredButEmpty, submit)

**Sources.** [PostHog/wizard#1171](https://github.com/PostHog/wizard/pull/1171)

**Frameworks.** `all`

**Wrong:**

```text
wizard_ask(...) -> { password: '' }     // Enter on a blank required field
external-data-sources-create({ password: '' })   // fails; no decline signal
```

**Fixed:**

```ts
// WizardAskScreen submit():
if (isRequiredButEmpty(question, value)) {
  setRequiredHint(true)   // nudge toward Esc
  return
}
// Esc = explicit decline -> that source gets its deep link
```

## Long connection form abandoned instead of split

**Problem.** Told 'one call per source', the agent treats the per-call cap as the source's limit and gives up on wide forms like Postgres with SSH tunnel.

**Impact.** A source the wizard could connect in the terminal is handed back as a link.

**Rule location.** [`wizard: src/agent/tools/tools.ts#WIZARD_ASK_TOOL_DESCRIPTION`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) ASK\_MAX\_QUESTIONS\_PER\_CALL (MCP and pi facades)

**Sources.** [PostHog/wizard#1319](https://github.com/PostHog/wizard/pull/1319), [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360)

**Frameworks.** `Postgres`, `MySQL`, `database sources`

**Wrong:**

```text
wizard_ask({ subject: "Postgres", questions: [ ...12 fields incl. SSH tunnel ] }) -> over cap
"Form too wide to collect here; handing the user a link."
```

**Fixed:**

```js
wizard_ask({ subject: "Postgres", questions: [ first fields ] })
wizard_ask({ subject: "Postgres", questions: [ remaining fields ] })  // same subject
// a wide subject spans consecutive calls; never a reason to fall back
// ASK_MAX_QUESTIONS_PER_CALL = widest form + headroom
```

## Same database connected twice under two names

**Problem.** Detection matches both a hosted provider (Supabase, Neon) and generic Postgres from one DATABASE\_URL, and connecting every detected kind looks thorough.

**Impact.** Every table imports twice and the user pays ingestion for the duplicate.

**Rule location.** [`wizard: src/programs/warehouse-sources/registry.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/warehouse-sources/registry.ts) (SourceDetector.supersededBy on Postgres) and detect.ts (detectWarehouseSources)

**Sources.** [PostHog/wizard#1300](https://github.com/PostHog/wizard/pull/1300)

**Frameworks.** `Postgres`, `Supabase`, `Neon`

**Wrong:**

```text
Detected: Postgres (DATABASE_URL), Supabase (@supabase/supabase-js)
connect Supabase -> ok
connect Postgres -> ok   // same database
```

**Fixed:**

```ts
// registry.ts
{ kind: 'Postgres', /* signals: pg, DATABASE_URL, ... */
  supersededBy: ['Neon', 'Supabase'] }
// detect.ts: drops an entry when any kind in supersededBy also matched
(detector.supersededBy ?? []).some((kind) => detectedKinds.has(kind))
```

## Supabase connected as plain Postgres via the direct host

**Problem.** Supabase looks like plain Postgres, so the agent picks source\_type Postgres, uses the direct host and whatever key is visible, but the direct host is IPv6-only and the familiar keys are not the DB password.

**Impact.** Warehouse source validation fails on the first attempt for most Supabase projects.

**Rule location.** [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (pre-flight, line ~51) and context/skills/integration-v2/warehouse/description.md (pre-flight, lines ~114-122)

**Sources.** [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/context-mill#361](https://github.com/PostHog/context-mill/pull/361), [PostHog/posthog#67018](https://github.com/PostHog/posthog/pull/67018)

**Frameworks.** `Supabase`, `Postgres`

**Wrong:**

```yaml
source_type: Postgres
host: db.<project-ref>.supabase.co     # direct host, IPv6-only
port: 5432
user: postgres
password: <anon / service_role JWT or account password>
```

**Fixed:**

```yaml
source_type: Supabase   # not Postgres
# host: pass on the Session-pooler guidance from the field caption
password: <database password>   # Supabase > Settings > Database
# not an anon/service_role JWT, not the account password
# SUPABASE_URL in env -> derive ref from db.<ref>.supabase.co, pre-fill host and username
```

## Wrong credential type for SaaS sources

**Problem.** The agent asks for the most familiar key (Stripe secret key, Sentry DSN) or reuses a send-only key from .env, not the read-scoped key type the warehouse connector validates.

**Impact.** Source validation fails on the first attempt or the import lacks read scopes, burning a wizard\_ask.

**Rule location.** [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) and integration-v2/warehouse/description.md (Pre-flight)

**Sources.** [PostHog/context-mill#206](https://github.com/PostHog/context-mill/pull/206), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [PostHog/context-mill#392](https://github.com/PostHog/context-mill/pull/392), [PostHog/context-mill#361](https://github.com/PostHog/context-mill/pull/361)

**Frameworks.** `Stripe`, `Sentry`, `RevenueCat`, `Convex`, `Twilio`, `Mailchimp`, `Resend`, `Mailgun`

**Wrong:**

```text
Stripe:  sk_live_...                              # secret key
Sentry:  https://<key>@o1.ingest.sentry.io/1      # DSN
Twilio:  account auth token
Resend:  send-only restricted key found in .env
```

**Fixed:**

```text
Stripe: restricted key (rk_live_...) with exact read scopes, not sk_live_...
Sentry: internal-integration token (not DSN or personal token)
RevenueCat: v2 secret key with read scopes; Twilio: API Key SID + Secret
Mailchimp: key with its -usX suffix; Resend/Mailgun: full/read-access key
```

## Stripe key prompt names no scopes

**Problem.** The agent asks for 'a Stripe key' without knowing PostHog needs a restricted key with specific scopes, and may invent a scope-preselecting link Stripe does not support.

**Impact.** The user guesses scopes, source validation fails, and setup stalls.

**Rule location.** [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (pre-flight, Stripe bullet, line ~53 on main)

**Sources.** [PostHog/context-mill#392](https://github.com/PostHog/context-mill/pull/392)

**Frameworks.** `Stripe`

**Wrong:**

```text
wizard_ask: "Paste your Stripe restricted API key beginning rk_live_
with no extra text and the required read scopes"
(no scopes listed, no link)
```

**Fixed:**

```text
Restricted key (rk_live_), not secret key (sk_live_). Name the scopes:
Read: Balance transactions, Charges, Customers, Disputes, Payment methods,
Payouts, Products, Coupons, Credit notes, Invoices, Prices, Subscriptions;
Write: Webhooks. Link posthog.com/docs/cdp/sources/stripe#option-1-...
Stripe has no URL param to pre-select scopes: don't invent a deep link.
```

## Source type sent as display label

**Problem.** Display names and enum values differ by spacing and casing, and the agent naturally uses the familiar name.

**Impact.** PostHog rejects the create call and the source is not connected.

**Rule location.**

- `wizard: src/lib/warehouse-sources/registry.ts`
- src/lib/programs/warehouse-source/index.ts

**Sources.** [PostHog/wizard#1145](https://github.com/PostHog/wizard/pull/1145), [PostHog/wizard#711](https://github.com/PostHog/wizard/pull/711), [PostHog/context-mill#361](https://github.com/PostHog/context-mill/pull/361), [PostHog/wizard-workbench#3616](https://github.com/PostHog/wizard-workbench/pull/3616), [`wizard-workbench: apps/warehouse/multi-source-next/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse/multi-source-next/README.md), [PostHog/wizard#488](https://github.com/PostHog/wizard/pull/488)

**Frameworks.** `all`

**Wrong:**

```ts
external-data-sources-create({ source_type: 'Hugging Face', ... })
external-data-sources-create({ source_type: 'GitHub', ... })
```

**Fixed:**

```ts
{ kind: 'HuggingFace', label: 'Hugging Face', mode: 'in-cli' }
{ kind: 'Github', label: 'GitHub', mode: 'deep-link' }
// prompt: "Use the `kind` string exactly as printed for `source_type` -
//   PostHog rejects the display label."
```

## Non-interactive run stalls or invents credentials

**Problem.** Without a prompt tool the agent either waits, guesses plausible values, or reports done, since nothing tells it a no-op is acceptable.

**Impact.** The run blocks or reports success for sources that were never created.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (When you cannot ask)

**Sources.** [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157), [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360)

**Frameworks.** `all`

**Wrong:**

```text
wizard_ask unavailable (CI)
"Cannot collect credentials, waiting..."   # or invents host/password
```

**Fixed:**

```text
// treat every source as deep-link: emit each new-source URL
// say credentials go in the app; report the task as `not needed`
```

## Prompting a user who is not there

**Problem.** If a question tool exists, the agent uses it. In CI, headless or signup runs nobody answers.

**Impact.** The run waits for the whole prompt timeout, then continues on a guess or fails.

**Rule location.**

- `wizard: src/lib/agent/runner/shared/bootstrap.ts` (shouldDisableAsk)
- src/lib/programs/posthog-integration/index.ts (disallowedTools)

**Sources.** [PostHog/wizard#459](https://github.com/PostHog/wizard/pull/459), [PostHog/wizard#1152](https://github.com/PostHog/wizard/pull/1152), [PostHog/wizard#558](https://github.com/PostHog/wizard/issues/558)

**Frameworks.** `all`

**Wrong:**

```text
CI run: wizard_ask("Which project?")   -> waits the full timeout -> run fails
```

**Fixed:**

```ts
shouldDisableAsk(session) => (session.ci || session.signup) && !session.e2eAsk
// no ask tool registered at all in those runs
disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk]  // basic integration
```

## Interactive program started in CI mode

**Problem.** Forwarding every flag to the agent run is the default, so an interactive-only program starts where wizard\_ask is disabled and scopes are wrong.

**Impact.** The agent loop burns tokens, then fails late on a 403 from the first MCP probe (--signup) or a stalled ask with no bridge (--ci).

**Rule location.** wizard (main): src/cli/commands/self-driving.ts (check)

**Sources.** [PostHog/wizard#642](https://github.com/PostHog/wizard/pull/642)

**Frameworks.** `all`

**Wrong:**

```ts
handler: (argv) => {
  runWizard(selfDrivingConfig, argv);   // --signup / --ci go straight through
}
```

**Fixed:**

```ts
check: (argv) => {
  if (argv.signup) throw new Error('`self-driving` cannot run with --signup. ...');
  if (argv.ci) throw new Error('`self-driving` cannot run in CI mode ...');
  return true;
}
```

## Credential prompts interrupt agents still editing code

**Problem.** A task injected by the runner before planning has no dependencies, so the scheduler runs it first, and the report step may finish before it.

**Impact.** Database password prompts appear mid-edit, or the report misses the warehouse section silently.

**Rule location.**

- [`context-mill: context/agents/integration-v2/warehouse.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/warehouse.md) report.md
- scripts/lib/agent-generator.js (assertRunnerSeededHasSink)
- `wizard: src/lib/agent/runner/sequence/orchestrator/queue-tools.ts` (uncoveredBySink), seeded-deps.ts

**Sources.** [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [PostHog/wizard#1103](https://github.com/PostHog/wizard/pull/1103), [PostHog/wizard#1077](https://github.com/PostHog/wizard/pull/1077)

**Frameworks.** `all`

**Wrong:**

```text
warehouse seeded with no deps -> first drain tier
asks for Postgres password while coding agents are mid-edit
report publishes before reportSection exists
```

**Fixed:**

```yaml
# warehouse.md
runnerSeeded: true
dependsOn: []   # waits for everything except the sink
# report.md
sink: true      # build fails if a runnerSeeded task has no sink
```

## Outro drops data-source next steps

**Problem.** A new run path composed its own outro and bypassed the shared builder. Nothing fails, the links just vanish.

**Impact.** Users were told sources were found, then got nothing pointing at them on most runs.

**Rule location.**

- `wizard: src/lib/agent/runner/shared/types.ts` (ProgramRun.buildOutroNextSteps)
- src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts (completedSeededTypes)
- src/lib/programs/posthog-integration/index.ts (buildOutroNextSteps)

**Sources.** [PostHog/wizard#1234](https://github.com/PostHog/wizard/pull/1234)

**Frameworks.** `all`

**Wrong:**

```ts
setOutroData({ message: composeFromDrain(result) })   // no nextSteps
```

**Fixed:**

```ts
nextSteps = program.buildOutroNextSteps?.(completedSeededTypes(store, seeded))
// omitted only when the warehouse step reached `done`
```

## Setup report dumped as a file in repo

**Problem.** Writing a markdown report file is the default way agents summarize work, and older skill text asked for it, so runs followed whichever instruction they saw.

**Impact.** An unrequested file lands in the user's project, stale files from earlier runs block writes, and the report may never reach the wizard session.

**Rule location.**

- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (Goal, allowedTools), context/skills/integration-v2/report/description.md (Publish)
- [`wizard: src/agent/tools/handoff.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/handoff.ts) (PUBLISH\_HANDOFF\_DESCRIPTION, 'never write the report to a file yourself')

**Sources.** [PostHog/context-mill#303](https://github.com/PostHog/context-mill/pull/303), [PostHog/wizard#1045](https://github.com/PostHog/wizard/pull/1045), [PostHog/wizard#1332](https://github.com/PostHog/wizard/issues/1332), [PostHog/context-mill#241](https://github.com/PostHog/context-mill/pull/241), [context-mill@afa69f3](https://github.com/PostHog/context-mill/commit/afa69f30), [PostHog/wizard#1141](https://github.com/PostHog/wizard/pull/1141), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112)

**Frameworks.** `all`

**Wrong:**

```js
Write({ file_path: 'posthog-setup-report.md', content: '# PostHog setup ...' })
// re-run: refused, file exists and was not read
```

**Fixed:**

```js
publish_handoff({ content: "# PostHog post-wizard report\n..." })
// once, no file: "Do not write a report file."
// report.md: allowedTools: [Read, Glob, Grep, posthog_exec] (no Write)
```

## Every step publishes its own final report

**Problem.** The report tool's description said to call it at the end of the run, so each task agent read its own end as the run's end and never called complete\_task.

**Impact.** Reports are written four to seven times per run. Steps that never call complete\_task restart and re-ask the user for credentials.

**Rule location.** [`wizard: src/agent/tools/handoff.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/handoff.ts) (PUBLISH\_HANDOFF\_DESCRIPTION, TASK\_REPORTING\_NOTE)

**Sources.** [PostHog/wizard#1360](https://github.com/PostHog/wizard/pull/1360), [PostHog/context-mill#303](https://github.com/PostHog/context-mill/pull/303), [PostHog/wizard#1051](https://github.com/PostHog/wizard/pull/1051)

**Frameworks.** `all`

**Wrong:**

```text
publish_handoff: "call it exactly once, at the end of the run;
the required way to deliver the report to the user"
# install, init, capture, dashboard, review steps each publish a report
# and never call complete_task -> restarted
```

**Fixed:**

```js
// description: "A run publishes once: call it only when your own instructions
// ask you to write that report ... a step that was not asked for the run report
// leaves this one uncalled"
complete_task({ reportSection: "## Warehouse\n..." })   // every other step
// TASK_REPORTING_NOTE appended on a task-agent publish:
' This does not report your task: call complete_task to finish.'
```

## Report rewrites sections other steps already wrote

**Problem.** Summarizing is the default instinct for a report writer, and one harness silently dropped the reportSection field so the section never arrived.

**Impact.** Step sections lose caveats, are duplicated, or are missing from the final report.

**Rule location.**

- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (Goal)
- [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts) (HANDOFF\_FIELDS), src/agent/runner/harness/pi/orchestrator-tools.ts

**Sources.** [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [context-mill@8dbb1df](https://github.com/PostHog/context-mill/commit/8dbb1dfd9b8620f613956d36cc1d9b91b8a4998d), [PostHog/wizard#1086](https://github.com/PostHog/wizard/pull/1086)

**Frameworks.** `all`

**Wrong:**

```text
## Next steps
The warehouse step connected some sources...   // re-summarized
// pi complete_task had no reportSection field
```

**Fixed:**

```text
// report.md: "Include it as its own section instead of rewriting or
// summarizing it, and do not restate its contents elsewhere."
// HANDOFF_FIELDS.reportSection is read by both the zod (MCP) and typebox (pi)
// complete_task schemas; handoff-schema-parity.test.ts keeps them level
```

## Event table dropped when plan file missing

**Problem.** The report agent reads the events file it was pointed at and, finding nothing, writes 'none recorded' instead of checking the code.

**Impact.** The user cannot see which events were instrumented or where.

**Rule location.** [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (Sources)

**Sources.** [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#188](https://github.com/PostHog/context-mill/pull/188), [context-mill@1ee8552](https://github.com/PostHog/context-mill/commit/1ee85521c21efd00776f25d7e657b46900a04b7b), [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214)

**Frameworks.** `all`

**Wrong:**

```markdown
## Events
(no .posthog-events.json found, none recorded)
```

**Fixed:**

```text
// file missing or empty: grep changed files for capture( calls,
// read the capture handoff in queue.json, rebuild (event, meaning, file)
```

## Report claims all app logs reach PostHog

**Problem.** 'Logs configured' sounds like full log shipping, but the run only adds an exporter for the log lines it wrote.

**Impact.** Users expect their existing log lines in PostHog and find only a handful.

**Rule location.**

- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (What to include, AI Observability and Logs)
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) ('Export only log lines this integration adds')

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [PostHog/wizard#1330](https://github.com/PostHog/wizard/issues/1330)

**Frameworks.** `javascript_node`, `python`

**Wrong:**

```markdown
## Logs
Application logs are now exported to PostHog.
```

**Fixed:**

```markdown
## Logs
Only log lines added by this run are exported.
To send the app's existing loggers too, route them into the same exporter
(one-line pointer from the logs handoff).
```

## Huge report truncated, losing next steps

**Problem.** Agents paste build logs and diffs to look thorough, unaware the backend caps handoff content.

**Impact.** The tail (checklist, next steps) is silently cut at 64 KB. Before the cap an oversized doc 400ed every later state push.

**Rule location.**

- [`wizard: src/agent/tools/handoff.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/handoff.ts) (MAX\_HANDOFF\_TEXT\_CHARS, publishHandoff)
- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) ('Keep it skimmable')

**Sources.** [PostHog/wizard#1045](https://github.com/PostHog/wizard/pull/1045)

**Frameworks.** `all`

**Wrong:**

```js
publish_handoff({ content: <200 KB: full build output + every diff> })
```

**Fixed:**

```text
// report/description.md: "Keep it skimmable" (H1, summary, tables, checklist)
// handoff.ts:
// const truncated = content.length > MAX_HANDOFF_TEXT_CHARS; // 64 * 1024
// text = content.slice(0, MAX_HANDOFF_TEXT_CHARS)
```

## Long report composed in one turn

**Problem.** Composing a 10-15K token report then writing it once looks efficient. Nothing warns that the streaming socket times out mid-generation.

**Impact.** The connection drops around the 5-10 minute mark, the whole turn is lost, and a rerun hits the same wall.

**Rule location.**

- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md)
- events-audit/references/5-report.md, 6-dashboard.md
- [`wizard: .claude/skills/wizard-development/references/ANTI-PATTERNS.md`](https://github.com/PostHog/wizard/blob/main/.claude/skills/wizard-development/references/ANTI-PATTERNS.md)

**Sources.** [PostHog/context-mill#169](https://github.com/PostHog/context-mill/pull/169), [PostHog/wizard#512](https://github.com/PostHog/wizard/pull/512)

**Frameworks.** `all`

**Wrong:**

```text
1. Compose the full audit report (10-15K output tokens).
2. Write posthog-audit-report.md once.
-> "API Error: The socket connection was closed unexpectedly"
```

**Fixed:**

```text
1. Write a skeleton: headings + <!-- SECTION_SUMMARY --> placeholders
2. Edit placeholder 1 with its real section (own turn)
3. Edit placeholder 2 ... (each tool call resets the timer)
4. Grep for leftover `{{` before finishing
# notebooks: notebooks-create-markdown + one notebooks-add-cell per section
```

## Large JSON merged inside a model turn

**Problem.** The agent echoes or merges subagent output in chat before writing, which looks harmless but streams hundreds of rows twice.

**Impact.** Runs crashed at max\_tokens when the orchestrator materialized the enriched JSON in one turn, and earlier runs wasted about 150 seconds streaming JSON before Write.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/3-enrich.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/3-enrich.md) (Phase 3, concat via jq, 'Don't merge in a model turn')
- 4-query.md (Output discipline)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168)

**Frameworks.** `all`

**Wrong:**

```text
"Here's the merged inventory:" { ...hundreds of rows... }
Write(.posthog-events-inventory.json, <same JSON again>)
```

**Fixed:**

```bash
# each subagent writes .posthog-events-inventory.part-N.json (no JSON echoed in chat)
jq -s --argjson es "$EXCEPTION_SITES" --argjson wa "$WRAPPER_ALIASES" \
  '{rows: (add | sort_by(.file, .line)), exception_sites: $es, wrapper_aliases: $wa, wrapper_undetected: false}' \
  .posthog-events-inventory.part-*.json > .posthog-events-inventory.json.tmp \
  && mv .posthog-events-inventory.json.tmp .posthog-events-inventory.json \
  && rm .posthog-events-inventory.part-*.json
# 4-query.md: one MCP call, one in-place merge, one Write; no 'here's the updated inventory' preamble
```

## Event plan file misplaced or fields renamed

**Problem.** A prompt saying 'event name, description, file path' lets the agent pick its own keys. Agents also write planning files in the wrong place or list events only in prose, and some steps lacked Write permission.

**Impact.** The wizard's event-plan view and outro render blank with no error, the report loses its events table, and a stray file lands in the repo.

**Rule location.**

- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (allowedTools)
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md)
- `wizard: src/lib/task-stream/event-plan-watcher.ts`

**Sources.** [PostHog/context-mill#188](https://github.com/PostHog/context-mill/pull/188), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [context-mill@1ee8552](https://github.com/PostHog/context-mill/commit/1ee85521c21efd00776f25d7e657b46900a04b7b), [PostHog/wizard#891](https://github.com/PostHog/wizard/pull/891), [PostHog/wizard#677](https://github.com/PostHog/wizard/pull/677)

**Frameworks.** `all`

**Wrong:**

```json
// ./.posthog-events.json (project root, written last)
[{ "name": "todo_created", "desc": "adds a todo", "path": "src/todos.ts" }]
```

**Fixed:**

```json
// v2 capture: .posthog-wizard-cache/.posthog-events.json, written before editing
[{ "event": "todo_created", "description": "User adds a todo", "file": "src/todos.ts" }]
// v1 skill pins: event_name, event_description, file (project root)
// capture step allowedTools: [Read, Write, Edit, Glob, Grep]
// watcher accepts event_name | name | event, event_description | description
```

## Shell retries to delete a blocked temp file

**Problem.** Told unconditionally to remove the file, an agent blocked by the sandbox treats it as an obstacle and escalates through rm -f, unlink and node or python instead of stopping.

**Impact.** The top bash denial on the pi harness (about 31 per week) and a wasted retry loop, for a file the host deletes anyway.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md)
- `wizard: src/lib/agent/runner/harness/pi/index.ts` (cleanup), pi runtime-notes.ts

**Sources.** [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214), [PostHog/wizard#816](https://github.com/PostHog/wizard/pull/816), [PostHog/wizard#833](https://github.com/PostHog/wizard/pull/833), [PostHog/wizard#834](https://github.com/PostHog/wizard/pull/834), [PostHog/wizard#894](https://github.com/PostHog/wizard/issues/894)

**Frameworks.** `all`

**Wrong:**

```bash
rm .posthog-events.json            # denied by the harness fence
rm -f .posthog-events.json         # retry
unlink .posthog-events.json        # shell fallback
node -e "fs.unlinkSync('.posthog-events.json')"
```

**Fixed:**

```text
Update `.posthog-events.json` to match the events you implemented, then remove it
with your file tools. If removal is blocked or fails, leave the file in place and
move on; the wizard host cleans it up after the run. Do not retry the removal or
reach for shell commands to force it.
```

## Model leaks tool-call tokens into written files

**Problem.** gpt-5.x streaming with tools can write its own function-call grammar into the string arguments of a write or edit call, and the write still succeeds, so nothing flags the corruption.

**Impact.** A syntax-broken file lands in the customer's repo while the run reports success. Run 9704a73e shipped a broken app/global-error.tsx.

**Rule location.**

- `wizard: src/lib/agent/runner/harness/pi/security.ts` (TRANSPORT\_LEAK\_PATTERNS, observeTransportLeak)
- `context-mill: context/agents/integration-v2/{install,init,error-tracking,dashboard,report}.md` (model\_pi, effort\_pi)

**Sources.** [PostHog/wizard#1017](https://github.com/PostHog/wizard/pull/1017), [wizard@af69880](https://github.com/PostHog/wizard/commit/af698807), [PostHog/context-mill#293](https://github.com/PostHog/context-mill/pull/293), [context-mill@edd91e9](https://github.com/PostHog/context-mill/commit/edd91e9e), [context-mill@edd91e9](https://github.com/PostHog/context-mill/commit/edd91e9eb55c52591816f622a83a6a3903d95405)

**Frameworks.** `all`, `next-js`

**Wrong:**

```text
write {"path":"app/global-error.tsx",
  "content":"...' }#+#+.functions.complete_task (commentary json>tagger..."}
# write succeeds; file now holds leaked tokens plus a DEL byte
```

**Fixed:**

```ts
// pi security extension: observe-only, one event per leaking write/edit
const TRANSPORT_LEAK_PATTERNS = [
  { pattern: /functions\.(?:complete_task|enqueue_task|read_handoffs)/, label: 'leaked tool-call tokens' },
  { pattern: /<\|(?:channel|constrain|message|call|end|start|return)\|>/, label: 'leaked channel markers' },
  { pattern: /[\0-\x08\x0B\f\x0E-\x1F\x7F]/, label: 'control characters' },
];
// observeTransportLeak -> 'file content leak observed' { tool, leak, leak_offset, content_length, at_end }
# agent frontmatter: model_pi openai/gpt-5.6-terra (was luna), effort_pi: low
```

## Guessed or stale model ids rejected

**Problem.** Model ids from training data or dated variants look valid, but the gateway admits only an allow-list the agent cannot see, and dispatch once accepted any string.

**Impact.** A task runs on a dead gateway id with zero tokens and fails, the planner burns a turn reading the allow-list from an error, or a pinned prompt fails at admission.

**Rule location.**

- `wizard: src/lib/agent/runner/switchboard/models.ts` (VALID\_MODELS, requireKnownModel)
- src/lib/agent/runner/sequence/orchestrator/queue-tools.ts (ENQUEUE\_MODEL\_DESCRIPTION, invalid-model guard)
- src/lib/agent/runner/harness/pi/orchestrator-tools.ts
- `context-mill: context/agents/integration-v2/*.md` frontmatter (model\_sdk, model\_pi)

**Sources.** [PostHog/wizard#963](https://github.com/PostHog/wizard/pull/963), [PostHog/wizard#1194](https://github.com/PostHog/wizard/pull/1194), [PostHog/context-mill#389](https://github.com/PostHog/context-mill/pull/389)

**Frameworks.** `all`

**Wrong:**

```text
enqueue_task({ type: 'capture', model: 'openai/gpt-5' })  // retired id
enqueue_task({ type: 'review', model: 'gpt-5.6' })
-> Model "gpt-5.6" is not allowed. Omit model to use the task default, or pick one of: ...
# frontmatter
model_sdk: claude-haiku-4-5-20251001
```

**Fixed:**

```text
enqueue_task({ type: 'review', dependsOn: [...] })   // omit model
// ENQUEUE_MODEL_DESCRIPTION lists VALID_MODELS on both harness schemas
model: requireKnownModel(spec.model, pick.model)  // throws on unknown id
model_sdk: claude-haiku-4-5   # undated id from the allowlist
model_sdk: claude-sonnet-5    # was claude-sonnet-4-6
```

## Planner retries a product this run excludes

**Problem.** An 'unknown task type' error looks transient, so the planner retries and then wires downstream tasks to a task that never exists.

**Impact.** Wasted turns, and dependsOn references that strand or reject review and report.

**Rule location.**

- [`context-mill: context/agents/integration-v2/integrate-posthog.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/integrate-posthog.md) (after the task graph list)
- [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts) (checkEnqueueGuards: unknown-type, unknown-dep)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `all`

**Wrong:**

```js
enqueue_task({ type: 'ai-observability' })  // not offered this run
-> Unknown task type "ai-observability". Valid types: ...
// retries, then review.dependsOn lists the missing task
```

**Fixed:**

```text
If `enqueue_task` does not offer a task's type, this run excludes that product
— skip it rather than retrying, and hang nothing off it.
```

## Instructions demand a task tool that is absent

**Problem.** The skill says 'call TaskCreate immediately', and an obedient agent searches for a tool its session never mounted.

**Impact.** Turns burned hunting for the tool and a complaint remark every run (36 of 223 remarks in one cycle).

**Rule location.**

- [`wizard: src/agent/runner/switchboard/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/switchboard/commandments.ts) (TASK\_LIST\_MANAGEMENT, linear only, earlier taskTracking/taskTools option in src/lib/agent/commandments.ts)
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md)

**Sources.** [PostHog/wizard#958](https://github.com/PostHog/wizard/pull/958), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/wizard#588](https://github.com/PostHog/wizard/issues/588)

**Frameworks.** `all`

**Wrong:**

```text
TaskCreate(...)   # tool not available
# remark: 'task-management tooling not offered'
```

**Fixed:**

```text
# wizard switchboard/commandments.ts: TASK_LIST_MANAGEMENT is LINEAR only;
# an orchestrator task session holds no Task tools and reports through
# complete_task, so the Task-tool rules are not sent there
# context-mill 1-begin.md still says: call `TaskCreate` immediately (runtimes that mount it)
```

## Agent exits or fabricates instead of aborting

**Problem.** When a precondition like a stable user id is missing, agents improvise a fallback id or try to halt the process, since they do not know the harness has an abort channel.

**Impact.** Inconsistent run state, and invented distinct ids corrupt person data.

**Rule location.**

- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) (tenet 1, abort lines)
- [`context-mill: context/skills/integration/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/1-begin.md) (Abort statuses)
- [`wizard: src/agent/agent-interface.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts) (\[ABORT\] detection)

**Sources.** [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [PostHog/wizard#389](https://github.com/PostHog/wizard/pull/389), [context-mill@4142e84](https://github.com/PostHog/context-mill/commit/4142e84c)

**Frameworks.** `all`

**Wrong:**

```js
// no stable id found
process.exit(1)
// or
const distinctId = stripeCustomerId
```

**Fixed:**

```text
[ABORT] Could not find a PostHog distinct_id
# revenue-analytics skill: "Never fabricate the value" (do NOT substitute a Stripe customer ID)
# 1-begin.md: "Do NOT attempt to exit or halt yourself" -
# the wizard middleware catches [ABORT] and terminates the run
```

## Missing prerequisite must hard-stop the run

**Problem.** Prose like 'tell the user and stop' is not enforced. The agent narrates the gap and keeps editing to be helpful.

**Impact.** The run continues past a broken precondition and ends with a normal success outro over fabricated changes.

**Rule location.**

- [`wizard: src/agent/agent-interface.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts) (\[ABORT\] detection, gated on abortCases.length > 0), src/agent/runner/sequence/linear.ts (matched AbortCase outro), src/programs/revenue-analytics/detect.ts#REVENUE\_ABORT\_CASES
- [`context-mill: context/skills/revenue-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/revenue-analytics/description.md) context/skills/integration/references/1-begin.md

**Sources.** [PostHog/wizard#389](https://github.com/PostHog/wizard/pull/389), [PostHog/context-mill#107](https://github.com/PostHog/context-mill/pull/107), [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/wizard#1052](https://github.com/PostHog/wizard/pull/1052), [PostHog/wizard#1433](https://github.com/PostHog/wizard/pull/1433)

**Frameworks.** `all`

**Wrong:**

```text
Skill prose: "If there is no Stripe integration, tell the user and stop."
Agent: explains the gap in one message, then keeps editing files
Run ends with the normal success outro
```

**Fixed:**

```ts
const match = block.text.match(/\[ABORT\]\s*(.+?)(?:\n|$)/)
if (match) {
  abortReason = match[1].trim()
  abortController.abort(); signalDone()
}
// linear.ts: abortCases.find(c => c.match.test(reason)) -> error outro + docsUrl
// skill: [ABORT] Could not find a Stripe integration
```

## Agent gives up without a stated reason

**Problem.** A generic agent ends its turn with a summary at a dead end. Nothing tells it a machine-readable reason is needed.

**Impact.** Failures land with no reason and can't be categorized: 10 of 19 mcp-analytics aborts had none.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (### Abort cases, under Scope and guardrails)

**Sources.** [PostHog/context-mill#210](https://github.com/PostHog/context-mill/pull/210)

**Frameworks.** `mcp-analytics`

**Wrong:**

```text
# could not find the server entry point
# agent ends its turn with a summary, no [ABORT] marker
```

**Fixed:**

```text
If anything blocks instrumentation, **always** emit exactly one
`[ABORT] <reason>` line and stop - never halt silently. Use one of:
- [ABORT] no mcp server found
- [ABORT] unsupported language for mcp analytics
- [ABORT] could not locate the server entry point
- [ABORT] <short specific reason>
The wizard catches [ABORT]; don't try to exit yourself.
```

## Required SDKs live in monorepo subpackages

**Problem.** Checking only the root package.json is the obvious move, but split apps keep posthog-js and stripe in different packages.

**Impact.** A valid frontend/backend split looks like missing Stripe or PostHog, and the agent installs or invents the missing piece.

**Rule location.** [`wizard: src/programs/revenue-analytics/detect.ts#detectRevenuePrerequisites`](https://github.com/PostHog/wizard/blob/main/src/programs/revenue-analytics/detect.ts) src/programs/shared/package-scanning.ts#findPackageJsons

**Sources.** [PostHog/wizard#385](https://github.com/PostHog/wizard/pull/385), [PostHog/wizard-workbench#1114](https://github.com/PostHog/wizard-workbench/pull/1114)

**Frameworks.** `stripe`, `posthog-js`, `posthog-node`, `monorepos`

**Wrong:**

```text
# reads only root package.json
# apps/web has posthog-js, apps/api has stripe
# concludes Stripe is missing and sets it up from scratch
```

**Fixed:**

```ts
findPackageJsons(installDir) // bounded walk, maxDepth 3, ignored dirs skipped
// union PostHog + Stripe SDKs across every package.json
// none         -> { kind: 'no-sdks' }
// stripe only  -> { kind: 'missing-posthog' }
// posthog only -> { kind: 'missing-stripe' }
```

## Framework skills miss shared browser and server rules

**Problem.** Rules attach by runtime tag, and Next.js, Nuxt, React Router or TanStack variants tagged only 'javascript' silently skip javascript\_web and javascript\_node rules.

**Impact.** Silent: agents in full-stack frameworks captured PII and skipped identify/reset and flush rules they never saw.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (variant tags)
- scripts/lib/skill-generator.js#collectCommandments
- scripts/lib/tests/skill-generator-tag-implications.test.js

**Sources.** [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [context-mill@2353588](https://github.com/PostHog/context-mill/commit/23535881)

**Frameworks.** `nextjs`, `nuxt`, `react-router`, `sveltekit`, `astro`, `tanstack-start`, `tanstack-router`, `vue`, `angular`

**Wrong:**

```yaml
- id: nextjs-app-router
  tags: [nextjs, react, ssr, app-router, javascript]
- id: react-router-7-framework
  tags: [react, react-router, v7, framework, ssr, javascript]
```

**Fixed:**

```yaml
- id: nextjs-app-router
  tags: [nextjs, react, ssr, app-router, javascript,
         javascript_web, javascript_node]
# SPA variants (data, declarative, tanstack-router): ..., javascript, javascript_web
# collectCommandments() is a plain per-tag lookup; test covers it
```

## Critical setup buried in reference docs is skipped

**Problem.** Agents follow terse rule lists but skim long bundled docs, so a requirement that lives only in reference prose is dropped even when it is in context.

**Impact.** Setup like flushing in Laravel queue workers is silently omitted and events are lost.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (laravel, line ~182)
- scripts/lib/skill-generator.js (writes references/COMMANDMENTS.md)

**Sources.** [PostHog/context-mill#282](https://github.com/PostHog/context-mill/pull/282), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [context-mill@5ddce45](https://github.com/PostHog/context-mill/commit/5ddce459)

**Frameworks.** `laravel`

**Wrong:**

```php
// references/laravel.md 'Long-running processes' section ignored
public function handle() {
    PostHog::capture(['distinctId' => $id, 'event' => 'triage_completed']);
}
```

**Fixed:**

```yaml
# context/commandments.yaml, laravel:
- Call PostHog::flush() after capture in queue jobs, Horizon, and Octane
  - a long-running worker never destructs, so events sit in the SDK buffer
# emitted as references/COMMANDMENTS.md ('# Framework rules') for task agents
```

## No example app, every run differs

**Problem.** With only docs, a capable agent invents its own init, identify and capture shapes each time, all plausible and all different, so known edge cases recur at random.

**Impact.** High run-to-run variance. Call sites drift from documented patterns.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (example\_paths)
- [`context-mill: context/skills/integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) (line 21)

**Sources.** [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270)

**Frameworks.** `go`, `rust`, `java`, `elixir`, `flutter`

**Wrong:**

```yaml
- id: go
  template: description-docs-only.md
  # no example_paths -> agent improvises structure
```

**Fixed:**

```yaml
- id: go
  framework: go
  example_paths: example-apps/go   # compiling anchor
- id: java
  framework: java
  example_paths: example-apps/java-spring-boot
# description.md: 'Match the example ... follow its patterns as closely as possible'
```

## Misspelled config key ships no example

**Problem.** The generator reads only example\_paths, so a singular example\_path is ignored without warning.

**Impact.** integration-react-vite, integration-javascript-node and integration-javascript-web are built without EXAMPLE.md, so their reference code never reaches the agent.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (react-vite, javascript\_node, javascript\_web still use example\_path)
- scripts/lib/skill-generator.js (reads group/variation example\_paths only)

**Sources.** [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [context-mill@c61c681](https://github.com/PostHog/context-mill/commit/c61c6811), [`skills: skills/posthog/integration/skills/javascript_web/references`](https://github.com/PostHog/skills/tree/main/skills/posthog/integration/skills/javascript_web/references)

**Frameworks.** `react-vite`, `javascript_node`, `javascript_web`

**Wrong:**

```yaml
- id: react-vite
  example_path: example-apps/react-vite   # generator reads only example_paths
  display_name: React (Vite)
```

**Fixed:**

```yaml
- id: react-vite
  example_paths: example-apps/react-vite
  display_name: React (Vite)
# same fix for javascript_node and javascript_web
```

## Example bundle hides build and dependency manifests

**Problem.** Global skips for .json, .yaml and .gradle drop the files that show real dependency and build wiring, so the agent falls back to README text instead.

**Impact.** The agent misses project wiring such as the posthog\_flutter dependency, minSdk in app/build.gradle, or XcodeGen project.yml, and edits generated files or trusts README env var names that drifted.

**Rule location.**

- [`context-mill: context/skip-patterns.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skip-patterns.yaml) (examples.swift-xcodegen.allow, examples.integration-flutter.allow)
- scripts/lib/example-processor.js#shouldSkip
- [`context-mill: example-apps/angular/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/README.md)

**Sources.** [PostHog/context-mill#213](https://github.com/PostHog/context-mill/pull/213), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#418](https://github.com/PostHog/context-mill/pull/418)

**Frameworks.** `angular`, `flutter`, `swift`

**Wrong:**

```yaml
global:
  includes: [.yaml, .yml, .json, build]
# pubspec.yaml, project.yml, app/build.gradle never reach EXAMPLE.md
# Angular README (stale): VITE_POSTHOG_PROJECT_TOKEN=...
```

**Fixed:**

```yaml
swift-xcodegen:
  allow: [project.yml]
integration-flutter:
  allow: [pubspec.yaml, app/build.gradle]   # allow wins over skip
# code: NG_APP_POSTHOG_PROJECT_TOKEN via @ngx-env/builder;
# Angular README still says VITE_ (fix pending in #418)
```

## Stale example README reintroduces fixed bugs

**Problem.** The agent copies README and template snippets packed into EXAMPLE.md, which still show the pre-fix shape or nonexistent APIs while the real code moved on.

**Impact.** Email-as-id and tag() PII come back, Angular gets VITE\_ vars, or Android integrations call a PostHog.getInstance() that never existed and fail to compile.

**Rule location.**

- [`context-mill: example-apps/flask/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/README.md) (lines 46-50), example-apps/flask/app/templates/{burrito,profile}.html
- [`context-mill: example-apps/angular/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/README.md) (VITE\_ vars)
- [`context-mill: example-apps/android/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/android/README.md)
- scripts/lib/example-processor.js

**Sources.** [PostHog/context-mill#271](https://github.com/PostHog/context-mill/pull/271), [PostHog/context-mill#418](https://github.com/PostHog/context-mill/pull/418), [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [context-mill@bc5201a](https://github.com/PostHog/context-mill/commit/bc5201ae)

**Frameworks.** `flask`, `android`, `angular`

**Wrong:**

```python
# example-apps/flask/README.md (stale; burrito.html and profile.html show identify_context(current_user.email))
with new_context():
    identify_context(user.email)
    tag('email', user.email)
    tag('is_staff', user.is_staff)
    capture('user_signed_up', properties={'signup_method': 'form'})
```

**Fixed:**

```python
# app/main/routes.py (real code)
with new_context():
    identify_context(str(user.id))
    posthog.set(distinct_id=str(user.id),
                properties={'email': user.email, 'is_staff': user.is_staff})
    capture('user_logged_in', properties={'login_method': 'password'})
```

## Build output and tests pollute example context

**Problem.** Skip rules silently missed (wrong lookup key, unanchored test pattern, dirty tree), so generated code and specs are presented to the agent as the target implementation.

**Impact.** A 450 KB sourcemap and 25 junk sections crowd out the integration code. Laravel ships generated bootstrap cache (17% of the skill).

**Rule location.**

- [`context-mill: context/skip-patterns.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skip-patterns.yaml) (global.includes, global.regex)
- scripts/lib/skill-generator.js line ~648 (still the buggy lookup on main)
- scripts/lib/example-processor.js (shouldSkip)

**Sources.** [PostHog/context-mill#284](https://github.com/PostHog/context-mill/issues/284), [PostHog/context-mill#285](https://github.com/PostHog/context-mill/pull/285), [PostHog/context-mill#363](https://github.com/PostHog/context-mill/pull/363), [PostHog/context-mill#76](https://github.com/PostHog/context-mill/pull/76), [PostHog/context-mill#304](https://github.com/PostHog/context-mill/pull/304)

**Frameworks.** `laravel`, `nuxt`, `nextjs`, `android`, `react-native`, `all`

**Wrong:**

```text
skipPatterns.examples[isSingle ? skill.id : dirName]  // 'integration-laravel' -> undefined
- /test/        # misses root tests/
## .nuxt/dist/server/server.mjs.map   (450 KB)
```

**Fixed:**

```yaml
# skip-patterns.yaml global.includes (merged, #363)
- .nuxt
- .output
- .map
# open PRs, not yet on main:
# #285 mergeSkipPatterns(global, examples?.[dirName])
# #304 regex: ['^(tests?|e2e)[\\/]']
```

## Moved docs pages ship stale or empty

**Problem.** The build fetcher follows redirects silently, so skills drift to old pages with no signal and the agent trusts them.

**Impact.** Agents read outdated product docs, or a page that has moved or 404s breaks the build.

**Rule location.**

- [`context-mill: scripts/lib/skill-generator.js#fetchDocOnce/fetchDoc`](https://github.com/PostHog/context-mill/blob/main/scripts/lib/skill-generator.js)
- [`context-mill: context/skills/ai-observability/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/config.yaml) and context/skills/llm-analytics/config.yaml

**Sources.** [PostHog/context-mill#296](https://github.com/PostHog/context-mill/pull/296), [PostHog/context-mill#297](https://github.com/PostHog/context-mill/pull/297), [PostHog/context-mill#155](https://github.com/PostHog/context-mill/pull/155)

**Frameworks.** `all`

**Wrong:**

```yaml
docs_urls:
  - https://posthog.com/docs/llm-analytics/installation/openai.md  # redirects now
```

**Fixed:**

```yaml
docs_urls:
  - https://posthog.com/docs/ai-observability/installation/openai.md
# URLs repointed by hand sweep (#296).
# fetchDocOnce throws on 404; redirects still followed silently.
# HTML-body guard + drift report (#297) closed, NOT on main.
```

## Skill references listed without their folder

**Problem.** Bare filenames look fine to authors, but the agent resolves paths exactly as written from the skill root and cannot find the files.

**Impact.** The agent stumbles on missing files, skips the docs and example, and falls back to memory.

**Rule location.** [`context-mill: scripts/lib/skill-generator.js`](https://github.com/PostHog/context-mill/blob/main/scripts/lib/skill-generator.js) (referencesText)

**Sources.** [PostHog/context-mill#97](https://github.com/PostHog/context-mill/pull/97)

**Frameworks.** `all`

**Wrong:**

```markdown
- `next-js.md` - Next.js docs
- `EXAMPLE.md` - example project code
- `basic-integration-1.3-conclude.md` - Review and fix any errors
```

**Fixed:**

```markdown
- `references/next-js.md` - Next.js docs
- `references/EXAMPLE.md` - example project code
- `references/basic-integration-1.3-conclude.md` - Review and fix any errors
```

## Installed skill examples pollute code search

**Problem.** Skills land inside the project, so the agent's grep for existing PostHog code matches skill examples.

**Impact.** Skill example lines can be mistaken for existing instrumentation, and context bloats.

**Rule location.**

- `wizard: src/ui/tui/screens/KeepSkillsScreen.tsx`
- [`context-mill: context/skills/integration/`](https://github.com/PostHog/context-mill/tree/main/context/skills/integration) (per-framework variants)
- [`context-mill: context/skills/omnibus/`](https://github.com/PostHog/context-mill/tree/main/context/skills/omnibus) (the aggregated alternative)

**Sources.** [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87)

**Frameworks.** `all`

**Wrong:**

```bash
$ grep -rn posthog .
./.claude/skills/nextjs-app-router/references/EXAMPLE.md:posthog.capture('burrito_considered', {
./.claude/skills/nextjs-app-router/references/EXAMPLE.md:posthog.identify(username, {
```

**Fixed:**

```text
Install one targeted skill for the project's stack (context/skills/integration),
not a monolithic all-variants skill (omnibus-* is for plugin use).
After the run, KeepSkillsScreen asks whether to keep .claude/skills/
and removes the wizard-installed ones if declined.
```

## Skill cites missing sections and stale counts

**Problem.** The model cannot tell a reference to a nonexistent section from real guidance, so it improvises silently.

**Impact.** Area framing differs every run and counts like 'all 12 rows' contradict the ledger.

**Rule location.**

- [`context-mill: context/skills/audit/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/description.md)
- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) (### Canonical area copy)

**Sources.** [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324)

**Frameworks.** `all`

**Wrong:**

```text
6-report.md: "Use the canonical area copy below"   (no such section)
description.md: "6-step chain", "13 pending checks", "all 12 rows"
```

**Fixed:**

```text
### Canonical area copy   (section now written, covers all four areas)
The chain is defined by the step files, not by any count: follow next_step.
Refer by name ("the live-data step"), never ordinal.
Read the ledger to see what you were given rather than assuming a fixed set.
```

## Uncapped live findings bury audit checks

**Problem.** Adding a row per open finding seems complete. Nothing caps it.

**Impact.** A project with 40 open findings would flood the Audit plan tab and hide source-tree checks.

**Rule location.** [`context-mill: context/skills/audit/references/5-live-data.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/5-live-data.md) (section c, and the sweep-row status text)

**Sources.** [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324)

**Frameworks.** `all`

**Wrong:**

```ts
audit_add_checks({ checks: [ ...40 rows, one per open finding... ] })
```

**Fixed:**

```text
### c. Cap the list at 8
Sort error, warning, suggestion; keep the first 8.
Cap before (d), never after: do not fetch remediations you throw away.
Sweep details: "8 of 23 open findings from PostHog (most severe first)"
```

## One resolve call drops every finding

**Problem.** Skills load from releases/latest against older wizards, which reject the whole batch on one unknown id.

**Impact.** Every gathered live-data finding is discarded.

**Rule location.**

- [`context-mill: context/skills/audit/references/5-live-data.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/5-live-data.md) (Resolve section)
- `wizard: src/lib/programs/audit/seed.ts` (seeds live-data-findings), src/lib/wizard-tools/tools.ts (unknown check id rejection)

**Sources.** [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324), [PostHog/wizard#1061](https://github.com/PostHog/wizard/pull/1061)

**Frameworks.** `all`

**Wrong:**

```ts
audit_resolve_checks({ updates: [
  { id: 'live-data-source-maps', status: 'warning', details: '...' },
  { id: 'live-data-findings', status: 'pass' }   // unknown on older wizards
]})
```

**Fixed:**

```text
1) audit_resolve_checks the appended finding rows
2) audit_resolve_checks { id: 'live-data-findings', status: 'pass' }
If 2 returns `unknown check id(s): live-data-findings`, the wizard predates it: not an error.
```

## Signal sources enabled while their products are off

**Problem.** Turning on a source succeeds without error, so the agent assumes the underlying product is live. On a fresh project it is not.

**Impact.** Sources sit idle with nothing to read, silently. Conversations was skipped entirely for lack of prior usage.

**Rule location.** [`context-mill: context/skills/self-driving/references/3-enable-products.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/3-enable-products.md) 4-sources.md (Enable table, session\_replay/session\_analysis\_cluster is retired)

**Sources.** [PostHog/context-mill#209](https://github.com/PostHog/context-mill/pull/209), [PostHog/context-mill#370](https://github.com/PostHog/context-mill/pull/370)

**Frameworks.** `self-driving`

**Wrong:**

```text
inbox-source-configs-create { source_product: "error_tracking",
  source_type: "issue_created", enabled: true }
# product never switched on -> source reads nothing
# conversations source skipped: "no prior usage evidence"
```

**Fixed:**

```text
# Step 3, before sources:
products-enable { "products": ["session_replay", "error_tracking", "conversations"] }
# -> { "results": { <product>: "enabled" | "already_enabled" } }
# Step 4 then enables error_tracking (3 rows) and conversations/ticket by default;
# conversations idles until a channel connects. Replay goes via 6c scanners, not a source.
```

## Codebase scan suggests Postgres as an issue tracker

**Problem.** Reusing an existing broad detector is the easy path, but it over-matches on things like DATABASE\_URL, and with no list the agent invents its own scan.

**Impact.** The connected-tools ask opens with Postgres, Stripe and OpenAI instead of the Sentry, Linear or GitHub the user has.

**Rule location.**

- `wizard: src/lib/programs/self-driving/detect.ts` (SELF\_DRIVING\_TOOL\_KINDS, detectConnectedTools, SELF\_DRIVING\_DETECTED\_TOOLS\_KEY)
- src/lib/programs/self-driving/prompt.ts (renderDetectedTools)

**Sources.** [PostHog/wizard#1028](https://github.com/PostHog/wizard/pull/1028), [PostHog/wizard#1022](https://github.com/PostHog/wizard/pull/1022)

**Frameworks.** `self-driving`

**Wrong:**

```ts
const sources = detectWarehouseSources(installDir); // pg, stripe, openai...
setFrameworkContext(KEY, sources);
```

**Fixed:**

```ts
const tools = detectWarehouseSources(installDir).filter((s) =>
  SELF_DRIVING_TOOL_KINDS.has(s.kind),
); // Github, GitLab, Linear, Jira, Sentry, Rollbar, Zendesk, ...
setFrameworkContext(SELF_DRIVING_DETECTED_TOOLS_KEY, tools);
// prompt says 'none found' on an empty scan so the agent does not scan itself
```

## Consent question hides per-PR cost

**Problem.** Asking 'which of these do you use?' over tool names reads as a stack question, not consent to paid automation.

**Impact.** Support ticket 65283: a user picked Linear and woke to 14 unrequested PRs and a $345 bill.

**Rule location.** [`context-mill: context/skills/self-driving/references/5-connected-tools.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5-connected-tools.md) (Step 5 intro and Do 1)

**Sources.** [PostHog/context-mill#292](https://github.com/PostHog/context-mill/pull/292)

**Frameworks.** `self-driving`

**Wrong:**

```js
{ prompt: "Self-driving can also watch your other tools... Which of these do you use?",
  options: [{ label: "Linear", value: "linear" }, { label: "Jira", value: "jira" }] }
```

**Fixed:**

```js
{ prompt: "Self-driving reads everything open in these and automatically opens\n  a draft PR for what it can fix — $15 each. Which do you use?",
  options: [{ label: "None of these", value: "none" },
            { label: "Linear (per issue)", value: "linear" },
            { label: "Zendesk (per ticket)", value: "zendesk" }] }
```

## Committing option listed first

**Problem.** Agents naturally list the action first, but the first option is the default highlight.

**Impact.** A reflexive Enter enables something the user never chose.

**Rule location.** [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) ("Decline goes first")

**Sources.** [PostHog/context-mill#192](https://github.com/PostHog/context-mill/pull/192)

**Frameworks.** `self-driving`

**Wrong:**

```text
wizard_ask options: ["Enable Linear + GitHub Issues", "Skip"]
```

**Fixed:**

```text
wizard_ask options: ["None, keep what's there", "Enable Linear + GitHub Issues"]
// decline always first, so an accidental Enter declines
```

## Duplicate picker labels widen the selection

**Problem.** Using team names as labels looks natural. The picker keys ticks by label, which the agent cannot see.

**Impact.** One tick selects several teams, or a team named 'All teams' enables every team.

**Rule location.** [`context-mill: context/skills/self-driving/references/5b-linear.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5b-linear.md) (step 4, unique labels)

**Sources.** [PostHog/context-mill#396](https://github.com/PostHog/context-mill/pull/396)

**Frameworks.** `self-driving`, `linear`

**Wrong:**

```js
options: [
  { label: "All teams", value: "all" },
  { label: "Platform", value: "t1" },
  { label: "Platform", value: "t2" }   // one tick submits t1 and t2
]
```

**Fixed:**

```js
options: [
  { label: "All teams", value: "all" },
  { label: "Platform (t1)", value: "t1" },   // append (<team id>) to colliding labels
  { label: "Platform (t2)", value: "t2" }
]
```

## Landing page strips UTMs before init

**Problem.** Query-string cleanup or a www redirect looks unrelated to analytics, and the loss is silent.

**Impact.** Ad campaign attribution disappears. The first pageview carries no UTMs.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/2-attribution-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/2-attribution-fix.md) (Task A, attribution-utm-survives-landing)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `next-js`, `react`, `astro`, `javascript-web`

**Wrong:**

```tsx
// same tree as <PostHogProvider>
useEffect(() => { router.replace(pathname) }, [])
// or middleware redirect www -> root dropping ?utm_*
```

**Fixed:**

```text
// audit-attribution, check attribution-utm-survives-landing:
// greps init sites (posthog.init) vs query manipulation (router.replace,
// history.replaceState, URLSearchParams) and middleware/redirects/rewrites.
// pass: init runs before any manipulation that drops utm_*
// suggestion: redirects could strip query -> add UTM passthrough
// recommendation: keep | preserve-utms-in-redirects | reorder-init-before-strip
```

## UTMs lost through OAuth sign-in redirect

**Problem.** Docs never cover it, and a social sign-in round trip silently drops the original query string.

**Impact.** The signup event fires without UTMs, so ad spend cannot be tied to conversions.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/2-attribution-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/2-attribution-fix.md) (Task B, attribution-survives-auth-redirect)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `next-js`, `react`, `auth0`, `clerk`, `supabase`, `firebase`

**Wrong:**

```tsx
<button onClick={() => signIn('google')}>Continue with Google</button>
// callback: posthog.identify(user.id); posthog.capture('signed_up')
```

**Fixed:**

```ts
// before redirect: stash
sessionStorage.setItem('utm', location.search)
// callback, before identify / signup capture: restore
const utm = sessionStorage.getItem('utm')
// alternatives: OAuth state param, short-lived first-party cookie
// audit: warning if auth redirect flow exists and no stash+restore found
```

## Agent alarms user about internal security warnings

**Problem.** A capable agent is trained to be transparent, so when a guardrail flags a write it explains the scanner and possible compromise instead of quietly fixing the code.

**Impact.** Scary output on a normal run, and the flagged change may stay in place.

**Rule location.** [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) (YARA commandment)

**Sources.** [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305)

**Frameworks.** `all`

**Wrong:**

```text
"Warning: a security scanner flagged a possible secret leak in your
project. You may be compromised."
```

**Fixed:**

```text
[YARA WARNING]/[YARA VIOLATION] seen -> handle silently:
revert the write, avoid the flagged pattern,
never mention security warnings or YARA to the user
```

## Writing existing files without a fresh read

**Problem.** Agents assume .env does not exist or that an earlier read is enough, while harnesses refuse writes to files not read immediately before. The obvious blanket read-first rule over-corrects into reading paths that do not exist yet.

**Impact.** Tool failures and loops on .env, stale edits that clobber newer content, or an overwritten user .env.

**Rule location.**

- [`wizard: src/programs/posthog-integration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/posthog-integration/index.ts) (narrowed rule)
- src/agent/commandments.ts and src/agent/agent-prompt.ts (blanket rule)
- `context-mill: context/skills/omnibus/instrument-*/description.md` (blanket rule)

**Sources.** [PostHog/wizard#243](https://github.com/PostHog/wizard/pull/243), [PostHog/wizard#816](https://github.com/PostHog/wizard/pull/816)

**Frameworks.** `all`

**Wrong:**

```text
Write(file_path=".env", content="POSTHOG_KEY=...")
# .env already exists, never read -> tool failure
Edit(src/app/layout.tsx, ...)   // last read many turns ago
# over-correction:
read src/lib/posthog.ts -> error: file does not exist
```

**Fixed:**

```text
If a file already EXISTS, read it immediately before you edit or overwrite it -
writing from a stale read causes a tool failure. Creating a brand-new file
needs no prior read: never read a path that does not exist yet; just write it.
// other surfaces still say the blanket form: 'You must read a file immediately
// before attempting to write it' (agent-prompt.ts, omnibus instrument-*)
```

## Agent asks questions in plain text

**Problem.** In a chat client, asking a question inline is right. Inside the wizard TUI there is no text reply path, so the agent carries on with assumed answers.

**Impact.** The run stalls, or continues silently on invented answers.

**Rule location.**

- [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) (wizard\_ask commandment)
- src/agent/tools/tools.ts

**Sources.** [PostHog/wizard#459](https://github.com/PostHog/wizard/pull/459)

**Frameworks.** `all`

**Wrong:**

```text
Before I continue:
1. Which stack: React, Vue, or vanilla JS?
2. How often should the tour show?
I'll assume React and "once" and keep going.
```

**Fixed:**

```ts
wizard_ask({ questions: [
  { id: "tech-stack", kind: "single", prompt: "Which stack?",
    options: [{ label: "React", value: "react" },
              { label: "Vanilla JS", value: "vanilla-js" }] },
  { id: "show-frequency", kind: "text", prompt: "How often should the tour show?" }
] })  // one call per skill step; never inline questions expecting a reply
```

## File edits race ahead of a pending question

**Problem.** Models fire Write/Edit in the same turn as the question, assuming the answer will not change the edit, and nothing stops writes until the user answers.

**Impact.** Files change on assumptions the user's answer would have overturned, including under a credential prompt open for up to 20 minutes.

**Rule location.**

- [`wizard: src/agent/agent-interface.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts) (wizardCanUseTool, wizardAskPending)
- src/lib/agent/runner/harness/pi/security.ts

**Sources.** [PostHog/wizard#459](https://github.com/PostHog/wizard/pull/459), [PostHog/wizard#1133](https://github.com/PostHog/wizard/pull/1133), [wizard@a2b492b](https://github.com/PostHog/wizard/commit/a2b492bd)

**Frameworks.** `all`

**Wrong:**

```ts
// one assistant turn
wizard_ask({ questions: [{ id: "tech-stack", kind: "single", ... }] })
Write({ file_path: "src/app.ts", content: "..." })  // lands before the answer
```

**Fixed:**

```ts
if (context.wizardAskPending && (toolName === 'Write' || toolName === 'Edit')) {
  return { behavior: 'deny',
    message: `${toolName} is paused while a wizard_ask question is open. ` +
             `Wait for the user's answer ...` };
}
// pi task path shares askState with the fence (PR 1133)
```

## Blocked tool list silently never enforced

**Problem.** The colon form of an MCP tool name looks right but never matches the SDK's mcp\_\_server\_\_tool form.

**Impact.** The blocked tool (wizard\_ask in basic integration) stays callable by the parent and every subagent, silently.

**Rule location.**

- [`wizard: src/agent/tools/tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) (WIZARD\_TOOL\_NAMES)
- src/agent/agent-interface.ts (wizardCanUseTool)

**Sources.** [PostHog/wizard#483](https://github.com/PostHog/wizard/pull/483)

**Frameworks.** `all`

**Wrong:**

```ts
disallowedTools: ['posthog-wizard:wizard_ask']  // colon form never matches
// subagents inherit every tool, wizard_ask included
```

**Fixed:**

```ts
wizardAsk: `mcp__${SERVER_NAME}__wizard_ask`,
if (context.disallowedTools?.includes(toolName))
  return { behavior: 'deny',
    message: `Tool ${toolName} is disabled for this program.` };
// the subagent AgentDefinition also gets disallowedTools
```

## Wizard tools called through the PostHog MCP

**Problem.** Prompt text called them 'the wizard-tools MCP', so the agent routed them through the only generic MCP dispatcher it had.

**Impact.** The hosted MCP rejects the call and the task loses a turn before asking the user.

**Rule location.** [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) (pi runtime notes)

**Sources.** [PostHog/wizard#1419](https://github.com/PostHog/wizard/pull/1419)

**Frameworks.** `all`

**Wrong:**

```ts
posthog_exec({command: 'call wizard_ask {...}'})
```

**Fixed:**

```text
go straight to the wizard tools: check_env_keys, set_env_values.
posthog_exec reaches PostHog's tools only; the wizard's own tools are
called directly by name, never through posthog_exec.
```

## Project scan answers in prose, not JSON

**Problem.** Asking for JSON in the prompt does not enforce the shape, and the model prefers to explain its pick.

**Impact.** No project is selected, so the run falls back to repo-root detection and lands on the wrong project or errors.

**Rule location.**

- `wizard: src/lib/detection/agentic.ts`
- src/lib/detection/project-scope.ts

**Sources.** [PostHog/wizard#1350](https://github.com/PostHog/wizard/pull/1350), [PostHog/wizard#1305](https://github.com/PostHog/wizard/pull/1305), [PostHog/wizard#1071](https://github.com/PostHog/wizard/pull/1071)

**Frameworks.** `all`

**Wrong:**

```text
agent: "I found two projects: web (Next.js) and api (Express).
I'd recommend web."   (no JSON report, nothing to parse)
```

**Fixed:**

```ts
run.structured = { schema, timeoutMs }  // provider-native structured output
// verdict written right after reading each manifest
// one retry in a fresh session (60s then 90s);
// on failure session.installDir is left untouched
```

## Fallback agent gets no PostHog guidance

**Problem.** When the wizard cannot continue, the user pastes 'add PostHog' into their own agent, which has no skill, scope or checks.

**Impact.** An unguided integration with all the usual freestyle mistakes.

**Rule location.** `wizard: src/lib/wizard-spellbook.ts` (writeWizardSpellbook, selectSkills)

**Sources.** [PostHog/wizard#1238](https://github.com/PostHog/wizard/pull/1238)

**Frameworks.** `all`

**Wrong:**

```text
user -> own coding agent: "add PostHog to my app"
(no skill, no docs, no scope, no checks)
```

**Fixed:**

```text
.posthog/wizard-spellbook-*/README.md: task, detected framework,
"Check what has already been done", skills picked by selectSkills
(exact id -> framework reference -> flow group), scanned on download,
official docs links. "No Wizard credentials are included;
keep credentials out of source code."
```

## Stored Claude login beats the gateway token

**Problem.** The Claude binary prefers ~/.claude/.credentials.json over an injected env token, which is invisible from the harness side.

**Impact.** Users already logged into Claude get a bogus 401 at the very start of setup.

**Rule location.**

- [`wizard: src/agent/stored-login.ts#createIsolatedAgentConfigDir`](https://github.com/PostHog/wizard/blob/main/src/agent/stored-login.ts)
- src/agent/agent-interface.ts (CLAUDE\_CONFIG\_DIR at spawn)
- src/agent/mcp-prompt-streaming.ts

**Sources.** [PostHog/wizard#1180](https://github.com/PostHog/wizard/pull/1180)

**Frameworks.** `all`

**Wrong:**

```text
~/.claude/.credentials.json exists
-> binary prefers stored login over the env token -> gateway: 401
```

**Fixed:**

```ts
env: { CLAUDE_CONFIG_DIR: agentConfigDir }
// createIsolatedAgentConfigDir(): fresh empty mkdtemp dir per run,
// so the injected gateway token is the only credential left
```

## Stop hook re-prompts after an API error

**Problem.** A stop hook that always queues the next feature or remark prompt never considers that the last turn failed on auth.

**Impact.** Each blocked stop re-calls the failing API, so a 401 prints three times and the run exits slowly and confusingly.

**Rule location.**

- [`wizard: src/agent/agent-interface.ts#createStopHook`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts)
- src/agent/output-signals.ts (hasApiError)

**Sources.** [PostHog/wizard#346](https://github.com/PostHog/wizard/pull/346)

**Frameworks.** `all`

**Wrong:**

```ts
if (featureIndex < queue.length) return { decision: 'block', reason: nextFeaturePrompt };
if (!remarkRequested) {
  remarkRequested = true;
  return { decision: 'block', reason: REMARK_PROMPT };
}
```

**Fixed:**

```ts
if (signals?.hasApiError()) {   // output contains 'API Error:'
  return {};   // blocking with more prompts would fail again
}
// 401 -> getUI().showAuthError({...}) ("try claude auth logout") + wizardAbort()
```

## Valid skill id rejected, agent guesses

**Problem.** The install tool's id regex rejected underscores that real ids contain, and an agent faced with a validation error invents variants.

**Impact.** The curated Node or browser JS skill never loads. The agent burns turns on wrong ids, then reads a docs resource that does not exist.

**Rule location.**

- [`wizard: src/agent/tools/mcp.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/mcp.ts) (install\_skill skillId regex)
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (ids javascript\_node, javascript\_web)

**Sources.** [PostHog/wizard#342](https://github.com/PostHog/wizard/pull/342)

**Frameworks.** `javascript_node`, `javascript_web`

**Wrong:**

```text
install_skill("integration-javascript_node") -> Error: lowercase alphanumeric with hyphens
install_skill("integration-javascript-node") -> not found
install_skill("integration-node")            -> not found
ReadMcpResource posthog://docs/frameworks/javascript_node -> MCP error -32602
```

**Fixed:**

```ts
// id regex accepts underscores, matching the skill menu
if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.skillId)) {
  return { isError: true, content: [...] };
}
```

## Dotted skill id makes the agent hand-roll Nuxt

**Problem.** A version-style id like nuxt-3.6 looks natural, but the install\_skill validator rejects dots, and the agent recovers by improvising rather than failing.

**Impact.** Agent tries curl for the skill zip (exit 7 in its sandbox), then writes the Nuxt integration from memory without the authored skill.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (variant nuxt-3-6)
- [`wizard: src/agent/tools/mcp.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/mcp.ts) (install\_skill skillId regex)

**Sources.** [PostHog/context-mill#114](https://github.com/PostHog/context-mill/pull/114)

**Frameworks.** `nuxt`

**Wrong:**

```yaml
- id: nuxt-3.6
  example_paths: basics/nuxt-3.6
  display_name: Nuxt 3.6
# install_skill rejects id -> curl zip -> exit 7 -> hand-written integration
```

**Fixed:**

```yaml
- id: nuxt-3-6
  example_paths: example-apps/nuxt-3-6
  display_name: Nuxt 3.6
# install_skill requires /^[a-z0-9][a-z0-9_-]*$/
```

## Run starts while skill host is down

**Problem.** Without a preflight, an unreachable skill menu looks like 'no skill', and the agent improvises from its own memory instead of stopping.

**Impact.** ERROR-RESOURCE-MISSING mid-run, or an unguided integration built from stale knowledge.

**Rule location.**

- [`wizard: src/shared/health-checks/readiness.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/health-checks/readiness.ts)
- src/shared/health-checks/endpoints.ts (checkSkillsOriginHealth)
- src/tui/screens/health/HealthCheckScreen.tsx
- src/tui/programs/shared/health-check-step.ts

**Sources.** [PostHog/wizard#336](https://github.com/PostHog/wizard/pull/336), [PostHog/wizard#340](https://github.com/PostHog/wizard/pull/340), [PostHog/wizard#339](https://github.com/PostHog/wizard/pull/339)

**Frameworks.** `all`

**Wrong:**

```text
[ERROR-RESOURCE-MISSING] Could not find a suitable skill for this project.
The skill menu returned no skills for the `integration` category.
Let me try loading the Android framework documentation directly...
```

**Fixed:**

```ts
export const checkSkillsOriginHealth = async () => {
  const [github, aws] = await Promise.all([
    fetchEndpointHealth(`${GITHUB_SKILLS_BASE_URL}/skill-menu.json`),
    fetchEndpointHealth(`${AWS_SKILLS_BASE_URL}/skill-menu.json`)]);
  return combineOriginHealth(github, aws);  // Down only if both fail
};
const DEFAULT_WIZARD_READINESS_CONFIG = { downBlocksRun: ['skillsOrigin'] };
// blocked: menu reachable -> download skills and exit; unreachable -> link docs
```

## Improvises from memory when docs are unreachable

**Problem.** A generic agent treats missing docs as a soft obstacle and falls back to training data, which holds stale init options and hosts.

**Impact.** The integration ships with outdated API shapes and no signal to the user or telemetry.

**Rule location.**

- [`wizard: src/programs/posthog-integration/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/posthog-integration/index.ts) (STEP 1 prompt)
- src/agent/signals.ts (ERROR\_MCP\_MISSING, ERROR\_RESOURCE\_MISSING)
- src/agent/runner/sequence/linear.ts

**Sources.** [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176)

**Frameworks.** `all`

**Wrong:**

```text
Agent: I can't reach the PostHog MCP server, so I'll set it up from what I remember.
npm i posthog-js
posthog.init('YOUR_KEY', { api_host: 'https://app.posthog.com' })
```

**Fixed:**

```text
STEP 1: Call load_skill_menu (from the wizard-tools MCP server).
   If the tool fails, emit: [ERROR-MCP-MISSING] Could not load skill menu and halt.
   If no suitable integration skill is found, emit:
   [ERROR-RESOURCE-MISSING] Could not find a suitable skill for this project.
// harness: failed outcome with error code + manual-setup docs URL
```

## Failed skill-menu fetch leaves run wandering

**Problem.** Each harness degrades differently on a failed registry fetch, and ending the run depends on the model choosing to emit \[ABORT\].

**Impact.** Programs without a fixed skill id retry or wander instead of failing once with a clear error.

**Rule location.** `wizard: src/lib/wizard-tools/mcp.ts:157-169` src/lib/agent/runner/harness/pi/tools.ts:86-112 (open #1033)

**Sources.** [PostHog/wizard#1033](https://github.com/PostHog/wizard/issues/1033)

**Frameworks.** `ai-observability`, `feature-flags`

**Wrong:**

```text
load_skill_menu { category: "feature-flags" }
-> schema-rejected (enum fell back to ['integration'])
pi: "Error: could not load the skill menu."
# run ends only if the model emits [ABORT]
```

**Fixed:**

```text
// target behavior (open issue)
// keep category callable on startup failure;
// both harnesses return one structured registry-unavailable failure;
// runner terminates with a single actionable error
```

## Unbounded project scans run out of memory

**Problem.** Globbing \*\*/\* with dot files and reading every match is the textbook approach and works on small repos.

**Impact.** Fatal OOM in prod (3.9GB heap, ineffective mark-compacts) or minutes-long hangs on monorepos and huge files.

**Rule location.**

- [`wizard: src/shared/utils/bounded-fs.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/bounded-fs.ts)
- used by src/programs/frameworks/\*/utils.ts and detection

**Sources.** [PostHog/wizard#972](https://github.com/PostHog/wizard/pull/972), [PostHog/wizard#957](https://github.com/PostHog/wizard/pull/957)

**Frameworks.** `all`

**Wrong:**

```ts
const matches = await fg('**/pages/_app.@(ts|tsx|js|jsx)', {
  dot: true, cwd: installDir, ignore: IGNORE_PATTERNS });
const env = fs.readFileSync('.env.backup', 'utf8');   // 400MB
```

**Fixed:**

```ts
boundedGlob(patterns, { cwd, limit })  // <= 500 matches, 8 s deadline, IGNORED_DIRS skipped
readProjectFile(path)                  // files > 2 MiB skipped
walkProjectFiles(root, cb, maxDepth)   // 10k entries/dir, 100k files, symlink-loop safe
```

## Retry spiral on blocked bash commands

**Problem.** Agents habitually wrap commands with cd, 2>&1 or | tail and explore with cat, then reword after the fence blocks them.

**Impact.** Each blocked retry is a model round-trip. A top cause in run-slowness profiles.

**Rule location.** [`wizard: src/agent/runner/harness/pi/runtime-notes.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (EXPLORE, BASH\_SCOPE, FENCE\_DETERMINISTIC)

**Sources.** [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/context-mill#6](https://github.com/PostHog/context-mill/issues/6)

**Frameworks.** `all`

**Wrong:**

```bash
cd my-app && pnpm add posthog-js 2>&1 | tail -20
ls -la src && cat src/app.ts
```

**Fixed:**

```bash
pnpm add posthog-js   # bare; runs in the project root, full output returned
# explore with ls/find/grep tools; read() for files; never retry a blocked command
```

## Loose failure hints hide wizard bugs

**Problem.** Broad text patterns classify many errors as user-environment problems, and a falling exception count reads like a fix.

**Impact.** An old Codex CLI was told to run marketplace add, and a broken plugin manifest blamed the user's config.toml.

**Rule location.**

- `wizard: src/steps/add-mcp-server-to-clients/clients/codex.ts` (expectedFailureHint)
- results.ts

**Sources.** [PostHog/wizard#1295](https://github.com/PostHog/wizard/pull/1295)

**Frameworks.** `Codex`

**Wrong:**

```ts
{ pattern: /unexpected argument/, hint: 'run codex plugin marketplace add ...' }  // any stage
```

**Fixed:**

```ts
{ stages: ['marketplace add'], pattern: /.../, unless: /serde/, hint: '...' }
// emits 'wizard: mcp expected failure hinted'
```

## Question cap stops multi-source credential prompts

**Problem.** A guard nudging after three consecutive questions reads as a stop signal, and agents fall back to browser links when five sources each need several fields.

**Impact.** About 65% of warehouse tasks reported completed with no source created.

**Rule location.** `wizard: src/lib/wizard-tools` (createAskAccounting, normaliseAskSubject)

**Sources.** [PostHog/wizard#1146](https://github.com/PostHog/wizard/pull/1146)

**Frameworks.** `all`

**Wrong:**

```typescript
// guard counts every consecutive wizard_ask in the run
ask #3 -> "batch the remaining questions into one call of at most 8"
// 5 sources x 3-5 fields = impossible advice
```

**Fixed:**

```typescript
wizard_ask({ subject: 'postgres', questions: [...] })
wizard_ask({ subject: 'stripe', questions: [...] })
// adjacency counts consecutive calls with the SAME subject; maxQuestions stays per-run
```

## Report section silently dropped by harness schema

**Problem.** The agent writes the field its skill demands. The pi harness complete\_task schema simply lacked it, and the extra field was dropped without error.

**Impact.** The warehouse section never reached the run report and agents burned turns working around it.

**Rule location.**

- [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts#HANDOFF_FIELDS`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts)
- src/agent/runner/harness/pi/orchestrator-tools.ts

**Sources.** [PostHog/wizard#1086](https://github.com/PostHog/wizard/pull/1086)

**Frameworks.** `all`

**Wrong:**

```ts
complete_task({ "status": "done", "handoff": { ... },
  "reportSection": "## Data warehouse\nConnected 2 of 5 ..." })
// pi schema has no reportSection: dropped, renderHandoffContext reads nothing
```

**Fixed:**

```ts
// HANDOFF_FIELDS: one shared record read by both zod and typebox schemas,
// typed against keyof Required<TaskHandoff>;
// handoff-schema-parity.test.ts fails if the harnesses diverge
```

## Already-installed MCP reported as failed install

**Problem.** Installers infer failure from CLI exit codes, and codex plugin marketplace add exits non-zero when already registered.

**Impact.** A bare 'Installation skipped.', follow-up steps dropped, and the user cannot tell skipped, present and broken apart.

**Rule location.** `wizard: src/steps/add-mcp-server-to-clients` (installer service and result helpers)

**Sources.** [PostHog/wizard#1075](https://github.com/PostHog/wizard/pull/1075), [PostHog/wizard#354](https://github.com/PostHog/wizard/pull/354)

**Frameworks.** `codex`, `claude-code`

**Wrong:**

```ts
codex plugin marketplace add ...   # exits non-zero if registered
if (exit !== 0) outcome = 'Failed'
```

**Fixed:**

```ts
// check config.toml / `plugin list` before installing
type Result = 'installed' | 'already-installed' | { failed: string }
// redact Authorization headers in error text
```

## MCP server search stops at repo root

**Problem.** Agents check only the root manifest, but in monorepos the MCP server lives in a workspace package.

**Impact.** The run aborts with 'no mcp server found'. This was the largest named failure in the mcp-analytics funnel.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (Scope and guardrails, Abort cases)

**Sources.** [PostHog/context-mill#210](https://github.com/PostHog/context-mill/pull/210)

**Frameworks.** `mcp-analytics`, `javascript`, `python`

**Wrong:**

```text
read ./package.json  -> no @modelcontextprotocol/sdk
[ABORT] no mcp server found
```

**Fixed:**

```markdown
Search dependency manifests AND source across the whole project, including
workspace packages (packages/*, apps/*, server/, src/).
Only after an exhaustive search: emit `[ABORT] no mcp server found` and say where
you looked and to re-run from inside the package that defines the MCP server.
```

## Unanswered question silently replaced by a guess

**Problem.** When a clarifying question times out, the easy path is to fall back to a default answer and keep going.

**Impact.** The integration continues with the wrong framework, environment or setup, or dies with an unrelated error.

**Rule location.** `wizard: src/lib/wizard-ask-bridge.ts` (DEFAULT\_ASK\_TIMEOUT\_MS, CANCELLED\_SENTINEL, timedOut)

**Sources.** [PostHog/wizard#558](https://github.com/PostHog/wizard/issues/558)

**Frameworks.** `all`

**Wrong:**

```typescript
const answer = await ask(q).catch(() => defaultGuess);
proceedWith(answer);
```

**Fixed:**

```typescript
// per-question timeout (DEFAULT_ASK_TIMEOUT_MS, 5 min) returns
// CANCELLED_SENTINEL with timedOut = true; the agent is told to stop, not guess
```

## Optional-step consent asked too late

**Problem.** Asking consent when the task becomes runnable seems natural, but by then the user has tabbed away and a timeout silently declines.

**Impact.** Silent skips: the notice times out after 300s. Warehouse completion fell from 77% to about 44%.

**Rule location.**

- `wizard: src/lib/orchestrator/orchestrator-runner.ts`
- queue.ts (skip reasons)

**Sources.** [PostHog/wizard#1147](https://github.com/PostHog/wizard/pull/1147)

**Frameworks.** `all`

**Wrong:**

```ts
// consent modal at task-runnable time (median 7.1 min in)
await showNotice(task) // 300s timeout => declined
queue.skip(task)       // no reason recorded
```

**Fixed:**

```ts
// seed loop: offer consent seconds into the run, serially
for (const t of seeded) answers[t.id] = await offerNotice(t)
queue.skip(id, 'user-declined' | 'notice-timeout' | 'notice-error' | 'agent-not-needed')
```

## Interrupted run leaves user without settings.json

**Problem.** Moving a file aside and restoring it at the end works on clean runs. Nobody tests SIGINT before the restore.

**Impact.** The user is left with no .claude/settings.json and an orphaned backup. Clean runs also logged ENOENT errors.

**Rule location.** [`wizard: src/shared/claude-settings.ts#recoverOrphanedSettingsBackups`](https://github.com/PostHog/wizard/blob/main/src/shared/claude-settings.ts)

**Sources.** [PostHog/wizard#614](https://github.com/PostHog/wizard/pull/614), [PostHog/wizard#602](https://github.com/PostHog/wizard/issues/602)

**Frameworks.** `all`

**Wrong:**

```ts
fs.copyFileSync(settings, settings + '.wizard-backup');
fs.unlinkSync(settings);
// restore only in outro; copyFileSync throws ENOENT when no backup exists
```

**Fixed:**

```ts
// restore: existsSync-guard each candidate, delete backup after success (idempotent)
// backup: don't clobber an existing backup (it holds the pristine original)
recoverOrphanedSettingsBackups(workingDirectory) // startup: backup present + original absent -> restore
```

## Cheap model writes init boilerplate from memory

**Problem.** A low-tier model at low effort skips reading the installed reference example and writes framework boilerplate from training data.

**Impact.** Init lands in the wrong file with the wrong env var name and no defaults option, so the integration drifts from the reference.

**Rule location.** `context-mill: error-tracking.md` report.md, dashboard.md frontmatter (model\_pi, effort\_pi)

**Sources.** [context-mill@8a649f9](https://github.com/PostHog/context-mill/commit/8a649f9cc63226f370e4dd8a26991e85bde4f594), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#293](https://github.com/PostHog/context-mill/pull/293)

**Frameworks.** `nextjs`

**Wrong:**

```text
luna low, Next.js pages router:
  init in lib/posthog.ts, wrong env var name, no `defaults` option
  (written from model memory)
```

**Fixed:**

```yaml
# skill frontmatter pins a stronger model
model_pi: openai/gpt-5.6-terra
effort_pi: low
# same app: instrumentation-client.ts, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, defaults set
```

## Stale triage model ID over-blocks every run

**Problem.** Model IDs hardcoded in several files drift. When the gateway drops one, the triage call 404s and the fail-closed path looks like a security block.

**Impact.** User runs are over-blocked, and the failure is hard to trace to a model ID.

**Rule location.** `wizard: src/lib/agent/triage-provider.ts` agent-interface.ts, mcp-prompt-streaming.ts

**Sources.** [PostHog/wizard#530](https://github.com/PostHog/wizard/issues/530)

**Frameworks.** `all`

**Wrong:**

```ts
// triage-provider.ts
model: 'claude-haiku-4-5-20251001'
// agent-interface.ts
model: 'claude-sonnet-4-6'
```

**Fixed:**

```ts
// models.ts, one source of truth
export const TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
export const AGENT_DEFAULT_MODEL = 'claude-sonnet-4-6';
```

## Agent inherits the user's MCP servers

**Problem.** The agent SDK merges project .mcp.json, user and plugin MCP servers by default, so a third-party tool schema the wizard never chose ends up in every request.

**Impact.** One malformed third-party tool schema makes the API reject every request with a 400. The wizard is fully broken with no hint.

**Rule location.** `wizard: src/lib/agent/agent-interface.ts` and mcp-prompt-streaming.ts (strictMcpConfig, PR #1254)

**Sources.** [PostHog/wizard#1091](https://github.com/PostHog/wizard/issues/1091), [PostHog/wizard#1254](https://github.com/PostHog/wizard/pull/1254)

**Frameworks.** `all`

**Wrong:**

```typescript
query({ options: { settingSources: ['project'], permissionMode: 'acceptEdits', mcpServers } })
// API Error: 400 tools.25.custom.input_schema.properties: Property keys should match pattern
```

**Fixed:**

```typescript
query({ options: { ..., strictMcpConfig: true, mcpServers } })
// plus contract test on options.strictMcpConfig and a TOOL_SCHEMA_REJECTED triage message
```

## Test and generated files leak into skill examples

**Problem.** The agent copies whatever the example contains. Skip-pattern bugs let top-level tests/ and generated caches through without any error.

**Impact.** Silent: test files and generated framework caches fill the example context, and the agent copies or imitates them.

**Rule location.**

- [`context-mill: scripts/lib/example-processor.js`](https://github.com/PostHog/context-mill/blob/main/scripts/lib/example-processor.js) (shouldSkip, mergeSkipPatterns)
- scripts/lib/skill-generator.js:648 (buggy lookup still on main)
- [`context-mill: context/skip-patterns.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skip-patterns.yaml) (global includes /test/, examples.laravel)

**Sources.** [PostHog/context-mill#284](https://github.com/PostHog/context-mill/issues/284), [PostHog/context-mill#24](https://github.com/PostHog/context-mill/issues/24), [PostHog/context-mill#285](https://github.com/PostHog/context-mill/pull/285), [PostHog/context-mill#304](https://github.com/PostHog/context-mill/pull/304)

**Frameworks.** `laravel`, `android`, `nextjs`

**Wrong:**

```text
PACKAGED tests/example.spec.ts          # /test/ only matched nested dirs
PACKAGED bootstrap/cache/services.php   # 20KB, 17% of the Laravel skill
// skipPatterns.examples[isSingle ? skill.id : dirName]
// yaml key: laravel; skill.id: integration-laravel -> no match
```

**Fixed:**

```text
# Proposed fixes, OPEN PRs (not yet in main):
# #304 global regex in skip-patterns.yaml: root test/ and tests/
- ^tests?[/\\]
# #285 look up the example override by directory name
skipPatterns.examples?.[dirName]
```
