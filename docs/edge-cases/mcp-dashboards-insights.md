# Dashboard and PostHog tool calls fail

67 cases. Part of the [edge case catalogue](../edge-cases.md).

## Overlapping replay scanners corroborate themselves

**Problem.** Narrowing several scanners to the important URL feels like better targeting, but findings emit at half weight and are grouped by meaning, so overlapping scanners corroborate each other.

**Impact.** Two scanners on one session sum to the 1.0 threshold, so a single recording promotes itself into a report with no independent evidence.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) (The two monitors' queries stay disjoint)
- [`context-mill: context/skills/self-driving/references/6c-replay-vision-scanners.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6c-replay-vision-scanners.md) (Why the monitors' queries must not overlap)

**Sources.** [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313), [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/wizard#1055](https://github.com/PostHog/wizard/pull/1055)

**Frameworks.** `javascript_web`, `all`

**Wrong:**

```json
{ "name": "Broken experiences", "emits_signals": true, "query": { "properties": [{ "key": "$current_url", "value": "/checkout" }] } }
{ "name": "Blocked conversion", "emits_signals": true, "query": { "properties": [{ "key": "$current_url", "value": "/checkout" }] } }
```

**Fixed:**

```json
// scanner 1 (breakage) owns WHERE: URL-scoped on the completion flow
"query": { "kind": "RecordingsQuery", "properties": [{ "key": "$current_url", "value": "/checkout", "operator": "icontains", "type": "event" }] }
// scanner 2 (frustration) owns WHAT: $rageclick as its only filter
"query": { "kind": "RecordingsQuery", "events": [{ "id": "$rageclick", "type": "events" }] }
// never URL-scope frustration; never event-gate breakage; summarizer stays out of self-driving
```

## Bug scanner limited to exception sessions

**Problem.** Filtering to $exception sessions feels like the obvious place breakage lives.

**Impact.** The scanner only sees what error tracking already catches and misses blank screens, dead buttons and wrong data.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanner-broken-experiences/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanner-broken-experiences/description.md) ("never gate it on $exception")
- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) and self-driving/references/6c-replay-vision-scanners.md (never gate the breakage monitor on an event)

**Sources.** [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349), [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341)

**Frameworks.** `all`

**Wrong:**

```json
"query": { "kind": "RecordingsQuery", "events": [{ "id": "$exception", "type": "events" }] }
```

**Fixed:**

```json
"query": { "kind": "RecordingsQuery",
  "properties": [{ "key": "$current_url", "value": "/checkout", "operator": "icontains", "type": "event" }] },
"sampling_rate": 0.5
// scope by WHERE plus sampling_rate, never by an outcome event
```

## Replay scanner scoped to guessed URL paths

**Problem.** /checkout is the generic default in the agent's head. The real routes live in router files it did not read.

**Impact.** The scanner watches sessions that never occur, or noise, at real credit cost.

**Rule location.**

- [`context-mill: context/agents/replay-vision/scanner-broken-experiences.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/replay-vision/scanner-broken-experiences.md) (Goal, query bullet)
- [`context-mill: context/skills/replay-vision-scanner-broken-experiences/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanner-broken-experiences/description.md) (query: completion flow read out of the repo)

**Sources.** [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343), [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349), [PostHog/wizard-workbench#3504](https://github.com/PostHog/wizard-workbench/pull/3504), [`wizard-workbench: apps/replay-vision/react-vite/court-booking/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/replay-vision/react-vite/court-booking/README.md)

**Frameworks.** `all`

**Wrong:**

```json
"query": {"kind": "RecordingsQuery", "properties": [
  {"key": "$current_url", "value": "/checkout",
   "operator": "icontains", "type": "event"}]}
// app's flow is actually /booking
```

**Fixed:**

```text
Read router files and page/route directories to find the real paths;
never guess at `/checkout` if this app calls it `/booking`.
No identifiable completion flow? Fall back to the handful of
highest-traffic paths and record in your handoff that you couldn't
identify one. No web surface: skip creation and say why.
```

## Scanner spend compared in wrong units

**Problem.** The estimate returns observations while quota is in credits, and both are plain numbers. The agent also infers quota from scanner count.

**Impact.** Spend is understated by the per-observation credit price, pushing the org over its monthly credit budget so observations are silently skipped, or the user is nagged about a cheap create.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) (Load the authoritative mechanics first)
- [`context-mill: context/skills/self-driving/references/6c-replay-vision-scanners.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6c-replay-vision-scanners.md) (Do step 2, Size before you ship)

**Sources.** [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341)

**Frameworks.** `all`

**Wrong:**

```text
estimate -> ~3000 observations per month
vision-quota-retrieve -> remaining = 5000 credits
3000 < 5000 -> create without asking
# or: project has no scanners -> assume full quota, skip the check
```

**Fixed:**

```text
skill-get {"skill_name": "creating-replay-vision-scanners"}
# estimate monthly CREDIT spend, read the org's remaining credit budget,
# compare credit to credit; quota is org-wide, never inferred from scanner count
# clearly cheap: just create. Large fraction of what's left (or exhausted):
# ONE wizard_ask, decline option first (create anyway vs skip)
# tool missing: create as-is, note 'spend not verified' in the report
```

## Replay scanners keep generic template names

**Problem.** The agent customises only the query and keeps the template's fixed name and prompt, since that looks like a safe default.

**Impact.** A booking product gets a scanner literally named 'Broken experiences' with a generic prompt, not tailored to its codebase.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) (Filling a scanner brief, The name)
- [`context-mill: context/skills/replay-vision-scanner-broken-experiences/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanner-broken-experiences/description.md)

**Sources.** [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349), [PostHog/wizard-workbench#3504](https://github.com/PostHog/wizard-workbench/pull/3504)

**Frameworks.** `all`

**Wrong:**

```json
{"name": "Broken experiences", "scanner_type": "monitor",
 "scanner_config": {"prompt": "Watch this session for moments where the
   product visibly broke for the user: an error message, a blank screen..."},
 "query": {"kind": "RecordingsQuery", "properties": [/* /booking */]}}
```

**Fixed:**

```json
{"name": "Booking failures",   // short, sentence case, product's words
 "scanner_config": {"prompt": "...In this product that especially means:
   {{WATCH_FOR}}. Only flag issues that are unambiguous on screen..."}}
// {{WATCH_FOR}} = noun phrases from the repo, never instructions
// never reuse: Broken experiences / User frustration / Session summaries
```

## Source config created for self-authorizing scanner

**Problem.** replay\_vision appears in the signal-source enum, so creating a config row for it looks required.

**Impact.** A redundant or wrong config row. The scanner's emits\_signals flag is the per-source config.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/4-sources.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/4-sources.md) (Nothing to create here, replay\_vision row)
- [`context-mill: context/skills/self-driving/references/6c-replay-vision-scanners.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6c-replay-vision-scanners.md) (Don't trip on these: No SignalSourceConfig row)

**Sources.** [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313)

**Frameworks.** `all`

**Wrong:**

```text
call inbox-source-configs-create {"source_product": "replay_vision",
  "source_type": "scanner_finding", "enabled": true}
```

**Fixed:**

```text
# 4-sources.md: replay_vision is self-authorizing, no row to write
call vision-scanners-create {"name": "Booking failures", "scanner_type": "monitor",
  "emits_signals": true, ...}
```

## Agent recreates a retired replay signal source

**Problem.** Stale training data and an old prompt both say to enable the session\_replay signal source, which PostHog has since deleted.

**Impact.** Silent: a Session Replay source is on but never emits. The run recreates the row the server migration deleted.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/4-sources.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/4-sources.md)
- 6c-replay-vision-scanners.md
- `wizard: src/lib/programs/self-driving/prompt.ts`

**Sources.** [PostHog/context-mill#370](https://github.com/PostHog/context-mill/pull/370), [PostHog/wizard#1174](https://github.com/PostHog/wizard/pull/1174)

**Frameworks.** `self-driving`

**Wrong:**

```text
inbox-source-configs-create
  { source_product: "session_replay",
    source_type: "session_analysis_cluster", enabled: true }
```

**Fixed:**

```text
Session replay: no source to enable. Coverage = Replay Vision scanners
(step 6c). The pair is retired; listed under "Nothing to create here"
so a future run does not add it back.
```

## Scout proposals ignore the repo's agent docs

**Problem.** The agent scans source and the event list cold, skipping AGENTS.md and architecture docs that map jobs, billing and out-of-scope areas.

**Impact.** Scouts miss surfaces, use the wrong vocabulary or target out-of-scope areas, adding recurring LLM spend for noise.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/6b-tailor-scouts.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6b-tailor-scouts.md) (step 2)
- [`wizard: src/programs/self-driving/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/self-driving/prompt.ts) (STEP 6b)

**Sources.** [PostHog/context-mill#233](https://github.com/PostHog/context-mill/pull/233), [PostHog/wizard#876](https://github.com/PostHog/wizard/pull/876)

**Frameworks.** `all`

**Wrong:**

```text
Gap analysis: scan source and the event taxonomy.
Proposed scout: "web app health" (generic wording)
(AGENTS.md / ARCHITECTURE.md never read)
```

**Fixed:**

```text
Start from AGENTS.md, CLAUDE.md, ARCHITECTURE.md, .cursor/rules/,
.github/copilot-instructions.md before scanning source. Name scouts in the
product's own vocabulary; check a gap isn't marked out of scope.
```

## GitHub repo researched via git remote when only one is connected

**Problem.** Parsing git remote is the reflex for 'which repo', but the integration only sees the repos the user connected. With exactly one connected the choice is forced.

**Impact.** Wasted calls, and a fork or renamed remote can pick a repo the integration cannot see.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/5a-github.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5a-github.md) (steps 1-2)
- [`wizard: src/programs/self-driving/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/self-driving/prompt.ts) (STEP 5)

**Sources.** [PostHog/context-mill#234](https://github.com/PostHog/context-mill/pull/234), [PostHog/wizard#878](https://github.com/PostHog/wizard/pull/878)

**Frameworks.** `self-driving`

**Wrong:**

```text
git remote get-url origin   # parse owner/repo
integrations-github-repos-retrieve { integration_id, search: "<repo name>" }
```

**Fixed:**

```text
integrations-github-repos-retrieve { integration_id }   # no search
# exactly one repo connected -> use it, no git remote inference, confirm
# several -> research (git remote then validate); none -> dormant fallback
```

## Inbox responder enabled with no data source

**Problem.** Flipping the responder toggle looks like the whole setup. The backing warehouse source is a separate step the agent defers.

**Impact.** Silent: the responder emits nothing until the user connects the source, which many never do.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/5-connected-tools.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5-connected-tools.md)
- 5c-credentials.md

**Sources.** [PostHog/context-mill#238](https://github.com/PostHog/context-mill/pull/238)

**Frameworks.** `self-driving`

**Wrong:**

```text
inbox-source-configs-create { source_type: "zendesk", enabled: true }
# no external-data-sources-create; follow-up: "connect Zendesk later"
```

**Fixed:**

```text
external-data-sources-create {
  "source_type": "Zendesk",
  "payload": { "credential_id": "<stored id>", "schemas": [...] }
}
# dormant responder + follow-up only when the user skips or creds missing
```

## Ticket source syncs every table incrementally

**Problem.** Incremental sync of everything is the usual default, but tickets are edited and closed after creation.

**Impact.** Needless sync load, and incremental append misses edits and closures, so the inbox acts on stale ticket state.

**Rule location.** [`context-mill: context/skills/self-driving/references/5c-credentials.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5c-credentials.md) (step 4)

**Sources.** [PostHog/context-mill#238](https://github.com/PostHog/context-mill/pull/238)

**Frameworks.** `self-driving`

**Wrong:**

```json
{ "source_type": "Zendesk", "payload": { "api_token": "...",
  "schemas": [{"name":"tickets","sync_type":"incremental"},
              {"name":"users","sync_type":"incremental"}] } }
```

**Fixed:**

```json
{ "source_type": "<Type>",
  "payload": { "credential_id": "<credential id>",
    "schemas": [{ "name": "<table>", "should_sync": true,
                  "sync_type": "full_refresh" }] } }
```

## PostHog MCP configured on retired /sse

**Problem.** Older docs and training data show the /sse endpoint, which the PostHog MCP no longer serves.

**Impact.** The configured MCP server never connects.

**Rule location.** [`wizard: src/shared/mcp-clients/defaults.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/mcp-clients/defaults.ts) (buildMCPUrl)

**Sources.** [PostHog/wizard#429](https://github.com/PostHog/wizard/pull/429)

**Frameworks.** `Claude Desktop`, `Claude Code`, `Codex`, `Cursor`, `VS Code`, `Zed`

**Wrong:**

```ts
const baseUrl = `${host}/${type === 'sse' ? 'sse' : 'mcp'}`
// https://mcp.posthog.com/sse
```

**Fixed:**

```ts
const baseUrl = `${host}/mcp`   // https://mcp.posthog.com/mcp, no transport arg
```

## Browser-only MCP connector reported as installed

**Problem.** For hosted connectors (Claude Desktop/Web) nothing is written locally, so 'install finished' is easy to report even though the user still has to sign in and click Connect.

**Impact.** The user believes PostHog MCP is set up when the connector is not connected.

**Rule location.**

- [`wizard: src/shared/mcp-clients/browser-client.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/mcp-clients/browser-client.ts)
- src/shared/mcp-clients/clients/claude-web.ts

**Sources.** [PostHog/wizard#517](https://github.com/PostHog/wizard/pull/517)

**Frameworks.** `claude-desktop`, `claude-web`

**Wrong:**

```text
Done: PostHog MCP installed for Claude Desktop/Web.
// nothing written locally; user never clicked Connect in claude.ai
```

**Fixed:**

```typescript
interface BrowserFinishable { /* connector URL + finish instruction */ }
// Done screen: connector URL + "Sign in and click Connect to finish"
// isServerInstalled() returns false, so it stays out of `mcp remove`
```

## Notebook copy trims the audit's events

**Problem.** Agents instinctively trim 'less interesting' items when copying a long report into a notebook.

**Impact.** The notebook makes the audit look like it found fewer events than it did.

**Rule location.** [`context-mill: context/skills/events-audit/references/6-dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/6-dashboard.md) (e.2, e.3)

**Sources.** [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356)

**Frameworks.** `all`

**Wrong:**

```text
local report: 15 top-level `event` bullets under ### Capture sites
notebook markdown: 9 bullets (trimmed to the 'interesting' events)
```

**Fixed:**

```text
Each section rides verbatim from the on-disk report; mirror 1:1.
e.3: count top-level event bullets under ### Capture sites in the
notebook and in posthog-events-audit-report.md. Counts MUST match;
if short, re-send the full section.
```

## Hard-coded retired model breaks every scanner

**Problem.** The agent copies the model id from skill text. The backend retired it, and each 400 does not stop the run from reporting success.

**Impact.** Every scanner create returns 400 and the run reports success with zero scanners.

**Rule location.**

- `context-mill: context/skills/replay-vision-scanner-*/description.md`
- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md)

**Sources.** [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349)

**Frameworks.** `all`

**Wrong:**

```json
vision-scanners-create {"name": "Broken experiences",
  "scanner_type": "monitor", "sampling_rate": 0.5,
  "model": "gemini-3.6-flash"}   // retired -> 400
```

**Fixed:**

```json
vision-scanners-create {"name": "<product-specific name>",
  "scanner_type": "monitor", "sampling_rate": 0.5,
  "model": "gemini-3-flash-preview"}
// a failed create is a recorded follow-up, not success
```

## One missing tool or 403 aborts setup

**Problem.** The agent treats any missing tool, 403 or quota warning as fatal, though the wizard OAuth token may simply lack one scope.

**Impact.** The user gets nothing instead of the rest of the setup plus a recorded next step.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) (Endpoint availability)
- [`context-mill: context/agents/replay-vision/enable-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/replay-vision/enable-replay.md)
- [`context-mill: context/skills/replay-vision/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision/description.md)

**Sources.** [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343)

**Frameworks.** `all`

**Wrong:**

```text
info products-enable -> unknown tool
[ABORT] cannot enable session replay
```

**Fixed:**

```text
A missing single tool, a 403 on one call, or an org near its quota
never fail the task: record a follow-up in the handoff and finish,
e.g. turn on 'Record user sessions' under Settings -> Session replay.
Only every scanner endpoint 404ing aborts: [ABORT] replay vision not available.
```

## Zero-traffic authorized URL removed as stale

**Problem.** Zero pageviews reads as a dead site, but an ad blocker eating events or a missing SDK produces the same signal.

**Impact.** A live site loses its authorized URL when the real fix was a reverse proxy or SDK install.

**Rule location.** [`context-mill: context/skills/web-analytics/references/checks.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/checks.md) (Check 2), remediation.md (dark\_authorized\_urls)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `javascript_web`

**Wrong:**

```text
# app_urls cleanup
remove "https://go.example.com"  # pageviews = 0
```

**Fixed:**

```text
# zero traffic can mean an ad blocker is eating events
# host still shipped -> recommend a reverse proxy, do not remove
# remove only when the user selected the finding
```

## Re-run clobbers or re-arms the user's scanners

**Problem.** On a name collision the agent assumes the scanner is its own and overwrites it, or sets enabled: true as part of 'setup'.

**Impact.** User-owned scanners are overwritten, duplicated, or re-armed after a person paused them, burning credits.

**Rule location.**

- [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) ("Re-runs and collisions")
- each brief's "Re-run match phrase" line in context/skills/replay-vision-scanner-\*/description.md
- emits\_signals override in context/skills/self-driving/references/6c-replay-vision-scanners.md

**Sources.** [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313)

**Frameworks.** `all`

**Wrong:**

```text
vision-scanners-create {"name": "Broken experiences"} -> 400 name exists
// assume it's ours
vision-scanners-update {"id": "...", "prompt": "<skeleton>", "enabled": true}
```

**Fixed:**

```text
Ours only if ALL three hold: same scanner_type, prompt contains the brief's
literal match phrase, emits_signals matches the flow. Then update in place
(fresh blanks incl. name); leave `enabled` as it is. Otherwise it is theirs:
leave it untouched and report it. On a 400 for a unique name: fetch that one
scanner, apply the same test; if not ours, ONE rename attempt (append the
product name), then record a follow-up.
```

## Scanner prompt invents product details

**Problem.** Given a template with blanks like 'In this product that especially means: ...', the agent fills them with plausible flows even when the repo shows none.

**Impact.** A persisted scanner prompt asserts false specifics and skews what it reports.

**Rule location.** [`context-mill: context/skills/replay-vision-scanners-core/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/replay-vision-scanners-core/description.md) (Filling a scanner brief)

**Sources.** [PostHog/context-mill#349](https://github.com/PostHog/context-mill/pull/349)

**Frameworks.** `all`

**Wrong:**

```text
In this product that especially means: the slot picker showing no available
courts, the payment step rejecting a valid card, ...   // no such flows in repo
```

**Fixed:**

```text
If the repo gives you nothing honest for a prompt blank, drop the scaffold
sentence that carries it rather than inventing content, and record that in
your handoff. A generic-but-true prompt beats a specific-but-fabricated one.
```

## Wizard dashboards and notebooks not tagged

**Problem.** The agent gives created dashboards generic names like 'Analytics basics'. Nothing asks it to mark them as wizard-made.

**Impact.** Users cannot tell wizard-created dashboards and notebooks from hand-built ones, and one search for '(wizard)' cannot list them all.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md)
- [`context-mill: context/skills/events-audit/references/6-dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/6-dashboard.md)
- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md)
- [`context-mill: context/skills/integration-v2/dashboard/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/dashboard/description.md)

**Sources.** [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168)

**Frameworks.** `all`

**Wrong:**

```text
dashboard-create { name: "Analytics basics" }
```

**Fixed:**

```text
dashboard-create { name: "Analytics basics (wizard)", tags: ["wizard"] }
notebooks-create-markdown { title: "PostHog audit (wizard) – <repo> – <timestamp>", markdown: "..." }
```

## Insights skipped because events not ingested yet

**Problem.** A careful agent checks read-data-schema and sees that the events it just instrumented are not there yet. It treats an insight as a snapshot of data, not a definition over event names, so holding back looks cautious, and the run still reports success.

**Impact.** Silent: the run reports success but hands off a dashboard with zero insights, or no dashboard at all, and it never fills in.

**Rule location.** [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md) context/skills/integration-v2/dashboard/description.md, context/skills/integration/references/4-conclude.md (all three carry the same paragraph). Wizard issue #894 proposes a matching commandment in src/lib/agent/commandments.ts, but it is not present in the current checkout

**Sources.** [PostHog/context-mill#258](https://github.com/PostHog/context-mill/pull/258), [context-mill@aa3dca0](https://github.com/PostHog/context-mill/commit/aa3dca07), [PostHog/wizard#894](https://github.com/PostHog/wizard/issues/894)

**Frameworks.** `all`

**Wrong:**

```text
read-data-schema -> no event named user_signed_up yet
"Events are not ingested yet, so I will skip the insights for now."
call dashboard-create {"name": "Analytics basics (wizard)"}
# no insight-create call follows; handoff: dashboard created, 0 insights
```

**Fixed:**

```text
Always create these insights based on the intended captures, regardless of
whether those events have been observed yet. An insight is a definition over
event names, not a snapshot of current data ... "No data ingested yet" ... are
never reasons to skip or defer insights - a dashboard handed off without them
is an incomplete integration, not a cautious one.
```

## Trends breakdown written at the wrong level

**Problem.** Older PostHog filter formats, docs and training data show a top-level `breakdown` on TrendsQuery. The current schema wants a `breakdowns` array inside breakdownFilter, and the validation error does not name the supported shape.

**Impact.** insight-create rejects the payload with a vague schema error, which costs a failed call and a retry turn on the first dashboard. The dashboard may end up empty.

**Rule location.**

- [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md) (trends breakdown example: "there is NO top-level `breakdown` field on `TrendsQuery`")
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md)

**Sources.** [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214), [context-mill@5741df3](https://github.com/PostHog/context-mill/commit/5741df31), [PostHog/posthog#68944](https://github.com/PostHog/posthog/issues/68944)

**Frameworks.** `all`

**Wrong:**

```json
"source": {
  "kind": "TrendsQuery",
  "series": [{"kind": "EventsNode", "event": "user_signed_up"}],
  "breakdown": {"property": "plan", "type": "event"}
}
```

**Fixed:**

```json
"source": {
  "kind": "TrendsQuery",
  "series": [{ "kind": "EventsNode", "event": "user_signed_up", "math": "total" }],
  "interval": "day", "dateRange": { "date_from": "-30d" },
  "breakdownFilter": { "breakdowns": [{ "type": "event", "property": "plan" }] },
  "trendsFilter": { "display": "ActionsBar" }
}
```

## Funnel window fields misplaced or snake\_case

**Problem.** The docs suggest the window fields go at the top level of FunnelsQuery, and the agent's fallback guess is the snake\_case names from the legacy filters API. They must be camelCase inside funnelsFilter.

**Impact.** insight-create rejects the funnel, with about two failed funnel-create calls per run when hit.

**Rule location.**

- [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md) (conversion funnel example: window fields "camelCase and live INSIDE funnelsFilter")
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md)

**Sources.** [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214), [PostHog/posthog#68944](https://github.com/PostHog/posthog/issues/68944)

**Frameworks.** `all`

**Wrong:**

```json
"source": {
  "kind": "FunnelsQuery",
  "series": [ ... ],
  "funnelWindowInterval": 14,
  "funnelWindowIntervalUnit": "day",
  "funnelsFilter": { "funnel_window_interval": 14 }
}
```

**Fixed:**

```json
"source": {
  "kind": "FunnelsQuery",
  "series": [
    { "kind": "EventsNode", "event": "page_viewed" },
    { "kind": "EventsNode", "event": "user_signed_up" }
  ],
  "funnelsFilter": { "funnelVizType": "steps", "funnelOrderType": "ordered",
    "funnelWindowInterval": 14, "funnelWindowIntervalUnit": "day" }
}
```

## Guessed chart display names and retry loops

**Problem.** 'ActionsBarChart' sounds right, and the valid trendsFilter.display values were not in `info insight-create`, only in the error response. The agent guesses, then retries small variations instead of reading the error.

**Impact.** Every run that guesses loses at least one call and one retry turn, and some loop or skip the insight.

**Rule location.**

- [`context-mill: context/skills/integration-v2/insight/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/insight/description.md) (final paragraph: valid display values, ActionsBarChart/ActionsBarGraph rejected)
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md)

**Sources.** [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214), [PostHog/posthog#68944](https://github.com/PostHog/posthog/issues/68944)

**Frameworks.** `all`

**Wrong:**

```json
"trendsFilter": { "display": "ActionsBarChart" }   // rejected
// retry:
"trendsFilter": { "display": "ActionsBarGraph" }   // rejected
```

**Fixed:**

```json
"trendsFilter": { "display": "ActionsBar" }
// Valid trendsFilter.display values: ActionsLineGraph, ActionsBar,
// ActionsAreaGraph, ActionsPie, ActionsStackedBar, BoldNumber, ActionsTable.
// If an insight call is rejected, fix the payload against these examples
// rather than retrying variations.
```

## Insights created but not on the dashboard

**Problem.** insight-create succeeds without a `dashboards` field, so the agent never captures the dashboard id or links the two. Nothing errors.

**Impact.** Silent: the insights exist, but the dashboard link given to the user shows nothing.

**Rule location.** [`context-mill: context/skills/integration-v2/dashboard/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/dashboard/description.md) (Create the dashboard), context/skills/integration-v2/insight/description.md, context/skills/integration/references/4-conclude.md, context/skills/events-audit/references/6-dashboard.md

**Sources.** [PostHog/context-mill#220](https://github.com/PostHog/context-mill/pull/220), [context-mill@5741df3](https://github.com/PostHog/context-mill/commit/5741df31), [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```shell
call dashboard-create {"name": "Analytics basics"}
call insight-create {"name": "Signup funnel", "query": {...}}
# no dashboards field, dashboard id never captured
```

**Fixed:**

```shell
call dashboard-create {"name": "Analytics basics (wizard)", "description": "...", "tags": ["wizard"]}
# capture the returned id, then for every insight:
call insight-create {"name": "Signup funnel (wizard)", "dashboards": [<dashboard id>], "query": {...}}
```

## Insight SQL saved with unfilled placeholders

**Problem.** The agent writes parameterised HogQL like `{event_list}` as if a template engine will fill it. insight-create saves the query exactly as written, and the agent also stops the whole dashboard when one insight fails.

**Impact.** Insights store the literal placeholder and show no data, or the user gets no dashboard at all.

**Rule location.** [`context-mill: context/skills/events-audit/references/6-dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/6-dashboard.md)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```text
insight-create { "query": "... WHERE event IN ({event_list}) ..." }  // persisted verbatim
// one failed insight -> abort the dashboard step
```

**Fixed:**

```text
dashboard-create -> emit "[DASHBOARD_URL] <url>" immediately
insight-create { dashboards: [DASHBOARD_ID],
  query: { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery',
    query: "... event IN ('a','b','c') ..." } } }   // IN-list inlined
// continue on failure: a partial dashboard beats none
```

## Created dashboards missing the wizard name tag

**Problem.** A generic agent gives saved artifacts natural names and changes the suffix casing freely. The tag is a wizard convention no doc asks for.

**Impact.** Silent: users cannot search for what the wizard created to find or clean it up.

**Rule location.**

- [`context-mill: context/skills/integration-v2/dashboard/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/dashboard/description.md) context/skills/integration-v2/insight/description.md, context/skills/integration/references/4-conclude.md, context/skills/events-audit/references/6-dashboard.md
- `wizard: src/lib/agent/mcp-prompt-streaming.ts` (Naming saved artifacts)

**Sources.** [PostHog/context-mill#220](https://github.com/PostHog/context-mill/pull/220), [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168), [context-mill@665cfaf](https://github.com/PostHog/context-mill/commit/665cfaf8), [PostHog/wizard#508](https://github.com/PostHog/wizard/pull/508), [PostHog/wizard#600](https://github.com/PostHog/wizard/pull/600)

**Frameworks.** `all`

**Wrong:**

```text
dashboard-create { "name": "My Analytics Dashboard", "tags": [] }
insight-create   { "name": "Signups (Wizard)" }
insight-create   { "name": "Top errors this week" }
```

**Fixed:**

```text
dashboard-create { "name": "Analytics basics (wizard)",
  "description": "Key views for the events instrumented by the PostHog wizard.",
  "tags": ["wizard"] }
// every insight name ends with (wizard), exact casing
// MCP tutorial: every create AND rename keeps "(wizard MCP tutorial)"
```

## Agent edits the user's existing dashboards

**Problem.** With dashboard write scope, reusing or tidying an existing dashboard looks helpful and efficient. Nothing but the prompt wording stops the agent from changing the user's saved work.

**Impact.** The user's saved analytics change without consent, and the wizard's output cannot be told apart from the user's own.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) and context/skills/integration-v2/dashboard/description.md (create the parent dashboard first, attach insights to its id)
- `wizard: src/lib/constants.ts` (WIZARD\_PROVISIONING\_SCOPES grants dashboard:write and insight:write)

**Sources.** [PostHog/wizard#200](https://github.com/PostHog/wizard/pull/200)

**Frameworks.** `all`

**Wrong:**

```text
dashboard-update { id: 4521, name: 'Product overview', ... }  // user's dashboard
```

**Fixed:**

```text
// create the parent dashboard first, capture its id
dashboard-create { name: 'Analytics basics (wizard)', tags: ['wizard'] }
// attach every new insight to the NEW dashboard only
insight-create { name: 'Signup funnel (wizard)', dashboards: [<new dashboard id>], ... }
```

## Dashboard link given in prose, not the marker

**Problem.** Mentioning the URL in a friendly sentence reads like a complete handoff. The agent cannot tell that the harness only parses an exact marker line from its visible final message.

**Impact.** Silent: the wizard's success summary drops the dashboard or notebook link.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (line 73, thinking or prose is dropped), context/skills/integration-v2/dashboard/description.md (Hand off the dashboard), context/skills/integration-v2/notebook/description.md and report/description.md (\[NOTEBOOK\_URL\])
- `wizard: src/lib/agent/signals.ts` (DASHBOARD\_URL, NOTEBOOK\_URL)

**Sources.** [PostHog/context-mill#188](https://github.com/PostHog/context-mill/pull/188), [PostHog/wizard#868](https://github.com/PostHog/wizard/pull/868), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181)

**Frameworks.** `all`

**Wrong:**

```text
Done! Your dashboard is ready at https://us.posthog.com/project/2/dashboard/17
I created the dashboard 'Analytics basics (wizard)': https://us.posthog.com/project/12345/dashboard/678
```

**Fixed:**

```text
[DASHBOARD_URL] https://us.posthog.com/project/12345/dashboard/678
[NOTEBOOK_URL] https://us.posthog.com/project/12345/notebooks/AbCdEfGh
# each on its own line in the visible assistant message, not in thinking;
# exact marker; also recorded in the handoff
```

## Named MCP tools called on an exec-only server

**Problem.** Skills, docs and training data name tools like mcp\_\_posthog-wizard\_\_insight-create. The server now exposes one `exec` tool by default, so the agent hunts for names that no longer exist.

**Impact.** Tool-not-found errors: dashboard, audit, warehouse and self-driving calls all fail, and integration runs stopped completing the dashboard step. Post-install follow-ups stopped firing silently because every call showed up as 'exec'.

**Rule location.**

- [`context-mill: context/shared/mcp-tool-calling.md`](https://github.com/PostHog/context-mill/blob/main/context/shared/mcp-tool-calling.md) ({{> mcp-tool-calling}} partial), context/skills/integration-v2/mcp/description.md, scripts/lib/skill-generator.js#expandPartials
- `wizard: src/lib/agent/runner/harness/pi/runtime-notes.ts` src/lib/host-resolution.ts, src/lib/agent/mcp-prompt-streaming.ts

**Sources.** [PostHog/wizard#842](https://github.com/PostHog/wizard/issues/842), [PostHog/wizard#843](https://github.com/PostHog/wizard/issues/843), [PostHog/wizard#850](https://github.com/PostHog/wizard/issues/850), [PostHog/wizard#851](https://github.com/PostHog/wizard/pull/851), [PostHog/wizard#858](https://github.com/PostHog/wizard/pull/858), [PostHog/wizard#862](https://github.com/PostHog/wizard/pull/862), [PostHog/wizard#863](https://github.com/PostHog/wizard/pull/863), [PostHog/context-mill#219](https://github.com/PostHog/context-mill/pull/219), [PostHog/context-mill#220](https://github.com/PostHog/context-mill/pull/220), [PostHog/context-mill#221](https://github.com/PostHog/context-mill/pull/221), [PostHog/context-mill#222](https://github.com/PostHog/context-mill/pull/222), [PostHog/posthog#69629](https://github.com/PostHog/posthog/pull/69629)

**Frameworks.** `all`

**Wrong:**

```text
ToolSearch select:mcp__posthog-wizard__dashboard-create
mcp__posthog-wizard__dashboard-create {"name": "Analytics basics"}
mcp__posthog-wizard__insight-create({ "name": "Signup funnel (wizard)", ... })
mcp__posthog-wizard__execute-sql { "query": "SELECT ..." }
# server now exposes one `exec` tool; these names do not exist
```

**Fixed:**

```text
exec({ "command": "search dashboard-create|insight-create" })
exec({ "command": "info dashboard-create" })
exec({ "command": "call dashboard-create {\"name\": \"Analytics basics (wizard)\"}" })
# posthog_exec on the pi harness; every PostHog tool goes through exec
# skills use bare inner names via the {{> mcp-tool-calling}} partial;
# harness injects server instructions and recovers inner tool names for follow-ups
```

## MCP tool called without reading its schema

**Problem.** The agent is confident it knows the PostHog API and writes the payload from memory, often in the legacy `filters` shape. It skips `info` and the schema drill-down, and on failure retries variations instead of reading the error's suggestion.

**Impact.** Guessed shapes for insight queries and source payloads are rejected repeatedly, retries burn turns, and the first dashboard is built by trial and error.

**Rule location.**

- [`context-mill: context/shared/mcp-tool-calling.md`](https://github.com/PostHog/context-mill/blob/main/context/shared/mcp-tool-calling.md) (Grammar, Errors)
- `wizard: src/lib/agent/runner/harness/pi/runtime-notes.ts#POSTHOG_MCP` (info once before the first call to each tool)

**Sources.** [PostHog/context-mill#214](https://github.com/PostHog/context-mill/pull/214), [PostHog/context-mill#219](https://github.com/PostHog/context-mill/pull/219), [PostHog/context-mill#220](https://github.com/PostHog/context-mill/pull/220), [PostHog/posthog#68944](https://github.com/PostHog/posthog/issues/68944)

**Frameworks.** `all`

**Wrong:**

```text
exec({ "command": "call insight-create {\"name\":\"Signups\",\"filters\":{\"events\":[{\"id\":\"user_signed_up\"}]}}" })
// legacy filters shape, no info call, rejected
exec({ "command": "call insight-create {\"query\":{\"kind\":\"TrendsQuery\",\"breakdown\":{...}}}" })
// no schema drill-down; on error retry another guess
```

**Fixed:**

```text
exec({ "command": "info insight-create" })                 # REQUIRED before every call
exec({ "command": "schema insight-create query.source" })   # field carries a hint: drill first
exec({ "command": "call insight-create <json_input>" })
# errors carry a suggestion and similar names: read it before retrying
```

## Renamed MCP tools or skills retried blindly

**Problem.** Skill text and memory name tools or skills the server has since renamed, such as survey-list, error-issue-list, signals-scout-config-\* and llma-skill-\*. On an error the agent retries or fuzzy-searches, or skips the step on the first 404, instead of reading the error's suggested names.

**Impact.** The agent loses the first turn of a step to each dead name, and steps degrade or get skipped on a deploy that works.

**Rule location.**

- [`context-mill: context/shared/mcp-tool-calling.md`](https://github.com/PostHog/context-mill/blob/main/context/shared/mcp-tool-calling.md) (Errors)
- [`context-mill: context/skills/self-driving/references/2-read-context.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/2-read-context.md) 6-scouts.md, 6b-tailor-scouts.md

**Sources.** [PostHog/context-mill#224](https://github.com/PostHog/context-mill/pull/224), [PostHog/context-mill#287](https://github.com/PostHog/context-mill/pull/287), [PostHog/context-mill#256](https://github.com/PostHog/context-mill/pull/256), [PostHog/context-mill#272](https://github.com/PostHog/context-mill/pull/272)

**Frameworks.** `self-driving`

**Wrong:**

```shell
info survey-list                -> tool not found
call error-issue-list {}        -> tool not found
call signals-scout-config-sync  -> unknown tool
call llma-skill-get {"skill_name": "authoring-signals-scouts"}  -> 404
```

**Fixed:**

```shell
info surveys-get-all
info query-error-tracking-issues-list
call scout-config-sync
call skill-get {"skill_name": "authoring-scouts"}
# 404 -> try authoring-signals-scouts (stores seeded before the rename)
# Errors carry a suggestion and similar tool names - read it before retrying.
# If a name isn't found it may have been renamed; run `search <pattern>` or `tools`.
```

## Endless search for a tool that is missing

**Problem.** When a tool such as products-enable is missing on a deploy, the agent assumes it was renamed and keeps searching under other names, or gives up on the step.

**Impact.** Round-trips are wasted, and the setup either aborts or invents a workaround instead of leaving a clean follow-up.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/3-enable-products.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/3-enable-products.md) (Tools, step 1)
- references/6c-replay-vision-scanners.md (Tools)

**Sources.** [PostHog/context-mill#287](https://github.com/PostHog/context-mill/pull/287), [PostHog/context-mill#313](https://github.com/PostHog/context-mill/pull/313), [PostHog/context-mill#272](https://github.com/PostHog/context-mill/pull/272)

**Frameworks.** `self-driving`

**Wrong:**

```text
call products-enable {...}   -> never published on this deploy
search enable
search products
search product-enable        # keeps hunting under other names
-> abort the step
```

**Fixed:**

```text
info products-enable   # unknown -> ONE `search enable` to confirm, then stop
# record follow-up: turn on Session replay / Error tracking in Settings
# continue to the next step; never abort. Permission rejection: follow-up too
# (6c scanners: same pattern, one `search vision`; 403 = missing scope)
```

## Made-up tool name for project settings changes

**Problem.** Asked to fix a project setting such as app\_urls, the agent assumes an update tool must exist and invents its name. The MCP may not expose any settings mutation.

**Impact.** The call fails or hits the wrong tool, and the report claims a fix that never happened.

**Rule location.** [`context-mill: context/skills/web-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/description.md) (Available tools, Phase 3 settings fixes), references/remediation.md (fix types, dark\_authorized\_urls)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `all`

**Wrong:**

```text
mcp__posthog-wizard__project-update { app_urls: [...] }   # name guessed, never discovered
```

**Fixed:**

```text
exec({ "command": "search <settings update regex>" }), then `info <tool>`
If you cannot find a settings-mutation tool:
  do NOT guess a tool name, do NOT fabricate a call
  record the fix as manual guidance in the report
```

## Harness mounts every MCP resource as a tool

**Problem.** Setting `directTools: true` looks like the simple, most capable way to expose the server. It also creates a posthog\_get\_&lt;name> tool for each of about 165 skill resources, with sentence-length names, and one name over 128 characters fails the whole Anthropic request.

**Impact.** Every turn returns HTTP 400 and the agent makes zero tool calls, yet the run looks finished. Every model hit this silent no-op.

**Rule location.** `wizard: src/lib/agent/runner/harness/pi/mcp.ts` (setupPostHogMcp), runtime-notes.ts, completion.ts

**Sources.** [PostHog/wizard#862](https://github.com/PostHog/wizard/pull/862), [PostHog/wizard#846](https://github.com/PostHog/wizard/issues/846), [PostHog/wizard#701](https://github.com/PostHog/wizard/pull/701)

**Frameworks.** `all`

**Wrong:**

```ts
const server = {
  url: mcpUrl,
  directTools: true, // also registers ~165 posthog_get_<resource sentence> tools
};
// -> tool name longer than 128 chars -> HTTP 400 on every request
```

**Fixed:**

```ts
const server = {
  url: mcpUrl,
  directTools: ['exec'],   // only the CLI-mode exec tool
  exposeResources: false,
};
// settings: { disableProxyTool: true }; runtime notes describe the exec grammar;
// run fails loudly (NO_PROGRESS, contact-support outro) when the agent makes no tool calls
```

## Long skill resource names break tool calls

**Problem.** The skill builder used the full description sentence as the MCP resource name. Clients that make one tool per resource then derive names far over 128 characters, and nothing warns at build time.

**Impact.** One invalid tool name fails the whole request with a 400, and the agent makes zero tool calls.

**Rule location.** [`context-mill: scripts/lib/build-phases.js`](https://github.com/PostHog/context-mill/blob/main/scripts/lib/build-phases.js) (generateManifest, resource name)

**Sources.** [PostHog/context-mill#225](https://github.com/PostHog/context-mill/pull/225)

**Frameworks.** `all`

**Wrong:**

```yaml
name: "Add PostHog MCP analytics to a TypeScript, JavaScript, or Python MCP server. Instruments …"
# -> posthog_get_add_posthog_mcp_analytics_to_a_typescript_… (493 chars)
```

**Fixed:**

```yaml
name: "any TypeScript or JavaScript MCP server"
# -> posthog_get_any_typescript_or_javascript_mcp_server (51 chars)
# build-phases.js: name: skill.displayName ?? skill.name
```

## MCP tool schemas fill the context window

**Problem.** Attaching an MCP server normally loads every tool schema up front. With PostHog's hundreds of tools this uses most of the window before the first turn, and nothing reports it.

**Impact.** About 113k of Sonnet's 200k tokens are used before turn one, so long integrations run out of room.

**Rule location.**

- `wizard: src/lib/host-resolution.ts` (CLI-mode MCP URL)
- previously src/lib/agent/agent-interface.ts (ENABLE\_TOOL\_SEARCH)

**Sources.** [PostHog/wizard#361](https://github.com/PostHog/wizard/pull/361), [PostHog/wizard#364](https://github.com/PostHog/wizard/pull/364), [PostHog/wizard#367](https://github.com/PostHog/wizard/pull/367), [PostHog/wizard#858](https://github.com/PostHog/wizard/pull/858)

**Frameworks.** `all`

**Wrong:**

```ts
mcpServers: { 'posthog-wizard': { url: MCP_URL } }
// every tool schema inlined; initial context ~113k of 200k tokens
```

**Fixed:**

```ts
env: {
  // Defer MCP tool schemas; ~113k tokens upfront otherwise
  ENABLE_TOOL_SEARCH: 'auto:0',
},
// logs 'Initial context: N tokens' on the first assistant message
// later replaced by the single-exec CLI-mode MCP URL
```

## Prompt promises tools that were never mounted

**Problem.** Static prompts tell the agent to drive steps through posthog\_exec even when the MCP handshake failed. The agent improvises around the missing tool, and nothing reports why.

**Impact.** Silent: a run whose MCP connection dropped creates no dashboard, and in a warehouse run tells the user to set sources up by hand.

**Rule location.**

- `wizard: src/lib/agent/runner/switchboard/commandments.ts`
- src/lib/agent/runner/harness/pi/runtime-notes.ts (RuntimeCaps)
- src/lib/agent/agent-interface.ts (reportMcpSetup)

**Sources.** [PostHog/wizard#1168](https://github.com/PostHog/wizard/pull/1168), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/context-mill#289](https://github.com/PostHog/context-mill/pull/289)

**Frameworks.** `all`

**Wrong:**

```text
pi notes: "drive the dashboard step entirely through posthog_exec"
MCP handshake failed -> tool absent -> report tells the user to set sources up by hand
```

**Fixed:**

```ts
// reportMcpSetup(): capture 'mcp setup failed' if server missing / not connected / no tools
caps = { bash, posthogMcp }                       // notes gated on tools actually mounted
if (caps.posthogMcp) notes.push(POSTHOG_MCP, DASHBOARD_STEP)
```

## Wizard token missing the query read scope

**Problem.** Scopes are picked for write actions like dashboard:write and insight:write, and nobody notices that reading data needs query:read. The failures look like agent mistakes, not auth.

**Impact.** MCP HogQL and insight queries fail with permission errors and get retried or skipped. It took a week of agent remarks to find.

**Rule location.** `wizard: src/lib/constants.ts` (WIZARD\_PROVISIONING\_SCOPES)

**Sources.** [PostHog/wizard#249](https://github.com/PostHog/wizard/pull/249)

**Frameworks.** `all`

**Wrong:**

```typescript
scopes: ['user:read', 'project:read', 'llm_gateway:read',
         'dashboard:write', 'insight:write']
```

**Fixed:**

```typescript
scopes: ['user:read', 'project:read', 'llm_gateway:read',
         'dashboard:write', 'insight:write', 'query:read']
```

## Write scope assumed to allow reads

**Problem.** Most APIs treat write as a superset of read. PostHog OAuth grants exactly the scope strings requested.

**Impact.** List calls return 403, so the agent cannot avoid duplicate flag keys or find person properties.

**Rule location.**

- [`wizard: src/programs/agent-skill/scopes.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/agent-skill/scopes.ts)
- src/programs/oauth/program-scopes.ts
- src/shared/constants.ts (WIZARD\_PROVISIONING\_SCOPES)

**Sources.** [PostHog/wizard#604](https://github.com/PostHog/wizard/pull/604), [PostHog/wizard#512](https://github.com/PostHog/wizard/pull/512), [PostHog/wizard#488](https://github.com/PostHog/wizard/pull/488)

**Frameworks.** `all`

**Wrong:**

```text
scopes: ['feature_flag:write']
agent: feature-flag-list -> 403 (read not granted)
agent: create 'tour-dashboards-first-chart' -> may collide
```

**Fixed:**

```ts
export const AGENT_SKILL_SCOPE_ADDITIONS = [
  'feature_flag:read',
  'feature_flag:write',
  'property_definition:read',
] as const;
```

## CI runs create a dashboard every time

**Problem.** Headless runs use the same task queue as interactive runs, so the dashboard task is queued on every pipeline run. The agent does not know the CI token lacks dashboard scopes, and keeps trying instead of skipping.

**Impact.** Orphan dashboards pile up in the user's project from automation runs, or time and tokens go to a task that cannot succeed.

**Rule location.**

- [`wizard: src/shared/utils/ci-flag-overrides.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/ci-flag-overrides.ts) (ciExcludedTaskTypes)
- src/agent/runner/sequence/orchestrator/orchestrator-runner.ts
- src/lib/agent/agent-prompt-loader.ts (opts.exclude)
- context-mill dashboard.md stays run-mode agnostic

**Sources.** [context-mill@0a62554](https://github.com/PostHog/context-mill/commit/0a62554ec4991cfa4c43dd015ad6b5cd833d6812), [context-mill@464c6fd](https://github.com/PostHog/context-mill/commit/464c6fd7928d155d494846864e419201152319f5), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/wizard#639](https://github.com/PostHog/wizard/pull/639)

**Frameworks.** `all`

**Wrong:**

```text
CI run queue: install -> init -> capture -> build -> dashboard -> report
-> dashboard-create on every pipeline run
-> or dashboard agent retries with a token missing dashboard scopes
```

**Fixed:**

```shell
# CI harness owns the policy; registry drops the type, seed cannot enqueue it
WIZARD_CI_EXCLUDE_TASKS=dashboard
# seed plans around it: `report` follows `build` when `dashboard` is absent
```

## Optional notebook copy fails a delivered report

**Problem.** The skill named an exact notebook tool, and the agent treats the notebook copy as required. notebooks-create-markdown exists only for about 20% of orgs, behind a flag.

**Impact.** The run aborts with 'report step failed' even though every code step finished and the report is on screen. 48 of 77 failed report tasks in 7 days.

**Rule location.**

- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) report/description.md, context/agents/integration-v2/report.md (open PR 423)
- `wizard: open` PRs 1425, 1437

**Sources.** [PostHog/context-mill#423](https://github.com/PostHog/context-mill/pull/423), [PostHog/wizard#1437](https://github.com/PostHog/wizard/pull/1437), [PostHog/wizard#1425](https://github.com/PostHog/wizard/pull/1425), [PostHog/context-mill#376](https://github.com/PostHog/context-mill/pull/376)

**Frameworks.** `all`

**Wrong:**

```text
publish_handoff({ "content": "# PostHog setup ..." })   -> ok
call notebooks-create-markdown {...}                   -> tool not found
complete_task({ "status": "failed" })
```

**Fixed:**

```text
report succeeds once publish_handoff goes through; the notebook is best effort
and never fails the task. If the result names no notebook, use the tool the
catalog lists (notebooks-create-markdown, or notebooks-create with one markdown
node) and emit the exact [NOTEBOOK_URL] line.
```

## Retired notebook tools and hand-built document JSON

**Problem.** Older skills and training data use notebooks-create with a ProseMirror document, a ph-markdown-notebook node and placeholder-swap edits. Those tools were removed from the MCP.

**Impact.** Tool-not-found, so no notebook and no \[NOTEBOOK\_URL\] are produced.

**Rule location.**

- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md)
- integration/references/4-conclude.md
- audit/references/6-report.md
- events-audit/references/6-dashboard.md

**Sources.** [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356), [PostHog/context-mill#232](https://github.com/PostHog/context-mill/pull/232), [context-mill@1fd70df](https://github.com/PostHog/context-mill/commit/1fd70dfe)

**Frameworks.** `all`

**Wrong:**

```shell
call notebooks-create {"title": "PostHog setup (wizard)", "content": {"type": "doc",
  "content": [{"type": "ph-markdown-notebook", "attrs": {"nodeId": "markdown-notebook-v2", "markdown": "..."}}]}}
call notebook-edit {...}   # placeholder-swap choreography
```

**Fixed:**

```shell
call notebooks-create-markdown {"title": "PostHog setup (wizard) – acme-shop", "markdown": "## Events captured\n\n..."}
call notebooks-add-cell {"notebook_id": "AbCdEfGh", "cell_type": "markdown", "markdown": "## Next steps\n..."}
# read back with notebooks-get; title becomes the leading H1
```

## Notebook content sent as plain markdown

**Problem.** A field called `content` looks like it takes text, and the agent has no reason to suspect a ProseMirror document. The call succeeds, so the mistake is silent. (This applies to the older notebooks-create tool, before notebooks-create-markdown.)

**Impact.** The notebook shows raw markdown text and tables do not render.

**Rule location.**

- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md)
- [`context-mill: context/skills/events-audit/references/6-dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/6-dashboard.md)
- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md)

**Sources.** [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168), [PostHog/context-mill#288](https://github.com/PostHog/context-mill/pull/288)

**Frameworks.** `all`

**Wrong:**

```json
notebooks-create { "title": "Audit",
  "content": "# Audit\n| Severity | Area |\n|---|---|" }
```

**Fixed:**

```json
{ "content": { "type": "doc", "content": [
  {"type": "ph-markdown-notebook",
   "attrs": {"nodeId": "markdown-notebook-v2",
             "markdown": "# Audit\n| Severity | Area |\n..."}}
]}}
```

## Notebook JSON wrapped in quotes or raw newlines

**Problem.** exec looks like a shell command, so the agent quotes the JSON argument shell-style, or pastes the multi-line report straight into the string. After the parse error it blames the size and trims the report instead of fixing the encoding.

**Impact.** The call fails with 'Unexpected token' or 'Bad control character', and the notebook is skipped or ships a cut-down report.

**Rule location.**

- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (exec command and Wrong, with exact errors)
- integration/references/4-conclude.md

**Sources.** [PostHog/context-mill#288](https://github.com/PostHog/context-mill/pull/288), [PostHog/context-mill#272](https://github.com/PostHog/context-mill/pull/272), [PostHog/context-mill#241](https://github.com/PostHog/context-mill/pull/241), [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181)

**Frameworks.** `all`

**Wrong:**

```shell
call notebooks-create-markdown '{"title": "PostHog setup (wizard)", ...}'
-> "Unexpected token"
call notebooks-create-markdown {"title": "...", "markdown": "## Events captured

| Event | Where |"}
-> "Bad control character"
```

**Fixed:**

```shell
call notebooks-create-markdown {"title": "PostHog setup (wizard) – acme-shop", "markdown": "## Events captured\n\n| Event | Where |\n|---|---|\n| `user_signed_up` | `src/auth.ts` |\n\nInitialized with \"capture_exceptions: true\".\n"}
# bare JSON on one line, newlines and quotes escaped (\n \" \\);
# report verbatim, never trim or summarize it to parse
```

## Notebook version conflict mistaken for a bad payload

**Problem.** Partial-update looks like a PATCH that needs only the id, so after splitting a long report the agent appends without the version from the create response. It reads the 409 'Someone else edited the Notebook' as a malformed payload, not an optimistic-lock check.

**Impact.** Every append fails: the agent re-escapes or trims a correct payload, the split fallback loops, and the notebook degrades.

**Rule location.** [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (split-transport fallback)

**Sources.** [PostHog/context-mill#288](https://github.com/PostHog/context-mill/pull/288), [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356)

**Frameworks.** `all`

**Wrong:**

```shell
call notebooks-partial-update {"short_id": "AbCdEfGh", "content": {"type": "doc", ...}}
-> 409 "Someone else edited the Notebook"   # misread as a malformed payload
```

**Fixed:**

```shell
call notebooks-add-cell {"notebook_id": "AbCdEfGh", "cell_type": "markdown", "markdown": "## Next steps\n\n- Replace the `DISTINCT_ID` placeholder in `src/auth.ts`\n"}
# one remaining section per call; notebook_id from the create response
# earlier fix on partial-update: pass "version" (0 on a fresh notebook, +1 per
# success); stale -> notebooks-retrieve and resend
```

## Large report truncated in one notebook call

**Problem.** The agent sends the whole audit report as one tool argument. The argument counts against the per-turn output budget, so the model cuts itself off mid-call, never fills a placeholder skeleton, or gets a size rejection and summarizes, and still emits the URL.

**Impact.** The notebook ships with sections missing, literal \_\_PLACEHOLDER\_\_ text, or a summarized report, or is never created, and \[NOTEBOOK\_URL\] is emitted anyway.

**Rule location.**

- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) (Why chunked upload)
- [`context-mill: context/skills/events-audit/references/6-dashboard.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/6-dashboard.md) (e.1-e.3)
- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md)

**Sources.** [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356), [PostHog/context-mill#169](https://github.com/PostHog/context-mill/pull/169), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`

**Wrong:**

```text
call notebooks-create {"title": ..., "content": <full 12-check report tree>}
// model self-truncates mid-call, or size rejection -> trim until it parses;
// or skeleton paragraphs like __FULL_AUDIT_INSTALLATION_TABLE__ never replaced
[NOTEBOOK_URL] https://.../notebooks/AbCdEfGh
```

**Fixed:**

```text
(a) notebooks-create-markdown {title, markdown: mirror line + Summary verbatim}
(b) notebooks-add-cell {notebook_id, cell_type: "markdown", markdown: "## Next section..."}
    one section per call, sequential
(c) notebooks-get -> every ## heading of the on-disk report present?
emit [NOTEBOOK_URL] only after (c) passes
# only the transport is split; the report file on disk stays complete
```

## Setup report saved only as a local file

**Problem.** Writing posthog-setup-report.md to the repo feels like a complete handoff. The agent has no reason to also mirror it into PostHog or emit a marker the harness can show.

**Impact.** The user has no in-app copy of the report to link or comment on in PostHog, and the wizard end screen has no notebook link to show.

**Rule location.**

- [`context-mill: context/skills/integration-v2/notebook/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/notebook/description.md) (notebooks-create-markdown call, \[NOTEBOOK\_URL\] line)
- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (no report file, publish\_handoff plus notebook)

**Sources.** [PostHog/context-mill#232](https://github.com/PostHog/context-mill/pull/232)

**Frameworks.** `all`

**Wrong:**

```text
Write posthog-setup-report.md
# done: report exists only on disk, no notebook, no [NOTEBOOK_URL] line
```

**Fixed:**

```shell
call notebooks-create-markdown {"title": "PostHog setup (wizard) – acme-shop", "markdown": "## Events captured\n..."}
[NOTEBOOK_URL] <host>/project/<project_id>/notebooks/<short_id>
```

## Warehouse source fields guessed instead of looked up

**Problem.** The agent knows roughly what a Postgres connection needs and invents payload field names like conn\_str. It never asks the API which fields that source kind needs.

**Impact.** Source creation fails, or the source is created with the wrong fields.

**Rule location.**

- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (Tools, Guiding tenet 4, in-cli workflow steps 2-6)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (Tools)

**Sources.** [PostHog/context-mill#157](https://github.com/PostHog/context-mill/pull/157)

**Frameworks.** `data-warehouse`

**Wrong:**

```text
external-data-sources-create { source_type: "Postgres", payload: { conn_str: "..." } }  # field names guessed
```

**Fixed:**

```text
1. external-data-sources-wizard {source_type: "Postgres"} -> exact fields
2. wizard_ask exactly those fields (respect `required`)
3. database: external-data-sources-db-schema -> validate + list tables
4. external-data-sources-create (SaaS: data-warehouse-source-setup)
```

## Event lookup tool denied for personal keys

**Problem.** entity-search sounds like the right tool for looking up event definitions and volume. Nothing says it needs project-key permissions that personal API keys lack.

**Impact.** The call returns permission denied, and the volume data the audit report needs never arrives.

**Rule location.** [`context-mill: context/skills/events-audit/references/4-query.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/4-query.md) (MCP tools table, step c)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```text
exec { "command": "call entity-search {\"query\": \"purchase_completed\"}" }
=> permission denied (personal API key)
```

**Fixed:**

```sql
SELECT event, count() AS volume_30d, max(timestamp) AS last_seen
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY AND event IN (<inventory event names>)
GROUP BY event ORDER BY volume_30d DESC
-- via execute-sql; works regardless of key type
```

## Audit retries, switches project, or aborts on MCP errors

**Problem.** A persistent agent retries a failing query, switches to another project it can see, fills the gap with plausible findings, or aborts. It does not treat a missing scope or an older PostHog as a normal result, or know the active project belongs to the wizard session.

**Impact.** The user gets no report, invented findings, or numbers from the wrong project. Calling audit\_add\_checks with an empty list is rejected.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/4-query.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/4-query.md) (steps a, g, i)
- [`context-mill: context/skills/audit/references/5-live-data.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/5-live-data.md) (step a, Resolve)
- events-audit/references/5-report.md ({{mcp\_disclaimer}})

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324)

**Frameworks.** `all`

**Wrong:**

```text
execute-sql failed -> retry x3
health-issues-list -> permission denied -> retries, then writes guessed findings
project mismatch -> mcp__posthog__project-set-active <other project>
[ABORT] MCP unavailable
nothing open -> audit_add_checks({ checks: [] })   // zero-length batch rejected
```

**Fixed:**

```text
{ "mcp_available": false, "mcp_skipped_reason": "execute-sql failed: <short reason>" }
// events-audit: one attempt; live-data: at most one retry; never guess.
// Never switch the wizard's active project.
// Report renders code-side findings plus a {{mcp_disclaimer}} callout; dashboard step skipped.
// live-data sweep row: "Skipped: health-issues-list unavailable. Source-tree checks are unaffected..."
// Nothing open: skip audit_add_checks, sweep row "No open findings in PostHog".
```

## Audit repeats duplicate and dismissed findings

**Problem.** The agent copies every recommendation and health issue it reads. It does not know one is computed from the other, or that dismissed rows are the user's answer.

**Impact.** The report counts one problem twice and keeps raising findings the user already chose to ignore.

**Rule location.** [`context-mill: context/skills/audit/references/5-live-data.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/5-live-data.md) (a. filters, b. Drop restatements)

**Sources.** [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324)

**Frameworks.** `all`

**Wrong:**

```text
rows appended:
  live-data-source-maps                         (recommendation: source_maps)
  live-data-error-tracking-missing-source-maps (health kind restating it)
  + rows with completed: true or dismissed_at set
```

**Fixed:**

```text
Keep a recommendation only when completed is false AND dismissed_at is null.
Drop dismissed rows silently: dismissing is an answer.
Pairing: health error_tracking_missing_source_maps restates recommendation
  source_maps -> keep the recommendation, drop the health issue.
```

## HogQL written as raw SQL with no time range

**Problem.** Training data has far more ClickHouse and generic SQL than HogQL, so the agent uses JSONExtract and count(DISTINCT) and scans the full table with no time range. On ClickHouse-backed HogQL that is slow and costly, and nothing errors.

**Impact.** Queries are slow or time out, dashboards are expensive, and results do not cover the window the user wanted.

**Rule location.**

- [`context-mill: context/commandments.yaml#hogql`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/tools-and-features/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tools-and-features/description.md)

**Sources.** [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [context-mill@06b0514](https://github.com/PostHog/context-mill/commit/06b05140)

**Frameworks.** `hogql`

**Wrong:**

```sql
SELECT JSONExtractString(properties, '$browser') AS b, count(DISTINCT person_id)
FROM events
WHERE event = '$pageview'
GROUP BY b
```

**Fixed:**

```sql
SELECT properties.$browser AS browser, uniq(person_id)
FROM events
WHERE event = '$pageview'
  AND timestamp >= now() - INTERVAL 7 DAY AND {filters}
GROUP BY browser
```

## Dashboard SQL ignores dashboard filters and dates

**Problem.** The agent hardcodes a date in the SQL tile as it would in any SQL editor. It does not know about the {filters} placeholders that connect the tile to the dashboard controls.

**Impact.** Silent: the dashboard's filter and date-range controls do nothing for that tile.

**Rule location.** [`context-mill: context/commandments.yaml#hogql`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [context-mill@06b0514](https://github.com/PostHog/context-mill/commit/06b05140), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61)

**Frameworks.** `hogql`

**Wrong:**

```sql
SELECT toStartOfDay(timestamp) AS d, count()
FROM events
WHERE timestamp >= '2026-01-01'
GROUP BY d
```

**Fixed:**

```sql
SELECT dateTrunc('day', timestamp) AS d, count()
FROM events
WHERE {filters}
  AND timestamp >= {filters.dateRange.from}
  AND timestamp <= {filters.dateRange.to}
GROUP BY d
```

## Missing property compared to empty string

**Problem.** In standard SQL, NULL compared to '' is never true, so an agent assumes missing rows drop out. In HogQL `NULL != ''` is TRUE, and nothing errors.

**Impact.** Silent: every row missing the property counts as a match, so proxied vs direct counts are skewed.

**Rule location.** [`context-mill: context/skills/web-analytics/references/checks.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/web-analytics/references/checks.md) (HogQL NULL gotcha)

**Sources.** [PostHog/context-mill#166](https://github.com/PostHog/context-mill/pull/166)

**Frameworks.** `all`

**Wrong:**

```sql
countIf(properties.$lib_custom_api_host != '') AS proxied
```

**Fixed:**

```sql
countIf(coalesce(properties.$lib_custom_api_host, '') != '') AS proxied
```

## MCP calls hit the last-opened project

**Problem.** Without a project id, MCP tools fall back to the user's last-selected project, not the one the key belongs to. Single-project testing never shows this.

**Impact.** In orgs with several projects the run acts on the wrong project, fails, or wastes turns.

**Rule location.**

- [`wizard: src/agent/agent-prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-prompt.ts) (defaultProjectPrompt)
- src/cli/wizard.ts (--project-id)

**Sources.** [PostHog/wizard#285](https://github.com/PostHog/wizard/pull/285), [PostHog/wizard#287](https://github.com/PostHog/wizard/pull/287)

**Frameworks.** `all`

**Wrong:**

```text
MCP: insights-list / flags-create (no project id passed)
-> resolves to last-opened project 2; API key is for project 1
```

**Fixed:**

```text
Project context:
- PostHog Project ID: ${context.projectId}
- PostHog API Key: ...
// on mismatch: "Try passing --project-id or POSTHOG_WIZARD_PROJECT_ID explicitly"
```

## Demo queries run against an empty project

**Problem.** The agent is told it is giving a live demo, so it runs canned read prompts. When results come back empty, it improvises instead of saying the project has no data.

**Impact.** The agent describes empty results as if they were a demo, and the user hits a dead end with no data.

**Rule location.**

- [`wizard: src/tui/tools/mcp/services/mcp-project-profile.ts`](https://github.com/PostHog/wizard/blob/main/src/tui/tools/mcp/services/mcp-project-profile.ts)
- mcp-role-prompts.ts#getTutorialPicker

**Sources.** [PostHog/wizard#600](https://github.com/PostHog/wizard/pull/600)

**Frameworks.** `all`

**Wrong:**

```text
Prompt: "show me my top events this week"
Project: 0 events in last 30 days
Agent: runs query, gets [], narrates what the chart would look like
```

**Fixed:**

```ts
if (profile.tier === 'empty') {
  return [...WRITE_ONLY_QUESTS, ...getActivationCrossSell(role, profile, 2)];
}
// probe: 1 HogQL query (5s timebox) for volume + real event names;
// failed probe falls back to the static kit
```

## User told to create flags by hand

**Problem.** Feature-flag docs tell humans to create the flag in the PostHog UI, and the agent repeats that even when a connected MCP server can create the flag itself.

**Impact.** The user gets extra manual steps, and flags may not exist when the code ships.

**Rule location.** [`context-mill: context/skills/feature-flags/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/feature-flags/description.md) (PostHog MCP tools)

**Sources.** [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61)

**Frameworks.** `all`

**Wrong:**

```text
Now go to PostHog > Feature Flags and create a flag called `new-checkout`.
```

**Fixed:**

```text
Check if a PostHog MCP server is connected. If it exposes flag tools
(create, list, update, delete), use them to manage flags directly
instead of asking the user.
```

## Coding agents do not know PostHog CLI

**Problem.** The posthog-cli api is newer than most training data, and nothing in the user's agent instructions mentions it, so agents write raw REST calls by hand.

**Impact.** Agents skip the supported agent-friendly path and fall behind current PostHog APIs.

**Rule location.**

- [`wizard: src/cli/commands/cli/add.ts`](https://github.com/PostHog/wizard/blob/main/src/cli/commands/cli/add.ts)
- src/shared/install-cli-steering/index.ts

**Sources.** [PostHog/wizard#646](https://github.com/PostHog/wizard/pull/646)

**Frameworks.** `all`

**Wrong:**

```text
~/.claude/CLAUDE.md has no PostHog guidance; the agent improvises
curl/fetch calls with a personal API key for PostHog data tasks.
```

**Fixed:**

```text
# wizard cli add -> posthog-cli api agents-md install --path ~/.claude/CLAUDE.md
<posthog>
Use `posthog-cli api` for all PostHog-related data queries and operations.
Before your first PostHog command, run `posthog-cli api --agent-help`.
</posthog>
```

## MCP feature filter uses wrong id spelling

**Problem.** Hyphenated ids look like normal URL style, and a list copied once goes stale. The server's names use underscores, and it silently ignores names it does not know.

**Impact.** The features= filter names groups the server does not recognize, so the intended tools are probably not enabled.

**Rule location.** `wizard: src/steps/add-mcp-server-to-clients/defaults.ts` (AVAILABLE\_FEATURES, features= URL param)

**Sources.** [PostHog/wizard#350](https://github.com/PostHog/wizard/pull/350)

**Frameworks.** `all`

**Wrong:**

```text
https://mcp.posthog.com/mcp?features=llm-analytics,error-tracking,flags
```

**Fixed:**

```text
https://mcp.posthog.com/mcp?features=llm_analytics,error_tracking,flags
// AVAILABLE_FEATURES mirrors all 29 server features with canonical names
```

## API key in .env ignored for MCP

**Problem.** OAuth is the default MCP setup, and the agent does not check .env.local or .env for an existing personal API key. The helper that read the key was added but never called, so nothing caught it.

**Impact.** Terminal-only and Stripe Projects users get an unwanted browser login.

**Rule location.** `wizard: src/utils/env-api-key.ts` (readApiKeyFromEnv), wired in src/lib/runners/run-non-interactive.ts

**Sources.** [PostHog/wizard#356](https://github.com/PostHog/wizard/pull/356), [PostHog/wizard#363](https://github.com/PostHog/wizard/pull/363)

**Frameworks.** `all`

**Wrong:**

```shell
claude mcp add --transport http posthog https://mcp.posthog.com/mcp
# .env has POSTHOG_PERSONAL_API_KEY=phx_xxx but OAuth is used anyway
```

**Fixed:**

```ts
apiKey: argv.apiKey ?? readApiKeyFromEnv(), // .env.local, then .env
// MCP client config then sends Authorization: Bearer instead of OAuth
```

## Inbox source rows created twice

**Problem.** The agent assumes setup means creating rows, so it calls create without listing first. It also creates the scout-gate row, which is on by default and exists only to record an opt-out.

**Impact.** The duplicate create returns 400 and the setup step stalls or aborts, or a redundant row is added.

**Rule location.**

- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (Every write must be idempotent)
- references/4-sources.md (Scout gate row)
- 6-scouts.md

**Sources.** [PostHog/context-mill#254](https://github.com/PostHog/context-mill/pull/254), [PostHog/context-mill#369](https://github.com/PostHog/context-mill/pull/369)

**Frameworks.** `self-driving`

**Wrong:**

```text
inbox-source-configs-create {"source_product": "github", "source_type": "issue"}
-> 400 (row already exists)
inbox-source-configs-create {source_product: "signals_scout",
  source_type: "cross_source_issue", enabled: true}   // redundant
```

**Fixed:**

```text
List before you create. Every write must be idempotent.
Duplicate -> find existing id -> inbox-source-configs-partial-update {id, enabled: true}
Scout gate: never create; enabled:false row -> partial-update enabled:true;
  no row -> do nothing, record "on by default".
```

## Two signal pipelines on one surface

**Problem.** More pipelines look like more coverage. The agent turns on a scout for error tracking or replay when a native source or scanner already covers that surface.

**Impact.** The same finding reaches the inbox twice, which adds noise, not coverage.

**Rule location.**

- [`context-mill: context/skills/self-driving/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/description.md) (One surface, one route)
- references/6-scouts.md
- 6b-tailor-scouts.md

**Sources.** [PostHog/context-mill#374](https://github.com/PostHog/context-mill/pull/374), [PostHog/context-mill#370](https://github.com/PostHog/context-mill/pull/370)

**Frameworks.** `self-driving`

**Wrong:**

```text
enable native error_tracking sources
scout-config-update { id: signals-scout-error-tracking, enabled: true }  // duplicate
```

**Fixed:**

```text
One surface, one route:
error tracking, support, setup health -> native source (step 4)
session replay -> Replay Vision scanners (step 6c)
connected tool -> warehouse source + responder (step 5)
everything else -> scout troop (steps 6, 6b)
```

## Partial config update wipes stored settings

**Problem.** 'partial-update' suggests a field-level merge, but the config object is replaced whole. The list call leaves out config, so the agent never sees what it is overwriting.

**Impact.** Silent: the user's steering text and default\_not\_actionable flag are deleted, which changes which Linear issues become signals and paid draft PRs.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/5-connected-tools.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/5-connected-tools.md) (Linear, step 4)
- description.md (write surface)

**Sources.** [PostHog/context-mill#396](https://github.com/PostHog/context-mill/pull/396)

**Frameworks.** `self-driving`, `Linear`

**Wrong:**

```json
inbox-source-configs-partial-update {
  "id": "<row id>",
  "config": { "linear_team_ids": ["T1"] }   // replaces the whole config
}
```

**Fixed:**

```json
cfg = inbox-source-configs-retrieve(id).config   // list omits config
inbox-source-configs-partial-update {
  "id": "<row id>",
  "config": { ...cfg, "linear_team_ids": ["T1"] }
}  // retrieve failed: write enabled only, record pick as follow-up
```

## Custom scout created with the generic skill tool

**Problem.** A scout looks like a skill with a signals-scout- name prefix, so skill-create seems right. Only scout-create grants the report-channel tools.

**Impact.** Silent: the scout's first run uses the deprecated signal channel and produces weak findings instead of full inbox reports.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/6b-tailor-scouts.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6b-tailor-scouts.md) (step 4)
- description.md (write surface)

**Sources.** [PostHog/context-mill#411](https://github.com/PostHog/context-mill/pull/411)

**Frameworks.** `self-driving`

**Wrong:**

```json
skill-create {
  "name": "signals-scout-checkout-funnel",
  "description": "...", "body": "..."
}   // no report tools; config auto-registered later
```

**Fixed:**

```json
scout-create {
  "name": "checkout-funnel", "description": "...", "body": "...",
  "config": { "enabled": true }  // emit, run_interval_minutes keep defaults
}  // writes skill + config atomically, grants report-channel tools
```

## Logs and Endpoints signal sources left disabled

**Problem.** The guide said logs had no responder and never mentioned endpoints, so the agent created no source rows for them. A missing row drops signals silently.

**Impact.** Silent: emit\_signal returns early with no source row, so Logs and Endpoints findings never reach the Inbox.

**Rule location.**

- context-mill main: context/skills/self-driving/references/4-sources.md (Enable table, Logs and Endpoints rows)
- references/2-read-context.md (endpoints-get-all probe). The shallow local checkout predates PR 412, use gh api

**Sources.** [PostHog/context-mill#412](https://github.com/PostHog/context-mill/pull/412)

**Frameworks.** `self-driving`

**Wrong:**

```text
4-sources.md (old): "logs: Nowhere yet, no v1 responder"; endpoints not listed
-> no row for logs / alert_state_change
-> no rows for endpoints / endpoint_execution_failed
```

**Fixed:**

```text
| Logs      | Only when the project uses Logs (step-2 checklist)        | logs / alert_state_change |
| Endpoints | Only when the project has endpoints (step-2               | endpoints / endpoint_execution_failed |
|           |  endpoints-get-all probe); enable BOTH rows               | endpoints / endpoint_breakdown_limit_exceeded |
// narrowed: only source_type evaluation is "Nowhere" now
```

## Enabled-scout limit ignored when planning

**Problem.** The agent sizes the troop against the documented ceiling of ten and the run budget. It misses the per-project max\_enabled\_scouts and sends enables before disables.

**Impact.** The server rejects enables past the limit, so scouts the user approved never start.

**Rule location.**

- context-mill main: context/skills/self-driving/references/6-scouts.md (step 1c, step 3 "Do the disables first, then the enables")
- references/6b-tailor-scouts.md (room formula)
- description.md (ceiling bullet). The shallow local checkout predates PR 414, use gh api

**Sources.** [PostHog/context-mill#414](https://github.com/PostHog/context-mill/pull/414)

**Frameworks.** `self-driving`

**Wrong:**

```text
// cap 6; 1 operational + 2 custom already enabled
plan = general + 5 specialists + 3 custom   // 9 planned
scout-config-update { "id": ..., "enabled": true }  // rejected: cap reached
```

**Fixed:**

```text
// max_enabled_scouts from scout-metadata-get
slots = max_enabled_scouts - enabled_operational
        - breaker_paused_operational - enabled_custom   // 6-1-0-2 = 3
// pick general + 2 specialists fit inside slots
// 6b room = min(10, budget, slots) - step6_count = 0 -> skip custom proposal
// step 3: disables first, then enables; cap cut a scout -> follow-up
// field absent (older deploy) -> old sizing
```
