# Success reported without proof

72 cases. Part of the [edge case catalogue](../edge-cases.md).

## Success screen names a report nobody writes

**Problem.** The agent naturally summarises in chat. Unless the prompt names the file and location, it never writes the report the outro points to.

**Impact.** Every upload-source-maps success screen (iOS, Android, Flutter, JS) pointed at posthog-source-maps-report.md, which no run had written.

**Rule location.** [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 9, reportFile param threaded from the program's REPORT\_FILE)

**Sources.** [PostHog/wizard#1006](https://github.com/PostHog/wizard/pull/1006)

**Frameworks.** `all`

**Wrong:**

```text
Outro: "Details in <installDir>/posthog-source-maps-report.md"
STEP 9 — Summarise and hand off. (skill: "Verify and hand off")
   Follow the skill's "Verify and hand off" step.
# agent summarises in chat; no file is written
```

**Fixed:**

```text
STEP 9 — Summarise and hand off. (skill: "Verify and hand off")
   Write the hand-off to `${reportFile}` at the WIZARD'S WORKING DIRECTORY,
   never prefixed with the selected project directory. Cover: the files
   you changed (paths only), the exact build and upload commands, every CI
   secret the user still has to create, and how to verify the upload.
   Never write secret values into the report, only variable names.
   The success screen points the user at this file, so do not skip it.
```

## Automated browser checks see zero events

**Problem.** posthog-js silently drops every capture from Playwright, Puppeteer or Selenium as a likely bot while /flags and asset loads still return 200, so the network tab looks healthy. Nothing in the integration docs warns about this, so the agent blames its own init code.

**Impact.** False negative: a working integration is rewritten or reported broken, or the agent ships opt\_out\_useragent\_filter: true in production init to make the test pass.

**Rule location.** [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (last bullet: "When verifying with an automated browser (Playwright, Puppeteer, Selenium), posthog-js's bot filter silently drops every capture...")

**Sources.** [context-mill@303f226](https://github.com/PostHog/context-mill/commit/303f2261), [context-mill@ac40cbe](https://github.com/PostHog/context-mill/commit/ac40cbe5), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `react-vite`, `sveltekit`, `vue`, `tanstack-start`

**Wrong:**

```ts
await page.goto('http://localhost:3000')
await page.click('#signup')
// /flags and array.js 200, no /e capture requests
// agent: 'events are not sending' -> rewrites init,
// or ships opt_out_useragent_filter: true
```

**Fixed:**

```ts
// test harness only, never app code
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  // also override navigator.userAgent AND navigator.userAgentData
})
// diagnose with ?__posthog_debug=true and look for "likely bot" in the console
```

## Green build reported as events flowing

**Problem.** A passing build and a correct-looking diff feel like proof, and the agent never sees the running app. The failure is silent: rubric and diff both look fine while nothing arrives.

**Impact.** Users merge believing events and identify work when the app sends nothing or only personless events.

**Rule location.** [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (## Goal, paragraph 'Separate what the run verified from what it did not', 'How you know you succeeded' says unconfirmed claims read as unconfirmed)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@b5829f9](https://github.com/PostHog/context-mill/commit/b5829f9166008cc8e64daf24754ead8eeabdd554), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa39)

**Frameworks.** `all`, `laravel`, `php`

**Wrong:**

```markdown
## Summary
Build passes. Events are now flowing to PostHog:
- user_signed_up, note_created, check_created
- Identify wired for all users
(no event was observed arriving)
```

**Fixed:**

```markdown
## Verified
- Build and typecheck pass
## Not verified
- Event delivery: nothing in this run observed an event arrive
# rule: 'A passing build proves the code compiles, not that events flow —
# never write that an event was captured unless the run observed it arrive.'
```

## Report claims done without a pre-merge checklist

**Problem.** Agents end with 'PostHog is integrated and working' or 'test it and check PostHog' because they built the files they touched, not knowing which failures are invisible from code, such as a CSP silently blocking the SDK, unset deploy env vars, or stale mocks.

**Impact.** A blocked SDK queues events silently and never sends. Users merge with unrun tests, unset deploy env vars and no CI source-map upload.

**Rule location.**

- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) ('Before you merge' checklist items)
- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (checklist items name file and line)
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) ('Verify before merging', v1 wording)

**Sources.** [context-mill@b5829f9](https://github.com/PostHog/context-mill/commit/b5829f9166008cc8e64daf24754ead8eeabdd554), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447)

**Frameworks.** `all`

**Wrong:**

```markdown
## Next steps
Test that everything works and check PostHog.
# or:
Setup complete. PostHog is integrated and working. No further action needed.
```

**Fixed:**

```markdown
## Before you merge
- [ ] Load the app and check the console for CSP violations
      (src/middleware.ts:12): a blocked SDK queues events silently
- [ ] Run a full production build (the wizard only verified the files it touched)
- [ ] Run the test suite: call sites may need updated mocks
- [ ] Env vars set in deploy environments, not just locally
- [ ] Wire source-map upload into CI if bundles are minified
```

## Full build never run after generated code

**Problem.** The agent checks only the files it touched and trusts that a lint directive or cast it wrote is right. The misplaced eslint-disable only fails under a full production build.

**Impact.** First `next build` fails on an unused disable directive plus an unsuppressed `any`, breaking CI right after the integration reported success.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (Verify before merging, the two 'Always' items)
- same items in context/skills/integration-v2/report/description.md ('Before you merge'). wizard: src/lib/programs/posthog-integration/handoff.ts builds the prompt that points the user's coding agent at the checklist

**Sources.** [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174)

**Frameworks.** `Next.js`, `TypeScript`

**Wrong:**

```typescript
const client = new PostHogAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posthog: phClient,
} as any)  // the `any` is here, the directive is not
// report: "Integration complete." (no build, no tests)
```

**Fixed:**

```markdown
## Verify before merging
- [ ] Run a full production build (the wizard only verified the files it touched)
      and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite - call sites that were rewritten or instrumented
      may need updated mocks or fixtures.
```

## Skipped or failed products reported as configured

**Problem.** The agent summarises intent rather than outcome and rounds partial results up to success. The outro renders every planned change under a success banner regardless of task status.

**Impact.** Users believe AI Observability, Logs or source-map upload is live when the task was skipped or failed.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) ('A skipped product is not a successful setup', distinguish code verification from observed delivery)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) ('Do not make paid LLM calls or claim delivery based on code changes')
- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) ('do not treat a skipped or failed task as a successful setup')
- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) ('Where a step failed or was skipped, say so plainly')

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [PostHog/context-mill#408](https://github.com/PostHog/context-mill/pull/408), [PostHog/wizard#951](https://github.com/PostHog/wizard/issues/951), [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325), [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/wizard#1195](https://github.com/PostHog/wizard/pull/1195), [PostHog/wizard#1216](https://github.com/PostHog/wizard/pull/1216), [PostHog/wizard#1147](https://github.com/PostHog/wizard/pull/1147), [PostHog/wizard#952](https://github.com/PostHog/wizard/pull/952), [PostHog/wizard#606](https://github.com/PostHog/wizard/pull/606), [PostHog/wizard#608](https://github.com/PostHog/wizard/pull/608), [PostHog/wizard#609](https://github.com/PostHog/wizard/pull/609)

**Frameworks.** `all`

**Wrong:**

```markdown
Successfully installed PostHog!
- AI Observability: configured, events flowing
- Source-map upload is wired into every production build
(AIO task skipped; credentials and CI step skipped)
```

**Fixed:**

```markdown
- AI Observability: skipped (no LLM call sites found)
- Logs: configured, delivery unobserved; trigger X to confirm
- Source maps: failed, credentials not provided
# 'A skipped product is not a successful setup.'
# 'Do not make paid LLM calls or claim delivery based on code changes.'
```

## LLM or log delivery claimed without seeing it

**Problem.** After wiring AI Observability or Logs the agent either assumes events flow or proves it by making a model call itself, writing an API key into a file to make it work, though it holds no credentials.

**Impact.** Reports assert delivery nobody observed. Model costs land on the user and a secret may land in committed code.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/4-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/4-verify.md) (intro, 'Tell the user how to trigger it', 'When it looks wrong', 'Do not')
- [`context-mill: context/agents/integration-v2/ai-observability.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/ai-observability.md) ('Do not run the app or make paid LLM calls', 'Describe delivery as unverified unless this run actually observed it')
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) ('delivery remains unverified until observed')

**Sources.** [PostHog/context-mill#251](https://github.com/PostHog/context-mill/pull/251), [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `openai`, `anthropic`, `langchain`, `vercel-ai`, `google-gemini`, `logs`

**Wrong:**

```text
[STATUS] AI Observability complete: $ai_generation events are flowing
# agent ran a live OpenAI call to check, or never checked at all:
echo "OPENAI_API_KEY=<real key>" >> smoke.env
python smoke_test.py   # agent calls the model itself
```

**Fixed:**

```text
Do not call the model yourself. You hold no credentials.
Do not put an API key in any file.
Name the smallest existing path (script, route, test) that runs one turn.
If no path exists, write one in the report as suggested code.
Report "wired, unverified" until the user confirms what landed.
If nothing arrives: vendor client still called, key or host unset, short script exits before flush.
```

## LLM tracing judged by the diff

**Problem.** Swapping in the PostHog wrapper client looks complete, but trace grouping (session, trace, spans, person) only shows up in what reaches PostHog.

**Impact.** Silent: a run producing one trace per call passes, and the user is told it works.

**Rule location.** [`context-mill: context/skills/ai-observability/references/4-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/4-verify.md)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `all`

**Wrong:**

```markdown
Agent report: "Replaced OpenAI client with PostHog wrapper, added posthog_distinct_id.
AI Observability integration complete."
```

**Fixed:**

```markdown
Grade what reaches PostHog, not what the diff contains. Open the newest trace:
- one session holds the turns of one conversation
- one trace holds every generation of one turn
- a span per tool run; person matches the app's user id
- $ai_provider names the real provider on a gateway
Report "wired, unverified" until the user confirms.
```

## LLM wrapper import never executed

**Problem.** Wrapper module paths differ by provider and language, and some providers (Bedrock, Go) have no wrapper at all. The agent writes the import from memory without running it.

**Impact.** The app crashes at startup with ModuleNotFoundError when the wrapper does not exist for that provider or language.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/4-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/4-verify.md) (import smoke test, Do not)
- references/3-instrument.md (Do not: 'Do not ship code whose imports fail')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `python`, `all`

**Wrong:**

```python
from posthog.ai.bedrock import BedrockClient   # no such wrapper; Bedrock is OTel-only
# written, never executed; report says done
```

**Fixed:**

```bash
# Before you hand over, run the import the code depends on:
python3 -c "from posthog.ai.openai import OpenAI"
# If it fails, go back to 1-begin.md and pick another variant.
# Do not report a run as done while an import fails.
```

## One LLM call site left uninstrumented

**Problem.** The agent finds call sites with one narrow grep for a single constructor shape and reports the hit count as the whole set. A differently structured import is invisible and the miss is silent.

**Impact.** One agent loop keeps the raw vendor client, so its generations never produce $ai\_generation events while the report claims full coverage.

**Rule location.**

- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (Verify before merging, LLM analytics item)
- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (same item)
- [`context-mill: context/skills/ai-observability/references/4-verify.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/4-verify.md) (When it looks wrong). The 'no remaining new Anthropic() constructors' check was proposed in wizard issue #447 but is not shipped

**Sources.** [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174)

**Frameworks.** `@posthog/ai`, `Anthropic SDK`, `OpenAI`, `Node.js`, `Python`

**Wrong:**

```bash
grep -rn "new Anthropic(" src/     # finds N sites
# site N+1 lives in another module with a different import shape
# report: "instrumented N Anthropic call sites"
```

**Fixed:**

```markdown
# integration 4-conclude.md, 'Verify before merging' checklist:
- [ ] Trigger the LLM call path(s) you instrumented and confirm
      `$ai_generation` events appear in PostHog AI Observability.
# ai-observability 4-verify.md, 'Nothing arrives' cause:
#   the code still calls the vendor client (a missed call site)
```

## Warehouse sources reported connected, none created

**Problem.** Handing out a deep link, collecting valid-looking credentials, or a prompt line saying 'never poll' all feel like progress, and a warehouse run changes almost no code, so a perfect run and a no-op look identical in the diff. The agent reports a connection it never confirmed, sometimes with invented IDs.

**Impact.** Silent no-op: of 697 warehouse tasks reported completed, only 247 created a source (about 65%). Users trust sources that do not exist or lose track of rejected ones.

**Rule location.**

- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) (tenet 8, Your report section)
- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (tenet 6, step 7, Report)
- [`context-mill: context/agents/integration-v2/warehouse.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/warehouse.md)
- wizard (main): src/programs/warehouse-source/
- src/programs/self-driving/prompt.ts (STEP 5)
- [`wizard-workbench: services/wizard-ci/warehouse-checks.ts`](https://github.com/PostHog/wizard-workbench/blob/main/services/wizard-ci/warehouse-checks.ts) (claimedConnected, 'no silent no-op', attemptedFailOk)

**Sources.** [PostHog/context-mill#360](https://github.com/PostHog/context-mill/pull/360), [PostHog/context-mill#333](https://github.com/PostHog/context-mill/pull/333), [PostHog/context-mill#336](https://github.com/PostHog/context-mill/pull/336), [PostHog/wizard#1146](https://github.com/PostHog/wizard/pull/1146), [PostHog/wizard#1144](https://github.com/PostHog/wizard/pull/1144), [PostHog/wizard#1395](https://github.com/PostHog/wizard/pull/1395), [PostHog/wizard#488](https://github.com/PostHog/wizard/pull/488), [PostHog/wizard#642](https://github.com/PostHog/wizard/pull/642), [PostHog/wizard#951](https://github.com/PostHog/wizard/issues/951), [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/wizard-workbench#3627](https://github.com/PostHog/wizard-workbench/pull/3627), [PostHog/wizard-workbench#3616](https://github.com/PostHog/wizard-workbench/pull/3616), [PostHog/wizard-workbench#3672](https://github.com/PostHog/wizard-workbench/pull/3672)

**Frameworks.** `all`

**Wrong:**

```markdown
Created 1 of 1 detected sources in PostHog.
**Stripe** was connected using a restricted API key.
- Source ID: 00000000-0000-7000-5747-000000000001   # no create call was made
# or: "All 5 detected data sources are set up." (user cancelled every prompt)
# or: [STATUS] Connected Postgres   (right after wizard_ask answers)
```

**Fixed:**

```text
Connected 0 of 5 detected sources. The user cancelled the credential
prompts, so all 5 need browser setup.   # data-warehouse-source: 'Created 0 of 5 ...'
- Stripe: needs the browser - <new-source URL>
// count a source only when external-data-sources-create returned success;
// a deep link is a handoff, not a connected source; on failure report the error
# grader: E2E_CHECK FAIL no silent no-op - report claims connected, no create succeeded
```

## Outro hides sources left unconnected

**Problem.** It is natural to assume a step marked done handled every input it was given, so the follow-up links get filtered out.

**Impact.** Sources whose credential prompts were dismissed or timed out get no next-step link at all.

**Rule location.** wizard (main): src/programs/posthog-integration/index.ts buildWarehouseNextSteps (PR #1395)

**Sources.** [PostHog/wizard#1395](https://github.com/PostHog/wizard/pull/1395)

**Frameworks.** `all`

**Wrong:**

```ts
buildWarehouseNextSteps(sess, host, projectId, completedSeededTypes)
if (completedSeededTypes.includes(WAREHOUSE_SEED_TASK_TYPE)) return undefined;
// drops every source when the seeded step finished 'done'
```

**Fixed:**

```ts
buildWarehouseNextSteps(sess, host, projectId)
const listed = sources.slice(0, WAREHOUSE_LINK_LIMIT);
// lists every detected source; the limit only caps how many get a bullet
```

## Outro shows success when a step was blocked

**Problem.** When a scope is missing or the SDK install fails, agents mark the task done or 'not required' and the harness prints fixed per-framework success copy instead of reading task outcomes.

**Impact.** The user sees a green outro while no source, scanner or SDK was actually set up.

**Rule location.**

- [`context-mill: context/skills/data-warehouse-source/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/data-warehouse-source/description.md) (Report, Task status)
- `wizard: orchestrator/queue.ts` (NotNeededReason.Blocked)
- src/frameworks/flutter/flutter-wizard-agent.ts (static getOutroChanges, open)

**Sources.** [PostHog/wizard#951](https://github.com/PostHog/wizard/issues/951), [PostHog/wizard#942](https://github.com/PostHog/wizard/issues/942), [PostHog/wizard#1328](https://github.com/PostHog/wizard/issues/1328)

**Frameworks.** `all`, `flutter`

**Wrong:**

```text
report: Created 0 of 1 detected sources in PostHog.
task list: Connect warehouse source [completed]
outro: Data warehouse source connected!
ui.getOutroChanges: () => ['Added the posthog_flutter SDK to your pubspec']
```

**Fixed:**

```markdown
Report line 1: `Created N of M detected sources in PostHog.`
- `done`: you created at least one source in PostHog.
- `not needed`: you created no source and a retry cannot change that. Do NOT use `done`.
- `failed`: every creation attempt returned a tool error.
```

## Missing PostHog MCP tool looks like a choice

**Problem.** Prompt notes and capability flags were hardcoded after a try/catch that swallowed MCP setup failure, so the agent was told to call posthog\_exec it did not have, wrote around the gap, and the run still ended green.

**Impact.** A run that lost its tool is indistinguishable from one that chose to create nothing. The report told the user to set things up by hand.

**Rule location.**

- [`wizard: src/agent/agent-interface.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts) (reportMcpSetup)
- src/agent/runner/harness/pi/index.ts
- runtime-notes.ts
- agent-prompt-loader.ts (renderToolInventory)

**Sources.** [PostHog/wizard#1168](https://github.com/PostHog/wizard/pull/1168), [PostHog/wizard#1433](https://github.com/PostHog/wizard/pull/1433), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995)

**Frameworks.** `all`

**Wrong:**

```typescript
caps: { bash: true, posthogMcp: true }  // hardcoded; MCP setup failure swallowed
notes.push(DASHBOARD_STEP)              // names posthog_exec, ungated
// report: 'Please set the sources up by hand.'   // run marked completed
```

**Fixed:**

```typescript
caps: { bash: true, posthogMcp }        // tracked from setup result
if (posthogMcp) notes.push(POSTHOG_MCP, DASHBOARD_STEP)
reportMcpSetup(initMsg) // captures 'mcp setup failed': missing / not connected / no tools
// renderToolInventory(): 'Your tools for this task: ...'
// [ERROR-MCP-MISSING] -> typed failure, aborted telemetry
```

## Agent improvises when skills fail to load

**Problem.** A capable agent can write a PostHog integration from memory, so a failed skill install or MCP resource fetch does not stop it, and the failure is often only logged to a file.

**Impact.** The run shows success with a generic or wrong integration (a PostHogProvider wrapped around every app), or ends silently with no exception or failed task recorded.

**Rule location.**

- `wizard: src/lib/agent/agent-interface.ts` (error classification)
- src/lib/agent/mcp-prompt-streaming.ts
- src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts
- src/lib/agent/signals.ts (SKILL\_INSTALL\_FAILED)
- src/agent/runner/harness/pi/completion.ts (setupSignalFailure)

**Sources.** [PostHog/wizard#173](https://github.com/PostHog/wizard/issues/173), [PostHog/wizard#189](https://github.com/PostHog/wizard/issues/189), [PostHog/wizard#1039](https://github.com/PostHog/wizard/pull/1039), [PostHog/wizard#816](https://github.com/PostHog/wizard/pull/816), [wizard@7985e75](https://github.com/PostHog/wizard/commit/7985e759), [PostHog/wizard#1433](https://github.com/PostHog/wizard/pull/1433), [PostHog/wizard#909](https://github.com/PostHog/wizard/pull/909), [PostHog/context-mill#114](https://github.com/PostHog/context-mill/pull/114), [context-mill@1a744af](https://github.com/PostHog/context-mill/commit/1a744af5b39b8f0ac59dc74dc278267989fc7531)

**Frameworks.** `all`

**Wrong:**

```text
EACCES: permission denied, mkdir '.../skills/integration-v2-notebook'
  -> logged to file only; the task starts 3s later with no skill
Tool load_skill_menu -> error: Setup instructions could not be downloaded.
Agent: "Recovered and completed the setup."   # installs SDK from memory
<PostHogProvider apiKey={key}>{children}</PostHogProvider>  // in every app
```

**Fixed:**

```typescript
// per-task install failure throws: executor captures, retries, then fails the task
throw new Error(installResult.message)
// agent emits ERROR_MCP_MISSING / ERROR_RESOURCE_MISSING and halts
const setupFailure = setupSignalFailure(signals);
if (setupFailure) return { kind: 'failure', classification: setupFailure };
// no continue-nudge while setupSignalFailure(signals) is set
```

## Writing the files counted as verification

**Problem.** Agents mark their own tasks complete and treat a written file, reading it back, starting a dev server, or an ad-hoc `node -e`/`python -c` import as proof, skipping the project's real bundler, typecheck and lint scripts where integration breakages show up.

**Impact.** Broken imports, type errors, bad framework config or an uninitialized SDK ship marked as verified with a success outro.

**Rule location.**

- `wizard: src/lib/agent/runner/harness/pi/runtime-notes.ts` (VERIFY\_WITH\_BUILD)
- src/lib/agent/bash-fence.ts (NODE\_SCRIPT\_NAMES)
- docs/benchmarking.md
- [`context-mill: context/commandments.yaml#javascript`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/wizard#793](https://github.com/PostHog/wizard/pull/793), [PostHog/wizard#805](https://github.com/PostHog/wizard/pull/805), [PostHog/wizard#701](https://github.com/PostHog/wizard/pull/701), [wizard@9730dfd](https://github.com/PostHog/wizard/commit/9730dfd9), [PostHog/wizard#196](https://github.com/PostHog/wizard/pull/196), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176), [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962), [PostHog/wizard#61](https://github.com/PostHog/wizard/issues/61), [PostHog/context-mill#277](https://github.com/PostHog/context-mill/pull/277), [`wizard: docs/benchmarking.md`](https://github.com/PostHog/wizard/blob/main/docs/benchmarking.md)

**Frameworks.** `all`

**Wrong:**

```bash
# package.json: "build": "next build", "lint": "eslint ."
write src/lib/posthog.ts
node -e "require('./src/lib/posthog')"   # ad-hoc probe
npm run dev & curl localhost:3000
report: 'Verified: posthog.js created and imported in app.js.'
```

**Fixed:**

```bash
# run the project's own script, output capped with one pipe
npm run build 2>&1 | tail -50
npm run typecheck | tail -30
# runtime note: 'if the project defines a build/typecheck/lint script, run it
# and confirm the SDK imports and initializes. If none, confirm by reading the
# files; ad-hoc node -e / python -c are blocked. A file being written is not verification.'
```

## Editing steps hunt for a shell to lint

**Problem.** Good practice says to lint after editing, so every editing agent looks for a command tool. Granting one makes it duplicate work the review step owns.

**Impact.** Turns burned every run and remark noise. Verification duplicated or done by the wrong task.

**Rule location.**

- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) identify.md, capture.md, error-tracking.md (closing paragraph)
- review.md owns verification

**Sources.** [PostHog/context-mill#289](https://github.com/PostHog/context-mill/pull/289), [context-mill@a365acb](https://github.com/PostHog/context-mill/commit/a365acbf4738ba54de566f112869ae39b1bc1f72), [context-mill@0bb51f8](https://github.com/PostHog/context-mill/commit/0bb51f85), [context-mill@f789765](https://github.com/PostHog/context-mill/commit/f78976548ade63595ecdf3b3fca67805ad2d9aeb), [context-mill@5a3d5e4](https://github.com/PostHog/context-mill/commit/5a3d5e425d592fbccba2e340551833310edf2f0f), [context-mill@a365acb](https://github.com/PostHog/context-mill/commit/a365acbf), [PostHog/context-mill#424](https://github.com/PostHog/context-mill/pull/424)

**Frameworks.** `all`

**Wrong:**

```text
capture agent remark (6+ runs):
'A command-execution tool would allow running the existing
npm run lint validation script after TypeScript edits.'
```

**Fixed:**

```text
You do not run builds, linters, or tests. The review task verifies the
whole integration after you; your edits just need to be right by reading.
```

## Agent verifies by running tests or servers

**Problem.** Running the test suite or the dev server is the default 'make sure it works' move, but it executes arbitrary project code, mutates databases, hangs on long-running processes, and the wizard fence only allows install, build, typecheck, lint and format.

**Impact.** The fence denies the command and the agent burns turns, works around the fence, or goes hollow. Unfenced, databases get migrated and runs hang.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md)
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md)
- `wizard: src/lib/agent/bash-fence.ts` (build/typecheck allowlist, test actions denied)
- src/lib/agent/runner/harness/pi/runtime-notes.ts (BASH\_SCOPE)

**Sources.** [context-mill@46b733c](https://github.com/PostHog/context-mill/commit/46b733cf), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947), [PostHog/wizard#888](https://github.com/PostHog/wizard/issues/888)

**Frameworks.** `all`, `laravel`, `django`, `swift`, `android`

**Wrong:**

```sh
npm test
php artisan test
./run_tests.sh
python manage.py migrate
python manage.py runserver
-> Bash command not allowed: only install, build, typecheck,
   lint and format commands are permitted
```

**Fixed:**

```sh
python manage.py check
npm run typecheck
./gradlew :app:compileDebugKotlin
xcodebuild -scheme App -sdk iphonesimulator -configuration Debug build
npm run lint -- <changed files>
# 'Do not run the test suite; the runtime does not allow it,
# and a green build is the bar.'
```

## Elixir verification limited to mix compile

**Problem.** `mix test`, `mix run` and `mix phx.server` are the obvious Elixir checks, but they run project-defined code (app code, tests, servers). The fence admits only dependency and build tasks, and a review bot noted that Mix aliases in mix.exs can still hide arbitrary code behind task names.

**Impact.** The fence refuses them, so Elixir verification is compile and format only and cannot prove events arrive.

**Rule location.** `wizard: src/lib/agent/bash-fence.ts` (SIMPLE\_MANAGERS.mix)

**Sources.** [PostHog/wizard#946](https://github.com/PostHog/wizard/pull/946), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `elixir`

**Wrong:**

```bash
mix test
mix run -e 'PostHog.capture("smoke", %{distinct_id: "x"})'
mix phx.server
```

**Fixed:**

```typescript
// mix runs arbitrary project-defined tasks, so only the dependency + build
// tasks are listed. run/test/phx.server are denied.
mix: ['deps.get', 'deps.update', 'deps.tree', 'compile', 'format', 'hex.info'],
```

## Native analyzer skipped when no manifest scripts

**Problem.** Verification prose assumes a JS app and reads package.json scripts. Flutter, Go, Rails or Gradle projects have none, so the agent concludes there is nothing to run, though the toolchain ships its own analyzer the project enforces.

**Impact.** Analyzer and lint errors the project enforces ship unchecked while the run says 'Build verified'.

**Rule location.**

- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (## Build and verify)
- `wizard: src/lib/agent/bash-fence.ts` (FLUTTER\_DART\_SUBCOMMANDS, GO\_SUBCOMMANDS)

**Sources.** [context-mill@da3f59f](https://github.com/PostHog/context-mill/commit/da3f59f7), [PostHog/context-mill#346](https://github.com/PostHog/context-mill/pull/346), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892)

**Frameworks.** `flutter`, `go`, `ruby-on-rails`

**Wrong:**

```text
# pubspec.yaml has no scripts block
# agent: 'no build/lint scripts found, nothing to run'
# flutter analyze / go vet never run
# agent: 'Build verified.'
```

**Fixed:**

```text
Run the project's build (or typecheck) and lint scripts if they exist
(check the manifest's scripts). Where the toolchain ships its own analyzer rather
than manifest scripts, run that instead.
// fence admits it: FLUTTER_DART_SUBCOMMANDS = ['analyze','build','clean','doctor']
//                  GO_SUBCOMMANDS = ['get','build','vet','fmt','version','list']
```

## Command fence blocks the project's own checks

**Problem.** A short command allowlist misses the linters and project generators real repos use (biome, ruff, xcodegen, python -m compileall), so the agent is denied and either burns turns or skips verification.

**Impact.** Edited files are never proven to parse, build or import the SDK, and broken integrations ship as done.

**Rule location.**

- `wizard: src/lib/safe-tools.ts` (LINTING\_TOOLS)
- src/lib/agent/bash-fence.ts (commandDecision, SIMPLE\_MANAGERS.xcodegen, XCODEBUILD\_DENIED\_ACTIONS)

**Sources.** [PostHog/wizard#218](https://github.com/PostHog/wizard/pull/218), [PostHog/wizard#1011](https://github.com/PostHog/wizard/pull/1011), [PostHog/wizard#1003](https://github.com/PostHog/wizard/pull/1003), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/wizard#894](https://github.com/PostHog/wizard/issues/894), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892)

**Frameworks.** `all`, `swift`, `python`, `django`

**Wrong:**

```bash
npx biome check .
→ Bash command not allowed: `npx biome check .`
xcodegen generate
→ `xcodegen` is not an allowed tool.
python3 -m compileall app/
→ `python3` is not an allowed tool.
```

**Fixed:**

```typescript
export const LINTING_TOOLS: string[] = ['biome', 'prettier', 'eslint', 'ruff', /* ~130 */]
xcodegen: ['generate'],  // materialise project.yml so xcodebuild can verify
// python3: -m compileall <files> (byte-compiles, never imports project code)
// xcodebuild: every action except test / test-without-building
```

## Python edits verified by running the app

**Problem.** Python has no typecheck script, so agents prove edits by importing or running the app, which executes project code and is denied by the fence.

**Impact.** The verify step either runs untrusted project code or is skipped. The agent thrashed between pip, venv and compileall attempts.

**Rule location.** `wizard: src/lib/agent/bash-fence.ts` (python branch: -m compileall, -m &lt;lint tool>, VENV\_BIN, VENV\_TOOL)

**Sources.** [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/wizard#1003](https://github.com/PostHog/wizard/pull/1003)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```bash
python3 -c "import app"
python3 app/server.py
```

**Fixed:**

```bash
python3 -m compileall app config.py   # byte-compiles without importing
.venv/bin/python -m compileall server.py
.venv/bin/ruff check app
# still denied: python -c, python script.py, .venv/bin/pytest
```

## Swift build fails without generating the Xcode project

**Problem.** Projects defined by project.yml do not commit the .xcodeproj, so xcodebuild has nothing to build until xcodegen generate runs, and a strict toolchain allowlist denies it.

**Impact.** The Swift run cannot build-verify its edits, so a broken integration ships unverified.

**Rule location.** `wizard: src/lib/agent/bash-fence.ts` (SIMPLE\_MANAGERS.xcodegen)

**Sources.** [PostHog/wizard#1011](https://github.com/PostHog/wizard/pull/1011)

**Frameworks.** `swift`, `ios`

**Wrong:**

```bash
$ xcodegen generate
→ Bash command not allowed: `xcodegen generate`. `xcodegen` is not an allowed tool.
$ xcodebuild -scheme BurritoStand build   # no .xcodeproj yet
```

**Fixed:**

```typescript
// bash-fence.ts
// Materializes the Xcode project from project.yml so xcodebuild can verify —
// build-equivalent risk (runs on the project's own spec).
xcodegen: ['generate'],  // other subcommands (e.g. dump) are not listed, so denied
```

## Never-compiled change presented as done

**Problem.** When the runner lacks the toolchain (no JRE), the agent cannot build or run the project's format gate, and a generic agent simply reports success instead of saying it could not check.

**Impact.** The change fails the repo's formatter or build in CI. The user is never told it was not compiled.

**Rule location.**

- `wizard: src/lib/agent/runner/sequence/orchestrator/queue-tools.ts` (handoff conflict field)
- src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts (conflict in outro, ~L1142-1226)

**Sources.** [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948), [PostHog/wizard#935](https://github.com/PostHog/wizard/pull/935)

**Frameworks.** `java`, `spring`

**Wrong:**

```text
// No JRE on runner: mvn compile never ran
// spring-javaformat check fails on PetController.java
setup report: "PostHog integration complete"
```

**Fixed:**

```ts
conflict: 'A one-line summary of any conflict you could not cleanly resolve (e.g. a dependency or build conflict)...'
// orchestrator-runner.ts outro:
const message = conflict
  ? 'PostHog set up, with one conflict to review.'
  : /* normal success message */
```

## Framework rules never checked against the diff

**Problem.** Rules framed as 'follow these when integrating' read as background advice, and review only checks that the code compiles. A missing wiring like Flutter Web init compiles fine, because Setup() is a silent no-op on web.

**Impact.** Required wiring such as screen tracking or web init is missing while the build passes. Web builds capture nothing.

**Rule location.**

- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (Build and verify, first paragraph). Note: the reworded COMMANDMENTS.md header in scripts/lib/skill-generator.js from commit e47207bf is not on main
- the header still reads 'Follow these when integrating PostHog into this framework.'

**Sources.** [context-mill@e47207b](https://github.com/PostHog/context-mill/commit/e47207bf), [PostHog/context-mill#346](https://github.com/PostHog/context-mill/pull/346)

**Frameworks.** `flutter`, `all`

**Wrong:**

```dart
// diff: lib/main.dart
await Posthog().setup(config);
// project ships web/index.html; the rule says Flutter Web
// needs the posthog-js snippet -> nothing in the diff answers it
// COMMANDMENTS.md: 'Follow these when integrating PostHog into this framework.'
```

**Fixed:**

```text
## Build and verify
Before building, re-read the framework rules you were given and check each one
that applies to this project against the diff you are about to verify. A rule
naming a file or a wiring this project has, with nothing in the diff answering
it, is unfinished work — do it now. This is the last step that can catch it.
```

## Created provider never imported or mounted

**Problem.** Creating the file feels like the work. Nothing fails when it is never imported, so the build stays green.

**Impact.** PostHog never initializes while the file exists and the build passes.

**Rule location.**

- [`context-mill: context/skills/integration/references/3-revise.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/3-revise.md) (line 'Ensure that any components created were actually used.')
- legacy integration skill only, not integration-v2

**Sources.** [context-mill@6e3c882](https://github.com/PostHog/context-mill/commit/6e3c882a), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245#issuecomment-4994610950)

**Frameworks.** `all`

**Wrong:**

```tsx
// components/PostHogProvider.tsx  created
// app/layout.tsx: never imports or renders it
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>
}
```

**Fixed:**

```tsx
// 3-revise.md: "Ensure that any components created were actually used."
import { PostHogProvider } from '@/components/PostHogProvider'
export default function RootLayout({ children }) {
  return <html><body>
    <PostHogProvider>{children}</PostHogProvider>
  </body></html>
}
```

## Denied SDK install reported as success

**Problem.** The fence allows the install command but the sandbox denies the write, often at a monorepo root. The agent hand-edits the manifest and moves on.

**Impact.** Report and outro claim PostHog was added when the package was never installed.

**Rule location.** [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (## Install, last sentence, ## Flag out-of-scope conflicts and move on)

**Sources.** [PostHog/wizard#933](https://github.com/PostHog/wizard/pull/933), [PostHog/wizard#951](https://github.com/PostHog/wizard/issues/951), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`, `monorepos`

**Wrong:**

```sh
pnpm add posthog-js   # denied by sandbox at workspace root
# agent edits package.json by hand, reports done, no conflict
```

**Fixed:**

```text
a failed install is a conflict to report (below), not a problem to fight.
...
A build or install you can't cleanly finish is a perfectly acceptable outcome —
as long as you report it. ... put a one-line summary in your handoff `conflict`
field and the full detail in `did`, then complete the task.
```

## Pre-existing build errors fail the review step

**Problem.** A red build looks like the agent's failure, so it marks the task failed even when the errors are in files it never touched.

**Impact.** Dashboard and report depend on review, so they never run and the user gets no report.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (How you know you succeeded)
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (last paragraph)

**Sources.** [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [PostHog/wizard#1275](https://github.com/PostHog/wizard/pull/1275), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/wizard#1425](https://github.com/PostHog/wizard/pull/1425), [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372)

**Frameworks.** `all`

**Wrong:**

```ts
complete_task({ status: 'failed' })
// npm run lint fails in files the run never touched
// dashboard and report depend on review -> stranded
```

**Fixed:**

```text
If the build or lint fails only on pre-existing errors you did not
introduce, that still counts — put a one-line summary in the `conflict`
field and the detail in what you did. Reserve a failed status for when
your own changes break the build.
(build: A `failed` status stops later steps that depend on this one.)
```

## Review flags unverifiable delivery as a finding

**Problem.** A reviewer that cannot run the app records 'could not verify events arrive', which feels diligent but is not actionable.

**Impact.** Noise in the handoff while real defects like dead captures are under-weighted.

**Rule location.** [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (paragraph 'Events reaching PostHog in production is the point of this code')

**Sources.** [context-mill@e686888](https://github.com/PostHog/context-mill/commit/e6868883), [context-mill@4431889](https://github.com/PostHog/context-mill/commit/44318898), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`

**Wrong:**

```text
review handoff: 'Finding: unable to verify events reach PostHog
in production; recommend running the app and checking live events.'
```

**Fixed:**

```text
a capture wired to a place it will never fire, an uninitialized SDK,
or a call the runtime silently drops is squarely yours to catch and fix
— it is a code defect. What you cannot do is confirm delivery: you
cannot exercise the app, and you never treat "I could not verify events
arrive" as a finding.
```

## Review finds changes by grepping the tree

**Problem.** grep -ri posthog or git diff is the obvious way to find what changed, but it is dominated by lockfiles and build output and misses env and manifest edits.

**Impact.** Noisy review that misses real edits.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (Review, as a strict reviewer who did none of the writing)
- `wizard: src/lib/wizard-tools/handoff.ts` (handoff fields: per-file intent, evidence, assumptions)

**Sources.** [context-mill@21b715c](https://github.com/PostHog/context-mill/commit/21b715ca), [context-mill@37ff18e](https://github.com/PostHog/context-mill/commit/37ff18e1), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [PostHog/wizard#935](https://github.com/PostHog/wizard/pull/935)

**Frameworks.** `all`

**Wrong:**

```sh
grep -ri posthog . | head   # hits lockfiles and build output
git diff                    # whole tree, mostly formatting noise
```

**Fixed:**

```text
`read_handoffs` returns every upstream task's handoff, and each one names
the files it touched and what it changed in them. That union of touched
files IS the changeset. ... Nothing else — not the SDK's installed
internals, not other tasks' instructions, not a diff of the whole tree;
the handoffs are the signal.
```

## Task handoff claims success without evidence

**Problem.** Agents summarize what they expect to work, not what they ran, so later stages trust unverified claims as facts.

**Impact.** The review stage cannot audit. Assumptions about the app ship as facts.

**Rule location.**

- [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts) (HANDOFF\_FIELDS, HANDOFF\_SHAPE)
- src/agent/agent-prompt-loader.ts (renderHandoffContext)

**Sources.** [PostHog/wizard#935](https://github.com/PostHog/wizard/pull/935)

**Frameworks.** `all`

**Wrong:**

```ts
complete_task({ status: 'done', handoff: {
  goals: 'Add PostHog',
  did: 'Added provider, everything should work',
  forNextAgent: 'Capture events next' } })
```

**Fixed:**

```ts
handoff: {
  did: 'for each file you edited: the change, the intention behind it, and the analytics it should feed',
  filesTouched: ['app/layout.tsx'],
  evidence: 'what you ran or observed, not what you expect',
  assumptions: 'what you assumed about the app and could not verify' }
```

## Partial edits from a failed optional task

**Problem.** Review trusts handoffs to describe every edit, but an optional task that failed mid-run wrote no handoff for what it left behind.

**Impact.** Dangling imports or half-wired instrumentation ship, or the build fails on code no handoff mentions.

**Rule location.** [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (Install and verify paragraph)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [PostHog/wizard#1080](https://github.com/PostHog/wizard/pull/1080)

**Frameworks.** `all`

**Wrong:**

```javascript
// index.js
import { posthogLogs } from './posthog-logs'  // logs task failed; file never written
// no handoff mentions index.js, so review never opens it
```

**Fixed:**

```text
An optional upstream task (AI Observability, Logs) may have failed and
left partial edits no handoff describes — install and build either way,
and let the build surface stray imports; fix or revert them like any
other defect.
```

## Report written before review finishes

**Problem.** Report and dashboard look independent of review, so they get queued in parallel and describe code the reviewer then changes.

**Impact.** The report documents the first draft, including files and behavior that no longer exist.

**Rule location.**

- [`context-mill: context/agents/integration-v2/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/report.md) (frontmatter)
- [`context-mill: context/agents/integration-v2/integrate-posthog.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/integrate-posthog.md) (report bullet)
- [`wizard: src/agent/runner/sequence/orchestrator/queue-tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/queue-tools.ts) (sink-closure guard, uncoveredBySink)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@c3ba4e1](https://github.com/PostHog/context-mill/commit/c3ba4e1d64a54e2900d37df79528d6025d4da918), [PostHog/wizard#1077](https://github.com/PostHog/wizard/pull/1077)

**Frameworks.** `all`

**Wrong:**

```yaml
# report.md frontmatter
dependsOn: [dashboard]   # review still running, fixes land later
```

**Fixed:**

```yaml
# report.md frontmatter
sink: true
dependsOn: [dashboard, review]   # describes the reviewed integration
```

## Stale 'deferred' claims copied into the report

**Problem.** The report agent copies early handoffs verbatim in order and does not notice a later task already resolved what they deferred, so a failed product can also read as set up.

**Impact.** The report tells the user to do work the run already did, or hides work never done.

**Rule location.** [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (Sources, What to include, AI Observability and Logs bullet)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [context-mill@e241288](https://github.com/PostHog/context-mill/commit/e2412880)

**Frameworks.** `all`

**Wrong:**

```markdown
Dependencies: posthog-js added to package.json, run npm install
(install handoff said 'deferred'; review step installed it)
Report: "Logs configured."                   # task skipped or failed
```

**Fixed:**

```text
Handoffs are written mid-run, in task order, so a later handoff
supersedes an earlier one's forward-looking claims. Report the final
state, and let no "deferred" or "pending" claim survive into the report.
Do not treat a skipped or failed task as a successful setup. A product
whose task was never queued is left out of the report entirely.
```

## Manual follow-ups buried in report prose

**Problem.** Agents mention what the user still owes (load .env, CI secrets) as a passing remark near the bottom, so the run reads as finished.

**Impact.** The user closes the run believing setup is done. The app then crashes at boot or never reports.

**Rule location.**

- context-mill (main): context/agents/error-tracking/report.md, init.md, configure.md
- scripts/lib/tests/error-tracking-env-loading.test.js. wizard (main): src/agent/tools/handoff.ts (PUBLISH\_HANDOFF\_DESCRIPTION), src/shared/utils/needs-attention.ts (readNeedsAttention), src/tui/exit-line.ts (needsAttentionBlock)

**Sources.** [PostHog/context-mill#408](https://github.com/PostHog/context-mill/pull/408), [PostHog/wizard#1352](https://github.com/PostHog/wizard/pull/1352), [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329)

**Frameworks.** `all`

**Wrong:**

```markdown
# PostHog error tracking report
...paragraphs about capture, build and CI...
(near the bottom) you may also want to load .env
```

**Fixed:**

```markdown
# PostHog error tracking report
> ⚠️ **Needs your attention**
> - Load `.env` in the app, or set `POSTHOG_API_KEY` in its environment.
# report.md: summary in chat, warning block first.
# exit-line.ts prints "⚠ Needs your attention:" + the bullets again on exit
```

## Outro points to a report file never written

**Problem.** The prompt says to write a report file while the handoff tool says not to, so which one happens depends on the model, and the outro prints the path without checking it exists.

**Impact.** The outro says 'Report saved to:' a file that does not exist, and the grader fails correct runs.

**Rule location.**

- wizard (main): src/agent/tools/handoff.ts (PUBLISH\_HANDOFF\_DESCRIPTION), src/agent/agent-prompt.ts (skillPrompt), src/agent/runner/sequence/linear.ts, src/tui/screens/OutroScreen.tsx, src/tui/programs/audit/screens/AuditOutroScreen.tsx
- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) context/skills/integration/references/4-conclude.md (publish\_handoff, 'do not write it to a file')

**Sources.** [PostHog/wizard#1332](https://github.com/PostHog/wizard/issues/1332), [PostHog/wizard#1141](https://github.com/PostHog/wizard/pull/1141), [PostHog/context-mill#306](https://github.com/PostHog/context-mill/pull/306)

**Frameworks.** `all`

**Wrong:**

```text
skillPrompt: "write a brief markdown report to ./${reportFile}"
publish_handoff: "never write the report to a file yourself"
Outro: Report saved to: <installDir>/posthog-audit-report.md
```

**Fixed:**

```ts
// src/agent/tools/handoff.ts: one channel, the tool
'...call it only when your own instructions ask you to write that report,
 passing the complete report as `content`, and never write the report
 to a file yourself.'
// STILL OPEN (wizard#1332): skillPrompt still asks for ./${reportFile}
// and the outros never check the file exists.
// Fix in flight: context-mill#306 (draft) moves skills to publish_handoff.
```

## Handoff checklist lists steps that do not apply

**Problem.** The agent pads the verify checklist with every generic item it knows, such as LLM event checks, regardless of what this run set up.

**Impact.** Developers chase checks for products that were never installed.

**Rule location.** [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) ("Verify before merging" section)

**Sources.** [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174)

**Frameworks.** `all`

**Wrong:**

```markdown
## Verify before merging
- [ ] Confirm $ai_generation events appear   # run set up no LLM analytics
```

**Fixed:**

```markdown
Include ONLY the items that actually apply to the integration you just performed — judge each against the code you changed in this run, and drop any that don't fit.
- If LLM analytics was set up in this run: "Trigger the LLM call path(s) you instrumented and confirm `$ai_generation` events appear..."
Do not invent items beyond what applies. If only the two "Always" items apply, the checklist is just those two.
```

## Run that changed no code reported as success

**Problem.** Reaching the end of the flow, adding the dependency or writing a report looks like success. When the install is blocked or the model returns nothing, the agent writes an event plan and stops, and a runner that treats any stop as completion cannot tell.

**Impact.** Silent: the outro says PostHog is set up, nothing is instrumented, no events arrive, and loose E2E checks pass.

**Rule location.**

- wizard (main): src/agent/runner/harness/pi/completion.ts (completionFailure), src/agent/runner/harness/pi/index.ts (~L820), src/agent/runner/sequence/linear.ts (NO\_PROGRESS), src/agent/runner/sequence/orchestrator/orchestrator-runner.ts (AgentOrchestratorHollowRun, zero tasks)
- docs/benchmarking.md#traps ('Reached the outro is not success')

**Sources.** [PostHog/wizard#888](https://github.com/PostHog/wizard/issues/888), [PostHog/wizard#791](https://github.com/PostHog/wizard/issues/791), [PostHog/wizard#792](https://github.com/PostHog/wizard/issues/792), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/wizard#805](https://github.com/PostHog/wizard/pull/805), [`wizard: docs/benchmarking.md`](https://github.com/PostHog/wizard/blob/main/docs/benchmarking.md)

**Frameworks.** `all`

**Wrong:**

```text
setup report: full event plan; 'composer require posthog/posthog-php was rejected'
$ git diff --stat
 package.json | 3 +++
 .env.local   | 2 ++   # no init file, no capture() calls
wizard outro: success
// E2E: assert(hasPosthogDep && skillsComplete) -> PASS
```

**Fixed:**

```ts
export function completionFailure(args: { toolCalls: number; openTasks: boolean }) {
  // No tool call at all — the project was never touched.
  if (args.toolCalls === 0) return AgentErrorType.NO_PROGRESS;
  // Acted but left tasks in its own plan unfinished.
  if (args.openTasks) return AgentErrorType.INCOMPLETE_TASKS;
  return undefined;
}
// pi/index.ts: NO_PROGRESS -> spinner.stop('Agent made no changes'); linear.ts: 'The Wizard exited without changing your project'
```

## Agent ends the run with tasks still open

**Problem.** Literal models end a turn with only a status line and no tool call. The pi harness treats that as the end of the run.

**Impact.** The integration finishes half done while looking complete.

**Rule location.**

- wizard (main): src/agent/runner/harness/pi/index.ts (MAX\_CONTINUE\_NUDGES, CONTINUE\_INSTRUCTION, hasOpenTasks)
- src/agent/runner/harness/pi/completion.ts (INCOMPLETE\_TASKS)
- src/agent/runner/harness/pi/runtime-notes.ts (STATUS\_LINEAR, STATUS\_TASK)

**Sources.** [PostHog/wizard#805](https://github.com/PostHog/wizard/pull/805)

**Frameworks.** `all`

**Wrong:**

```text
assistant: "[STATUS] Wiring up the login capture"   // text only, no tool call
// prompt() resolves, run ends; Instrument/Verify/Dashboard still pending
```

**Fixed:**

```ts
while (nudges < MAX_CONTINUE_NUDGES && hasOpenTasks(store)) {
  await agentSession.prompt('You still have open tasks in your list... ' +
    'pick up the next in_progress or pending task. Continue now.')
  nudges++
}
// MAX_CONTINUE_NUDGES = 20; runtime note: always pair [STATUS] with a tool call
```

## Failed or empty task queue shows success

**Problem.** An orchestrator that only waits for the queue to drain treats failed, blocked or zero tasks as finished since nothing threw, and every enqueue call can be refused while the planning turn still ends cleanly.

**Impact.** Users are told 'PostHog set up' with no working integration, see a '0/0 completed' success screen, and blocked steps vanish without an outcome.

**Rule location.**

- wizard (main): src/agent/runner/sequence/orchestrator/orchestrator-runner.ts (drainVerdict, describeDrainFailure, reportBlockedTasks, AgentOrchestratorHollowRun)
- [`context-mill: context/agents/integration-v2/integrate-posthog.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/integrate-posthog.md) ('How you know you succeeded')

**Sources.** [PostHog/wizard#964](https://github.com/PostHog/wizard/pull/964), [PostHog/wizard#1165](https://github.com/PostHog/wizard/pull/1165), [PostHog/wizard#1166](https://github.com/PostHog/wizard/pull/1166), [PostHog/wizard#1275](https://github.com/PostHog/wizard/pull/1275), [wizard@db0c556](https://github.com/PostHog/wizard/commit/db0c556f)

**Frameworks.** `all`

**Wrong:**

```text
run 559d18bf: build task failed 2x                 -> outro "PostHog set up"
run e6884071: init failed 2x, 7 tasks blocked      -> success outro
every enqueue_task refused (gateway 400 / guard)   -> "0/0 completed"
message = `PostHog set up: ${summary.done}/${summary.total} steps completed.`;
```

**Fixed:**

```typescript
const verdict = drainVerdict(store.list(), reportDeliveredIds);
reportBlockedTasks(store.list(), verdict.requiredFailedTypes); // 'orchestrator task blocked'
if (verdict.requiredFailedTypes.length > 0 || verdict.blocked > 0)
  return failed({ code: ErrorCodes.AgentOrchestratorTasksFailed,
    message: `... unable to set up PostHog: ${describeDrainFailure(verdict)}` })
if (summary.total === 0)
  return failed({ code: ErrorCodes.AgentOrchestratorHollowRun, ... })
// seed prompt: success = every task queued, the report last, the first runnable
```

## SDK 'success' result trusted on API failure

**Problem.** The Agent SDK can emit `subtype: 'success'` with `is_error: true`, including on auth failure, so a wrapper that checks only the subtype calls a dead run complete.

**Impact.** A run that died on a 429, 500 or auth error is shown as 'PostHog integration complete' with no changes made.

**Rule location.** wizard (main): src/agent/agent-interface.ts (handleSDKMessage case 'result' is\_error check, sdkResultFailure, runAgent hasApiErrorStatus(429) classification)

**Sources.** [PostHog/wizard#231](https://github.com/PostHog/wizard/pull/231), [PostHog/wizard#744](https://github.com/PostHog/wizard/pull/744)

**Frameworks.** `all`

**Wrong:**

```typescript
if (message.type === 'result' && message.subtype === 'success') {
  done = true   // is_error ignored
}
spinner.stop('PostHog integration complete')
```

**Fixed:**

```typescript
// is_error can be true even when subtype is 'success'
if (message.is_error) {
  if (typeof message.result === 'string') signals.push(message.result)
}
// success only when: subtype === 'success' && !message.is_error
// ...
if (signals.hasApiErrorStatus(429))
  return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage }
```

## Cleanup error turns a good run into failure

**Problem.** Any exception or second error result after the agent finishes looks like a failed run, but the SDK throws during cleanup and emits telemetry errors after success.

**Impact.** Users see cascading errors and a failure screen after a good integration.

**Rule location.** wizard (main): src/agent/agent-interface.ts (receivedSuccessResult, completeWithSuccess, handleSDKMessage post-success suppression)

**Sources.** [PostHog/wizard#231](https://github.com/PostHog/wizard/pull/231), [PostHog/wizard#246](https://github.com/PostHog/wizard/pull/246)

**Frameworks.** `all`

**Wrong:**

```typescript
try { for await (const m of response) handle(m) }
catch (e) { spinner.stop('Error'); throw e }  // SDK cleanup throws after success
```

**Fixed:**

```typescript
if (message.subtype === 'success' && !message.is_error) receivedSuccessResult = true
// ...
catch (error) {
  if (receivedSuccessResult) return completeWithSuccess(error as Error) // log only
}
```

## Task runs on a retired model id

**Problem.** A retired, aliased or empty gateway model id, or a reasoning flag sent to a non-reasoning model, makes the call return nothing without a hard error, so the flow moves on.

**Impact.** Silent zero-token run: the capture step never happens and the flow still proceeds.

**Rule location.**

- wizard (main): src/agent/runner/switchboard/models.ts (VALID\_MODELS, requireKnownModel, MODEL\_CAPABILITIES, modelCapabilities)
- src/agent/runner/sequence/orchestrator/queue-tools.ts (checkEnqueueGuards)
- orchestrator-runner.ts (requireKnownModel dispatch)
- src/agent/runner/harness/pi/gateway.ts (reasoning flag)

**Sources.** [PostHog/wizard#963](https://github.com/PostHog/wizard/pull/963), [PostHog/wizard#791](https://github.com/PostHog/wizard/issues/791), [PostHog/wizard#792](https://github.com/PostHog/wizard/issues/792)

**Frameworks.** `all`

**Wrong:**

```ts
enqueue_task({ type: 'capture', model: 'gpt-5.5' })   // retired id: zero tokens
// or pi sends alias 'sonnet' raw / reasoning_effort to gpt-4o
```

**Fixed:**

```ts
model: requireKnownModel(taskModel.model, taskPick.model),
// VALID_MODELS allow-list on enqueue_task and every dispatch site
// modelCapabilities(id).reasoning decides whether to send effort
```

## Detection asks for JSON in prose

**Problem.** Asking for JSON in the prompt seems enough, but nothing enforces the shape and models reply with prose or broken JSON.

**Impact.** Project detection fails intermittently.

**Rule location.**

- wizard (main): src/programs/detection/agentic.ts (run.structured, retry once)
- src/agent/runner/switchboard/models.ts (triageModelFor)
- src/agent/runner/harness/pi/structured-output.ts

**Sources.** [PostHog/wizard#1350](https://github.com/PostHog/wizard/pull/1350)

**Frameworks.** `all`

**Wrong:**

```ts
prompt: "Reply with a JSON detection report"
const report = JSON.parse(agentText)
```

**Fixed:**

```ts
runAgent({ run: { ...config.run, structured: { schema, timeoutMs } } })
// Pi native structured output / SDK outputFormat on Haiku;
// scan model = triageModelFor(harness); retry once on timeout or invalid output
```

## Agent never reports missing or wrong guidance

**Problem.** A coding agent ends with 'Done' and has no reason to mention the scopes, docs or globs that wasted its turns, so prompt and skill defects never reach the team.

**Impact.** The same failing tool calls and contradictory docs repeat on every run.

**Rule location.**

- `wizard: src/lib/agent/agent-interface.ts` (createStopHook, phase 2)
- src/lib/agent/signals.ts (REMARK\_INSTRUCTION, AgentSignals.WIZARD\_REMARK)
- src/lib/agent/output-signals.ts (remark parsing)

**Sources.** [PostHog/wizard#243](https://github.com/PostHog/wizard/pull/243), [PostHog/wizard#249](https://github.com/PostHog/wizard/pull/249)

**Frameworks.** `all`

**Wrong:**

```text
Agent ends the run: 'Done, PostHog is integrated.'
// no word about the missing OAuth scope or conflicting docs
```

**Fixed:**

```typescript
// createStopHook: phase 2, once per run
if (requestRemark && !remarkRequested) {
  remarkRequested = true;
  return { decision: 'block', reason: REMARK_INSTRUCTION };
}
// REMARK_INSTRUCTION: 'Reply with a single line that starts with
// [WIZARD-REMARK] ... what information or guidance would have been useful
// ... anything that would have prevented tool failures, erroneous edits...'
return {}; // phase 3: allow stop
```

## Audit misses events sent through a wrapper

**Problem.** The audit greps for literal posthog.capture( and treats no hits as absence, but signup and purchase usually fire from backend code or through an in-house wrapper like trackEvent or analytics.track.

**Impact.** False 'missing event' findings, wrong recommendations, or an empty event map while the SDK is in the manifest: a silent false pass.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/2-scan.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/2-scan.md) (intro flow, sub-steps b-e, empty-inventory path with wrapper\_undetected)
- events-audit/references/5-report.md (panel 9 'Wrapper likely undiscovered')
- posthog-best-practices/references/investigation-standards.md (standard 2, absence findings). Open PR #314 adds wrapper/registry following to audit/references/4-event-capture.md (capture-growth-events) but is not merged

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314), [PostHog/context-mill#169](https://github.com/PostHog/context-mill/pull/169)

**Frameworks.** `all`

**Wrong:**

```sh
grep -rn "posthog\.capture(" src/
# 0 hits for 'user created' -> report: signup event missing
export const trackEvent = (name, props) => analytics.track(name, props)
trackEvent('invite_sent', { team_id })
```

**Fixed:**

```sh
# events-audit step 2: zero direct hits is not 'no events'. Continue with
# (b) init grep, (c) in-file wrappers, (d) one import hop, (e) wrapper call sites.
# Direct grep empty AND wrapper scan empty AND SDK in manifest ->
{ "rows": [], "exception_sites": [], "wrapper_undetected": true }
# report: grep for (captureEvent|track|trackEvent|logEvent|analytics\.track)\s*\(
# absence findings must state the search run and directories checked
```

## Capture search misses optional-chained calls

**Problem.** The obvious regex `posthog\.capture\(` does not match `posthog?.capture(`, which apps use to guard an uninitialised SDK, and nothing reports the miss.

**Impact.** Event inventory is undercounted by half or more, so coverage and phantom-event conclusions are wrong.

**Rule location.** [`context-mill: context/skills/events-audit/references/2-scan.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/2-scan.md) (sub-step a, Grep for direct SDK calls)

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `javascript-web`, `react`, `next-js`, `javascript-node`

**Wrong:**

```typescript
// agent grep: posthog\.capture\(
posthog.capture('signup_completed')     // found
posthog?.capture('checkout_started')    // missed
usePostHog()?.capture('plan_upgraded')  // missed
```

**Fixed:**

```bash
Grep -rn -B 0 -A 3 -E 'posthog\??\.(capture|identify|alias|group|setPersonProperties|setPersonPropertiesForFlags|reset)|usePostHog\(\)\??\.(capture|identify)|client\??\.capture|PostHog\??\.(shared|capture)|Posthog\(\)\??\.capture'
```

## Events in code that PostHog never received

**Problem.** The agent treats every capture call it finds in code as live instrumentation and never queries PostHog for actual volume.

**Impact.** Typos, dead code paths and unshipped instrumentation are reported as healthy coverage.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/4-query.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/4-query.md) (step c query, step d merge, step f status tagging)
- 5-report.md (Overview KPI 'Phantom (dead code)' and panel 2 'Phantom events')

**Sources.** [PostHog/context-mill#129](https://github.com/PostHog/context-mill/pull/129)

**Frameworks.** `all`

**Wrong:**

```text
Report: 51 events captured, all healthy
# purchase_complet in checkout.ts:88 has never fired; no volume check was run
```

**Fixed:**

```sql
SELECT event, count() AS volume_30d, max(timestamp) AS last_seen
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
  AND event IN (<inventory event names>)
GROUP BY event
-- no row returned: volume_30d = 0, last_seen = null  =>  status = "phantom"
```

## Audit findings with no file and line

**Problem.** The agent infers plausible findings from framework conventions ('probably re-inits on route change'), or fills an open review slot with generic advice, without citing code.

**Impact.** Wrong findings in customer-facing audits. In one run 3 of 5 were false or overstated, findings rotate run to run, and operators chase imaginary problems.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/investigation-standards.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/investigation-standards.md) (standard 1, provenance)
- [`context-mill: context/skills/audit-events/references/2-events-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-events/references/2-events-fix.md) (Task D event-quality-context-review, 'Do not invent issues to fill the slot')
- audit/references/2-init.md (init-not-duplicated)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314), [PostHog/wizard#736](https://github.com/PostHog/wizard/issues/736)

**Frameworks.** `all`

**Wrong:**

```text
Finding: PostHog is likely initialized twice (error).
Based on the framework it probably re-inits on route change.
warning: event 'page_loaded' may be low value      # no file:line
suggestion: consider more descriptive names        # tied to no capture site
```

**Fixed:**

```text
Finding: init-not-duplicated = warning
  src/app/providers.tsx:12        posthog.init(...)
  src/instrumentation-client.ts:4 posthog.init(...)
# no code found: pass, details "skip: searched X, Y; found nothing"
# open-ended check with nothing notable:
# pass, details: "No quality issues identified for this codebase."
# every non-pass finding cites file:line; never invent issues to fill the slot
```

## Missing reset claimed after one logout path

**Problem.** Agents stop at the first logout handler they find, though apps often have several signout, magic-link or session-expiry paths.

**Impact.** A false 'missing reset()' claim reaches the report when another path does call it.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/investigation-standards.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/investigation-standards.md) (standards 2 and 3)
- [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) and audit-identify/references/6-report.md ('Assumptions and blind spots')
- audit/references/3-identification.md Task D (identify-reset-on-logout). Open PR #314 would add explicit enumeration of every sign-out path

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314)

**Frameworks.** `all`

**Wrong:**

```text
Finding: no posthog.reset() on logout (checked src/auth/logout.ts only)
```

**Fixed:**

```markdown
For absence findings, evidence is the search you ran and the directories
you checked. Only resolve "missing reset() on logout" after checking every
plausible logout / signout code path, not just the first one you found.
#### Assumptions and blind spots
- which code paths were not checked (e.g. the magic-link flow)
```

## Audit skill assumes a ledger nobody seeded

**Problem.** Skill text said the wizard seeds the check ledger, but it only seeds the comprehensive audit, so narrow audits resolve ids that do not exist.

**Impact.** audit\_resolve\_checks fails with unknown check ids, the plan tab stays empty, and the report renders placeholders or improvised findings.

**Rule location.** `context-mill: context/skills/audit-{events,autocapture,feature-flags,identify,session-replay,attribution}/references/1-presence.md` (Seed the audit ledger) and description.md

**Sources.** [PostHog/context-mill#400](https://github.com/PostHog/context-mill/pull/400)

**Frameworks.** `all`

**Wrong:**

```text
"The audit ledger is seeded by the wizard with one pending check per event check."
mcp__wizard-tools__audit_resolve_checks({ id: "capture-event-names-static" })
-> error: unknown check id(s)
```

**Fixed:**

```json
"The runtime does not pre-seed this skill's ledger", so call
mcp__wizard-tools__audit_seed_checks({ "checks": [
  { "id": "capture-event-names-static", "area": "Event Capture",
    "label": "Event names use static strings", "status": "pending" },
  ... ] })   // Step 1; replaces the file atomically, safe every run
```

## Audit completes with no ledger tools available

**Problem.** When the expected tools are missing, the agent does not stop. It writes the report from its own notes and marks the audit done.

**Impact.** Silent: the plan tab sat at 13 pending rows and the report bypassed the ledger. A missing seed row rejected a whole batch.

**Rule location.**

- `wizard: src/lib/agent/runner/harness/pi/tools.ts` (Audit ledger section)
- src/lib/programs/audit/seed.ts (init-not-duplicated)

**Sources.** [PostHog/wizard#1263](https://github.com/PostHog/wizard/pull/1263)

**Frameworks.** `all`

**Wrong:**

```ts
// audit_* tools registered only on the MCP facade; pi mounts no MCP server
// agent searches, finds nothing, completes the audit anyway
```

**Fixed:**

```ts
// pi facade registers native audit_seed_checks / audit_add_checks / audit_resolve_checks
// seed.ts includes init-not-duplicated so init-correct resolves atomically
```

## Audit passes while PostHog shows open warnings

**Problem.** Audits read only the source tree, but some problems (unresolved stack frames, health issues) are only visible in PostHog's own server-side findings.

**Impact.** Silent: the source\_maps recommendation (over 30% of JS frames unresolved) stays open while the audit reports clean.

**Rule location.**

- [`context-mill: context/skills/audit/references/5-live-data.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/5-live-data.md)
- `wizard: src/lib/programs/audit/seed.ts`

**Sources.** [PostHog/context-mill#324](https://github.com/PostHog/context-mill/pull/324), [PostHog/wizard#1061](https://github.com/PostHog/wizard/pull/1061)

**Frameworks.** `all`

**Wrong:**

```text
wizard audit all, steps 1-4 only:
  installation, init, identification, event capture -> all pass
  (PostHog UI shows an open missing-source-maps warning)
```

**Fixed:**

```text
call error-tracking-recommendations-list {"limit": 50}
call health-issues-list {"status": "active", "dismissed": false, "limit": 50}
# audit_add_checks: one row per open finding, area "Live Data"
# id: live-data-<type>, e.g. live-data-source-maps
```

## Notebook link shared before the notebook is complete

**Problem.** The agent announces the URL right after creating the notebook, while later sections are still unappended, and never reads the notebook back to check that every section landed.

**Impact.** Users open a notebook with sections missing from the report.

**Rule location.** [`context-mill: context/skills/audit/references/6-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/6-report.md) (Upload to a PostHog notebook, steps a-d)

**Sources.** [PostHog/context-mill#356](https://github.com/PostHog/context-mill/pull/356), [PostHog/context-mill#168](https://github.com/PostHog/context-mill/pull/168)

**Frameworks.** `all`

**Wrong:**

```text
notebooks-create-markdown(title, head)
[NOTEBOOK_URL] https://app.posthog.com/notebooks/abc123   # sections not appended yet
```

**Fixed:**

```text
notebooks-create-markdown -> hold short_id + URL, no marker yet
notebooks-add-cell x N  (one section per call, sequential)
notebooks-get -> every ## / ### heading present
[NOTEBOOK_URL] <url>   # only after verify
```

## Android mapping upload tested on a debug build

**Problem.** Default run commands (react-native run-android, flutter run, Android Studio Run) build the debug variant, but mapping upload runs only on minified Release builds.

**Impact.** The test exception shows an unsymbolicated trace and the setup looks broken.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Identify the build and run commands, test affordance examples)

**Sources.** [PostHog/context-mill#253](https://github.com/PostHog/context-mill/pull/253), [PostHog/context-mill#263](https://github.com/PostHog/context-mill/pull/263)

**Frameworks.** `android`, `react-native`, `expo`, `flutter`

**Wrong:**

```bash
npx react-native run-android          # debug variant
./gradlew installDebug
# tap the test button; the mapping was never uploaded
```

**Fixed:**

```bash
./gradlew installRelease              # or Build Variants > release, then Run
npx expo run:ios --configuration Release
npx expo run:android --variant release
# launch, tap the button: an event, not a crash
```

## Source map test run on the dev server

**Problem.** The dev server is the natural place to try things, but source map upload runs only in the production build, so a dev-server test proves nothing either way.

**Impact.** The test exception shows minified or unresolved frames and the setup is wrongly judged broken or working.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Identify the build and run commands, Verify and hand off)

**Sources.** [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `Next.js`, `Vite`, `Node.js`

**Wrong:**

```bash
npm run dev   # trigger the test error, then check Error Tracking
```

**Fixed:**

```bash
npm run build   # uploads maps
npm run start   # or preview; trigger the error
# confirm a new symbol set on the Symbol sets page and resolved source frames
```

## Flutter web maps tested with flutter run

**Problem.** `flutter run -d chrome` is the documented way to run a web target, but it never executes the post-build source map processing and upload.

**Impact.** The test exception is never symbolicated, so the wiring looks broken or stays unproven.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ('Resolve build and run commands', Flutter web)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `flutter`

**Wrong:**

```bash
flutter run -d chrome   # dev server skips the post-build upload
```

**Fixed:**

```bash
flutter build web --source-maps
posthog-cli --dotenv-file .env sourcemap process --directory build/web
python3 -m http.server 8000 --directory build/web
```

## Throwing test button left in the app

**Problem.** The usual way to test error tracking is a button that throws, which depends on global handlers and dev overlays, and nothing reminds the agent to remove it afterwards.

**Impact.** A deliberate crash trigger ships to production, and the check itself is non-deterministic.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Test the local setup)
- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 7/8)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `react`, `next-js`, `vite`, `node`, `nuxt`, `angular`, `react-native`, `android`, `ios`, `flutter`

**Wrong:**

```tsx
<button onClick={() => { throw new Error('test') }}>
  Break things
</button>
// left in the repo after the check
```

**Fixed:**

```tsx
// only after wizard_ask "test-affordance" = yes; direct capture, no throw
<button onClick={() => posthog.captureException(
  new Error("PostHog source maps test"))}>
  Test PostHog Error Tracking
</button>
// revert after the user confirms, even if the test failed; re-read to confirm
```

## Unrelated JS SDK counted as Rust SDK

**Problem.** A single 'has PostHog' boolean is satisfied by any PostHog dependency in the directory, such as a stray posthog-js in package.json.

**Impact.** Symbol upload proceeds for a service with no posthog-rs. A virtual workspace root is wrongly reported as missing the SDK.

**Rule location.** [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (rustSdkVerifier, manifestMentionsSdk)

**Sources.** [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938)

**Frameworks.** `rust`

**Wrong:**

```json
{ "path": ".", "framework": "Rust", "hasPostHog": true }
// true because package.json lists posthog-js, not Cargo.toml
```

**Fixed:**

```ts
// comment-stripped manifest read; bounded walk of member manifests (depth 3)
const code = line.split('#', 1)[0];
return code.includes('posthog-rs');   // overrides the agent's boolean for rust
```

## Nobody checks PostHog is receiving data

**Problem.** A coding agent stops when the code builds. Whether events, pageleaves or a reverse proxy actually work is only visible on the PostHog side.

**Impact.** A broken or incomplete integration looks finished while no events arrive.

**Rule location.**

- [`wizard: src/tools/doctor/fetch.ts`](https://github.com/PostHog/wizard/blob/main/src/tools/doctor/fetch.ts)
- src/tools/doctor/kind-metadata.ts

**Sources.** [PostHog/wizard#422](https://github.com/PostHog/wizard/pull/422)

**Frameworks.** `all`

**Wrong:**

```bash
npm run build   # passes
# done; nobody checks whether $pageview events reach PostHog
```

**Fixed:**

```typescript
GET /api/environments/${projectId}/health_issues/?status=active&dismissed=false&limit=250
// kinds: no_live_events, no_pageleave_events, reverse_proxy, sdk_outdated,
//        ingestion_lag, ingestion_warning ...
```

## Product judged off from the repo alone

**Problem.** Finding no replay or error-tracking config in the repo looks like proof the product is off, but products are often enabled from another repo, the snippet, or project settings.

**Impact.** The user gets wrong setup advice, or the agent re-enables something already on.

**Rule location.**

- `wizard: src/lib/programs/self-driving/prompt.ts` (project state block)
- src/lib/agent/agent-prompt.ts (teamProductOptIns)

**Sources.** [PostHog/wizard#776](https://github.com/PostHog/wizard/pull/776), [PostHog/wizard#642](https://github.com/PostHog/wizard/pull/642)

**Frameworks.** `self-driving`

**Wrong:**

```bash
grep -r "session_recording" .   # no matches
agent: "Session replay is not set up"   # project setting already ON
```

**Fixed:**

```text
Prompt injects project settings read at auth time:
  Session replay recording: ON | OFF | unknown   Exception autocapture: ...
"repo evidence may rule a product IN but never OUT"
```

## Missing setup report read as nothing instrumented

**Problem.** Agents treat ./posthog-setup-report.md as ground truth, but many projects were set up manually or before the wizard wrote reports.

**Impact.** Wrong source and scout decisions, such as skipping error tracking on an instrumented app.

**Rule location.** [`context-mill: context/skills/self-driving/references/2-read-context.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/2-read-context.md)

**Sources.** [PostHog/context-mill#198](https://github.com/PostHog/context-mill/pull/198), [PostHog/context-mill#192](https://github.com/PostHog/context-mill/pull/192)

**Frameworks.** `self-driving`

**Wrong:**

```bash
cat ./posthog-setup-report.md   # ENOENT
-> "No report, so nothing is instrumented; skip error tracking and replay"
```

**Fixed:**

```markdown
Read ./posthog-setup-report.md if it's there. Absence = no signal, not 'nothing instrumented';
fall through to the project profile and usage probes. Note 'profile unavailable' if that 404s.
```

## Default scout budget reported as verified

**Problem.** When the metadata read fails, the published default is the only number at hand, so the agent states it as the project's limit.

**Impact.** The user plans around an unverified budget.

**Rule location.**

- [`context-mill: context/skills/self-driving/references/6-scouts.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/6-scouts.md) (step 1b)
- references/7-report.md

**Sources.** [PostHog/context-mill#295](https://github.com/PostHog/context-mill/pull/295)

**Frameworks.** `self-driving`

**Wrong:**

```text
Report: "Your project has 100 scout runs per day."   // scout-metadata-get failed
```

**Fixed:**

```text
Report: "The budget could not be read; 100 runs a day is the published
early-access default, not this project's verified limit."
```

## Report claims a scope the server never stored

**Problem.** The write recipe said to leave an already-enabled source alone, so a following agent skips the write and still reports the user's selection.

**Impact.** The report states a narrowing the server never received, which is worse than never asking.

**Rule location.** [`context-mill: context/skills/self-driving/references/4-sources.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/4-sources.md) (write recipe)

**Sources.** [PostHog/context-mill#396](https://github.com/PostHog/context-mill/pull/396)

**Frameworks.** `self-driving`, `linear`

**Wrong:**

```text
recipe: row exists and enabled: true -> leave it alone, "already enabled"
(user just picked teams T1, T2)
report: "Self-driving reads teams T1, T2"
```

**Fixed:**

```markdown
A recorded Linear team pick takes its config.linear_team_ids write on whichever
branch the row landed, branch 2 (already enabled) included, merged into the
existing config. Every other source writes `enabled` and nothing else.
```

## Single failed probe aborts an open-beta run

**Problem.** Agents use a gated API call as an access check and treat any 403, 404 or scope error as 'not available', though no gate exists.

**Impact.** A team that should proceed gets a clean refusal. One transient failure ends the whole run.

**Rule location.** [`context-mill: context/skills/self-driving/references/1-check-access.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/1-check-access.md)

**Sources.** [PostHog/context-mill#203](https://github.com/PostHog/context-mill/pull/203)

**Frameworks.** `self-driving`

**Wrong:**

```text
call inbox-source-configs-list
  -> 403 / 404 / scope error
[ABORT] self-driving is not available for this project
```

**Fixed:**

```markdown
1. Mark this task in_progress, then completed, right away.
2. Call no MCP tool here. No probe, no source list.
# [ABORT] only if EVERY Signals call hard-fails (403/404).
# A single failed source or scout is a follow-up, never an abort.
```

## Server toggle reported as working capture

**Problem.** Flipping the project setting succeeds, so the agent reports replay or error tracking as enabled even for a backend or mobile app with no SDK code to capture it.

**Impact.** The report misstates what works: nothing is captured until SDK code is configured.

**Rule location.** [`context-mill: context/skills/self-driving/references/7-report.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/self-driving/references/7-report.md) and 3-enable-products.md

**Sources.** [PostHog/context-mill#209](https://github.com/PostHog/context-mill/pull/209)

**Frameworks.** `self-driving`, `backend`, `mobile`

**Wrong:**

```text
Products
  Session replay:  enabled   (backend service, no SDK capture configured)
  Error tracking:  skipped   (not a web app)
```

**Fixed:**

```markdown
Products enabled, each as:
  enabled | already enabled | enabled but inert (backend or mobile: needs SDK code)
  | not enabled (non-admin; add project-admin follow-up)
Never "skipped" for a backend/mobile product.
```

## Free-form audits skip identity checks

**Problem.** A generic agent audits free-hand, so it checks different things each run. The totals look stable while the findings rotate and checks like reset-on-logout are skipped.

**Impact.** Real issues are missed and false positives appear between runs on the same codebase.

**Rule location.**

- `wizard: src/lib/programs/audit/seed.ts` (AUDIT\_SEED\_CHECKS)
- src/lib/wizard-tools/tools.ts (audit ledger tools)

**Sources.** [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425), [PostHog/wizard#736](https://github.com/PostHog/wizard/issues/736), [PostHog/wizard#1061](https://github.com/PostHog/wizard/pull/1061)

**Frameworks.** `all`

**Wrong:**

```text
run A: 1 error + 3 warnings (findings set 1)
run B: 1 error + 3 warnings (different findings,
       no reset()-on-logout check at all)
```

**Fixed:**

```typescript
AUDIT_SEED_CHECKS = ['init-correct', 'init-not-duplicated', 'identify-not-late',
  'identify-reset-on-logout', 'cross-runtime-distinct-id', 'capture-uses-proxy', ...]
// each id must be resolved via audit_resolve_checks; unknown ids reject the batch
```

## Proxy audit fails on unreadable env host

**Problem.** The agent cannot see the env value statically and treats 'unknown' as 'no proxy'.

**Impact.** A false 'no reverse proxy' finding when ingestion already routes through a first-party subdomain.

**Rule location.** [`context-mill: context/skills/audit/references/4-event-capture.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/4-event-capture.md) (Task B capture-uses-proxy)

**Sources.** [PostHog/wizard#736](https://github.com/PostHog/wizard/issues/736)

**Frameworks.** `nextjs`, `javascript_web`

**Wrong:**

```typescript
api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST
// agent: cannot read value -> capture-uses-proxy = fail
```

**Fixed:**

```typescript
// resolve the value from .env*, deploy config and rewrites first
// an unknown value is not evidence of no proxy
api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST // = https://e.example.com -> pass
```

## Review reads the whole tree, not the changes

**Problem.** The old prompt forbade reading unnamed files while its review dimensions needed neighbors, so agents resolved the conflict by exploring freely.

**Impact.** 39 to 47 reads per run, slow reviews and findings about code the run never touched.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) ("Review, as a strict reviewer who did none of the writing")
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) ("Review the integration": the queue log's handoffs name the files each step touched)

**Sources.** [context-mill@41a4deb](https://github.com/PostHog/context-mill/commit/41a4deb1), [context-mill@37ff18e](https://github.com/PostHog/context-mill/commit/37ff18e1), [context-mill@21b715c](https://github.com/PostHog/context-mill/commit/21b715ca), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `all`

**Wrong:**

```sh
git diff            # whole tree, lockfiles and generated files
grep -ri posthog .  # every hit
read node_modules/posthog-js/...
```

**Fixed:**

```text
read_handoffs returns every upstream handoff; the union of touched files IS the changeset.
Read each changeset file once and judge it. Read beyond the changeset only where a
dimension sends you: one neighboring example per pattern you are checking, and the
callers of code that changed. Nothing else - not the SDK's installed internals, not a
diff of the whole tree; the handoffs are the signal.
```

## Audit counts captureException as a product event

**Problem.** A \\.capture( regex also matches .captureException(, and the agent does not notice the prefix match.

**Impact.** Silent. Exception sites pollute the product event inventory.

**Rule location.**

- [`context-mill: context/skills/events-audit/references/2-scan.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/events-audit/references/2-scan.md) (g)
- 5-report.md (appendices)

**Sources.** [PostHog/context-mill#169](https://github.com/PostHog/context-mill/pull/169)

**Frameworks.** `all`

**Wrong:**

```bash
grep -rn '\.capture(' src/   # also matches posthog.captureException(err)
```

**Fixed:**

```text
# drop slices whose trigger line contains .captureException(
# list them separately as exception_sites in the report appendix
```

## iOS test error crashes instead of capturing

**Problem.** A test error reads as 'make it crash', and capture(error) looks like it should work, but capture() takes an event-name String.

**Impact.** Needs debugger detach and relaunch, or does not compile, so the symbolication check is not deterministic.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (test affordance, iOS example)

**Sources.** [PostHog/context-mill#229](https://github.com/PostHog/context-mill/pull/229)

**Frameworks.** `ios`, `swift`

**Wrong:**

```swift
Button("Trigger test error") {
    fatalError("Source map upload test") // detach debugger, relaunch
}
// or: PostHogSDK.shared.capture(error)  // capture() takes a String
```

**Fixed:**

```swift
do {
    throw NSError(domain: "PostHogSourceMapTest", code: 1,
                  userInfo: [NSLocalizedDescriptionKey: "Source map upload test error"])
} catch {
    PostHogSDK.shared.captureException(error)
}
```

## Source map resolution never proven end to end

**Problem.** The agent stops once the build passes and an error handler exists. Proving maps resolve means triggering a real error and reading the issue back, and a generic agent never does that.

**Impact.** Issues show minified frames like dist/index.js:2:90646, and nobody notices.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (line ~34 'Don't ship source maps publicly... hidden source maps', line ~40 Vite/Webpack/Rollup bundler plugin, test affordance section)
- [`wizard: src/programs/error-tracking/test/e2e.json`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking/test/e2e.json) (driver profile)
- PostHog/wizard-workbench PR 3742 (error-tracking fixtures and workflow)

**Sources.** [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185), [PostHog/wizard-workbench#3742](https://github.com/PostHog/wizard-workbench/pull/3742)

**Frameworks.** `webpack`, `node`, `all`

**Wrong:**

```javascript
// webpack.config.js
devtool: 'source-map' // map shipped publicly, never uploaded, no release set
```

**Fixed:**

```javascript
// node-webpack run output (PR 1185)
devtool: 'hidden-source-map',
plugins: [new PosthogWebpackPlugin({ sourcemaps: {
  enabled: true, deleteAfterUpload: true, releaseName: 'wizard-e2e-node-webpack' } })]
// e2e: trigger error, read issue back, expect ./src/index.ts frames
```
