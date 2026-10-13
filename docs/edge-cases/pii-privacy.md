# Personal data sent to PostHog

26 cases. Part of the [edge case catalogue](../edge-cases.md).

## Personal data put in event properties

**Problem.** Told to add useful properties, the agent copies email, name or username from the handler onto the event, and PostHog's docs and its own example apps taught exactly that. The wizard's framework skills briefly missed the rule too, because a tag mismatch kept the javascript\_web/node commandments from reaching Next.js and other framework skills. Nothing errors, so the leak is silent.

**Impact.** PII is copied onto every event row, outside person-level controls, and cannot be removed by deleting or editing the person. Person profiles stay empty.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 53-54 'NEVER send PII in posthog.capture() event properties') and #python (76-77)
- there is no PII rule under #javascript\_node
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (javascript\_web/javascript\_node tag fix, PR 212)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) ('Never put PII in an event')
- `wizard: src/lib/agent/commandments.ts` line 22 (generic PII commandment)
- src/lib/yara-hooks.ts (posthog\_pii\_in\_capture\_call)
- warlock: posthog\_pii\_in\_capture\_call.yar
- `wizard-workbench: evaluation.md` (eq\_no\_pii)

**Sources.** [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [context-mill@95bf763](https://github.com/PostHog/context-mill/commit/95bf7633), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145), [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [context-mill@f6bf6e1](https://github.com/PostHog/context-mill/commit/f6bf6e1f), [context-mill@881ca9f](https://github.com/PostHog/context-mill/commit/881ca9f764362c02802b037dc4ff550d44156f69), [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/wizard#272](https://github.com/PostHog/wizard/pull/272), [PostHog/wizard#283](https://github.com/PostHog/wizard/pull/283), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard#512](https://github.com/PostHog/wizard/pull/512), [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597), [PostHog/wizard#793](https://github.com/PostHog/wizard/pull/793), [PostHog/wizard#804](https://github.com/PostHog/wizard/pull/804), [PostHog/wizard#818](https://github.com/PostHog/wizard/pull/818), [PostHog/wizard#580](https://github.com/PostHog/wizard/issues/580), [PostHog/warlock#59](https://github.com/PostHog/warlock/pull/59), [PostHog/wizard-workbench#754](https://github.com/PostHog/wizard-workbench/pull/754), [PostHog/wizard-workbench#1170](https://github.com/PostHog/wizard-workbench/pull/1170), [PostHog/wizard-workbench#1863](https://github.com/PostHog/wizard-workbench/pull/1863), [PostHog/wizard-workbench#1583](https://github.com/PostHog/wizard-workbench/pull/1583), [PostHog/wizard-workbench#2238](https://github.com/PostHog/wizard-workbench/pull/2238), [PostHog/wizard-workbench#2456](https://github.com/PostHog/wizard-workbench/pull/2456), [`wizard-workbench: services/pr-evaluator/prompts/evaluation.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation.md)

**Frameworks.** `all`, `javascript_web`, `javascript_node`, `nextjs`, `react`, `vue`, `angular`, `astro`, `android`, `expo`, `react-router`, `tanstack-router`, `tanstack-start`, `nuxt`, `sveltekit`, `dotnet`, `python`, `ruby`

**Wrong:**

```typescript
posthog.capture({
  distinctId: username,
  event: 'server_login',
  properties: { username: username, isNewUser, source: 'api' },
})
// client side
posthog.capture('user_signed_up', { email: user.email, full_name: user.name })
posthog.capture('user_signed_in', { email: user.email, name: user.name })
```

**Fixed:**

```typescript
posthog.identify(user.id, { email: user.email, name: user.name }) // PII on the person
posthog.capture('user_signed_up', { plan: user.plan })            // non-PII facts only
// or keep it as person data on the event:
posthog.capture('user_logged_in', { $set: { email: user.email } })
// warlock posthog_pii_in_capture_call reverts the write, block text names the fix
```

## User-written text sent as event properties

**Problem.** To make events richer the agent attaches the message, todo text or form payload itself. The PII rule talks about emails and names, so free text slips through as 'context'.

**Impact.** User-generated content and form payloads are stored on every event and cannot be cleanly deleted or masked. Stringified blobs also pollute breakdowns.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 53) and #python (lines 76-77: 'user-generated content ... Safe event properties are metadata like message\_length, form\_type, boolean flags')
- [`context-mill: example-apps/python/todo.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py) example-apps/php/todo.php, example-apps/ruby/todo.rb (todo\_length)
- [`context-mill: context/skills/audit-events/references/2-events-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-events/references/2-events-fix.md) (Task D, PII and JSON.stringify'd values)
- `wizard: src/lib/agent/commandments.ts` line 22 (generic, 'user-entered PII' only)

**Sources.** [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [context-mill@f6bf6e1](https://github.com/PostHog/context-mill/commit/f6bf6e1fa4d33f889d376083465eaae9b13368e4), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `python`, `php`, `ruby`, `nuxt`, `react`, `all`

**Wrong:**

```python
posthog_client.capture('form_submitted', properties={
    'email': user_email,
    'message': message_content,
    'name': user_name,
})
# client side: posthog.capture('todo_added', { text: todo.text })
```

**Fixed:**

```python
posthog_client.capture('contact_form_submitted', properties={
    'message_length': len(message),  # metadata is OK
    'has_email': bool(email),        # boolean flags are OK
    'form_type': 'contact',          # categories are OK
})
# client side: posthog.capture('todo_added', { text_length: text.length, total_todos: todos.length })
```

## Example apps showing username in event properties

**Problem.** Agents copy reference code literally, so a reference login route that puts the username in properties gets reproduced even when the written rule says not to.

**Impact.** Agents reproduce the violation, then hit scanner blocks and spiral retrying. The evaluator penalizes the run.

**Rule location.**

- [`context-mill: example-apps/next-app-router/src/app/api/auth/login/route.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/app/api/auth/login/route.ts) and next-pages-router login.ts (fixed in 95bf7633)
- still showing username in burrito\_considered: example-apps/astro-ssr/src/pages/burrito.astro, example-apps/expo/app/burrito.tsx (+README), example-apps/sveltekit/src/routes/burrito/+page.svelte

**Sources.** [context-mill@95bf763](https://github.com/PostHog/context-mill/commit/95bf7633), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212)

**Frameworks.** `nextjs`, `posthog-node`, `astro`, `expo`, `sveltekit`

**Wrong:**

```typescript
posthog.capture({
  distinctId: username,
  event: 'server_login',
  properties: { username: username, isNewUser, source: 'api' },
})
```

**Fixed:**

```typescript
posthog.capture({
  distinctId: username,
  event: 'server_login',
  properties: { isNewUser, source: 'api' },
})
// PII (email, name) belongs in identify() person properties
```

## Server SDK PII not routed to person properties

**Problem.** Server SDKs have no obvious identify-with-traits call in quick-start code, and each has a different way to set person data ($set map in Go and Rust, userProperty in Java, IdentifyAsync in .NET), so an agent falls back to a plain event property.

**Impact.** Email and name are copied onto every server event instead of living once on the person. Silent compliance problem.

**Rule location.**

- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 87 'keep PII in person properties via $set'), #dotnet (line 108), #java-server (line 118), #ios (line 254)
- #rust (line 99) only says set person properties via a $set event property, no PII wording
- [`context-mill: example-apps/go/handlers.go`](https://github.com/PostHog/context-mill/blob/main/example-apps/go/handlers.go) login()
- java-spring-boot BurritoController.login()

**Sources.** [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101), [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150), [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151), [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270)

**Frameworks.** `go`, `java-server`, `dotnet`, `rust`, `ios`

**Wrong:**

```go
client.Enqueue(posthog.Capture{
    DistinctId: userId,
    Event:      "user_logged_in",
    Properties: posthog.NewProperties().
        Set("email", email).Set("name", name),
})
// Java: PostHogCaptureOptions.builder().property("email", email)
```

**Fixed:**

```go
Properties: posthog.NewProperties().
    Set("login_method", "email").
    // $set attaches person properties, the server-side identify
    Set("$set", map[string]any{"email": email}),
// Java: PostHogCaptureOptions.builder().userProperty("email", email)
//         .property("login_method", "email")
// .NET: IdentifyAsync   Rust: $set property on the event
```

## Flutter: person data in capture properties

**Problem.** Agents add username or email to each capture for context instead of passing it once through identify's userProperties.

**Impact.** Person data duplicated onto events while the profile is never updated.

**Rule location.**

- [`context-mill: example-apps/flutter/lib/screens/burrito_screen.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/lib/screens/burrito_screen.dart) (comment lines 43-45), lib/auth/auth\_state.dart (lines 34-47, userProperties/userPropertiesSetOnce)
- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 281 'keep PII in user properties, not event properties')

**Sources.** [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150)

**Frameworks.** `flutter`

**Wrong:**

```dart
await Posthog().capture(
  eventName: 'burrito_considered',
  properties: {'username': username, 'email': email},
);
```

**Fixed:**

```dart
await Posthog().identify(userId: id, userProperties: {'email': email});
await Posthog().capture(
  eventName: 'burrito_considered',
  properties: {'total_considerations': total, 'is_first_consideration': total == 1},
);
```

## Python tag() used to set person data

**Problem.** tag() inside a context reads like 'attach to the person', and the old example comment even said 'PII goes in tag, not capture'. In fact posthog-python adds every tag as a property on each event in the context. Nothing errors.

**Impact.** Email and join date leak into every event in the context, and person properties are never set.

**Rule location.**

- [`context-mill: example-apps/django/core/signals.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/signals.py) (posthog.set, lines 22-30)
- [`context-mill: example-apps/flask/app/main/routes.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/main/routes.py) (lines 30-36, 79-84)
- [`context-mill: example-apps/fastapi/app/middleware.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/middleware.py) (only tag('is\_staff') left)
- commandments.yaml#python line 79 (use set(), not identify, no explicit tag() rule exists)
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) ('Never put PII in an event'). Stale tag('email'): example-apps/fastapi/README.md lines 49-60, fastapi/app/templates/signup.html lines 33-45, django/README.md line 127

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@1e43ce1](https://github.com/PostHog/context-mill/commit/1e43ce1f), [context-mill@864a9b2](https://github.com/PostHog/context-mill/commit/864a9b2f), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101)

**Frameworks.** `django`, `flask`, `fastapi`, `python`

**Wrong:**

```python
with new_context():
    identify_context(str(user.id))
    # Set person properties (PII goes in tag, not capture)
    tag('email', user.email)
    tag('date_joined', user.date_joined.isoformat())
    capture('user_logged_in')
```

**Fixed:**

```python
with new_context():
    identify_context(str(user.id))
    # PII belongs in person properties, never in event properties
    posthog.set(distinct_id=str(user.id),
                properties={'email': user.email, 'is_staff': user.is_staff})
    capture('user_logged_in', properties={'login_method': 'password'})
# tag() only for non-PII context
```

## PII scanner block: move field, keep event

**Problem.** When a write is reverted, a generic agent either retries the same edit or drops the whole capture call to get past the block, losing the instrumentation.

**Impact.** Repeated blocks abort the run ('tried to write personal data (PII) into your project') or the event silently disappears.

**Rule location.**

- warlock: src/scanner/rules/posthog\_pii\_in\_capture\_call.yar
- wizard (main): src/agent/yara-hooks.ts (repeat-block tracker, abort copy), src/agent/runner/harness/pi/runtime-notes.ts (YARA note)

**Sources.** [PostHog/wizard#793](https://github.com/PostHog/wizard/pull/793), [PostHog/wizard#751](https://github.com/PostHog/wizard/pull/751), [PostHog/wizard#818](https://github.com/PostHog/wizard/pull/818), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212)

**Frameworks.** `all`

**Wrong:**

```typescript
posthog.capture('checkout_completed', {
  email: user.email,
  phone: user.phone,
  plan,
})
// [YARA] posthog_pii_in_capture_call -> REVERTED; agent retries or deletes the call
```

**Fixed:**

```typescript
posthog.identify(user.id, { email: user.email }) // person properties, not event properties
posthog.capture('checkout_completed', { plan })   // keep the event itself
```

## PII guard blocks its own recommended fix

**Problem.** A regex PII rule that matches $set/$set\_once, or bleeds from a bare capture() into the next identify() call, blocks the agent's correct self-correction, and the block message never says what to do instead.

**Impact.** The agent is blocked again on every retry and loops until the run dies, losing the integration.

**Rule location.**

- wizard (main): src/agent/runner/harness/pi/security.ts (blockMessage appends 'Fix: &lt;remediation>')
- scripts/warlock-smoke-test.ts (NEGATIVES)
- package.json (@posthog/warlock 0.2.4)
- warlock: src/scanner/rules/posthog\_pii\_in\_capture\_call.yar

**Sources.** [PostHog/wizard#804](https://github.com/PostHog/wizard/pull/804), [PostHog/wizard#827](https://github.com/PostHog/wizard/pull/827), [PostHog/wizard#828](https://github.com/PostHog/wizard/pull/828), [PostHog/warlock#59](https://github.com/PostHog/warlock/pull/59)

**Frameworks.** `all`

**Wrong:**

```javascript
// both are the recommended fix, both blocked by the stale rule (warlock 0.2.2)
posthog.capture('user_logged_in', { $set: { email: user.email } })

posthog.capture('signup_completed')
posthog.identify(userId, { email: user.email }) // match bled across calls
```

**Fixed:**

```text
[YARA] posthog_pii_in_capture_call: Personally identifiable information ... passed to a PostHog tracking call.
Fix: Move PII out of event properties - use posthog.identify(), setPersonProperties(), or $set / $set_once ...
// rule gap [^{)]* keeps a match inside one call's arguments
// scripts/warlock-smoke-test.ts NEGATIVES assert $set, $set_once and capture()+identify() do NOT match
// @posthog/warlock pinned 0.2.4 (needs >=0.2.3)
```

## PII scanner reverts the wizard's own reports

**Problem.** Audit and inventory programs quote the user's existing capture calls verbatim, and a naive PII scan treats that documentation as the agent introducing PII. The quick fix, a filename allowlist, is itself spoofable.

**Impact.** Report writes are reverted and audit programs loop without finishing. With the basename band-aid, real PII written to a file named like an inventory skips the PII check.

**Rule location.**

- wizard (main): src/agent/yara-hooks.ts (WIZARD\_DOC\_BASENAMES, isWizardDocumentationPath, TODO(warlock#33))
- src/agent/runner/harness/pi/security.ts (same suppression on output context)

**Sources.** [PostHog/wizard#512](https://github.com/PostHog/wizard/pull/512), [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597), [PostHog/wizard#531](https://github.com/PostHog/wizard/issues/531), [PostHog/wizard#594](https://github.com/PostHog/wizard/issues/594), [PostHog/warlock#33](https://github.com/PostHog/warlock/pull/33)

**Frameworks.** `all`

**Wrong:**

```markdown
<!-- posthog-events-audit-report.md, written via Write -->
| signup | `posthog.capture('signup', { email })` | app/signup.ts |
<!-- PostToolUse: posthog_pii_in_capture_call matched -> write reverted -->
```

**Fixed:**

```typescript
const WIZARD_DOC_BASENAMES = new Set([
  EVENT_INVENTORY_FILE, EVENTS_AUDIT_REPORT_FILE,
  AUDIT_REPORT_FILE, EVENT_PLAN_FILE,
]);
// posthog_pii matches dropped on these basenames only, BEFORE LLM triage;
// secrets, injection, supply-chain rules still revert them
// TODO(warlock#33): remove suppression once precise PII rules ship
// (warlock#33 is still open)
```

## PII scanner flagging normal analytics wording

**Problem.** A loose PII rule matches a PII word anywhere near capture(), such as an event name or a benign key, so a strict guard reverts legitimate instrumentation and the agent surfaces alarming warnings to the user.

**Impact.** Valid instrumentation is reverted and the run is disrupted by false alarms.

**Rule location.**

- warlock: src/scanner/rules/posthog\_pii\_in\_capture\_call.yar
- wizard (main): src/agent/commandments.ts (YARA silent-handling rule)

**Sources.** [PostHog/wizard#580](https://github.com/PostHog/wizard/issues/580), [PostHog/wizard#551](https://github.com/PostHog/wizard/issues/551), [PostHog/wizard#818](https://github.com/PostHog/wizard/pull/818), [PostHog/warlock#59](https://github.com/PostHog/warlock/pull/59)

**Frameworks.** `all`

**Wrong:**

```typescript
posthog.capture('email_verified', { method: 'link' })
posthog.capture('form_submitted', { emailFieldCount: 3 })
// legacy local rule: PII word within 200 chars of .capture( -> write reverted
```

**Fixed:**

```text
// warlock rule: PII key must be a top-level key in the first { ... } object,
// gap [^{)]* never leaves the call's own arguments; $set payloads don't match
// commandments.ts: handle [YARA WARNING]/[YARA VIOLATION] silently, fix the code,
// never show security language to the user
```

## Database source discovery walks the auth schema

**Problem.** Schema discovery works with no schema set, so the agent omits it. On managed Postgres like Supabase that returns the provider's auth and storage tables alongside the app's own.

**Impact.** The response truncates before review, and the agent enumerates and may sync the customer's auth.users and other internal tables.

**Rule location.** [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Pre-flight: scope a database source to one schema)

**Sources.** [PostHog/context-mill#339](https://github.com/PostHog/context-mill/pull/339)

**Frameworks.** `Supabase`, `Postgres`, `managed databases`

**Wrong:**

```json
{"source_type": "Supabase", "payload": {"host": "...", "database": "postgres"},
 "schemas": [
   {"name": "users", "should_sync": true},
   {"name": "auth.users", "should_sync": true},
   {"name": "storage.objects", "should_sync": true}
 ]}
```

**Fixed:**

```json
{"source_type": "Supabase", "payload": {"host": "...", "schema": "public"},
 "schemas": [{"name": "orders", "should_sync": true}]}
// set schema (default public); never select auth or other internal-schema tables
```

## LLM prompt capture chosen silently

**Problem.** The agent either guesses a privacy\_mode default (an earlier wizard rule turned it on and stripped content) or rewrites the client constructor and drops an existing privacy setting, and the report never says prompts are stored or where to change it.

**Impact.** Traces silently lose input/output, or sensitive prompts are stored without the user knowing how to turn it off. An existing privacy decision can be weakened.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (Privacy mode), 4-verify.md (Privacy-mode handoff)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) and 4-conclude.md
- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md)

**Sources.** [PostHog/context-mill#403](https://github.com/PostHog/context-mill/pull/403), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [context-mill@2151f43](https://github.com/PostHog/context-mill/commit/2151f434)

**Frameworks.** `python`, `javascript_node`, `openai`, `ai-observability`

**Wrong:**

```python
# existing: Posthog(key, host=host, privacy_mode=True)
client = PostHogOpenAI(posthog_client=Posthog(key, host=host))  # setting dropped
# report: 'LLM analytics configured'
```

**Fixed:**

```python
posthog = Posthog(key, host=host, privacy_mode=False)  # new client only
# existing privacy_mode=True or redaction: keep it, say why
# Report 'Privacy mode': prompts and completions are stored in PostHog,
# effective setting, file:line to edit, when to enable,
# posthog.com/docs/ai-observability/privacy-mode
```

## Privacy mode assumed to cover manual LLM capture

**Problem.** privacy\_mode sounds global, but it only strips $ai\_input and $ai\_output\_choices from SDK-captured events. Manual capture, framework hooks and OTel have their own controls.

**Impact.** The report promises prompts are not stored while manually captured payloads still reach PostHog.

**Rule location.**

- context-mill main: context/skills/ai-observability/references/3-instrument.md (Privacy mode section)
- [`context-mill: context/skills/ai-observability/references/4-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/4-verify.md) (Privacy-mode handoff, 'What it changes' bullet). Local checkout is older than #403
- read via gh api

**Sources.** [PostHog/context-mill#403](https://github.com/PostHog/context-mill/pull/403)

**Frameworks.** `python`, `node`, `ai-observability`

**Wrong:**

```python
posthog = Posthog(key, host=host, privacy_mode=True)
posthog.capture(distinct_id=uid, event="$ai_generation", properties={
    "$ai_input": messages, "$ai_output_choices": out,
})
# report: "privacy mode on, prompts are not stored"
```

**Fixed:**

```text
Privacy mode excludes $ai_input and $ai_output_choices from SDK-captured events.
Do not promise it removes arbitrary custom properties, manually captured
payloads, or previously stored events. Framework hooks, OpenTelemetry and
manual capture follow their own documented controls; do not invent SDK
options for them or assume the SDK setting filters manually captured content.
```

## PII rule strips LLM prompt and completion

**Problem.** Once told never to send user-generated content, a careful agent over-applies the blanket rule to $ai\_input and $ai\_output\_choices, whose whole purpose is to carry the user's prompt and the model's answer.

**Impact.** LLM traces arrive hashed, redacted or empty, losing the text the product exists to show. Silent loss of the core payload.

**Rule location.** [`context-mill: context/commandments.yaml#ai_observability`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (third carve-out, line ~336)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [context-mill@b3c0dec](https://github.com/PostHog/context-mill/commit/b3c0deca)

**Frameworks.** `ai-observability`, `all`

**Wrong:**

```python
properties = {
    '$ai_model': model,
    '$ai_input': hash_text(prompt),   # 'avoid PII in event properties'
    '$ai_output_choices': '[REDACTED]',
}
```

**Fixed:**

```python
# $ai_* payload properties ($ai_input, $ai_output_choices and the rest)
# intentionally carry prompt and completion text, so the PII rules do NOT
# apply to them; those rules still govern every other property you set
properties = {'$ai_model': model, '$ai_input': prompt, '$ai_output_choices': out}
```

## Log exporter attached to the root logger

**Problem.** Platform docs show attaching the PostHog exporter to the root or existing loggers, so the agent follows them. The export of every existing log line never shows up in the diff.

**Impact.** All existing app logs, possibly with secrets, request bodies and user data, leave the app without a mandate.

**Rule location.**

- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) (Logs item under 'AI Observability and Logs')
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (Logs report sentence)
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) (lines ~28-31)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [context-mill@2151f43](https://github.com/PostHog/context-mill/commit/2151f434)

**Frameworks.** `python`, `javascript_node`, `all server runtimes`

**Wrong:**

```python
handler = LoggingHandler(level=logging.NOTSET, logger_provider=provider)
logging.getLogger().addHandler(handler)  # exports ALL existing logs
```

**Fixed:**

```python
ph_logger = logging.getLogger("posthog.integration")  # dedicated logger
ph_logger.addHandler(handler)
ph_logger.info("order placed")  # purpose-written lines only
# report: one-line change to route existing loggers in, if wanted
```

## Capture silently disabled in init for privacy

**Problem.** Asked to be privacy-safe, the agent over-corrects by writing autocapture:false, disable\_session\_recording:true or opt\_out\_capturing:true into init instead of wiring a runtime consent call.

**Impact.** Autocapture, replay or all capture is permanently off without the user asking. Silent data loss.

**Rule location.**

- [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) ('Keep PostHog data capture at its defaults unless the user explicitly asks otherwise...')
- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Keep autocapture enabled')
- [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md) (do not leave disable\_session\_recording: true)

**Sources.** [PostHog/context-mill#173](https://github.com/PostHog/context-mill/issues/173), [PostHog/context-mill#175](https://github.com/PostHog/context-mill/issues/175), [PostHog/wizard#592](https://github.com/PostHog/wizard/issues/592)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```typescript
posthog.init(token, {
  autocapture: false,
  disable_session_recording: true,
  opt_out_capturing: true,
})
```

**Fixed:**

```typescript
posthog.init(token, { api_host })   // keep defaults
// consent is a runtime call, not init config:
if (!hasConsent) posthog.opt_out_capturing()
```

## PostHog starts before the cookie banner answers

**Problem.** Quick-start init captures immediately at app start as the docs show, and an agent focused on PostHog never looks for the app's existing consent banner to wire it to opt-in/opt-out calls.

**Impact.** Events, cookies and UTMs are collected before or despite the user's refusal (legal exposure), or capture never starts after consent is granted.

**Rule location.**

- [`context-mill: context/skills/audit-attribution/references/3-attribution-config.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/3-attribution-config.md) (Task C, attribution-consent-integration, audit check, not integration)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Key principles, consent controls, its referenced references/data-collection.md is missing)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `javascript-web`, `posthog-js`, `react`, `next-js`

**Wrong:**

```typescript
posthog.init(KEY, { api_host: HOST })   // runs at load
// <CookieBanner onAccept={...} />  never calls posthog
```

**Fixed:**

```typescript
posthog.init(KEY, { api_host: HOST, opt_out_capturing_by_default: true })
// banner onAccept:
posthog.opt_in_capturing()
// onReject:
posthog.opt_out_capturing()
```

## Replay and autocapture masking turned off

**Problem.** To make replays readable or autocapture richer, the agent sets maskAllInputs:false or mask\_all\_text:false globally instead of targeting the few surfaces that need it.

**Impact.** Passwords mid-typing, billing and health fields are recorded in clear text in $snapshot and $autocapture events.

**Rule location.**

- [`context-mill: context/skills/audit-session-replay/references/2-session-replay-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-session-replay/references/2-session-replay-fix.md) (Task B replay-mask-config)
- [`context-mill: context/skills/audit-autocapture/references/2-autocapture-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-autocapture/references/2-autocapture-fix.md) (Task B autocapture-mask-config, Task C autocapture-allowlists). Audit checks, not integration rules

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/wizard#452](https://github.com/PostHog/wizard/pull/452)

**Frameworks.** `javascript-web`, `react`, `next-js`, `vue`

**Wrong:**

```javascript
posthog.init(key, {
  autocapture: true,
  mask_all_text: false,
  mask_all_element_attributes: false,
  session_recording: { maskAllInputs: false },  // app has login and card forms
})
```

**Fixed:**

```javascript
posthog.init(key, {
  // masking defaults stay on; open up only specific surfaces
  session_recording: { maskInputOptions: { password: true, email: true },
                       maskTextSelector: '.sensitive' },
  autocapture: { url_allowlist: [...], element_attribute_ignorelist: [...] },
})
```

## Flutter beforeSend assumed to scrub native data

**Problem.** beforeSend looks like a global redaction hook, but in Flutter it only sees Dart-captured events.

**Impact.** Native session replay, lifecycle events and system properties bypass the redaction, so PII can still leave the device.

**Rule location.** [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (beforeSend bullet)

**Sources.** [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150)

**Frameworks.** `flutter`

**Wrong:**

```dart
config.beforeSend = [
  (event) {
    event.properties?.remove('email'); // assumed to cover replay and native events
    return event;
  },
];
```

**Fixed:**

```dart
// beforeSend redacts or drops Dart-captured events only; it does not
// intercept native session replay, lifecycle, or system properties
config.beforeSend = [
  (event) { /* redact Dart events */ return event; },
];
// mask native replay through replay settings
```

## iOS session replay enabled without masking review

**Problem.** The agent flips sessionReplay on unconditionally, without checking masking needs, and in targets that also build for macOS where replay does nothing.

**Impact.** Unmasked screens may be recorded, and on macOS replay silently does nothing.

**Rule location.** [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `swift`

**Wrong:**

```swift
config.sessionReplay = true  // no masking review, shared by iOS and macOS targets
```

**Fixed:**

```swift
// Enable only after confirming project replay settings and masking requirements.
// Session replay is iOS-only, not macOS.
#if os(iOS)
config.sessionReplay = true
#endif
```

## Cookieless mode enabled without attribution tradeoff

**Problem.** cookieless\_mode 'always' looks like the safe privacy choice, but its daily-rotating hash breaks cross-session identity, which the agent never mentions.

**Impact.** A Monday ad click cannot be linked to a Thursday signup, silently breaking paid-acquisition ROAS.

**Rule location.** [`context-mill: context/skills/audit-attribution/references/3-attribution-config.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-attribution/references/3-attribution-config.md) (attribution-cookieless-mode-impact)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-web`, `react`, `next-js`

**Wrong:**

```typescript
posthog.init(KEY, { cookieless_mode: 'always' })
// site also runs gtag()/fbq() ad pixels
```

**Fixed:**

```typescript
// 'always' + paid-acquisition signals = warning; 'on_reject' = suggestion
posthog.init(KEY, { cookieless_mode: 'on_reject' })
// report the privacy-vs-attribution tradeoff as a conscious choice
```

## Personal data cited in report files

**Problem.** Asked for evidence, the agent quotes concrete distinct ids, emails, session ids or IPs from query results into a markdown report.

**Impact.** Personal data lands in a file in the user's repo.

**Rule location.**

- [`context-mill: context/skills/web-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/description.md) (## Constraints, 'Do NOT include personally identifiable information')
- [`context-mill: context/skills/web-analytics/references/report-format.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/report-format.md) ('No PII')
- references/findings-schema.md (evidence field)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `all`

**Wrong:**

```markdown
- Evidence: user alice@example.com (distinct_id 8f3...) fired 12 pageviews from 203.0.113.4
```

**Fixed:**

```markdown
- example.com: 12.4k pageviews, 0 proxied   # hosts, paths, counts only
```

## Credentials recorded as trace span attributes

**Problem.** Adding rich span attributes, the agent records request headers and body fields wholesale, including auth headers and passwords.

**Impact.** Credentials are exported to PostHog with every trace.

**Rule location.** [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Attributes bullet, present on main, missing from older local checkout)

**Sources.** [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391)

**Frameworks.** `all`

**Wrong:**

```javascript
span.setAttribute('http.request.header.authorization', req.headers.authorization)
span.setAttribute('user.password', body.password)
```

**Fixed:**

```javascript
// never put secrets, tokens or passwords in attributes
span.setAttribute('http.route', req.route.path)
// posthog-node: beforeSpanSend can scrub or drop spans before export
```

## Source sent to model before org AI consent

**Problem.** A plain coding agent reads the repo and streams it to its model provider without checking whether the PostHog organization approved AI data processing. An opt-in screen without a hard gate is cosmetic.

**Impact.** Source code leaves the machine for a provider the org has not approved.

**Rule location.**

- `wizard: src/lib/programs/ai-opt-in-gate.ts` (withAiOptInGate, aiApproved)
- src/lib/agent/runner/shared/bootstrap.ts (waitForAiOptIn call)
- src/ui/tui/ink-ui.ts (waitForAiOptIn -> getGate('ai-opt-in'))
- src/lib/programs/program-step.ts (requiresAi)

**Sources.** [PostHog/wizard#645](https://github.com/PostHog/wizard/pull/645), [PostHog/wizard#644](https://github.com/PostHog/wizard/pull/644), [PostHog/wizard#552](https://github.com/PostHog/wizard/issues/552), [PostHog/wizard#244](https://github.com/PostHog/wizard/issues/244)

**Frameworks.** `all`

**Wrong:**

```typescript
// org is_ai_data_processing_approved = false
await installSkills()
await startAgent()   // reads the repo anyway
```

**Fixed:**

```typescript
// bootstrapProgram(): before the agent starts
await getUI().waitForAiOptIn();  // parks until org approval is literal true
// ai-opt-in-gate.ts: only literal true proceeds; null/undefined/false block
gate: (session) => session.ci || session.signup || aiApproved(session),
// programs that never run the agent declare requiresAi: false
```

## Tool detection reported before user consent

**Problem.** Detecting competitor tools from dependencies and .env names is cheap and useful, so it gets reported at startup before any consent screen.

**Impact.** The user is never told their stack is reported and cannot decline.

**Rule location.**

- [`wizard: src/shared/run-state.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/run-state.ts) (ScanConsent, mayReportScanResults)
- src/programs/session/wizard-session.ts (scanConsent init)
- src/tui/programs/posthog-integration/screens/PostHogIntegrationIntroScreen.tsx (share toggle)

**Sources.** [PostHog/wizard#1099](https://github.com/PostHog/wizard/pull/1099)

**Frameworks.** `all`

**Wrong:**

```typescript
scanDeps(); reportToPostHog(found)  // before intro, before login
```

**Fixed:**

```typescript
// ScanConsent: undecided | granted | declined (undecided sends nothing)
// Intro screen toggle: 'Share tools' / "Don't share tools"
// CI resolves to granted; --signup alone stays undecided
scanConsent: args.ci ? ScanConsent.Granted : ScanConsent.Undecided
if (mayReportScanResults(session)) reportToPostHog(found)
```

## Agent-written scout bodies paste source and secrets

**Problem.** Authoring a remote monitoring scout from its repo analysis, the agent pastes raw source, env values or customer data into the body, and the MCP create path is not covered by the file-write scanners.

**Impact.** Secrets or PII are persisted server-side, contradicting the promise that .env contents never leave the machine.

**Rule location.** [`wizard: src/programs/self-driving/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/self-driving/prompt.ts) (STEP 6b, custom scouts)

**Sources.** [PostHog/wizard#642](https://github.com/PostHog/wizard/pull/642)

**Frameworks.** `all`

**Wrong:**

```text
llma-skill-create(
  name: "billing-watch",
  body: "<pasted src/billing.ts>\nSTRIPE_KEY=sk_live_...\nstack trace for jane@acme.com"
)
```

**Fixed:**

```text
Keep scout bodies high-level: describe the behavior and signal
conditions to watch, referencing repo evidence by file/function name
— never paste raw source, secrets, env values, or customer data
into a scout body.
```
