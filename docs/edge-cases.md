# Edge case catalogue

This catalogue lists 913 edge cases that a generic coding agent gets wrong when it adds PostHog to a project. For each case it shows what goes wrong, why it matters, where the fixing rule lives, and a wrong and a fixed snippet. The [wizard handbook](https://posthog.com/handbook/wizard-and-docs/wizard-edge-cases) summarizes it.

We built it from these sources:

- The context mill skills and their references, integration v1 and v2.
- The agent prompts, commandments, skip patterns, and best practices in context mill.
- All example apps in context mill.
- The wizard harness: agent prompts, the YARA scanner and security rules, and framework detection.
- The benchmark and [wizard-workbench](https://github.com/PostHog/wizard-workbench) graders.
- Every merged PR and issue in [PostHog/context-mill](https://github.com/PostHog/context-mill) and [PostHog/wizard](https://github.com/PostHog/wizard) since October 2025.
- Recent `wizard remark` and `orchestrator remark` events from real runs.

Readers went through each source and wrote down about 2,500 raw findings. We merged duplicates and checked each case against its sources. The tally and method are in [PostHog/wizard#1439](https://github.com/PostHog/wizard/issues/1439).

The case pages sit in [`docs/edge-cases/`](edge-cases/), one page per category. This page has the reasons, how to add a case, and an index of every case.


## Why generic agents get these wrong

Adding PostHog looks like a five-line job, but most of the ways it goes wrong raise no error, so a generic agent ships broken analytics and reports success. This catalogue lists 913 such failures, each seen in a real wizard run, benchmark, PR or issue over the past year and turned into a context-mill skill rule or a wizard harness check. The skills are long because each rule holds back one of these failures, and many rules exist because the first fix went too far.

- **Failures are silent, so the agent cannot self-correct.** A CSP block, a missing flush, a wrong region or an empty token all build cleanly and throw nothing, so the agent never gets a signal to fix them. The skills have to name each one ahead of time, because the agent will not find them by trying. Examples: [Host defaults to US Cloud for EU projects](edge-cases/region-host.md#host-defaults-to-us-cloud-for-eu-projects).
- **Docs, examples and training data are wrong or stale.** Agents call APIs that were removed or never existed, copy email ids from shipped READMEs, and pin versions they remember. The skills correct the sources the model would otherwise trust. Examples: [Trends breakdown written at the wrong level](edge-cases/mcp-dashboards-insights.md#trends-breakdown-written-at-the-wrong-level).
- **Each framework has its own lifecycle and wiring.** A Laravel queue worker never flushes, Flutter setup does nothing on web, Django middleware reads the user before login runs, and Angular needs a separate builder to read env vars. One generic rule cannot cover these, so each framework needs its own rules. Examples: [React Router v7 SSR missing ssr.noExternal](edge-cases/framework-specific.md#react-router-v7-ssr-missing-ssrnoexternal).
- **The obvious fix over-corrects.** Told to flush, agents shut down the shared client. Told to reset on logout, they reset every anonymous visitor, and told to avoid email ids, they add schema migrations. Many rules exist to fence off the second mistake that the first fix created. Examples: [Reset runs for anonymous visitors on page load](edge-cases/identify-reset.md#reset-runs-for-anonymous-visitors-on-page-load), [Identify fires on every navigation or render](edge-cases/identify-reset.md#identify-fires-on-every-navigation-or-render), [Capture silently disabled in init for privacy](edge-cases/pii-privacy.md#capture-silently-disabled-in-init-for-privacy).
- **Verification signals lie.** A green build, a headless browser that drops every capture, a handoff that says CSP is handled, and a warehouse link counted as a connection all look like proof. The skills say which checks count and make the report show what actually shipped. Examples: [Automated browser checks see zero events](edge-cases/verification.md#automated-browser-checks-see-zero-events), [Denied SDK install reported as success](edge-cases/verification.md#denied-sdk-install-reported-as-success), [Skipped or failed products reported as configured](edge-cases/verification.md#skipped-or-failed-products-reported-as-configured).
- **Steps undo each other unless ordered.** A minimal review deletes the only shutdown helper, parallel logs and AI tasks overwrite each other's edits, and a report written early describes code the review later reverted. The task graph and handoffs set the order that keeps one step's fix intact. Examples: [Parallel AI and Logs steps clobber files](edge-cases/scope-discipline.md#parallel-ai-and-logs-steps-clobber-files).
- **The harness enforces what prompts cannot.** Agents skip rules buried in reference prose, corrupt .env files by hand, and load the target repo's hooks as their own. Tool fences, deny rules, framework detection and install checks stop these mistakes without relying on the agent to follow instructions. Examples: [Blocked install leads to hollow success](edge-cases/dependencies-install.md#blocked-install-leads-to-hollow-success).
- **Generic agents damage code outside the integration.** Seen in real runs: repo-wide formatting rewrote 429 files, whole-file rewrites cut off Astro frontmatter, a re-run removed a hand-tuned ui\_host, and agents forced peer conflicts. Scope rules keep the diff limited to the PostHog change. Examples: [Spawning subagents during the integration](edge-cases/scope-discipline.md#spawning-subagents-during-the-integration).
- **Helpful defaults leak personal data and secrets.** Agents put emails into event properties, write real tokens into the committed .env.example, and paste bearer keys into curl when MCP looks down. The skills and the scanner block each of these leaks. Examples: [Database source discovery walks the auth schema](edge-cases/pii-privacy.md#database-source-discovery-walks-the-auth-schema), [Personal API key shipped to the browser](edge-cases/security-secrets-injection.md#personal-api-key-shipped-to-the-browser).

## How to add a case

1. Find proof. Use a wizard run, a benchmark result, a PR, or an issue that shows the failure. Strip customer names, project names, URLs, tokens, and people from anything you copy.
2. Decide where the rule lives. Each case needs a rule that stops the failure.
3. Ship the rule, then add the case to the right category page in [`docs/edge-cases/`](edge-cases/) and to the index below.

Put the rule in context mill when the agent needs to know something:

- Skill references in [`context/skills/`](https://github.com/PostHog/context-mill/tree/main/context/skills), such as [`integration-v2`](https://github.com/PostHog/context-mill/tree/main/context/skills/integration-v2).
- Agent prompts in [`context/agents/`](https://github.com/PostHog/context-mill/tree/main/context/agents).
- Per-framework rules in [`context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml).
- Files the agent must not touch in [`context/skip-patterns.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skip-patterns.yaml).
- Reference code in [`example-apps/`](https://github.com/PostHog/context-mill/tree/main/example-apps). Agents copy example apps, so a wrong example spreads.

Put the rule in the wizard harness when the agent cannot be trusted to follow a prompt:

- Tools and tool fences in [`src/agent/tools/`](../src/agent/tools/).
- Harness commandments in [`src/agent/commandments.ts`](../src/agent/commandments.ts).
- The YARA scanner in [`src/agent/yara-hooks.ts`](../src/agent/yara-hooks.ts) and [`src/agent/yara-policy.ts`](../src/agent/yara-policy.ts).
- Framework detection in [`src/programs/frameworks/`](../src/programs/frameworks/).

Each case uses this shape:

- **Problem.** Why a generic agent gets it wrong.
- **Impact.** What breaks, and whether anyone notices.
- **Rule location.** The skill reference or harness file that holds the rule.
- **Sources.** The PRs, issues, and files that prove it.
- **Wrong** and **Fixed** snippets.

Some rule locations name files that have since moved. Search the repo for the rule text when a path no longer exists.

## Cases by category

| Category | Cases |
| --- | --- |
| [Events dropped at process exit](edge-cases/lifecycle-flush.md) | 25 |
| [Content Security Policy blocks the SDK](edge-cases/csp-network.md) | 9 |
| [Users not identified or reset](edge-cases/identify-reset.md) | 25 |
| [Wrong or shared person ids](edge-cases/distinct-id.md) | 25 |
| [Success reported without proof](edge-cases/verification.md) | 72 |
| [Missing or misnamed config](edge-cases/env-config.md) | 41 |
| [Personal data sent to PostHog](edge-cases/pii-privacy.md) | 26 |
| [Secrets leaked or untrusted input followed](edge-cases/security-secrets-injection.md) | 59 |
| [SDK started in the wrong place](edge-cases/init-placement-ssr.md) | 23 |
| [Framework-specific wiring missed](edge-cases/framework-specific.md) | 99 |
| [SDK APIs used wrongly](edge-cases/sdk-api-misuse.md) | 66 |
| [Wrong PostHog region or host](edge-cases/region-host.md) | 11 |
| [Reverse proxy missing or broken](edge-cases/reverse-proxy.md) | 11 |
| [Errors not captured or unreadable](edge-cases/error-tracking-sourcemaps.md) | 86 |
| [Events that mislead analysis](edge-cases/event-design.md) | 38 |
| [Feature flags read wrongly](edge-cases/feature-flags.md) | 31 |
| [Packages installed wrongly](edge-cases/dependencies-install.md) | 45 |
| [Changes that break builds or deploys](edge-cases/build-deploy-safety.md) | 3 |
| [Edits beyond the integration](edge-cases/scope-discipline.md) | 54 |
| [Dashboard and PostHog tool calls fail](edge-cases/mcp-dashboards-insights.md) | 67 |
| [Wizard run mechanics](edge-cases/other.md) | 97 |

## Events dropped at process exit

25 cases in [lifecycle-flush.md](edge-cases/lifecycle-flush.md).

- [Server route returns before batched event sends](edge-cases/lifecycle-flush.md#server-route-returns-before-batched-event-sends)
- [Server error hook captures but never flushes](edge-cases/lifecycle-flush.md#server-error-hook-captures-but-never-flushes)
- [Shutting down the shared client every request](edge-cases/lifecycle-flush.md#shutting-down-the-shared-client-every-request)
- [Per-request server client never shut down](edge-cases/lifecycle-flush.md#per-request-server-client-never-shut-down)
- [Node server has no shutdown on SIGTERM](edge-cases/lifecycle-flush.md#node-server-has-no-shutdown-on-sigterm)
- [Node script exits before the batch sends](edge-cases/lifecycle-flush.md#node-script-exits-before-the-batch-sends)
- [Python script exits without calling shutdown](edge-cases/lifecycle-flush.md#python-script-exits-without-calling-shutdown)
- [FastAPI app has no shutdown flush](edge-cases/lifecycle-flush.md#fastapi-app-has-no-shutdown-flush)
- [Laravel queue job events never sent](edge-cases/lifecycle-flush.md#laravel-queue-job-events-never-sent)
- [PHP script or WordPress hook never flushes](edge-cases/lifecycle-flush.md#php-script-or-wordpress-hook-never-flushes)
- [Lambda and job worker captures never flushed](edge-cases/lifecycle-flush.md#lambda-and-job-worker-captures-never-flushed)
- [Rust app with no shutdown hook skips flush](edge-cases/lifecycle-flush.md#rust-app-with-no-shutdown-hook-skips-flush)
- [Go client never closed on shutdown](edge-cases/lifecycle-flush.md#go-client-never-closed-on-shutdown)
- [Java client never closed when the JVM stops](edge-cases/lifecycle-flush.md#java-client-never-closed-when-the-jvm-stops)
- [.NET CLI exits without FlushAsync](edge-cases/lifecycle-flush.md#net-cli-exits-without-flushasync)
- [Ruby script skips shutdown on some exit paths](edge-cases/lifecycle-flush.md#ruby-script-skips-shutdown-on-some-exit-paths)
- [Metrics lost when a short script exits](edge-cases/lifecycle-flush.md#metrics-lost-when-a-short-script-exits)
- [Trace spans lost when the process exits](edge-cases/lifecycle-flush.md#trace-spans-lost-when-the-process-exits)
- [LLM script exits before AI events flush](edge-cases/lifecycle-flush.md#llm-script-exits-before-ai-events-flush)
- [Serverless MCP server relies on a SIGTERM flush](edge-cases/lifecycle-flush.md#serverless-mcp-server-relies-on-a-sigterm-flush)
- [Python MCP server exits without draining analytics](edge-cases/lifecycle-flush.md#python-mcp-server-exits-without-draining-analytics)
- [Cloudflare Worker ends before the batch sends](edge-cases/lifecycle-flush.md#cloudflare-worker-ends-before-the-batch-sends)
- [Migration maps Statsig shutdown to PostHog everywhere](edge-cases/lifecycle-flush.md#migration-maps-statsig-shutdown-to-posthog-everywhere)
- [CLI exits on Ctrl+C or closed terminal before analytics flush](edge-cases/lifecycle-flush.md#cli-exits-on-ctrlc-or-closed-terminal-before-analytics-flush)
- [Wrong waitUntil source per framework on Workers](edge-cases/lifecycle-flush.md#wrong-waituntil-source-per-framework-on-workers)

## Content Security Policy blocks the SDK

9 cases in [csp-network.md](edge-cases/csp-network.md).

- [Review trusts 'CSP handled' without checking directives](edge-cases/csp-network.md#review-trusts-csp-handled-without-checking-directives)
- [Site CSP blocks the SDK, zero events](edge-cases/csp-network.md#site-csp-blocks-the-sdk-zero-events)
- [CSP built in server code goes unnoticed](edge-cases/csp-network.md#csp-built-in-server-code-goes-unnoticed)
- [CSP allows events but not lazy-loaded scripts](edge-cases/csp-network.md#csp-allows-events-but-not-lazy-loaded-scripts)
- [CSP blocks session replay while events send](edge-cases/csp-network.md#csp-blocks-session-replay-while-events-send)
- [default-src self silently blocks event sending](edge-cases/csp-network.md#default-src-self-silently-blocks-event-sending)
- [Rails CSP initializer left blocking PostHog](edge-cases/csp-network.md#rails-csp-initializer-left-blocking-posthog)
- [Replay assets lack CORS and crossorigin](edge-cases/csp-network.md#replay-assets-lack-cors-and-crossorigin)
- [Bundled SDK still needs script-src for lazy bundles](edge-cases/csp-network.md#bundled-sdk-still-needs-script-src-for-lazy-bundles)

## Users not identified or reset

25 cases in [identify-reset.md](edge-cases/identify-reset.md).

- [Login tracked but user never identified](edge-cases/identify-reset.md#login-tracked-but-user-never-identified)
- [Logout never resets the PostHog identity](edge-cases/identify-reset.md#logout-never-resets-the-posthog-identity)
- [Reset runs for anonymous visitors on page load](edge-cases/identify-reset.md#reset-runs-for-anonymous-visitors-on-page-load)
- [Reset called right before identify on login](edge-cases/identify-reset.md#reset-called-right-before-identify-on-login)
- [Identify fires on every navigation or render](edge-cases/identify-reset.md#identify-fires-on-every-navigation-or-render)
- [Returning logged-in users never identified](edge-cases/identify-reset.md#returning-logged-in-users-never-identified)
- [Identify called late, after captures and flags](edge-cases/identify-reset.md#identify-called-late-after-captures-and-flags)
- [Logout event captured after reset](edge-cases/identify-reset.md#logout-event-captured-after-reset)
- [next-auth session has no user id](edge-cases/identify-reset.md#next-auth-session-has-no-user-id)
- [Django login event captured as nobody](edge-cases/identify-reset.md#django-login-event-captured-as-nobody)
- [FastAPI login event uses pre-login context](edge-cases/identify-reset.md#fastapi-login-event-uses-pre-login-context)
- [Server logout event captured after session ends](edge-cases/identify-reset.md#server-logout-event-captured-after-session-ends)
- [Python context opened around every capture](edge-cases/identify-reset.md#python-context-opened-around-every-capture)
- [Node errors captured without the user](edge-cases/identify-reset.md#node-errors-captured-without-the-user)
- [Users identified on the server, or twice](edge-cases/identify-reset.md#users-identified-on-the-server-or-twice)
- [Rails browser and server identities never joined](edge-cases/identify-reset.md#rails-browser-and-server-identities-never-joined)
- [MCP identify reads headers with old SDK shape](edge-cases/identify-reset.md#mcp-identify-reads-headers-with-old-sdk-shape)
- [Two identify calls with different ids](edge-cases/identify-reset.md#two-identify-calls-with-different-ids)
- [Server alias of the browser anonymous id](edge-cases/identify-reset.md#server-alias-of-the-browser-anonymous-id)
- [Server $set capture with no identify](edge-cases/identify-reset.md#server-set-capture-with-no-identify)
- [Imports an auth library the app lacks](edge-cases/identify-reset.md#imports-an-auth-library-the-app-lacks)
- [Later tasks re-add identify already written](edge-cases/identify-reset.md#later-tasks-re-add-identify-already-written)
- [Fake identify in an app with no users](edge-cases/identify-reset.md#fake-identify-in-an-app-with-no-users)
- [Person properties set on every capture](edge-cases/identify-reset.md#person-properties-set-on-every-capture)
- [Redundant alias() added next to identify()](edge-cases/identify-reset.md#redundant-alias-added-next-to-identify)

## Wrong or shared person ids

25 cases in [distinct-id.md](edge-cases/distinct-id.md).

- [Email used as the distinct id](edge-cases/distinct-id.md#email-used-as-the-distinct-id)
- [Marketing site and app split identity](edge-cases/distinct-id.md#marketing-site-and-app-split-identity)
- [Coerced missing id becomes the string undefined](edge-cases/distinct-id.md#coerced-missing-id-becomes-the-string-undefined)
- [Literal anonymous fallback pools all users](edge-cases/distinct-id.md#literal-anonymous-fallback-pools-all-users)
- [Visible placeholder when no stable id reaches](edge-cases/distinct-id.md#visible-placeholder-when-no-stable-id-reaches)
- [Accountless apps get personless events, not fake ids](edge-cases/distinct-id.md#accountless-apps-get-personless-events-not-fake-ids)
- [Example READMEs still teach email ids](edge-cases/distinct-id.md#example-readmes-still-teach-email-ids)
- [Per-login or per-session id passed to identify](edge-cases/distinct-id.md#per-login-or-per-session-id-passed-to-identify)
- [Hand-rolled session header instead of tracing\_headers](edge-cases/distinct-id.md#hand-rolled-session-header-instead-of-tracing_headers)
- [Server events use a different id than the browser](edge-cases/distinct-id.md#server-events-use-a-different-id-than-the-browser)
- [Form API route keys events on submitted email](edge-cases/distinct-id.md#form-api-route-keys-events-on-submitted-email)
- [Capture instrumented before identity is settled](edge-cases/distinct-id.md#capture-instrumented-before-identity-is-settled)
- [Audit wrongly demands identify() on server SDKs](edge-cases/distinct-id.md#audit-wrongly-demands-identify-on-server-sdks)
- [Rails posthog\_distinct\_id returns the email](edge-cases/distinct-id.md#rails-posthog_distinct_id-returns-the-email)
- [Rails job errors carry no user](edge-cases/distinct-id.md#rails-job-errors-carry-no-user)
- [CLI generates a new id every run](edge-cases/distinct-id.md#cli-generates-a-new-id-every-run)
- [Stripe metadata gets a different id than identify](edge-cases/distinct-id.md#stripe-metadata-gets-a-different-id-than-identify)
- [Placeholder distinct id written to Stripe](edge-cases/distinct-id.md#placeholder-distinct-id-written-to-stripe)
- [Revenue setup aborts when users are never identified](edge-cases/distinct-id.md#revenue-setup-aborts-when-users-are-never-identified)
- [Elixir context lost in spawned processes](edge-cases/distinct-id.md#elixir-context-lost-in-spawned-processes)
- [Spans not joined to person or replay](edge-cases/distinct-id.md#spans-not-joined-to-person-or-replay)
- [Per-request identity on OTel Resource attributes](edge-cases/distinct-id.md#per-request-identity-on-otel-resource-attributes)
- [Hardcoded user id on LLM events](edge-cases/distinct-id.md#hardcoded-user-id-on-llm-events)
- [Invented ids for MCP tool calls](edge-cases/distinct-id.md#invented-ids-for-mcp-tool-calls)
- [Stripe person link only on Customer creation](edge-cases/distinct-id.md#stripe-person-link-only-on-customer-creation)

## Success reported without proof

72 cases in [verification.md](edge-cases/verification.md).

- [Success screen names a report nobody writes](edge-cases/verification.md#success-screen-names-a-report-nobody-writes)
- [Automated browser checks see zero events](edge-cases/verification.md#automated-browser-checks-see-zero-events)
- [Green build reported as events flowing](edge-cases/verification.md#green-build-reported-as-events-flowing)
- [Report claims done without a pre-merge checklist](edge-cases/verification.md#report-claims-done-without-a-pre-merge-checklist)
- [Full build never run after generated code](edge-cases/verification.md#full-build-never-run-after-generated-code)
- [Skipped or failed products reported as configured](edge-cases/verification.md#skipped-or-failed-products-reported-as-configured)
- [LLM or log delivery claimed without seeing it](edge-cases/verification.md#llm-or-log-delivery-claimed-without-seeing-it)
- [LLM tracing judged by the diff](edge-cases/verification.md#llm-tracing-judged-by-the-diff)
- [LLM wrapper import never executed](edge-cases/verification.md#llm-wrapper-import-never-executed)
- [One LLM call site left uninstrumented](edge-cases/verification.md#one-llm-call-site-left-uninstrumented)
- [Warehouse sources reported connected, none created](edge-cases/verification.md#warehouse-sources-reported-connected-none-created)
- [Outro hides sources left unconnected](edge-cases/verification.md#outro-hides-sources-left-unconnected)
- [Outro shows success when a step was blocked](edge-cases/verification.md#outro-shows-success-when-a-step-was-blocked)
- [Missing PostHog MCP tool looks like a choice](edge-cases/verification.md#missing-posthog-mcp-tool-looks-like-a-choice)
- [Agent improvises when skills fail to load](edge-cases/verification.md#agent-improvises-when-skills-fail-to-load)
- [Writing the files counted as verification](edge-cases/verification.md#writing-the-files-counted-as-verification)
- [Editing steps hunt for a shell to lint](edge-cases/verification.md#editing-steps-hunt-for-a-shell-to-lint)
- [Agent verifies by running tests or servers](edge-cases/verification.md#agent-verifies-by-running-tests-or-servers)
- [Elixir verification limited to mix compile](edge-cases/verification.md#elixir-verification-limited-to-mix-compile)
- [Native analyzer skipped when no manifest scripts](edge-cases/verification.md#native-analyzer-skipped-when-no-manifest-scripts)
- [Command fence blocks the project's own checks](edge-cases/verification.md#command-fence-blocks-the-projects-own-checks)
- [Python edits verified by running the app](edge-cases/verification.md#python-edits-verified-by-running-the-app)
- [Swift build fails without generating the Xcode project](edge-cases/verification.md#swift-build-fails-without-generating-the-xcode-project)
- [Never-compiled change presented as done](edge-cases/verification.md#never-compiled-change-presented-as-done)
- [Framework rules never checked against the diff](edge-cases/verification.md#framework-rules-never-checked-against-the-diff)
- [Created provider never imported or mounted](edge-cases/verification.md#created-provider-never-imported-or-mounted)
- [Denied SDK install reported as success](edge-cases/verification.md#denied-sdk-install-reported-as-success)
- [Pre-existing build errors fail the review step](edge-cases/verification.md#pre-existing-build-errors-fail-the-review-step)
- [Review flags unverifiable delivery as a finding](edge-cases/verification.md#review-flags-unverifiable-delivery-as-a-finding)
- [Review finds changes by grepping the tree](edge-cases/verification.md#review-finds-changes-by-grepping-the-tree)
- [Task handoff claims success without evidence](edge-cases/verification.md#task-handoff-claims-success-without-evidence)
- [Partial edits from a failed optional task](edge-cases/verification.md#partial-edits-from-a-failed-optional-task)
- [Report written before review finishes](edge-cases/verification.md#report-written-before-review-finishes)
- [Stale 'deferred' claims copied into the report](edge-cases/verification.md#stale-deferred-claims-copied-into-the-report)
- [Manual follow-ups buried in report prose](edge-cases/verification.md#manual-follow-ups-buried-in-report-prose)
- [Outro points to a report file never written](edge-cases/verification.md#outro-points-to-a-report-file-never-written)
- [Handoff checklist lists steps that do not apply](edge-cases/verification.md#handoff-checklist-lists-steps-that-do-not-apply)
- [Run that changed no code reported as success](edge-cases/verification.md#run-that-changed-no-code-reported-as-success)
- [Agent ends the run with tasks still open](edge-cases/verification.md#agent-ends-the-run-with-tasks-still-open)
- [Failed or empty task queue shows success](edge-cases/verification.md#failed-or-empty-task-queue-shows-success)
- [SDK 'success' result trusted on API failure](edge-cases/verification.md#sdk-success-result-trusted-on-api-failure)
- [Cleanup error turns a good run into failure](edge-cases/verification.md#cleanup-error-turns-a-good-run-into-failure)
- [Task runs on a retired model id](edge-cases/verification.md#task-runs-on-a-retired-model-id)
- [Detection asks for JSON in prose](edge-cases/verification.md#detection-asks-for-json-in-prose)
- [Agent never reports missing or wrong guidance](edge-cases/verification.md#agent-never-reports-missing-or-wrong-guidance)
- [Audit misses events sent through a wrapper](edge-cases/verification.md#audit-misses-events-sent-through-a-wrapper)
- [Capture search misses optional-chained calls](edge-cases/verification.md#capture-search-misses-optional-chained-calls)
- [Events in code that PostHog never received](edge-cases/verification.md#events-in-code-that-posthog-never-received)
- [Audit findings with no file and line](edge-cases/verification.md#audit-findings-with-no-file-and-line)
- [Missing reset claimed after one logout path](edge-cases/verification.md#missing-reset-claimed-after-one-logout-path)
- [Audit skill assumes a ledger nobody seeded](edge-cases/verification.md#audit-skill-assumes-a-ledger-nobody-seeded)
- [Audit completes with no ledger tools available](edge-cases/verification.md#audit-completes-with-no-ledger-tools-available)
- [Audit passes while PostHog shows open warnings](edge-cases/verification.md#audit-passes-while-posthog-shows-open-warnings)
- [Notebook link shared before the notebook is complete](edge-cases/verification.md#notebook-link-shared-before-the-notebook-is-complete)
- [Android mapping upload tested on a debug build](edge-cases/verification.md#android-mapping-upload-tested-on-a-debug-build)
- [Source map test run on the dev server](edge-cases/verification.md#source-map-test-run-on-the-dev-server)
- [Flutter web maps tested with flutter run](edge-cases/verification.md#flutter-web-maps-tested-with-flutter-run)
- [Throwing test button left in the app](edge-cases/verification.md#throwing-test-button-left-in-the-app)
- [Unrelated JS SDK counted as Rust SDK](edge-cases/verification.md#unrelated-js-sdk-counted-as-rust-sdk)
- [Nobody checks PostHog is receiving data](edge-cases/verification.md#nobody-checks-posthog-is-receiving-data)
- [Product judged off from the repo alone](edge-cases/verification.md#product-judged-off-from-the-repo-alone)
- [Missing setup report read as nothing instrumented](edge-cases/verification.md#missing-setup-report-read-as-nothing-instrumented)
- [Default scout budget reported as verified](edge-cases/verification.md#default-scout-budget-reported-as-verified)
- [Report claims a scope the server never stored](edge-cases/verification.md#report-claims-a-scope-the-server-never-stored)
- [Single failed probe aborts an open-beta run](edge-cases/verification.md#single-failed-probe-aborts-an-open-beta-run)
- [Server toggle reported as working capture](edge-cases/verification.md#server-toggle-reported-as-working-capture)
- [Free-form audits skip identity checks](edge-cases/verification.md#free-form-audits-skip-identity-checks)
- [Proxy audit fails on unreadable env host](edge-cases/verification.md#proxy-audit-fails-on-unreadable-env-host)
- [Review reads the whole tree, not the changes](edge-cases/verification.md#review-reads-the-whole-tree-not-the-changes)
- [Audit counts captureException as a product event](edge-cases/verification.md#audit-counts-captureexception-as-a-product-event)
- [iOS test error crashes instead of capturing](edge-cases/verification.md#ios-test-error-crashes-instead-of-capturing)
- [Source map resolution never proven end to end](edge-cases/verification.md#source-map-resolution-never-proven-end-to-end)

## Missing or misnamed config

41 cases in [env-config.md](edge-cases/env-config.md).

- [Env key check looks at one file only](edge-cases/env-config.md#env-key-check-looks-at-one-file-only)
- [Missing token skipped silently with no dev error](edge-cases/env-config.md#missing-token-skipped-silently-with-no-dev-error)
- [Empty or placeholder token used as fallback](edge-cases/env-config.md#empty-or-placeholder-token-used-as-fallback)
- [Mobile token read from Xcode scheme env](edge-cases/env-config.md#mobile-token-read-from-xcode-scheme-env)
- [Flutter web snippet ships a placeholder token](edge-cases/env-config.md#flutter-web-snippet-ships-a-placeholder-token)
- [Project token pasted into init code](edge-cases/env-config.md#project-token-pasted-into-init-code)
- [Agent edits .env files with its own tools](edge-cases/env-config.md#agent-edits-env-files-with-its-own-tools)
- [Existing env key assumed to be correct](edge-cases/env-config.md#existing-env-key-assumed-to-be-correct)
- [Browser code reads an unexposed env var](edge-cases/env-config.md#browser-code-reads-an-unexposed-env-var)
- [Astro browser script reads a non-public env var](edge-cases/env-config.md#astro-browser-script-reads-a-non-public-env-var)
- [Angular reads env vars the CLI never exposes](edge-cases/env-config.md#angular-reads-env-vars-the-cli-never-exposes)
- [React Native reads token from process.env](edge-cases/env-config.md#react-native-reads-token-from-processenv)
- [Token stored under legacy API key name](edge-cases/env-config.md#token-stored-under-legacy-api-key-name)
- [New env keys missing from .env.example](edge-cases/env-config.md#new-env-keys-missing-from-envexample)
- [Node start script exits when .env is missing](edge-cases/env-config.md#node-start-script-exits-when-env-is-missing)
- [Token written to .env that nothing loads](edge-cases/env-config.md#token-written-to-env-that-nothing-loads)
- [Gradle build crashes when .env is missing](edge-cases/env-config.md#gradle-build-crashes-when-env-is-missing)
- [Dev and staging events land in production](edge-cases/env-config.md#dev-and-staging-events-land-in-production)
- [PostHog starts during tests and CI](edge-cases/env-config.md#posthog-starts-during-tests-and-ci)
- [Elixir test suite sends real events](edge-cases/env-config.md#elixir-test-suite-sends-real-events)
- [Elixir reads env in config.exs, not runtime.exs](edge-cases/env-config.md#elixir-reads-env-in-configexs-not-runtimeexs)
- [Placeholder from .env.example accepted as real token](edge-cases/env-config.md#placeholder-from-envexample-accepted-as-real-token)
- [Key in .env.example treated as configured](edge-cases/env-config.md#key-in-envexample-treated-as-configured)
- [Env write duplicates an export KEY line](edge-cases/env-config.md#env-write-duplicates-an-export-key-line)
- [Env file written to a duplicated subdirectory](edge-cases/env-config.md#env-file-written-to-a-duplicated-subdirectory)
- [Existing init reads a variable nobody defined](edge-cases/env-config.md#existing-init-reads-a-variable-nobody-defined)
- [Deploy step does not pass the token](edge-cases/env-config.md#deploy-step-does-not-pass-the-token)
- [Too much guard code around a simple bootstrap](edge-cases/env-config.md#too-much-guard-code-around-a-simple-bootstrap)
- [Env vars set locally, missing in production](edge-cases/env-config.md#env-vars-set-locally-missing-in-production)
- [Trailing newline corrupts uploaded env value](edge-cases/env-config.md#trailing-newline-corrupts-uploaded-env-value)
- [A .env directory crashes the key lookup](edge-cases/env-config.md#a-env-directory-crashes-the-key-lookup)
- [Trailing-slash install dir blocks env writes](edge-cases/env-config.md#trailing-slash-install-dir-blocks-env-writes)
- [Project Claude settings override agent credentials](edge-cases/env-config.md#project-claude-settings-override-agent-credentials)
- [OAuth silently picks the wrong project](edge-cases/env-config.md#oauth-silently-picks-the-wrong-project)
- [First project's token used without asking](edge-cases/env-config.md#first-projects-token-used-without-asking)
- [Env step depends on a missing tool server](edge-cases/env-config.md#env-step-depends-on-a-missing-tool-server)
- [Missing-key error text flagged as malicious](edge-cases/env-config.md#missing-key-error-text-flagged-as-malicious)
- [MCP auth header relies on variable expansion](edge-cases/env-config.md#mcp-auth-header-relies-on-variable-expansion)
- [Workers key read from process.env at module scope](edge-cases/env-config.md#workers-key-read-from-processenv-at-module-scope)
- [.env.example added to .gitignore](edge-cases/env-config.md#envexample-added-to-gitignore)
- [Missing-token guard repeated at every capture](edge-cases/env-config.md#missing-token-guard-repeated-at-every-capture)

## Personal data sent to PostHog

26 cases in [pii-privacy.md](edge-cases/pii-privacy.md).

- [Personal data put in event properties](edge-cases/pii-privacy.md#personal-data-put-in-event-properties)
- [User-written text sent as event properties](edge-cases/pii-privacy.md#user-written-text-sent-as-event-properties)
- [Example apps showing username in event properties](edge-cases/pii-privacy.md#example-apps-showing-username-in-event-properties)
- [Server SDK PII not routed to person properties](edge-cases/pii-privacy.md#server-sdk-pii-not-routed-to-person-properties)
- [Flutter: person data in capture properties](edge-cases/pii-privacy.md#flutter-person-data-in-capture-properties)
- [Python tag() used to set person data](edge-cases/pii-privacy.md#python-tag-used-to-set-person-data)
- [PII scanner block: move field, keep event](edge-cases/pii-privacy.md#pii-scanner-block-move-field-keep-event)
- [PII guard blocks its own recommended fix](edge-cases/pii-privacy.md#pii-guard-blocks-its-own-recommended-fix)
- [PII scanner reverts the wizard's own reports](edge-cases/pii-privacy.md#pii-scanner-reverts-the-wizards-own-reports)
- [PII scanner flagging normal analytics wording](edge-cases/pii-privacy.md#pii-scanner-flagging-normal-analytics-wording)
- [Database source discovery walks the auth schema](edge-cases/pii-privacy.md#database-source-discovery-walks-the-auth-schema)
- [LLM prompt capture chosen silently](edge-cases/pii-privacy.md#llm-prompt-capture-chosen-silently)
- [Privacy mode assumed to cover manual LLM capture](edge-cases/pii-privacy.md#privacy-mode-assumed-to-cover-manual-llm-capture)
- [PII rule strips LLM prompt and completion](edge-cases/pii-privacy.md#pii-rule-strips-llm-prompt-and-completion)
- [Log exporter attached to the root logger](edge-cases/pii-privacy.md#log-exporter-attached-to-the-root-logger)
- [Capture silently disabled in init for privacy](edge-cases/pii-privacy.md#capture-silently-disabled-in-init-for-privacy)
- [PostHog starts before the cookie banner answers](edge-cases/pii-privacy.md#posthog-starts-before-the-cookie-banner-answers)
- [Replay and autocapture masking turned off](edge-cases/pii-privacy.md#replay-and-autocapture-masking-turned-off)
- [Flutter beforeSend assumed to scrub native data](edge-cases/pii-privacy.md#flutter-beforesend-assumed-to-scrub-native-data)
- [iOS session replay enabled without masking review](edge-cases/pii-privacy.md#ios-session-replay-enabled-without-masking-review)
- [Cookieless mode enabled without attribution tradeoff](edge-cases/pii-privacy.md#cookieless-mode-enabled-without-attribution-tradeoff)
- [Personal data cited in report files](edge-cases/pii-privacy.md#personal-data-cited-in-report-files)
- [Credentials recorded as trace span attributes](edge-cases/pii-privacy.md#credentials-recorded-as-trace-span-attributes)
- [Source sent to model before org AI consent](edge-cases/pii-privacy.md#source-sent-to-model-before-org-ai-consent)
- [Tool detection reported before user consent](edge-cases/pii-privacy.md#tool-detection-reported-before-user-consent)
- [Agent-written scout bodies paste source and secrets](edge-cases/pii-privacy.md#agent-written-scout-bodies-paste-source-and-secrets)

## Secrets leaked or untrusted input followed

59 cases in [security-secrets-injection.md](edge-cases/security-secrets-injection.md).

- [Env file written without gitignore coverage](edge-cases/security-secrets-injection.md#env-file-written-without-gitignore-coverage)
- [Connection string leaked in task remark telemetry](edge-cases/security-secrets-injection.md#connection-string-leaked-in-task-remark-telemetry)
- [Agent resends the same blocked edit](edge-cases/security-secrets-injection.md#agent-resends-the-same-blocked-edit)
- [Edit guard blocks edits that remove violations](edge-cases/security-secrets-injection.md#edit-guard-blocks-edits-that-remove-violations)
- [Chat mentions flagged as security violations](edge-cases/security-secrets-injection.md#chat-mentions-flagged-as-security-violations)
- [First-party skill text aborts the run](edge-cases/security-secrets-injection.md#first-party-skill-text-aborts-the-run)
- [Subagents escape parent tool restrictions](edge-cases/security-secrets-injection.md#subagents-escape-parent-tool-restrictions)
- [MCP URL written without explicit https](edge-cases/security-secrets-injection.md#mcp-url-written-without-explicit-https)
- [Identity taken from client-controlled request values](edge-cases/security-secrets-injection.md#identity-taken-from-client-controlled-request-values)
- [Unknown api\_host warns instead of blocking](edge-cases/security-secrets-injection.md#unknown-api_host-warns-instead-of-blocking)
- [Agent writes outside the project directory](edge-cases/security-secrets-injection.md#agent-writes-outside-the-project-directory)
- [Vaulted secret handed to PostHog warehouse tools](edge-cases/security-secrets-injection.md#vaulted-secret-handed-to-posthog-warehouse-tools)
- [Agent reads .env files into model context](edge-cases/security-secrets-injection.md#agent-reads-env-files-into-model-context)
- [Env file guard silently skipped by SDK](edge-cases/security-secrets-injection.md#env-file-guard-silently-skipped-by-sdk)
- [Agent invents or lifts warehouse credentials](edge-cases/security-secrets-injection.md#agent-invents-or-lifts-warehouse-credentials)
- [Real key written to committed .env.example](edge-cases/security-secrets-injection.md#real-key-written-to-committed-envexample)
- [Pasted secret lands in the transcript](edge-cases/security-secrets-injection.md#pasted-secret-lands-in-the-transcript)
- [Self-driving asks for SaaS credentials in chat instead of the connect link](edge-cases/security-secrets-injection.md#self-driving-asks-for-saas-credentials-in-chat-instead-of-the-connect-link)
- [Raw curl with bearer key when MCP fails](edge-cases/security-secrets-injection.md#raw-curl-with-bearer-key-when-mcp-fails)
- [Secret values quoted in the setup report](edge-cases/security-secrets-injection.md#secret-values-quoted-in-the-setup-report)
- [Personal API key shipped to the browser](edge-cases/security-secrets-injection.md#personal-api-key-shipped-to-the-browser)
- [Personal API key hardcoded in source](edge-cases/security-secrets-injection.md#personal-api-key-hardcoded-in-source)
- [Personal API key passed to the app container](edge-cases/security-secrets-injection.md#personal-api-key-passed-to-the-app-container)
- [API key passed as Docker ARG or ENV](edge-cases/security-secrets-injection.md#api-key-passed-as-docker-arg-or-env)
- [CI upload secrets exposed to cargo build](edge-cases/security-secrets-injection.md#ci-upload-secrets-exposed-to-cargo-build)
- [CI job writes secrets into a .env file](edge-cases/security-secrets-injection.md#ci-job-writes-secrets-into-a-env-file)
- [Key inlined in the package.json start script](edge-cases/security-secrets-injection.md#key-inlined-in-the-packagejson-start-script)
- [Startup log prints part of the key](edge-cases/security-secrets-injection.md#startup-log-prints-part-of-the-key)
- [Go example app has XSS and weak cookies](edge-cases/security-secrets-injection.md#go-example-app-has-xss-and-weak-cookies)
- [Rust example renders cookie value unescaped](edge-cases/security-secrets-injection.md#rust-example-renders-cookie-value-unescaped)
- [Agent obeys instructions hidden in project files](edge-cases/security-secrets-injection.md#agent-obeys-instructions-hidden-in-project-files)
- [Planted ticket text says uninstall PostHog](edge-cases/security-secrets-injection.md#planted-ticket-text-says-uninstall-posthog)
- [Repo or Linear text steers self-driving setup](edge-cases/security-secrets-injection.md#repo-or-linear-text-steers-self-driving-setup)
- [Generated scouts lack a data-not-instructions guard](edge-cases/security-secrets-injection.md#generated-scouts-lack-a-data-not-instructions-guard)
- [Audit obeys text inside event payloads](edge-cases/security-secrets-injection.md#audit-obeys-text-inside-event-payloads)
- [Repo file names injected into the prompt](edge-cases/security-secrets-injection.md#repo-file-names-injected-into-the-prompt)
- [Benign demo copy trips the injection scanner](edge-cases/security-secrets-injection.md#benign-demo-copy-trips-the-injection-scanner)
- [Non-critical scanner match ends a healthy run](edge-cases/security-secrets-injection.md#non-critical-scanner-match-ends-a-healthy-run)
- [Missing triage provider deletes clean skills](edge-cases/security-secrets-injection.md#missing-triage-provider-deletes-clean-skills)
- [Security hook error lets the action through](edge-cases/security-secrets-injection.md#security-hook-error-lets-the-action-through)
- [Padding past the scan size cap](edge-cases/security-secrets-injection.md#padding-past-the-scan-size-cap)
- [Hook stop reason never stops the agent](edge-cases/security-secrets-injection.md#hook-stop-reason-never-stops-the-agent)
- [Short hook timeout drops the protection](edge-cases/security-secrets-injection.md#short-hook-timeout-drops-the-protection)
- [Prefix shell allowlist lets extra commands through](edge-cases/security-secrets-injection.md#prefix-shell-allowlist-lets-extra-commands-through)
- [Allowed go build verbs can still run a toolexec program](edge-cases/security-secrets-injection.md#allowed-go-build-verbs-can-still-run-a-toolexec-program)
- [Skill installed by a generated shell command](edge-cases/security-secrets-injection.md#skill-installed-by-a-generated-shell-command)
- [Skill archive entries escape the target folder](edge-cases/security-secrets-injection.md#skill-archive-entries-escape-the-target-folder)
- [Downloaded skill files trusted without a scan](edge-cases/security-secrets-injection.md#downloaded-skill-files-trusted-without-a-scan)
- [LLM-reported project path escapes the repo](edge-cases/security-secrets-injection.md#llm-reported-project-path-escapes-the-repo)
- [Target repo's Claude hooks run during wizard](edge-cases/security-secrets-injection.md#target-repos-claude-hooks-run-during-wizard)
- [Target repo's agent config loaded into the run](edge-cases/security-secrets-injection.md#target-repos-agent-config-loaded-into-the-run)
- [MCP bearer token visible in process list](edge-cases/security-secrets-injection.md#mcp-bearer-token-visible-in-process-list)
- [Install scripts inherit the wizard's secrets](edge-cases/security-secrets-injection.md#install-scripts-inherit-the-wizards-secrets)
- [Secret sent out with curl or wget](edge-cases/security-secrets-injection.md#secret-sent-out-with-curl-or-wget)
- [Repo copied out through allowed GitHub domains](edge-cases/security-secrets-injection.md#repo-copied-out-through-allowed-github-domains)
- [Agent shell can write and connect anywhere](edge-cases/security-secrets-injection.md#agent-shell-can-write-and-connect-anywhere)
- [Report written through a planted symlink](edge-cases/security-secrets-injection.md#report-written-through-a-planted-symlink)
- [Agent runs npx packages, publish or chained commands](edge-cases/security-secrets-injection.md#agent-runs-npx-packages-publish-or-chained-commands)
- [Remote flag can switch off security scanner](edge-cases/security-secrets-injection.md#remote-flag-can-switch-off-security-scanner)

## SDK started in the wrong place

23 cases in [init-placement-ssr.md](edge-cases/init-placement-ssr.md).

- [Next.js init written from memory in lib file](edge-cases/init-placement-ssr.md#nextjs-init-written-from-memory-in-lib-file)
- [instrumentation-client.ts on Next.js older than 15.3](edge-cases/init-placement-ssr.md#instrumentation-clientts-on-nextjs-older-than-153)
- [instrumentation-client file gets the wrong extension](edge-cases/init-placement-ssr.md#instrumentation-client-file-gets-the-wrong-extension)
- [Next.js init inside a useEffect provider](edge-cases/init-placement-ssr.md#nextjs-init-inside-a-useeffect-provider)
- [PostHog provider or init added twice](edge-cases/init-placement-ssr.md#posthog-provider-or-init-added-twice)
- [Migration swaps old provider for a second PostHog one](edge-cases/init-placement-ssr.md#migration-swaps-old-provider-for-a-second-posthog-one)
- [React SPA init inside a component effect](edge-cases/init-placement-ssr.md#react-spa-init-inside-a-component-effect)
- [PostHog script tags cause hydration errors](edge-cases/init-placement-ssr.md#posthog-script-tags-cause-hydration-errors)
- [SvelteKit init runs during server render](edge-cases/init-placement-ssr.md#sveltekit-init-runs-during-server-render)
- [Angular init runs on the server render](edge-cases/init-placement-ssr.md#angular-init-runs-on-the-server-render)
- [Nuxt components assume a PostHog client exists](edge-cases/init-placement-ssr.md#nuxt-components-assume-a-posthog-client-exists)
- [Nuxt plugin also runs on the server](edge-cases/init-placement-ssr.md#nuxt-plugin-also-runs-on-the-server)
- [One init pattern applied to every rendering mode](edge-cases/init-placement-ssr.md#one-init-pattern-applied-to-every-rendering-mode)
- [Next.js router guessed instead of detected](edge-cases/init-placement-ssr.md#nextjs-router-guessed-instead-of-detected)
- [Unguarded window access in SSR provider options](edge-cases/init-placement-ssr.md#unguarded-window-access-in-ssr-provider-options)
- [Server SDK client built in every request](edge-cases/init-placement-ssr.md#server-sdk-client-built-in-every-request)
- [Django client created outside AppConfig.ready](edge-cases/init-placement-ssr.md#django-client-created-outside-appconfigready)
- [Full-stack app gets only the browser SDK](edge-cases/init-placement-ssr.md#full-stack-app-gets-only-the-browser-sdk)
- [Second PostHog client built just for metrics](edge-cases/init-placement-ssr.md#second-posthog-client-built-just-for-metrics)
- [Logs setup replaces the AI tracing provider](edge-cases/init-placement-ssr.md#logs-setup-replaces-the-ai-tracing-provider)
- [iOS SDK set up inside a SwiftUI view](edge-cases/init-placement-ssr.md#ios-sdk-set-up-inside-a-swiftui-view)
- [Flutter native auto-init left on beside Dart setup](edge-cases/init-placement-ssr.md#flutter-native-auto-init-left-on-beside-dart-setup)
- [Flutter setup not awaited before runApp](edge-cases/init-placement-ssr.md#flutter-setup-not-awaited-before-runapp)

## Framework-specific wiring missed

99 cases in [framework-specific.md](edge-cases/framework-specific.md).

- [react-native-config used in an Expo app](edge-cases/framework-specific.md#react-native-config-used-in-an-expo-app)
- [process.env used for token on Cloudflare Workers](edge-cases/framework-specific.md#processenv-used-for-token-on-cloudflare-workers)
- [WordPress token hardcoded or in custom .env](edge-cases/framework-specific.md#wordpress-token-hardcoded-or-in-custom-env)
- [Svelte 4 syntax written into a runes app](edge-cases/framework-specific.md#svelte-4-syntax-written-into-a-runes-app)
- [Flutter PostHog mock rejected at runtime](edge-cases/framework-specific.md#flutter-posthog-mock-rejected-at-runtime)
- [Flutter Web target left uninitialized](edge-cases/framework-specific.md#flutter-web-target-left-uninitialized)
- [Flutter release builds cannot reach PostHog](edge-cases/framework-specific.md#flutter-release-builds-cannot-reach-posthog)
- [Hand-written middleware instead of the SDK's](edge-cases/framework-specific.md#hand-written-middleware-instead-of-the-sdks)
- [Django context middleware placed before authentication](edge-cases/framework-specific.md#django-context-middleware-placed-before-authentication)
- [Client reached through an invented registry](edge-cases/framework-specific.md#client-reached-through-an-invented-registry)
- [FastAPI has no SDK middleware to bind identity](edge-cases/framework-specific.md#fastapi-has-no-sdk-middleware-to-bind-identity)
- [useEffect used for derived state and callbacks](edge-cases/framework-specific.md#useeffect-used-for-derived-state-and-callbacks)
- [Adding use client or use server to make captures work](edge-cases/framework-specific.md#adding-use-client-or-use-server-to-make-captures-work)
- [Next.js App Router and Pages Router mixed up](edge-cases/framework-specific.md#nextjs-app-router-and-pages-router-mixed-up)
- [Next.js instrumentation file outside src/](edge-cases/framework-specific.md#nextjs-instrumentation-file-outside-src)
- [TypeScript and JavaScript files mixed up](edge-cases/framework-specific.md#typescript-and-javascript-files-mixed-up)
- [Shared skill tags leak wrong-platform rules](edge-cases/framework-specific.md#shared-skill-tags-leak-wrong-platform-rules)
- [No worked example, new shape every run](edge-cases/framework-specific.md#no-worked-example-new-shape-every-run)
- [Detected framework maps to wrong or no skill](edge-cases/framework-specific.md#detected-framework-maps-to-wrong-or-no-skill)
- [Harness picks family default skill, ignoring detected mode](edge-cases/framework-specific.md#harness-picks-family-default-skill-ignoring-detected-mode)
- [Browser apps detected as Node servers](edge-cases/framework-specific.md#browser-apps-detected-as-node-servers)
- [Flutter repo misread as a native Android or iOS app](edge-cases/framework-specific.md#flutter-repo-misread-as-a-native-android-or-ios-app)
- [Android, KMP and JVM server confused by Gradle](edge-cases/framework-specific.md#android-kmp-and-jvm-server-confused-by-gradle)
- [Framework detected from a stray word](edge-cases/framework-specific.md#framework-detected-from-a-stray-word)
- [Missing package.json crashes detection and setup](edge-cases/framework-specific.md#missing-packagejson-crashes-detection-and-setup)
- [Monorepo scan mixes up or misses sub-projects](edge-cases/framework-specific.md#monorepo-scan-mixes-up-or-misses-sub-projects)
- [Monorepo root instrumented instead of the app](edge-cases/framework-specific.md#monorepo-root-instrumented-instead-of-the-app)
- [Monorepo services in other languages missed](edge-cases/framework-specific.md#monorepo-services-in-other-languages-missed)
- [Go or Rust repo with tooling package.json read as JS](edge-cases/framework-specific.md#go-or-rust-repo-with-tooling-packagejson-read-as-js)
- [Workspace roots and stray manifests claimed as apps](edge-cases/framework-specific.md#workspace-roots-and-stray-manifests-claimed-as-apps)
- [Run continues with no framework detected](edge-cases/framework-specific.md#run-continues-with-no-framework-detected)
- [Existing native PostHog install not seen](edge-cases/framework-specific.md#existing-native-posthog-install-not-seen)
- [XcodeGen iOS app not detected](edge-cases/framework-specific.md#xcodegen-ios-app-not-detected)
- [Non-JS manifests ignored during platform detection](edge-cases/framework-specific.md#non-js-manifests-ignored-during-platform-detection)
- [React Router v7 SSR missing ssr.noExternal](edge-cases/framework-specific.md#react-router-v7-ssr-missing-ssrnoexternal)
- [React Router modes need different init placement](edge-cases/framework-specific.md#react-router-modes-need-different-init-placement)
- [macOS sandbox disabled for network access](edge-cases/framework-specific.md#macos-sandbox-disabled-for-network-access)
- [Session replay turned on for macOS targets](edge-cases/framework-specific.md#session-replay-turned-on-for-macos-targets)
- [Android SDK set up in an Activity](edge-cases/framework-specific.md#android-sdk-set-up-in-an-activity)
- [Android activities missing android:label](edge-cases/framework-specific.md#android-activities-missing-androidlabel)
- [Android dependency in wrong Gradle syntax](edge-cases/framework-specific.md#android-dependency-in-wrong-gradle-syntax)
- [KMP SDK added per platform](edge-cases/framework-specific.md#kmp-sdk-added-per-platform)
- [KMP setup without platform PostHogContext](edge-cases/framework-specific.md#kmp-setup-without-platform-posthogcontext)
- [Astro PostHog script missing is:inline](edge-cases/framework-specific.md#astro-posthog-script-missing-isinline)
- [npm import inside Astro inline script](edge-cases/framework-specific.md#npm-import-inside-astro-inline-script)
- [Astro view transitions re-run init](edge-cases/framework-specific.md#astro-view-transitions-re-run-init)
- [Astro handlers bound once, lost after soft navigation](edge-cases/framework-specific.md#astro-handlers-bound-once-lost-after-soft-navigation)
- [Astro API routes prerendered, server capture never runs](edge-cases/framework-specific.md#astro-api-routes-prerendered-server-capture-never-runs)
- [Astro files rewritten, frontmatter fence lost](edge-cases/framework-specific.md#astro-files-rewritten-frontmatter-fence-lost)
- [SvelteKit relative asset paths break replay](edge-cases/framework-specific.md#sveltekit-relative-asset-paths-break-replay)
- [Svelte edits written from stale memory](edge-cases/framework-specific.md#svelte-edits-written-from-stale-memory)
- [Angular service not a root singleton, reads process.env](edge-cases/framework-specific.md#angular-service-not-a-root-singleton-reads-processenv)
- [Angular init runs inside the zone](edge-cases/framework-specific.md#angular-init-runs-inside-the-zone)
- [WordPress code put in theme functions.php](edge-cases/framework-specific.md#wordpress-code-put-in-theme-functionsphp)
- [WordPress plugin file runs without ABSPATH guard](edge-cases/framework-specific.md#wordpress-plugin-file-runs-without-abspath-guard)
- [WordPress pageviews captured from PHP](edge-cases/framework-specific.md#wordpress-pageviews-captured-from-php)
- [TanStack Router provider in an unused root](edge-cases/framework-specific.md#tanstack-router-provider-in-an-unused-root)
- [Laravel 11 wired through old Kernel files](edge-cases/framework-specific.md#laravel-11-wired-through-old-kernel-files)
- [Laravel bare use Throwable breaks config:cache](edge-cases/framework-specific.md#laravel-bare-use-throwable-breaks-configcache)
- [Laravel env() calls and scattered capture](edge-cases/framework-specific.md#laravel-env-calls-and-scattered-capture)
- [Modern integration applied to ancient versions](edge-cases/framework-specific.md#modern-integration-applied-to-ancient-versions)
- [Framework version read from package.json range](edge-cases/framework-specific.md#framework-version-read-from-packagejson-range)
- [PostHog client built inside ASP.NET controllers](edge-cases/framework-specific.md#posthog-client-built-inside-aspnet-controllers)
- [Full-stack apps get browser metrics SDK](edge-cases/framework-specific.md#full-stack-apps-get-browser-metrics-sdk)
- [Server log exporter added to browser app](edge-cases/framework-specific.md#server-log-exporter-added-to-browser-app)
- [MCP SDK v2 servers rejected at detection](edge-cases/framework-specific.md#mcp-sdk-v2-servers-rejected-at-detection)
- [Hand-rolled captures in an MCP server's tool handlers](edge-cases/framework-specific.md#hand-rolled-captures-in-an-mcp-servers-tool-handlers)
- [MCP analytics wrapped around unsupported servers](edge-cases/framework-specific.md#mcp-analytics-wrapped-around-unsupported-servers)
- [Debug logging corrupts a stdio MCP server](edge-cases/framework-specific.md#debug-logging-corrupts-a-stdio-mcp-server)
- [NestJS MCP server has no constructor to wrap](edge-cases/framework-specific.md#nestjs-mcp-server-has-no-constructor-to-wrap)
- [Python LLM apps miss LLM analytics](edge-cases/framework-specific.md#python-llm-apps-miss-llm-analytics)
- [Go LLM calls hand-captured with core SDK](edge-cases/framework-specific.md#go-llm-calls-hand-captured-with-core-sdk)
- [go.mod alone routes a polyglot repo to Go](edge-cases/framework-specific.md#gomod-alone-routes-a-polyglot-repo-to-go)
- [Provider instrumented instead of the agent framework](edge-cases/framework-specific.md#provider-instrumented-instead-of-the-agent-framework)
- [AI framework in manifest but not making the calls](edge-cases/framework-specific.md#ai-framework-in-manifest-but-not-making-the-calls)
- [OpenAI-compatible gateway routed as plain OpenAI](edge-cases/framework-specific.md#openai-compatible-gateway-routed-as-plain-openai)
- [Phoenix PostHog Plug missing or after router](edge-cases/framework-specific.md#phoenix-posthog-plug-missing-or-after-router)
- [React Native provider wraps NavigationContainer](edge-cases/framework-specific.md#react-native-provider-wraps-navigationcontainer)
- [Expo Router screens never tracked](edge-cases/framework-specific.md#expo-router-screens-never-tracked)
- [Expo and bare React Native set up alike](edge-cases/framework-specific.md#expo-and-bare-react-native-set-up-alike)
- [No pageviews for in-app navigation without a router](edge-cases/framework-specific.md#no-pageviews-for-in-app-navigation-without-a-router)
- [Nuxt module chosen without checking minor version](edge-cases/framework-specific.md#nuxt-module-chosen-without-checking-minor-version)
- [Replay vision run on backend-only apps](edge-cases/framework-specific.md#replay-vision-run-on-backend-only-apps)
- [Browser snippet added to an API-only Rails app](edge-cases/framework-specific.md#browser-snippet-added-to-an-api-only-rails-app)
- [Rails integrated like a plain Ruby script](edge-cases/framework-specific.md#rails-integrated-like-a-plain-ruby-script)
- [Server-rendered app gets no browser snippet](edge-cases/framework-specific.md#server-rendered-app-gets-no-browser-snippet)
- [Stock snippet crashes when toString is read-only](edge-cases/framework-specific.md#stock-snippet-crashes-when-tostring-is-read-only)
- [PostHogProvider assumed in non-React frameworks](edge-cases/framework-specific.md#posthogprovider-assumed-in-non-react-frameworks)
- [Workers runtime hidden behind a framework adapter](edge-cases/framework-specific.md#workers-runtime-hidden-behind-a-framework-adapter)
- [iOS extensions get their own anonymous identity](edge-cases/framework-specific.md#ios-extensions-get-their-own-anonymous-identity)
- [inject() rule refactors existing Angular classes](edge-cases/framework-specific.md#inject-rule-refactors-existing-angular-classes)
- [Astro view transitions drop pageviews and listeners](edge-cases/framework-specific.md#astro-view-transitions-drop-pageviews-and-listeners)
- [TanStack Router pageviews tracked with useEffect](edge-cases/framework-specific.md#tanstack-router-pageviews-tracked-with-useeffect)
- [Flutter screens untracked or unnamed](edge-cases/framework-specific.md#flutter-screens-untracked-or-unnamed)
- [Hand-rolled app lifecycle events in Flutter](edge-cases/framework-specific.md#hand-rolled-app-lifecycle-events-in-flutter)
- [SwiftUI screens named by internal view identifiers](edge-cases/framework-specific.md#swiftui-screens-named-by-internal-view-identifiers)
- [Flutter platform minimums left below the SDK floor](edge-cases/framework-specific.md#flutter-platform-minimums-left-below-the-sdk-floor)
- [Token hardcoded in Angular environment file](edge-cases/framework-specific.md#token-hardcoded-in-angular-environment-file)
- [Laravel config:cache ignores the server .env](edge-cases/framework-specific.md#laravel-configcache-ignores-the-server-env)

## SDK APIs used wrongly

66 cases in [sdk-api-misuse.md](edge-cases/sdk-api-misuse.md).

- [Disabled Python client still raises on capture](edge-cases/sdk-api-misuse.md#disabled-python-client-still-raises-on-capture)
- [Replay enabled server-side but disabled in code](edge-cases/sdk-api-misuse.md#replay-enabled-server-side-but-disabled-in-code)
- [tracing\_headers set with host including port](edge-cases/sdk-api-misuse.md#tracing_headers-set-with-host-including-port)
- [Session replay records bounces and test runs](edge-cases/sdk-api-misuse.md#session-replay-records-bounces-and-test-runs)
- [Wrapping the SDK in a guarded require](edge-cases/sdk-api-misuse.md#wrapping-the-sdk-in-a-guarded-require)
- [React Native logs hand-wired through OpenTelemetry](edge-cases/sdk-api-misuse.md#react-native-logs-hand-wired-through-opentelemetry)
- [Made-up PostHog wrapper client for AWS Bedrock](edge-cases/sdk-api-misuse.md#made-up-posthog-wrapper-client-for-aws-bedrock)
- [Init without defaults loses SPA pageviews](edge-cases/sdk-api-misuse.md#init-without-defaults-loses-spa-pageviews)
- [Calling identify() on the Python SDK](edge-cases/sdk-api-misuse.md#calling-identify-on-the-python-sdk)
- [Scaffolding features the Rust or Java SDK lacks](edge-cases/sdk-api-misuse.md#scaffolding-features-the-rust-or-java-sdk-lacks)
- [Enabling web vitals overwrites other performance options](edge-cases/sdk-api-misuse.md#enabling-web-vitals-overwrites-other-performance-options)
- [Ruby gem required by its package name](edge-cases/sdk-api-misuse.md#ruby-gem-required-by-its-package-name)
- [Unfiltered source catalog floods agent context](edge-cases/sdk-api-misuse.md#unfiltered-source-catalog-floods-agent-context)
- [Low-level create used for SaaS sources](edge-cases/sdk-api-misuse.md#low-level-create-used-for-saas-sources)
- [Database schemas array placed outside payload](edge-cases/sdk-api-misuse.md#database-schemas-array-placed-outside-payload)
- [Webhook pending inputs ignored after source setup](edge-cases/sdk-api-misuse.md#webhook-pending-inputs-ignored-after-source-setup)
- [Credential question sent without question kind](edge-cases/sdk-api-misuse.md#credential-question-sent-without-question-kind)
- [Task handoff fields sent flat, not nested](edge-cases/sdk-api-misuse.md#task-handoff-fields-sent-flat-not-nested)
- [Browser SDK options on the Node client](edge-cases/sdk-api-misuse.md#browser-sdk-options-on-the-node-client)
- [Browser SDK imported in server code](edge-cases/sdk-api-misuse.md#browser-sdk-imported-in-server-code)
- [Server SDK imported into client components](edge-cases/sdk-api-misuse.md#server-sdk-imported-into-client-components)
- [posthog-js call shape used in posthog-node](edge-cases/sdk-api-misuse.md#posthog-js-call-shape-used-in-posthog-node)
- [PostHog methods called before init runs](edge-cases/sdk-api-misuse.md#posthog-methods-called-before-init-runs)
- [Two documented SDK setups mixed together](edge-cases/sdk-api-misuse.md#two-documented-sdk-setups-mixed-together)
- [Python configured through module globals](edge-cases/sdk-api-misuse.md#python-configured-through-module-globals)
- [Removed Python identify and positional capture](edge-cases/sdk-api-misuse.md#removed-python-identify-and-positional-capture)
- [Tracing headers internal, hand-rolled, or silently no-op](edge-cases/sdk-api-misuse.md#tracing-headers-internal-hand-rolled-or-silently-no-op)
- [SDK init cancels products enabled in project](edge-cases/sdk-api-misuse.md#sdk-init-cancels-products-enabled-in-project)
- [Ruby capture and capture\_exception argument styles swapped](edge-cases/sdk-api-misuse.md#ruby-capture-and-capture_exception-argument-styles-swapped)
- [PHP capture called with positional arguments](edge-cases/sdk-api-misuse.md#php-capture-called-with-positional-arguments)
- [Rails app builds its own PostHog::Client](edge-cases/sdk-api-misuse.md#rails-app-builds-its-own-posthogclient)
- [Elixir code calls capture\_exception and identify](edge-cases/sdk-api-misuse.md#elixir-code-calls-capture_exception-and-identify)
- [Elixir capture without distinct\_id silently dropped](edge-cases/sdk-api-misuse.md#elixir-capture-without-distinct_id-silently-dropped)
- [Rust async client in a crate without runtime](edge-cases/sdk-api-misuse.md#rust-async-client-in-a-crate-without-runtime)
- [Rust identify and replay assumed from other SDKs](edge-cases/sdk-api-misuse.md#rust-identify-and-replay-assumed-from-other-sdks)
- [Java error tracking invented for unsupported SDK](edge-cases/sdk-api-misuse.md#java-error-tracking-invented-for-unsupported-sdk)
- [JVM backend gets the Android SDK](edge-cases/sdk-api-misuse.md#jvm-backend-gets-the-android-sdk)
- [Invented getInstance() accessor on Android SDK](edge-cases/sdk-api-misuse.md#invented-getinstance-accessor-on-android-sdk)
- [KMP uses native imports and wrong context](edge-cases/sdk-api-misuse.md#kmp-uses-native-imports-and-wrong-context)
- [Exception middleware swallows errors instead of rethrowing](edge-cases/sdk-api-misuse.md#exception-middleware-swallows-errors-instead-of-rethrowing)
- [Flutter captureException called without named args](edge-cases/sdk-api-misuse.md#flutter-captureexception-called-without-named-args)
- [Anthropic stream() bypasses the PostHog LLM wrapper](edge-cases/sdk-api-misuse.md#anthropic-stream-bypasses-the-posthog-llm-wrapper)
- [Stale instrument(server.server) workaround kept](edge-cases/sdk-api-misuse.md#stale-instrumentserverserver-workaround-kept)
- [Custom MCP dispatcher forwards raw tool arguments](edge-cases/sdk-api-misuse.md#custom-mcp-dispatcher-forwards-raw-tool-arguments)
- [First-touch properties written with $set](edge-cases/sdk-api-misuse.md#first-touch-properties-written-with-set)
- [Server events overwrite client person properties](edge-cases/sdk-api-misuse.md#server-events-overwrite-client-person-properties)
- [group() called with unstable key on render](edge-cases/sdk-api-misuse.md#group-called-with-unstable-key-on-render)
- [person\_profiles 'always' on mostly anonymous traffic](edge-cases/sdk-api-misuse.md#person_profiles-always-on-mostly-anonymous-traffic)
- [Copy and dead-click autocapture switched on](edge-cases/sdk-api-misuse.md#copy-and-dead-click-autocapture-switched-on)
- [Statsig config mapped to a flag return value](edge-cases/sdk-api-misuse.md#statsig-config-mapped-to-a-flag-return-value)
- [Statsig logEvent value dropped in migration](edge-cases/sdk-api-misuse.md#statsig-logevent-value-dropped-in-migration)
- [Server logs sent as analytics events](edge-cases/sdk-api-misuse.md#server-logs-sent-as-analytics-events)
- [OTLP exporter added to mobile apps](edge-cases/sdk-api-misuse.md#otlp-exporter-added-to-mobile-apps)
- [Generic OpenTelemetry instead of posthog-node traces](edge-cases/sdk-api-misuse.md#generic-opentelemetry-instead-of-posthog-node-traces)
- [OTel exporter added where Python native spans exist](edge-cases/sdk-api-misuse.md#otel-exporter-added-where-python-native-spans-exist)
- [Hand-built OpenTelemetry metrics instead of posthog.metrics](edge-cases/sdk-api-misuse.md#hand-built-opentelemetry-metrics-instead-of-posthogmetrics)
- [OpenTelemetry chosen over PostHog LLM wrapper](edge-cases/sdk-api-misuse.md#opentelemetry-chosen-over-posthog-llm-wrapper)
- [LLM wrapper on pinned pre-1.0 openai emits nothing](edge-cases/sdk-api-misuse.md#llm-wrapper-on-pinned-pre-10-openai-emits-nothing)
- [Generic instrumentor used instead of Agents SDK processor](edge-cases/sdk-api-misuse.md#generic-instrumentor-used-instead-of-agents-sdk-processor)
- [Wrapped Gemini client used instead of ADK plugin](edge-cases/sdk-api-misuse.md#wrapped-gemini-client-used-instead-of-adk-plugin)
- [Extra PostHog client or doubled AI instrumentation](edge-cases/sdk-api-misuse.md#extra-posthog-client-or-doubled-ai-instrumentation)
- [Vercel AI calls without experimental\_telemetry enabled](edge-cases/sdk-api-misuse.md#vercel-ai-calls-without-experimental_telemetry-enabled)
- [AI spans silently dropped by the PostHog filter](edge-cases/sdk-api-misuse.md#ai-spans-silently-dropped-by-the-posthog-filter)
- [Go code imports an AI wrapper that doesn't exist](edge-cases/sdk-api-misuse.md#go-code-imports-an-ai-wrapper-that-doesnt-exist)
- [Raw thread id fails session id validation](edge-cases/sdk-api-misuse.md#raw-thread-id-fails-session-id-validation)
- [Test-only init flags copied into app code](edge-cases/sdk-api-misuse.md#test-only-init-flags-copied-into-app-code)

## Wrong PostHog region or host

11 cases in [region-host.md](edge-cases/region-host.md).

- [Host defaults to US Cloud for EU projects](edge-cases/region-host.md#host-defaults-to-us-cloud-for-eu-projects)
- [Tracing and metrics endpoints hardcoded to US](edge-cases/region-host.md#tracing-and-metrics-endpoints-hardcoded-to-us)
- [Reverse proxy targets copied as US hosts](edge-cases/region-host.md#reverse-proxy-targets-copied-as-us-hosts)
- [App host used as the SDK host](edge-cases/region-host.md#app-host-used-as-the-sdk-host)
- [Browser link built from the ingestion host](edge-cases/region-host.md#browser-link-built-from-the-ingestion-host)
- [App link missing the project id](edge-cases/region-host.md#app-link-missing-the-project-id)
- [Host hardcoded as a literal in init](edge-cases/region-host.md#host-hardcoded-as-a-literal-in-init)
- [Region guessed by racing both clouds](edge-cases/region-host.md#region-guessed-by-racing-both-clouds)
- [EU users sent to US MCP login](edge-cases/region-host.md#eu-users-sent-to-us-mcp-login)
- [Region detected by substring match](edge-cases/region-host.md#region-detected-by-substring-match)
- [Custom stack URL not carried to every host](edge-cases/region-host.md#custom-stack-url-not-carried-to-every-host)

## Reverse proxy missing or broken

11 cases in [reverse-proxy.md](edge-cases/reverse-proxy.md).

- [Vite proxy has one catch-all /ingest rule](edge-cases/reverse-proxy.md#vite-proxy-has-one-catch-all-ingest-rule)
- [SvelteKit proxy hook only handles /static](edge-cases/reverse-proxy.md#sveltekit-proxy-hook-only-handles-static)
- [Browser SDK sends straight to PostHog, no proxy](edge-cases/reverse-proxy.md#browser-sdk-sends-straight-to-posthog-no-proxy)
- [Proxy configured only for the dev server](edge-cases/reverse-proxy.md#proxy-configured-only-for-the-dev-server)
- [Proxied api\_host without ui\_host](edge-cases/reverse-proxy.md#proxied-api_host-without-ui_host)
- [Next.js proxy without skipTrailingSlashRedirect](edge-cases/reverse-proxy.md#nextjs-proxy-without-skiptrailingslashredirect)
- [Hand-written proxy forwards the original headers unchanged](edge-cases/reverse-proxy.md#hand-written-proxy-forwards-the-original-headers-unchanged)
- [Reverse proxy wired into the server SDK](edge-cases/reverse-proxy.md#reverse-proxy-wired-into-the-server-sdk)
- [PHP first-party loader fatals when served standalone](edge-cases/reverse-proxy.md#php-first-party-loader-fatals-when-served-standalone)
- [Proxy set up on one host, not the others](edge-cases/reverse-proxy.md#proxy-set-up-on-one-host-not-the-others)
- [Proxy asset routes left on US for EU](edge-cases/reverse-proxy.md#proxy-asset-routes-left-on-us-for-eu)

## Errors not captured or unreadable

86 cases in [error-tracking-sourcemaps.md](edge-cases/error-tracking-sourcemaps.md).

- [Bundler config reads .env that nothing loads](edge-cases/error-tracking-sourcemaps.md#bundler-config-reads-env-that-nothing-loads)
- [Vite config cannot see upload credentials](edge-cases/error-tracking-sourcemaps.md#vite-config-cannot-see-upload-credentials)
- [posthog-cli build step gets no credentials](edge-cases/error-tracking-sourcemaps.md#posthog-cli-build-step-gets-no-credentials)
- [Upload credential names don't match the uploader](edge-cases/error-tracking-sourcemaps.md#upload-credential-names-dont-match-the-uploader)
- [Upload variable names differ between local and CI](edge-cases/error-tracking-sourcemaps.md#upload-variable-names-differ-between-local-and-ci)
- [Upload credentials never reach the CI build](edge-cases/error-tracking-sourcemaps.md#upload-credentials-never-reach-the-ci-build)
- [Flutter native builds miss the root .env](edge-cases/error-tracking-sourcemaps.md#flutter-native-builds-miss-the-root-env)
- [Gradle upload task ignores .env](edge-cases/error-tracking-sourcemaps.md#gradle-upload-task-ignores-env)
- [Report promises source-map uploads that cannot run](edge-cases/error-tracking-sourcemaps.md#report-promises-source-map-uploads-that-cannot-run)
- [iOS dSYM upload tested with a Debug build](edge-cases/error-tracking-sourcemaps.md#ios-dsym-upload-tested-with-a-debug-build)
- [Go binary tested without re-uploading symbols](edge-cases/error-tracking-sourcemaps.md#go-binary-tested-without-re-uploading-symbols)
- [Generic CLI bolted onto framework source maps](edge-cases/error-tracking-sourcemaps.md#generic-cli-bolted-onto-framework-source-maps)
- [React Native repo gets the iOS dSYM uploader](edge-cases/error-tracking-sourcemaps.md#react-native-repo-gets-the-ios-dsym-uploader)
- [Source map upload breaks Astro builds](edge-cases/error-tracking-sourcemaps.md#source-map-upload-breaks-astro-builds)
- [Composite GitHub action reads secrets directly](edge-cases/error-tracking-sourcemaps.md#composite-github-action-reads-secrets-directly)
- [Tooling Gemfile mistaken for a Ruby server](edge-cases/error-tracking-sourcemaps.md#tooling-gemfile-mistaken-for-a-ruby-server)
- [Symbol upload wired into a pure Dart package](edge-cases/error-tracking-sourcemaps.md#symbol-upload-wired-into-a-pure-dart-package)
- [Test cleanup also reverts the real setup](edge-cases/error-tracking-sourcemaps.md#test-cleanup-also-reverts-the-real-setup)
- [Agent invents a CI workflow it cannot trace](edge-cases/error-tracking-sourcemaps.md#agent-invents-a-ci-workflow-it-cannot-trace)
- [Node server errors never reach Error Tracking](edge-cases/error-tracking-sourcemaps.md#node-server-errors-never-reach-error-tracking)
- [Python client built without exception autocapture](edge-cases/error-tracking-sourcemaps.md#python-client-built-without-exception-autocapture)
- [Nuxt module set up without error tracking](edge-cases/error-tracking-sourcemaps.md#nuxt-module-set-up-without-error-tracking)
- [Flask error handlers hide exceptions from PostHog](edge-cases/error-tracking-sourcemaps.md#flask-error-handlers-hide-exceptions-from-posthog)
- [Browser SDK installed with exception capture off](edge-cases/error-tracking-sourcemaps.md#browser-sdk-installed-with-exception-capture-off)
- [Manual captures sprinkled across every route](edge-cases/error-tracking-sourcemaps.md#manual-captures-sprinkled-across-every-route)
- [Hand-built global handler where SDK has a flag](edge-cases/error-tracking-sourcemaps.md#hand-built-global-handler-where-sdk-has-a-flag)
- [Autocapture option copied from the wrong SDK](edge-cases/error-tracking-sourcemaps.md#autocapture-option-copied-from-the-wrong-sdk)
- [Extra global error listener beside SDK autocapture](edge-cases/error-tracking-sourcemaps.md#extra-global-error-listener-beside-sdk-autocapture)
- [One failure captured at several layers](edge-cases/error-tracking-sourcemaps.md#one-failure-captured-at-several-layers)
- [Exceptions sent as hand-built $exception events](edge-cases/error-tracking-sourcemaps.md#exceptions-sent-as-hand-built-exception-events)
- [Go errors captured by hand, not SDK helpers](edge-cases/error-tracking-sourcemaps.md#go-errors-captured-by-hand-not-sdk-helpers)
- [Console errors and extension noise left on](edge-cases/error-tracking-sourcemaps.md#console-errors-and-extension-noise-left-on)
- [Source maps generated but never uploaded](edge-cases/error-tracking-sourcemaps.md#source-maps-generated-but-never-uploaded)
- [Existing PostHog setup skips source map upload](edge-cases/error-tracking-sourcemaps.md#existing-posthog-setup-skips-source-map-upload)
- [Maps uploaded without chunk ID injection](edge-cases/error-tracking-sourcemaps.md#maps-uploaded-without-chunk-id-injection)
- [Source maps emitted without original source](edge-cases/error-tracking-sourcemaps.md#source-maps-emitted-without-original-source)
- [Webpack devtool clashes with the PostHog plugin](edge-cases/error-tracking-sourcemaps.md#webpack-devtool-clashes-with-the-posthog-plugin)
- [React plus Vite gets the generic CLI path](edge-cases/error-tracking-sourcemaps.md#react-plus-vite-gets-the-generic-cli-path)
- [Public project token used to upload maps](edge-cases/error-tracking-sourcemaps.md#public-project-token-used-to-upload-maps)
- [Build cannot read uploader credentials. Extra secrets](edge-cases/error-tracking-sourcemaps.md#build-cannot-read-uploader-credentials-extra-secrets)
- [Upload wired for stacks that cannot use it](edge-cases/error-tracking-sourcemaps.md#upload-wired-for-stacks-that-cannot-use-it)
- [Go SDK detected from any go.mod mention](edge-cases/error-tracking-sourcemaps.md#go-sdk-detected-from-any-gomod-mention)
- [Web source-map recipe applied to mobile apps](edge-cases/error-tracking-sourcemaps.md#web-source-map-recipe-applied-to-mobile-apps)
- [iOS crashes unsymbolicated: no dSYM upload](edge-cases/error-tracking-sourcemaps.md#ios-crashes-unsymbolicated-no-dsym-upload)
- [iOS errors sent as custom events](edge-cases/error-tracking-sourcemaps.md#ios-errors-sent-as-custom-events)
- [Android mapping upload never runs](edge-cases/error-tracking-sourcemaps.md#android-mapping-upload-never-runs)
- [Rust release build has no symbols](edge-cases/error-tracking-sourcemaps.md#rust-release-build-has-no-symbols)
- [Cargo workspace profile edited in member crate](edge-cases/error-tracking-sourcemaps.md#cargo-workspace-profile-edited-in-member-crate)
- [React Native native crash symbols skipped](edge-cases/error-tracking-sourcemaps.md#react-native-native-crash-symbols-skipped)
- [Flutter symbols uploaded for one platform only](edge-cases/error-tracking-sourcemaps.md#flutter-symbols-uploaded-for-one-platform-only)
- [Flutter exceptions captured without stack trace](edge-cases/error-tracking-sourcemaps.md#flutter-exceptions-captured-without-stack-trace)
- [Go binary built without build ID](edge-cases/error-tracking-sourcemaps.md#go-binary-built-without-build-id)
- [Go release flags strip symbols before upload](edge-cases/error-tracking-sourcemaps.md#go-release-flags-strip-symbols-before-upload)
- [Go symbols uploaded for an old SDK](edge-cases/error-tracking-sourcemaps.md#go-symbols-uploaded-for-an-old-sdk)
- [Docker build loses the release's git commit](edge-cases/error-tracking-sourcemaps.md#docker-build-loses-the-releases-git-commit)
- [Readable-stack apps get no release linking](edge-cases/error-tracking-sourcemaps.md#readable-stack-apps-get-no-release-linking)
- [Backend release name differs from source maps](edge-cases/error-tracking-sourcemaps.md#backend-release-name-differs-from-source-maps)
- [CLI catch-all swallows errors before autocapture](edge-cases/error-tracking-sourcemaps.md#cli-catch-all-swallows-errors-before-autocapture)
- [PHP autocaptured errors are personless](edge-cases/error-tracking-sourcemaps.md#php-autocaptured-errors-are-personless)
- [.NET assumed to autocapture exceptions](edge-cases/error-tracking-sourcemaps.md#net-assumed-to-autocapture-exceptions)
- [WordPress recovery mode swallows fatals first](edge-cases/error-tracking-sourcemaps.md#wordpress-recovery-mode-swallows-fatals-first)
- [Rails rescued errors and job failures missed](edge-cases/error-tracking-sourcemaps.md#rails-rescued-errors-and-job-failures-missed)
- [Elixir errors poorly grouped, no release source](edge-cases/error-tracking-sourcemaps.md#elixir-errors-poorly-grouped-no-release-source)
- [React Router error boundary swallows exceptions](edge-cases/error-tracking-sourcemaps.md#react-router-error-boundary-swallows-exceptions)
- [Vue component errors never reach PostHog](edge-cases/error-tracking-sourcemaps.md#vue-component-errors-never-reach-posthog)
- [Nuxt component errors bypass autocapture](edge-cases/error-tracking-sourcemaps.md#nuxt-component-errors-bypass-autocapture)
- [SvelteKit handleError hooks not wired](edge-cases/error-tracking-sourcemaps.md#sveltekit-handleerror-hooks-not-wired)
- [Exception step fed the SDK install page](edge-cases/error-tracking-sourcemaps.md#exception-step-fed-the-sdk-install-page)
- [Flutter native exception capture left off](edge-cases/error-tracking-sourcemaps.md#flutter-native-exception-capture-left-off)
- [Bare sourcemap inject passes only on dev machines](edge-cases/error-tracking-sourcemaps.md#bare-sourcemap-inject-passes-only-on-dev-machines)
- [Upload CLI pointed at the ingestion host](edge-cases/error-tracking-sourcemaps.md#upload-cli-pointed-at-the-ingestion-host)
- [Release step omits host for EU projects](edge-cases/error-tracking-sourcemaps.md#release-step-omits-host-for-eu-projects)
- [Init fails typecheck on env lookups](edge-cases/error-tracking-sourcemaps.md#init-fails-typecheck-on-env-lookups)
- [esbuild CommonJS bundle in an ESM package](edge-cases/error-tracking-sourcemaps.md#esbuild-commonjs-bundle-in-an-esm-package)
- [Build emits bundle but start runs source](edge-cases/error-tracking-sourcemaps.md#build-emits-bundle-but-start-runs-source)
- [Source map upload breaks builds without keys](edge-cases/error-tracking-sourcemaps.md#source-map-upload-breaks-builds-without-keys)
- [Source maps shipped publicly or bundles not injected](edge-cases/error-tracking-sourcemaps.md#source-maps-shipped-publicly-or-bundles-not-injected)
- [Elixir release built without packaged source](edge-cases/error-tracking-sourcemaps.md#elixir-release-built-without-packaged-source)
- [Upload secrets never reach the Docker build](edge-cases/error-tracking-sourcemaps.md#upload-secrets-never-reach-the-docker-build)
- [Docker build has no release name or version](edge-cases/error-tracking-sourcemaps.md#docker-build-has-no-release-name-or-version)
- [Release ID never reaches the running container](edge-cases/error-tracking-sourcemaps.md#release-id-never-reaches-the-running-container)
- [SSH export never reaches the systemd service](edge-cases/error-tracking-sourcemaps.md#ssh-export-never-reaches-the-systemd-service)
- [PHP-FPM clear\_env drops the release ID](edge-cases/error-tracking-sourcemaps.md#php-fpm-clear_env-drops-the-release-id)
- [Releases created on every branch build](edge-cases/error-tracking-sourcemaps.md#releases-created-on-every-branch-build)
- [Parallel deploy jobs race to create release](edge-cases/error-tracking-sourcemaps.md#parallel-deploy-jobs-race-to-create-release)
- [Release step breaks on slim CI images](edge-cases/error-tracking-sourcemaps.md#release-step-breaks-on-slim-ci-images)

## Events that mislead analysis

38 cases in [event-design.md](edge-cases/event-design.md).

- [First PR instruments every possible event](edge-cases/event-design.md#first-pr-instruments-every-possible-event)
- [Dashboard insights use guessed event names](edge-cases/event-design.md#dashboard-insights-use-guessed-event-names)
- [Cleanup pass renames events the dashboard uses](edge-cases/event-design.md#cleanup-pass-renames-events-the-dashboard-uses)
- [Planned events invisible in headless runs](edge-cases/event-design.md#planned-events-invisible-in-headless-runs)
- [User actions captured from effects or render](edge-cases/event-design.md#user-actions-captured-from-effects-or-render)
- [Client-side route changes send no pageviews](edge-cases/event-design.md#client-side-route-changes-send-no-pageviews)
- [Manual pageview on top of automatic pageviews](edge-cases/event-design.md#manual-pageview-on-top-of-automatic-pageviews)
- [Custom page\_viewed events on mount](edge-cases/event-design.md#custom-page_viewed-events-on-mount)
- [Events captured with no properties](edge-cases/event-design.md#events-captured-with-no-properties)
- [Filler events invented to hit a count](edge-cases/event-design.md#filler-events-invented-to-hit-a-count)
- [New event names ignore the project's existing ones](edge-cases/event-design.md#new-event-names-ignore-the-projects-existing-ones)
- [Audit migrates a consistent naming convention](edge-cases/event-design.md#audit-migrates-a-consistent-naming-convention)
- [Event names built from variables](edge-cases/event-design.md#event-names-built-from-variables)
- [Payment, webhook and auth events only in the browser](edge-cases/event-design.md#payment-webhook-and-auth-events-only-in-the-browser)
- [Same milestone captured in browser and API](edge-cases/event-design.md#same-milestone-captured-in-browser-and-api)
- [Same number sent as number and string](edge-cases/event-design.md#same-number-sent-as-number-and-string)
- [Signup and purchase left to autocapture](edge-cases/event-design.md#signup-and-purchase-left-to-autocapture)
- [Captures on repository and service methods](edge-cases/event-design.md#captures-on-repository-and-service-methods)
- [Pageleave capture off or missing in SPAs](edge-cases/event-design.md#pageleave-capture-off-or-missing-in-spas)
- [Same page tracked under several hosts](edge-cases/event-design.md#same-page-tracked-under-several-hosts)
- [Ad click ids never captured](edge-cases/event-design.md#ad-click-ids-never-captured)
- [Conversion events carry no attribution](edge-cases/event-design.md#conversion-events-carry-no-attribution)
- [Metrics tagged with user IDs or raw URLs](edge-cases/event-design.md#metrics-tagged-with-user-ids-or-raw-urls)
- [Metrics hand-added to every route](edge-cases/event-design.md#metrics-hand-added-to-every-route)
- [Ids in span names and spans everywhere](edge-cases/event-design.md#ids-in-span-names-and-spans-everywhere)
- [Outbound calls drop the traceparent header](edge-cases/event-design.md#outbound-calls-drop-the-traceparent-header)
- [Demo events seeded with no cleanup marker](edge-cases/event-design.md#demo-events-seeded-with-no-cleanup-marker)
- [New trace id minted for every model call](edge-cases/event-design.md#new-trace-id-minted-for-every-model-call)
- [AI session id minted per call or skipped](edge-cases/event-design.md#ai-session-id-minted-per-call-or-skipped)
- [AI session id under a misspelled key](edge-cases/event-design.md#ai-session-id-under-a-misspelled-key)
- [OTel session id set on the resource](edge-cases/event-design.md#otel-session-id-set-on-the-resource)
- [LLM tool calls never captured as spans](edge-cases/event-design.md#llm-tool-calls-never-captured-as-spans)
- [Fabricated or duplicate LLM spans](edge-cases/event-design.md#fabricated-or-duplicate-llm-spans)
- [Incomplete LLM payloads on streaming routes](edge-cases/event-design.md#incomplete-llm-payloads-on-streaming-routes)
- [Groq calls attributed to OpenAI](edge-cases/event-design.md#groq-calls-attributed-to-openai)
- [MCP 2026-07-28 traffic splits every request](edge-cases/event-design.md#mcp-2026-07-28-traffic-splits-every-request)
- [Fabricated MCP initialize and hardcoded protocol version](edge-cases/event-design.md#fabricated-mcp-initialize-and-hardcoded-protocol-version)
- [Report promises MCP events that never exist](edge-cases/event-design.md#report-promises-mcp-events-that-never-exist)

## Feature flags read wrongly

31 cases in [feature-flags.md](edge-cases/feature-flags.md).

- [Unloaded flag treated as off in React](edge-cases/feature-flags.md#unloaded-flag-treated-as-off-in-react)
- [Flag read right after init](edge-cases/feature-flags.md#flag-read-right-after-init)
- [Flag copied into state instead of hook](edge-cases/feature-flags.md#flag-copied-into-state-instead-of-hook)
- [No bootstrap when the server knows flags](edge-cases/feature-flags.md#no-bootstrap-when-the-server-knows-flags)
- [Server and client evaluate the same flag](edge-cases/feature-flags.md#server-and-client-evaluate-the-same-flag)
- [React flag hooks in Server Components](edge-cases/feature-flags.md#react-flag-hooks-in-server-components)
- [Bulk flag reads record no experiment exposure](edge-cases/feature-flags.md#bulk-flag-reads-record-no-experiment-exposure)
- [Flag value or payload used with no default](edge-cases/feature-flags.md#flag-value-or-payload-used-with-no-default)
- [Code checks a flag that does not exist](edge-cases/feature-flags.md#code-checks-a-flag-that-does-not-exist)
- [Deprecated per-flag helpers instead of one snapshot](edge-cases/feature-flags.md#deprecated-per-flag-helpers-instead-of-one-snapshot)
- [Gated events lack the flag snapshot](edge-cases/feature-flags.md#gated-events-lack-the-flag-snapshot)
- [Flag evaluation failure takes the page down](edge-cases/feature-flags.md#flag-evaluation-failure-takes-the-page-down)
- [Server flag check without await](edge-cases/feature-flags.md#server-flag-check-without-await)
- [PHP person properties passed as groups](edge-cases/feature-flags.md#php-person-properties-passed-as-groups)
- [Server flags baked into cached WordPress pages](edge-cases/feature-flags.md#server-flags-baked-into-cached-wordpress-pages)
- [Feature Management without a PostHog user context](edge-cases/feature-flags.md#feature-management-without-a-posthog-user-context)
- [Local evaluation inside edge or Lambda handlers](edge-cases/feature-flags.md#local-evaluation-inside-edge-or-lambda-handlers)
- [Local evaluation left on 30-second polling](edge-cases/feature-flags.md#local-evaluation-left-on-30-second-polling)
- [Flag polling keeps Durable Objects awake](edge-cases/feature-flags.md#flag-polling-keeps-durable-objects-awake)
- [Bootstrap uses a different or random distinct id](edge-cases/feature-flags.md#bootstrap-uses-a-different-or-random-distinct-id)
- [Person-targeted flag read before login](edge-cases/feature-flags.md#person-targeted-flag-read-before-login)
- [Anonymous flag snapshot kept after login](edge-cases/feature-flags.md#anonymous-flag-snapshot-kept-after-login)
- [Flags evaluated under a different id than events](edge-cases/feature-flags.md#flags-evaluated-under-a-different-id-than-events)
- [Deprecated payload getter evaluates the flag twice](edge-cases/feature-flags.md#deprecated-payload-getter-evaluates-the-flag-twice)
- [New flag created live at 100%](edge-cases/feature-flags.md#new-flag-created-live-at-100)
- [Flag key repeated as literals across files](edge-cases/feature-flags.md#flag-key-repeated-as-literals-across-files)
- [Flag added to a side the app lacks](edge-cases/feature-flags.md#flag-added-to-a-side-the-app-lacks)
- [Product tour hidden when PostHog isn't loaded](edge-cases/feature-flags.md#product-tour-hidden-when-posthog-isnt-loaded)
- [Stale flags disabled before code removal](edge-cases/feature-flags.md#stale-flags-disabled-before-code-removal)
- [Security switch turns off when flags fail](edge-cases/feature-flags.md#security-switch-turns-off-when-flags-fail)
- [Migrated server flag checks lose the user id](edge-cases/feature-flags.md#migrated-server-flag-checks-lose-the-user-id)

## Packages installed wrongly

45 cases in [dependencies-install.md](edge-cases/dependencies-install.md).

- [Steering points agents at a missing CLI](edge-cases/dependencies-install.md#steering-points-agents-at-a-missing-cli)
- [Peer dependency conflict hidden behind done](edge-cases/dependencies-install.md#peer-dependency-conflict-hidden-behind-done)
- [Bumps the project's Go version for the bridge](edge-cases/dependencies-install.md#bumps-the-projects-go-version-for-the-bridge)
- [Unquoted version specifier in pip install](edge-cases/dependencies-install.md#unquoted-version-specifier-in-pip-install)
- [SDK version typed from memory](edge-cases/dependencies-install.md#sdk-version-typed-from-memory)
- [Stale CLI version rejects flags it uses](edge-cases/dependencies-install.md#stale-cli-version-rejects-flags-it-uses)
- [SDK version floor older than APIs used](edge-cases/dependencies-install.md#sdk-version-floor-older-than-apis-used)
- [posthog-js left to a loose peer range](edge-cases/dependencies-install.md#posthog-js-left-to-a-loose-peer-range)
- [Old SDK silently ignores the release ID](edge-cases/dependencies-install.md#old-sdk-silently-ignores-the-release-id)
- [Lowers the SDK so a local install passes](edge-cases/dependencies-install.md#lowers-the-sdk-so-a-local-install-passes)
- [Old posthog-go never sends symbolication data](edge-cases/dependencies-install.md#old-posthog-go-never-sends-symbolication-data)
- [Old @posthog/mcp ignores newer MCP features](edge-cases/dependencies-install.md#old-posthogmcp-ignores-newer-mcp-features)
- [MCP SDK peers added or versions guessed](edge-cases/dependencies-install.md#mcp-sdk-peers-added-or-versions-guessed)
- [Installs with the wrong package manager](edge-cases/dependencies-install.md#installs-with-the-wrong-package-manager)
- [pip used outside the project's Python environment](edge-cases/dependencies-install.md#pip-used-outside-the-projects-python-environment)
- [Assumes bare python and pip exist](edge-cases/dependencies-install.md#assumes-bare-python-and-pip-exist)
- [pip install never recorded in requirements](edge-cases/dependencies-install.md#pip-install-never-recorded-in-requirements)
- [Lockfile search drowns in node\_modules](edge-cases/dependencies-install.md#lockfile-search-drowns-in-node_modules)
- [Blocked install leads to hollow success](edge-cases/dependencies-install.md#blocked-install-leads-to-hollow-success)
- [Flutter pub add refused by the sandbox](edge-cases/dependencies-install.md#flutter-pub-add-refused-by-the-sandbox)
- [Install retry spiral on environment failures](edge-cases/dependencies-install.md#install-retry-spiral-on-environment-failures)
- [Fallback refuses to declare SDK without version](edge-cases/dependencies-install.md#fallback-refuses-to-declare-sdk-without-version)
- [SDK imported but never added to manifest](edge-cases/dependencies-install.md#sdk-imported-but-never-added-to-manifest)
- [Bare posthog package installed from npm](edge-cases/dependencies-install.md#bare-posthog-package-installed-from-npm)
- [AI wrapper forced past a peer conflict](edge-cases/dependencies-install.md#ai-wrapper-forced-past-a-peer-conflict)
- [Upgrades the app's own packages to fit PostHog](edge-cases/dependencies-install.md#upgrades-the-apps-own-packages-to-fit-posthog)
- [Edits app code to dodge stale SDK](edge-cases/dependencies-install.md#edits-app-code-to-dodge-stale-sdk)
- [Skill and wizard disagree on who installs](edge-cases/dependencies-install.md#skill-and-wizard-disagree-on-who-installs)
- [Unused posthog-js next to the Astro snippet](edge-cases/dependencies-install.md#unused-posthog-js-next-to-the-astro-snippet)
- [React Native SDK installed without peers](edge-cases/dependencies-install.md#react-native-sdk-installed-without-peers)
- [Go OTel path given the core Go SDK](edge-cases/dependencies-install.md#go-otel-path-given-the-core-go-sdk)
- [Hand-edited go.mod or Cargo.toml](edge-cases/dependencies-install.md#hand-edited-gomod-or-cargotoml)
- [Async Rust client forced on sync app](edge-cases/dependencies-install.md#async-rust-client-forced-on-sync-app)
- [Skill download depends on curl and unzip](edge-cases/dependencies-install.md#skill-download-depends-on-curl-and-unzip)
- [Sandbox blocks corepack and Volta installs](edge-cases/dependencies-install.md#sandbox-blocks-corepack-and-volta-installs)
- [Install backgrounded while the build runs](edge-cases/dependencies-install.md#install-backgrounded-while-the-build-runs)
- [posthog-cli installed globally or via npm in native apps](edge-cases/dependencies-install.md#posthog-cli-installed-globally-or-via-npm-in-native-apps)
- [Gradle plugin version copied from the SDK](edge-cases/dependencies-install.md#gradle-plugin-version-copied-from-the-sdk)
- [Swift package added with half the Xcode wiring](edge-cases/dependencies-install.md#swift-package-added-with-half-the-xcode-wiring)
- [Swift package added to generated Xcode project](edge-cases/dependencies-install.md#swift-package-added-to-generated-xcode-project)
- [Non-semver dependency values crash version checks](edge-cases/dependencies-install.md#non-semver-dependency-values-crash-version-checks)
- [Plugin install before marketplace is registered](edge-cases/dependencies-install.md#plugin-install-before-marketplace-is-registered)
- [Codex marketplace add reported as install](edge-cases/dependencies-install.md#codex-marketplace-add-reported-as-install)
- [Uninstall leaves a second plugin copy](edge-cases/dependencies-install.md#uninstall-leaves-a-second-plugin-copy)
- [Agent cannot install the upload CLI](edge-cases/dependencies-install.md#agent-cannot-install-the-upload-cli)

## Changes that break builds or deploys

3 cases in [build-deploy-safety.md](edge-cases/build-deploy-safety.md).

- [Xcode open while project files are edited](edge-cases/build-deploy-safety.md#xcode-open-while-project-files-are-edited)
- [Old SDK removed while imports remain](edge-cases/build-deploy-safety.md#old-sdk-removed-while-imports-remain)
- [Production deploy fails when PostHog is unreachable](edge-cases/build-deploy-safety.md#production-deploy-fails-when-posthog-is-unreachable)

## Edits beyond the integration

54 cases in [scope-discipline.md](edge-cases/scope-discipline.md).

- [Linear signal source reads every workspace team](edge-cases/scope-discipline.md#linear-signal-source-reads-every-workspace-team)
- [Frontend flag invented for a server-rendered app](edge-cases/scope-discipline.md#frontend-flag-invented-for-a-server-rendered-app)
- [Extra recap files beyond the one report](edge-cases/scope-discipline.md#extra-recap-files-beyond-the-one-report)
- [Data-source step edits app files](edge-cases/scope-discipline.md#data-source-step-edits-app-files)
- [Offering every detected data source at once](edge-cases/scope-discipline.md#offering-every-detected-data-source-at-once)
- [Asks credentials for data sources the app lacks](edge-cases/scope-discipline.md#asks-credentials-for-data-sources-the-app-lacks)
- [Connects a data source after the user declined](edge-cases/scope-discipline.md#connects-a-data-source-after-the-user-declined)
- [Agent turns off autocapture or session replay](edge-cases/scope-discipline.md#agent-turns-off-autocapture-or-session-replay)
- [Invented wrappers the codebase never uses](edge-cases/scope-discipline.md#invented-wrappers-the-codebase-never-uses)
- [Re-run strips hand-tuned config and guards](edge-cases/scope-discipline.md#re-run-strips-hand-tuned-config-and-guards)
- [Already-integrated project re-run without detection](edge-cases/scope-discipline.md#already-integrated-project-re-run-without-detection)
- [Second PostHog init beside the existing one](edge-cases/scope-discipline.md#second-posthog-init-beside-the-existing-one)
- [Whole-file rewrite drops existing code](edge-cases/scope-discipline.md#whole-file-rewrite-drops-existing-code)
- [Unrelated code changed in touched files](edge-cases/scope-discipline.md#unrelated-code-changed-in-touched-files)
- [Tutorial comments and tracking wrapper functions](edge-cases/scope-discipline.md#tutorial-comments-and-tracking-wrapper-functions)
- [Fixing build errors the change did not cause](edge-cases/scope-discipline.md#fixing-build-errors-the-change-did-not-cause)
- [Review renames events and second-guesses design](edge-cases/scope-discipline.md#review-renames-events-and-second-guesses-design)
- [Parallel AI and Logs steps clobber files](edge-cases/scope-discipline.md#parallel-ai-and-logs-steps-clobber-files)
- [Wizard scratch files left in the user's repo](edge-cases/scope-discipline.md#wizard-scratch-files-left-in-the-users-repo)
- [Wizard workflow files left in user's project](edge-cases/scope-discipline.md#wizard-workflow-files-left-in-users-project)
- [Cleanup deletes the user's own skills](edge-cases/scope-discipline.md#cleanup-deletes-the-users-own-skills)
- [rm reaching outside the project root](edge-cases/scope-discipline.md#rm-reaching-outside-the-project-root)
- [Destructive git or rm commands run unprompted](edge-cases/scope-discipline.md#destructive-git-or-rm-commands-run-unprompted)
- [Reading or searching outside the project](edge-cases/scope-discipline.md#reading-or-searching-outside-the-project)
- [Spawning subagents during the integration](edge-cases/scope-discipline.md#spawning-subagents-during-the-integration)
- [Junk files from a failed tool call](edge-cases/scope-discipline.md#junk-files-from-a-failed-tool-call)
- [Builds missing Stripe setup instead of aborting](edge-cases/scope-discipline.md#builds-missing-stripe-setup-instead-of-aborting)
- [Adding new Stripe calls to attach metadata](edge-cases/scope-discipline.md#adding-new-stripe-calls-to-attach-metadata)
- [Replaces existing telemetry or analytics code](edge-cases/scope-discipline.md#replaces-existing-telemetry-or-analytics-code)
- [Second tracing pipeline beside existing OpenTelemetry](edge-cases/scope-discipline.md#second-tracing-pipeline-beside-existing-opentelemetry)
- [Narrow command grows into full integration](edge-cases/scope-discipline.md#narrow-command-grows-into-full-integration)
- [Loads skills outside the allowed categories](edge-cases/scope-discipline.md#loads-skills-outside-the-allowed-categories)
- [Agent reads every skill step up front](edge-cases/scope-discipline.md#agent-reads-every-skill-step-up-front)
- [Audit run edits the code it audits](edge-cases/scope-discipline.md#audit-run-edits-the-code-it-audits)
- [Agent hand-writes or early-deletes the audit ledger](edge-cases/scope-discipline.md#agent-hand-writes-or-early-deletes-the-audit-ledger)
- [Narrow audit check grows into deep dive](edge-cases/scope-discipline.md#narrow-audit-check-grows-into-deep-dive)
- [Doctor applies fixes the user never picked](edge-cases/scope-discipline.md#doctor-applies-fixes-the-user-never-picked)
- [Handoff prompt tells next agent to fix everything](edge-cases/scope-discipline.md#handoff-prompt-tells-next-agent-to-fix-everything)
- [Migration adds tracking the old SDK never had](edge-cases/scope-discipline.md#migration-adds-tracking-the-old-sdk-never-had)
- [Agent invents mappings for calls with no equivalent](edge-cases/scope-discipline.md#agent-invents-mappings-for-calls-with-no-equivalent)
- [Migration keeps going when the source SDK is absent](edge-cases/scope-discipline.md#migration-keeps-going-when-the-source-sdk-is-absent)
- [LLM-only run adds events, error handlers, proxy](edge-cases/scope-discipline.md#llm-only-run-adds-events-error-handlers-proxy)
- [Wraps LLM providers the app does not use](edge-cases/scope-discipline.md#wraps-llm-providers-the-app-does-not-use)
- [AI observability invented for an app without LLMs](edge-cases/scope-discipline.md#ai-observability-invented-for-an-app-without-llms)
- [Extra scaffolding around a short OTel bootstrap](edge-cases/scope-discipline.md#extra-scaffolding-around-a-short-otel-bootstrap)
- [Spans wrapped around plain helper functions](edge-cases/scope-discipline.md#spans-wrapped-around-plain-helper-functions)
- [Needless GitLab YAML edits for CI variables](edge-cases/scope-discipline.md#needless-gitlab-yaml-edits-for-ci-variables)
- [Release linking edits local dev and creates releases](edge-cases/scope-discipline.md#release-linking-edits-local-dev-and-creates-releases)
- [Setup overrides or enables unconfirmed signal sources](edge-cases/scope-discipline.md#setup-overrides-or-enables-unconfirmed-signal-sources)
- [Tunes server-owned fields on scout configs](edge-cases/scope-discipline.md#tunes-server-owned-fields-on-scout-configs)
- [Enables too many signals scouts](edge-cases/scope-discipline.md#enables-too-many-signals-scouts)
- [Operational scout switched off or forced on](edge-cases/scope-discipline.md#operational-scout-switched-off-or-forced-on)
- [Typecheck tooling added the project never had](edge-cases/scope-discipline.md#typecheck-tooling-added-the-project-never-had)
- [Replay vision setup aborts without an SDK](edge-cases/scope-discipline.md#replay-vision-setup-aborts-without-an-sdk)

## Dashboard and PostHog tool calls fail

67 cases in [mcp-dashboards-insights.md](edge-cases/mcp-dashboards-insights.md).

- [Overlapping replay scanners corroborate themselves](edge-cases/mcp-dashboards-insights.md#overlapping-replay-scanners-corroborate-themselves)
- [Bug scanner limited to exception sessions](edge-cases/mcp-dashboards-insights.md#bug-scanner-limited-to-exception-sessions)
- [Replay scanner scoped to guessed URL paths](edge-cases/mcp-dashboards-insights.md#replay-scanner-scoped-to-guessed-url-paths)
- [Scanner spend compared in wrong units](edge-cases/mcp-dashboards-insights.md#scanner-spend-compared-in-wrong-units)
- [Replay scanners keep generic template names](edge-cases/mcp-dashboards-insights.md#replay-scanners-keep-generic-template-names)
- [Source config created for self-authorizing scanner](edge-cases/mcp-dashboards-insights.md#source-config-created-for-self-authorizing-scanner)
- [Agent recreates a retired replay signal source](edge-cases/mcp-dashboards-insights.md#agent-recreates-a-retired-replay-signal-source)
- [Scout proposals ignore the repo's agent docs](edge-cases/mcp-dashboards-insights.md#scout-proposals-ignore-the-repos-agent-docs)
- [GitHub repo researched via git remote when only one is connected](edge-cases/mcp-dashboards-insights.md#github-repo-researched-via-git-remote-when-only-one-is-connected)
- [Inbox responder enabled with no data source](edge-cases/mcp-dashboards-insights.md#inbox-responder-enabled-with-no-data-source)
- [Ticket source syncs every table incrementally](edge-cases/mcp-dashboards-insights.md#ticket-source-syncs-every-table-incrementally)
- [PostHog MCP configured on retired /sse](edge-cases/mcp-dashboards-insights.md#posthog-mcp-configured-on-retired-sse)
- [Browser-only MCP connector reported as installed](edge-cases/mcp-dashboards-insights.md#browser-only-mcp-connector-reported-as-installed)
- [Notebook copy trims the audit's events](edge-cases/mcp-dashboards-insights.md#notebook-copy-trims-the-audits-events)
- [Hard-coded retired model breaks every scanner](edge-cases/mcp-dashboards-insights.md#hard-coded-retired-model-breaks-every-scanner)
- [One missing tool or 403 aborts setup](edge-cases/mcp-dashboards-insights.md#one-missing-tool-or-403-aborts-setup)
- [Zero-traffic authorized URL removed as stale](edge-cases/mcp-dashboards-insights.md#zero-traffic-authorized-url-removed-as-stale)
- [Re-run clobbers or re-arms the user's scanners](edge-cases/mcp-dashboards-insights.md#re-run-clobbers-or-re-arms-the-users-scanners)
- [Scanner prompt invents product details](edge-cases/mcp-dashboards-insights.md#scanner-prompt-invents-product-details)
- [Wizard dashboards and notebooks not tagged](edge-cases/mcp-dashboards-insights.md#wizard-dashboards-and-notebooks-not-tagged)
- [Insights skipped because events not ingested yet](edge-cases/mcp-dashboards-insights.md#insights-skipped-because-events-not-ingested-yet)
- [Trends breakdown written at the wrong level](edge-cases/mcp-dashboards-insights.md#trends-breakdown-written-at-the-wrong-level)
- [Funnel window fields misplaced or snake\_case](edge-cases/mcp-dashboards-insights.md#funnel-window-fields-misplaced-or-snake_case)
- [Guessed chart display names and retry loops](edge-cases/mcp-dashboards-insights.md#guessed-chart-display-names-and-retry-loops)
- [Insights created but not on the dashboard](edge-cases/mcp-dashboards-insights.md#insights-created-but-not-on-the-dashboard)
- [Insight SQL saved with unfilled placeholders](edge-cases/mcp-dashboards-insights.md#insight-sql-saved-with-unfilled-placeholders)
- [Created dashboards missing the wizard name tag](edge-cases/mcp-dashboards-insights.md#created-dashboards-missing-the-wizard-name-tag)
- [Agent edits the user's existing dashboards](edge-cases/mcp-dashboards-insights.md#agent-edits-the-users-existing-dashboards)
- [Dashboard link given in prose, not the marker](edge-cases/mcp-dashboards-insights.md#dashboard-link-given-in-prose-not-the-marker)
- [Named MCP tools called on an exec-only server](edge-cases/mcp-dashboards-insights.md#named-mcp-tools-called-on-an-exec-only-server)
- [MCP tool called without reading its schema](edge-cases/mcp-dashboards-insights.md#mcp-tool-called-without-reading-its-schema)
- [Renamed MCP tools or skills retried blindly](edge-cases/mcp-dashboards-insights.md#renamed-mcp-tools-or-skills-retried-blindly)
- [Endless search for a tool that is missing](edge-cases/mcp-dashboards-insights.md#endless-search-for-a-tool-that-is-missing)
- [Made-up tool name for project settings changes](edge-cases/mcp-dashboards-insights.md#made-up-tool-name-for-project-settings-changes)
- [Harness mounts every MCP resource as a tool](edge-cases/mcp-dashboards-insights.md#harness-mounts-every-mcp-resource-as-a-tool)
- [Long skill resource names break tool calls](edge-cases/mcp-dashboards-insights.md#long-skill-resource-names-break-tool-calls)
- [MCP tool schemas fill the context window](edge-cases/mcp-dashboards-insights.md#mcp-tool-schemas-fill-the-context-window)
- [Prompt promises tools that were never mounted](edge-cases/mcp-dashboards-insights.md#prompt-promises-tools-that-were-never-mounted)
- [Wizard token missing the query read scope](edge-cases/mcp-dashboards-insights.md#wizard-token-missing-the-query-read-scope)
- [Write scope assumed to allow reads](edge-cases/mcp-dashboards-insights.md#write-scope-assumed-to-allow-reads)
- [CI runs create a dashboard every time](edge-cases/mcp-dashboards-insights.md#ci-runs-create-a-dashboard-every-time)
- [Optional notebook copy fails a delivered report](edge-cases/mcp-dashboards-insights.md#optional-notebook-copy-fails-a-delivered-report)
- [Retired notebook tools and hand-built document JSON](edge-cases/mcp-dashboards-insights.md#retired-notebook-tools-and-hand-built-document-json)
- [Notebook content sent as plain markdown](edge-cases/mcp-dashboards-insights.md#notebook-content-sent-as-plain-markdown)
- [Notebook JSON wrapped in quotes or raw newlines](edge-cases/mcp-dashboards-insights.md#notebook-json-wrapped-in-quotes-or-raw-newlines)
- [Notebook version conflict mistaken for a bad payload](edge-cases/mcp-dashboards-insights.md#notebook-version-conflict-mistaken-for-a-bad-payload)
- [Large report truncated in one notebook call](edge-cases/mcp-dashboards-insights.md#large-report-truncated-in-one-notebook-call)
- [Setup report saved only as a local file](edge-cases/mcp-dashboards-insights.md#setup-report-saved-only-as-a-local-file)
- [Warehouse source fields guessed instead of looked up](edge-cases/mcp-dashboards-insights.md#warehouse-source-fields-guessed-instead-of-looked-up)
- [Event lookup tool denied for personal keys](edge-cases/mcp-dashboards-insights.md#event-lookup-tool-denied-for-personal-keys)
- [Audit retries, switches project, or aborts on MCP errors](edge-cases/mcp-dashboards-insights.md#audit-retries-switches-project-or-aborts-on-mcp-errors)
- [Audit repeats duplicate and dismissed findings](edge-cases/mcp-dashboards-insights.md#audit-repeats-duplicate-and-dismissed-findings)
- [HogQL written as raw SQL with no time range](edge-cases/mcp-dashboards-insights.md#hogql-written-as-raw-sql-with-no-time-range)
- [Dashboard SQL ignores dashboard filters and dates](edge-cases/mcp-dashboards-insights.md#dashboard-sql-ignores-dashboard-filters-and-dates)
- [Missing property compared to empty string](edge-cases/mcp-dashboards-insights.md#missing-property-compared-to-empty-string)
- [MCP calls hit the last-opened project](edge-cases/mcp-dashboards-insights.md#mcp-calls-hit-the-last-opened-project)
- [Demo queries run against an empty project](edge-cases/mcp-dashboards-insights.md#demo-queries-run-against-an-empty-project)
- [User told to create flags by hand](edge-cases/mcp-dashboards-insights.md#user-told-to-create-flags-by-hand)
- [Coding agents do not know PostHog CLI](edge-cases/mcp-dashboards-insights.md#coding-agents-do-not-know-posthog-cli)
- [MCP feature filter uses wrong id spelling](edge-cases/mcp-dashboards-insights.md#mcp-feature-filter-uses-wrong-id-spelling)
- [API key in .env ignored for MCP](edge-cases/mcp-dashboards-insights.md#api-key-in-env-ignored-for-mcp)
- [Inbox source rows created twice](edge-cases/mcp-dashboards-insights.md#inbox-source-rows-created-twice)
- [Two signal pipelines on one surface](edge-cases/mcp-dashboards-insights.md#two-signal-pipelines-on-one-surface)
- [Partial config update wipes stored settings](edge-cases/mcp-dashboards-insights.md#partial-config-update-wipes-stored-settings)
- [Custom scout created with the generic skill tool](edge-cases/mcp-dashboards-insights.md#custom-scout-created-with-the-generic-skill-tool)
- [Logs and Endpoints signal sources left disabled](edge-cases/mcp-dashboards-insights.md#logs-and-endpoints-signal-sources-left-disabled)
- [Enabled-scout limit ignored when planning](edge-cases/mcp-dashboards-insights.md#enabled-scout-limit-ignored-when-planning)

## Wizard run mechanics

97 cases in [other.md](edge-cases/other.md).

- [Localhost database host offered to PostHog](edge-cases/other.md#localhost-database-host-offered-to-posthog)
- [Prompt placeholders copied literally into output](edge-cases/other.md#prompt-placeholders-copied-literally-into-output)
- [Report shortened to get past notebook errors](edge-cases/other.md#report-shortened-to-get-past-notebook-errors)
- [Notebook shows the report title twice](edge-cases/other.md#notebook-shows-the-report-title-twice)
- [Notebook link written as prose, not marker](edge-cases/other.md#notebook-link-written-as-prose-not-marker)
- [Many sources packed into one credential prompt](edge-cases/other.md#many-sources-packed-into-one-credential-prompt)
- [Credentials asked one field at a time](edge-cases/other.md#credentials-asked-one-field-at-a-time)
- [Retryable batch nudge treated as a hard stop](edge-cases/other.md#retryable-batch-nudge-treated-as-a-hard-stop)
- [Tracking parameters stripped from setup links](edge-cases/other.md#tracking-parameters-stripped-from-setup-links)
- [Key files asked through a terminal prompt](edge-cases/other.md#key-files-asked-through-a-terminal-prompt)
- [One declined prompt ends all credential collection](edge-cases/other.md#one-declined-prompt-ends-all-credential-collection)
- [First failed source aborts remaining sources](edge-cases/other.md#first-failed-source-aborts-remaining-sources)
- [One rejected credential abandons the whole source](edge-cases/other.md#one-rejected-credential-abandons-the-whole-source)
- [Timed-out prompt confused with user dismissal](edge-cases/other.md#timed-out-prompt-confused-with-user-dismissal)
- [Long credential form times out mid-entry](edge-cases/other.md#long-credential-form-times-out-mid-entry)
- [Timed-out question blocks every later question](edge-cases/other.md#timed-out-question-blocks-every-later-question)
- [Stepping away treated as declining](edge-cases/other.md#stepping-away-treated-as-declining)
- [Question times out during slow user work](edge-cases/other.md#question-times-out-during-slow-user-work)
- [Blank required credential accepted as an answer](edge-cases/other.md#blank-required-credential-accepted-as-an-answer)
- [Long connection form abandoned instead of split](edge-cases/other.md#long-connection-form-abandoned-instead-of-split)
- [Same database connected twice under two names](edge-cases/other.md#same-database-connected-twice-under-two-names)
- [Supabase connected as plain Postgres via the direct host](edge-cases/other.md#supabase-connected-as-plain-postgres-via-the-direct-host)
- [Wrong credential type for SaaS sources](edge-cases/other.md#wrong-credential-type-for-saas-sources)
- [Stripe key prompt names no scopes](edge-cases/other.md#stripe-key-prompt-names-no-scopes)
- [Source type sent as display label](edge-cases/other.md#source-type-sent-as-display-label)
- [Non-interactive run stalls or invents credentials](edge-cases/other.md#non-interactive-run-stalls-or-invents-credentials)
- [Prompting a user who is not there](edge-cases/other.md#prompting-a-user-who-is-not-there)
- [Interactive program started in CI mode](edge-cases/other.md#interactive-program-started-in-ci-mode)
- [Credential prompts interrupt agents still editing code](edge-cases/other.md#credential-prompts-interrupt-agents-still-editing-code)
- [Outro drops data-source next steps](edge-cases/other.md#outro-drops-data-source-next-steps)
- [Setup report dumped as a file in repo](edge-cases/other.md#setup-report-dumped-as-a-file-in-repo)
- [Every step publishes its own final report](edge-cases/other.md#every-step-publishes-its-own-final-report)
- [Report rewrites sections other steps already wrote](edge-cases/other.md#report-rewrites-sections-other-steps-already-wrote)
- [Event table dropped when plan file missing](edge-cases/other.md#event-table-dropped-when-plan-file-missing)
- [Report claims all app logs reach PostHog](edge-cases/other.md#report-claims-all-app-logs-reach-posthog)
- [Huge report truncated, losing next steps](edge-cases/other.md#huge-report-truncated-losing-next-steps)
- [Long report composed in one turn](edge-cases/other.md#long-report-composed-in-one-turn)
- [Large JSON merged inside a model turn](edge-cases/other.md#large-json-merged-inside-a-model-turn)
- [Event plan file misplaced or fields renamed](edge-cases/other.md#event-plan-file-misplaced-or-fields-renamed)
- [Shell retries to delete a blocked temp file](edge-cases/other.md#shell-retries-to-delete-a-blocked-temp-file)
- [Model leaks tool-call tokens into written files](edge-cases/other.md#model-leaks-tool-call-tokens-into-written-files)
- [Guessed or stale model ids rejected](edge-cases/other.md#guessed-or-stale-model-ids-rejected)
- [Planner retries a product this run excludes](edge-cases/other.md#planner-retries-a-product-this-run-excludes)
- [Instructions demand a task tool that is absent](edge-cases/other.md#instructions-demand-a-task-tool-that-is-absent)
- [Agent exits or fabricates instead of aborting](edge-cases/other.md#agent-exits-or-fabricates-instead-of-aborting)
- [Missing prerequisite must hard-stop the run](edge-cases/other.md#missing-prerequisite-must-hard-stop-the-run)
- [Agent gives up without a stated reason](edge-cases/other.md#agent-gives-up-without-a-stated-reason)
- [Required SDKs live in monorepo subpackages](edge-cases/other.md#required-sdks-live-in-monorepo-subpackages)
- [Framework skills miss shared browser and server rules](edge-cases/other.md#framework-skills-miss-shared-browser-and-server-rules)
- [Critical setup buried in reference docs is skipped](edge-cases/other.md#critical-setup-buried-in-reference-docs-is-skipped)
- [No example app, every run differs](edge-cases/other.md#no-example-app-every-run-differs)
- [Misspelled config key ships no example](edge-cases/other.md#misspelled-config-key-ships-no-example)
- [Example bundle hides build and dependency manifests](edge-cases/other.md#example-bundle-hides-build-and-dependency-manifests)
- [Stale example README reintroduces fixed bugs](edge-cases/other.md#stale-example-readme-reintroduces-fixed-bugs)
- [Build output and tests pollute example context](edge-cases/other.md#build-output-and-tests-pollute-example-context)
- [Moved docs pages ship stale or empty](edge-cases/other.md#moved-docs-pages-ship-stale-or-empty)
- [Skill references listed without their folder](edge-cases/other.md#skill-references-listed-without-their-folder)
- [Installed skill examples pollute code search](edge-cases/other.md#installed-skill-examples-pollute-code-search)
- [Skill cites missing sections and stale counts](edge-cases/other.md#skill-cites-missing-sections-and-stale-counts)
- [Uncapped live findings bury audit checks](edge-cases/other.md#uncapped-live-findings-bury-audit-checks)
- [One resolve call drops every finding](edge-cases/other.md#one-resolve-call-drops-every-finding)
- [Signal sources enabled while their products are off](edge-cases/other.md#signal-sources-enabled-while-their-products-are-off)
- [Codebase scan suggests Postgres as an issue tracker](edge-cases/other.md#codebase-scan-suggests-postgres-as-an-issue-tracker)
- [Consent question hides per-PR cost](edge-cases/other.md#consent-question-hides-per-pr-cost)
- [Committing option listed first](edge-cases/other.md#committing-option-listed-first)
- [Duplicate picker labels widen the selection](edge-cases/other.md#duplicate-picker-labels-widen-the-selection)
- [Landing page strips UTMs before init](edge-cases/other.md#landing-page-strips-utms-before-init)
- [UTMs lost through OAuth sign-in redirect](edge-cases/other.md#utms-lost-through-oauth-sign-in-redirect)
- [Agent alarms user about internal security warnings](edge-cases/other.md#agent-alarms-user-about-internal-security-warnings)
- [Writing existing files without a fresh read](edge-cases/other.md#writing-existing-files-without-a-fresh-read)
- [Agent asks questions in plain text](edge-cases/other.md#agent-asks-questions-in-plain-text)
- [File edits race ahead of a pending question](edge-cases/other.md#file-edits-race-ahead-of-a-pending-question)
- [Blocked tool list silently never enforced](edge-cases/other.md#blocked-tool-list-silently-never-enforced)
- [Wizard tools called through the PostHog MCP](edge-cases/other.md#wizard-tools-called-through-the-posthog-mcp)
- [Project scan answers in prose, not JSON](edge-cases/other.md#project-scan-answers-in-prose-not-json)
- [Fallback agent gets no PostHog guidance](edge-cases/other.md#fallback-agent-gets-no-posthog-guidance)
- [Stored Claude login beats the gateway token](edge-cases/other.md#stored-claude-login-beats-the-gateway-token)
- [Stop hook re-prompts after an API error](edge-cases/other.md#stop-hook-re-prompts-after-an-api-error)
- [Valid skill id rejected, agent guesses](edge-cases/other.md#valid-skill-id-rejected-agent-guesses)
- [Dotted skill id makes the agent hand-roll Nuxt](edge-cases/other.md#dotted-skill-id-makes-the-agent-hand-roll-nuxt)
- [Run starts while skill host is down](edge-cases/other.md#run-starts-while-skill-host-is-down)
- [Improvises from memory when docs are unreachable](edge-cases/other.md#improvises-from-memory-when-docs-are-unreachable)
- [Failed skill-menu fetch leaves run wandering](edge-cases/other.md#failed-skill-menu-fetch-leaves-run-wandering)
- [Unbounded project scans run out of memory](edge-cases/other.md#unbounded-project-scans-run-out-of-memory)
- [Retry spiral on blocked bash commands](edge-cases/other.md#retry-spiral-on-blocked-bash-commands)
- [Loose failure hints hide wizard bugs](edge-cases/other.md#loose-failure-hints-hide-wizard-bugs)
- [Question cap stops multi-source credential prompts](edge-cases/other.md#question-cap-stops-multi-source-credential-prompts)
- [Report section silently dropped by harness schema](edge-cases/other.md#report-section-silently-dropped-by-harness-schema)
- [Already-installed MCP reported as failed install](edge-cases/other.md#already-installed-mcp-reported-as-failed-install)
- [MCP server search stops at repo root](edge-cases/other.md#mcp-server-search-stops-at-repo-root)
- [Unanswered question silently replaced by a guess](edge-cases/other.md#unanswered-question-silently-replaced-by-a-guess)
- [Optional-step consent asked too late](edge-cases/other.md#optional-step-consent-asked-too-late)
- [Interrupted run leaves user without settings.json](edge-cases/other.md#interrupted-run-leaves-user-without-settingsjson)
- [Cheap model writes init boilerplate from memory](edge-cases/other.md#cheap-model-writes-init-boilerplate-from-memory)
- [Stale triage model ID over-blocks every run](edge-cases/other.md#stale-triage-model-id-over-blocks-every-run)
- [Agent inherits the user's MCP servers](edge-cases/other.md#agent-inherits-the-users-mcp-servers)
- [Test and generated files leak into skill examples](edge-cases/other.md#test-and-generated-files-leak-into-skill-examples)

## Open cases

These cases have no shipped fix yet. Some came from recent wizard runs, others have a rule that is planned or still in review. They have no snippets.

- **Package manager detector misses workspace root.** detect\_package\_manager only looks for a lockfile in the install dir, so a nested app in a pnpm/yarn workspace gets 'npm' by default. A generic agent trusts the tool, as the commandment tells it to. npm install fails with EUNSUPPORTEDPROTOCOL on workspace:/catalog: specs and the SDK never lands in the manifest.
- **Command fence blocks the project's own verify scripts.** The pi bash fence allows only fixed script names (build, lint, typecheck, check...). Real projects name them qa, ts-check, verify, test:run, gradle:build, and use poetry run, nx, npm --prefix, astro check, vendor/bin/pint. The deny message even claims some of these are allowed. Verification is skipped or reported unverified, and the agent burns a turn on a blocked call. Tracked in [PostHog/wizard#1016](https://github.com/PostHog/wizard/pull/1016), [PostHog/wizard#1000](https://github.com/PostHog/wizard/pull/1000).
- **pnpm exits nonzero after a good install.** pnpm 10/11 prints ERR\_PNPM\_IGNORED\_BUILDS and exits nonzero after dependencies are written. The agent reads the exit code as a failed install, and the 'one attempt, no retry' rule stops it there. A correct install is reported as failed, and build and lint never start.
- **Python venv has no pip, install stalls.** detect\_package\_manager covers Node lockfiles and says nothing useful for a uv-made .venv without pip or a project with only pyproject.toml. The fence allows pip but not 'uv pip install --python .venv/bin/python'. The SDK is never installed and the run ends with an unresolved dependency.
- **Wizard run starts outside the app folder.** The run takes the launch directory as the project. When that folder holds only wizard scaffolding or an OS folder, every step finds no manifest, and the agent cannot tell the user the real cause. All integration steps are blocked or no-ops, yet the run proceeds as if it succeeded.
- **Expo projects get the bare React Native env rule.** The React Native commandment says use react-native-config, and the Expo one says use expo-constants. Expo runs see both, and projects that already use EXPO\_PUBLIC\_\* add a third convention. The agent picks by guess. The wrong choice adds a package that Expo cannot link or reads a variable that is never embedded.
- **Edit-only tasks are told to install packages.** init, identify, capture and error-tracking tasks have no shell, but the reference examples import packages (@posthog/react, posthog-js peers) that the install task did not add. The skill text says to run the install command anyway. The code imports a package that is not in the manifest, and the build breaks until review catches it.
- **Self-driving agents cannot find Replay Vision skills.** The scanner skill is told to load creating-replay-vision-scanners with skill-get, but it is a built-in loaded with learn, its children are absent from the skill menu, and posthog\_exec needs a conversation id. Project profile 404s on first run read as errors. The agent spends turns probing categories and failed calls before it can create scanners.
- **Skill menu hides skills the task names.** load\_skill\_menu lists skills by category, but the task names an ID the menu omits, or a skill already preinstalled. The rule 'load the menu first' forces a lookup that cannot find it. Wasted lookups, and a skill that exists is treated as missing. Tracked in [PostHog/wizard#1033](https://github.com/PostHog/wizard/issues/1033).
- **Warehouse setup stumbles on field shapes.** The data-warehouse skill does not cover a connection string typed into a host field, a Stripe auth-method reply that holds a key, omitted schemas, or choosing tables after discovery under the one-prompt-per-source rule. Sources fail to connect or are handed to the browser, and the agent improvises. Tracked in [PostHog/wizard#1233](https://github.com/PostHog/wizard/pull/1233).
- **Dashboard step cannot read event schema.** The wizard token has no property\_definition:read or action:read scope, so read-data-schema fails. The dashboard skill does not say so, and the agent builds insights from the plan with no way to check the events exist. Insights are created blind, and a typo in an event name shows an empty chart.
- **Windows runs have no shell or search.** On Windows the bash tool needs a configured Bash, and the grep/find helper binaries fail to download or crash. The agent is told to run npm commands and to search the tree. Install, build and lint never run, and the report says unverified. Tracked in [PostHog/wizard#563](https://github.com/PostHog/wizard/issues/563).
- **Report: write a file or hand off?.** Skills ask for a local report file in some places and publish\_handoff only in others. The agent cannot tell which wins, so it writes both or neither. The outro names a file that does not exist, or the report is duplicated. Tracked in [PostHog/wizard#1332](https://github.com/PostHog/wizard/issues/1332), [PostHog/context-mill#306](https://github.com/PostHog/context-mill/pull/306).
- **Lint on route-group paths is blocked.** Next.js route groups like app/(main)/page.tsx contain parentheses, which the bash fence treats as shell syntax. The agent cannot lint the files it changed and reports the lint as blocked. Tracked in [PostHog/wizard#1000](https://github.com/PostHog/wizard/pull/1000).
- **@posthog/ai against the app's SDK version.** The agent installs the latest @posthog/ai, which wants a newer openai or anthropic SDK than the app pins. Nothing names the compatible @posthog/ai major. One failed install, a downgrade cycle, or a duplicate vendor SDK. Tracked in [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325).
- **Skill install says done, files missing.** install\_skill returns success but the advertised SKILL.md and reference files are not on disk at the stated path. The agent works from partial guidance and may skip rules that were in the missing references.
- **Read-before-write rule fails on new files.** The commandment says read the exact file immediately before writing. For a file that does not exist yet, the read errors with ENOENT, and the agent is unsure whether that counts. An extra failed tool call per new file, and some agents skip creating the file.
- **Swift token: no literal, no config path.** The Swift reference embeds the public token for archives, but the guardrail bans token and host literals in source. No wizard-supported build setting bridges them. The agent invents an xcconfig, adds an extra host key, or leaves the token unset in release builds.
- **Minimality review deletes the shutdown helper.** A review told to 'delete helpers nothing calls' sees an exported shutdown function with no caller and removes it, instead of wiring it to process exit. The loss of events is silent. The run's only shutdown path is removed, so buffered events and logs are lost at exit. Tracked in [PostHog/wizard#1330](https://github.com/PostHog/wizard/issues/1330), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245).
- **Go log.Fatal skips the deferred Close.** `defer client.Close()` above `log.Fatal(http.ListenAndServe(...))` looks correct. But log.Fatal calls os.Exit, which never runs deferred functions. The wizard prompt itself suggests `defer client.Close()`. Silent: the queued batch is dropped on every restart. Tracked in [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267).
- **Logout event lost to full-page form submit.** Putting capture() and reset() in the logout form's onSubmit looks correct. But a POST form navigates away at once, so the queued capture races the page unload and reset() runs before the flush. Silent: the logout capture can be lost in the unload, and reset() competes with the pending flush. Tracked in [PostHog/wizard#1121](https://github.com/PostHog/wizard/issues/1121).
- **False flag assignments never reported.** The onFeatureFlags callback map looks like the full flag set, but the SDK leaves out false values. Iterating it and checking types seems careful but drops one branch. Silent: false assignments never emit an exposure event. The UI still works, so the data gap goes unnoticed.
- **All-flags result indexed like a map.** Training data shows a name-keyed object, but the pinned SDK returns an array of results. Indexing it by name just yields undefined. Healthy true assignments are rejected and exposures skipped, so the feature stays off for users who should have it.
- **Multivariate flag read as a boolean.** isFeatureEnabled is the first flag API in most examples, and any matched variant counts as true. Every variant takes the same branch, for example a hard-only banner also shows for the easy variant.
- **Stale flags judged by grep or rollout alone.** A grep hit or a 100% rollout looks like a clear answer. But comment-only and dead-module references are not live, and PostHog state is half the picture. Live flags get removed, or dead references keep stale flags around.
- **Stub client hides real SDK behaviour.** The agent writes tests against a hand-made stub whose callback shape it guessed, so the test encodes its own wrong assumption about the SDK. Local tests pass while the real browser bundle misbehaves, for example false flag exposures never sent.
- **PHP cast before ?? yields an empty id.** (string) binds tighter than ??, so (string) null becomes '' which is not null. The fallback chain reads correctly but never falls through. Events and exceptions are captured with an empty distinct id. Silent. Tracked in [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101).
- **distinct\_id stuffed into capture properties.** Passing distinct\_id as a property is a shortcut agents copy from server SDK habits, and the React Router 6 example app itself ships this shape, so it reads as sanctioned. Silent: only that event goes to a username person. Pageviews, autocapture and replay stay on the anonymous id and are never merged.
- **App middleware intercepts the proxy path.** The agent adds rewrites without reading the existing i18n or auth middleware, whose matcher runs before the rewrites. Static assets still load, so PostHog looks initialized. Silent: POST /ingest/s gets a 307 to /en/ingest/s, then a 404, so events, flags and replay all drop. Tracked in [PostHog/wizard#62](https://github.com/PostHog/wizard/issues/62), [PostHog/posthog.com#17784](https://github.com/PostHog/posthog.com/pull/17784).
- **Full OpenTelemetry SDK pulled in for logs.** Generic OTel tutorials start a full NodeSDK, so the agent does that even when it only needs a log exporter. About 30 extra packages (35 MB) and global tracer and meter providers pointing at default OTLP endpoints. Tracked in [PostHog/wizard#1330](https://github.com/PostHog/wizard/issues/1330), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390).
- **Unused server client scaffolded from the example.** The agent copies the SSR example's file layout and creates a server client even when no API route captures anything. The astro-ssr and astro-hybrid commandments say to create the singleton and do not say to skip it when nothing uses it. Dead code, an empty committed file and an unused posthog-node dependency. Tracked in [PostHog/wizard-workbench#2393](https://github.com/PostHog/wizard-workbench/pull/2393), [PostHog/wizard-workbench#2963](https://github.com/PostHog/wizard-workbench/pull/2963).
- **Flag guard placed in a shared function.** The agent puts the flag check where it is easiest, in an existing controller method that serves an unrelated route, without tracing what else reaches it. False, missing or unavailable flags break an existing view: in one test app the Completed filter stopped rendering its list (9 route assertions failed across false, missing and outage modes). Tasks stayed saved. The route contents were wrong.
- **Success event fires before the server confirms.** The submit handler is the obvious place for a 'completed' event, so the agent captures at the top before awaiting the response. The happy-path test passes. Silent: rejected or failed requests still count as signups or purchases in funnels. Tracked in [PostHog/context-mill#388](https://github.com/PostHog/context-mill/pull/388).
- **Audit flags typed event wrappers as dynamic.** A rule that says 'no variable event names' is easy to apply literally. A variable limited to a string-literal union or constant registry is bounded, but it looks the same as interpolation. False error findings on safe typed wrappers, which change from run to run. Tracked in [PostHog/wizard#736](https://github.com/PostHog/wizard/issues/736), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314).
- **Every server event creates or updates a person.** Backend SDKs process a person profile on every capture with a distinct id, and attach runtime metadata ($os, $lib) that overwrites what the browser set. The agent leaves the flag off on system events. The obvious fix of disabling person processing everywhere over-corrects and strips signup and subscription too. Person properties overwritten (a Linux server rewrites a macOS user's $os) and every event billed as identified. Over-correction leaves no person profiles. Tracked in [PostHog/context-mill#388](https://github.com/PostHog/context-mill/pull/388), [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372).
- **Expected failures captured as exceptions.** Asked to add error tracking, an agent wraps every catch in captureException. Nothing tells it that validation errors, 4xx responses and cancellations are normal outcomes, not bugs. Noise and cost. A validation catch that fires tens of thousands of times a week from a few thousand users buries real issues. Tracked in [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407).
- **Exceptions captured as strings or dynamic messages.** captureException accepts a string and capture('$exception') looks equivalent, so an agent writes whatever compiles. The grouping cost of ids in messages and dropped causes never shows up locally. Issues do not group, fingerprints fragment, and root causes are lost. Tracked in [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407).
- **Errors sent as product events.** Told to track failures, the agent reaches for capture() with an error property because it already uses capture() for everything else. Stack traces land in product analytics instead of error tracking, and events carry unbounded text. Tracked in [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407).
- **Log levels misused and debug logs exported.** When asked to add logs, an agent adds more logging everywhere. It logs expected outcomes at ERROR, logs before a rethrow, and leaves debug export on. Every line looks harmless alone. Log volume and cost explode and real errors get buried. In one run a logs task added posthogLogs.info() after every capture. Tracked in [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407), [PostHog/wizard#1330](https://github.com/PostHog/wizard/issues/1330).
- **Go identify faked with a $identify capture.** The Go commandments mention $set but name no identify API, so the agent builds one from a Capture message with a literal event name. A fake event named $identify goes out instead of the SDK's identify path, and person properties may not apply. Tracked in [PostHog/context-mill#352](https://github.com/PostHog/context-mill/pull/352), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270).
- **Private SDK method patched by its source name.** The agent reads the unminified SDK source, patches a private method, and the unit test passes. The production bundle renames the method. The patch never runs in the browser bundle. In one test app, valid flag responses arrived but the UI stayed disabled.
- **Insight update called with short\_id.** The tool schema documents short\_id as valid, so an agent fixing a rejected insight uses it, or invents insight\_id. At runtime only the numeric id works. Updates are rejected. One run failed a batch of 5 calls. Tracked in [PostHog/posthog#68944](https://github.com/PostHog/posthog/issues/68944).
