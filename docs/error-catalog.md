# Wizard error catalog

The wizard runs headless inside cloud sandboxes where the host cannot see why a
run died. The error catalog gives every terminal failure a stable,
machine-readable code so the backend, the web UI, and sandbox supervisors can
classify failures without parsing human-readable messages.

- **Source of truth for codes:**
  [`src/lib/errors/codes.ts`](../src/lib/errors/codes.ts)
- **Source of truth for metadata (group, retry advice, description):**
  [`src/lib/errors/catalog.ts`](../src/lib/errors/catalog.ts)
- **Consumers:** `wizardAbort()`
  ([`src/utils/wizard-abort.ts`](../src/utils/wizard-abort.ts)), the task stream
  ([`src/lib/task-stream/`](../src/lib/task-stream/)), and non-interactive hosts
  reading stderr.

## Stability contract

Codes are **append-only and never renamed**. A code's meaning may be refined,
but a released code must keep matching its documented failure. Treat the string
as an API: backends may branch on it.

New codes follow the pattern `PHW_<GROUP>_<NAME>` (see `ERROR_CODE_PATTERN` in
`codes.ts`). Groups are lowercase module prefixes (`cli`, `args`, `auth`, `env`,
`detect`, `skill`, `agent`, `settings`, `internal`).

## How codes propagate

1. **`wizardAbort({ code, detail, ... })`** — the single exit funnel resolves a
   code (explicit `code` first, then `WizardError.code`), stamps it onto
   `OutroData` (`errorCode`, `errorDetail`), tags the captured exception with
   `error_code` in analytics, and — when the active UI is a
   `LoggingUI`/`HeadlessUI` — prints one machine-readable line to stderr just
   before exit:

   ```
   phw-error: {"code":"PHW_DETECT_NO_FRAMEWORK","message":"Could not auto-detect your framework for this project.","detail":{"reason":"no matches"}}
   ```

   Sandboxes should scrape the last `phw-error:` line on stderr. It is the only
   machine-readable channel that works even when the task stream itself is down.

2. **Task stream** — `OutroData.errorCode`/`errorDetail` flow into the `error`
   object of every run-state push (`TaskStreamError.code`,
   `TaskStreamError.detail`), so the PostHog backend receives the code with the
   terminal `RunPhase.Error` snapshot.
3. **Analytics** — `analytics.captureException` receives `error_code` for every
   aborted run that carries a code.
4. **TUI** — `OutroData.errorCode` is available to error screens for display;
   the interactive UX remains message-first.

`WizardError(message, context, code)` carries the code alongside its telemetry
context. Codes are also emitted at raw `process.exit` sites that run before the
abort funnel exists (CLI arg validation, Node version preflight, yargs failures)
via `emitPhwError()`.

`errorDetail` is allowlisted (`reason`, `detected`, `platform`) at both egress
boundaries — the `phw-error:` stderr line and the task-stream push — so fields
like filesystem paths never reach remote telemetry. Local surfaces (TUI error
screen, debug log) keep the full detail.

## Catalog

| Code                                           | Group    | Fires when                                                                                                                                                                                                   | Retry        |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `PHW_CLI_NODE_VERSION`                         | cli      | Node runtime below the supported range (preflight in `bin.ts`)                                                                                                                                               | no           |
| `PHW_CLI_BAD_ARGS`                             | cli      | yargs strict-mode rejection (unknown command/option)                                                                                                                                                         | no           |
| `PHW_CLI_FLAG_UNAVAILABLE`                     | cli      | dev-only flag (`--ci`, `--harness`, `--local-*`, …) in a published build                                                                                                                                     | no           |
| `PHW_CLI_INTERACTIVE_REQUIRED`                 | cli      | command needs an interactive terminal and has no non-interactive fallback                                                                                                                                    | no           |
| `PHW_ARGS_MISSING_API_KEY`                     | args     | non-interactive run without `--api-key`                                                                                                                                                                      | no           |
| `PHW_ARGS_MISSING_INSTALL_DIR`                 | args     | non-interactive run without `--install-dir`                                                                                                                                                                  | no           |
| `PHW_ARGS_MISSING_EMAIL`                       | args     | `--signup` without `--email`                                                                                                                                                                                 | no           |
| `PHW_ARGS_SIGNUP_PROVISION_FAILED`             | args     | account provisioning failed during signup install                                                                                                                                                            | yes          |
| `PHW_AUTH_KEY_TYPE`                            | auth     | key with the wrong type/prefix for the mode (`phc_` project key, unknown prefix)                                                                                                                             | no           |
| `PHW_AUTH_MISSING_SCOPE`                       | auth     | key or OAuth grant lacks a required scope                                                                                                                                                                    | no           |
| `PHW_AUTH_REGION_MISMATCH`                     | auth     | resolved gateway region disagrees with the session region                                                                                                                                                    | no           |
| `PHW_AUTH_INVALID_OR_EXPIRED`                  | auth     | gateway rejected an otherwise well-formed credential                                                                                                                                                         | no           |
| `PHW_AUTH_SETTINGS_CONFLICT`                   | auth     | Claude settings file overrides the gateway credential                                                                                                                                                        | no           |
| `PHW_AUTH_STORED_LOGIN_CONFLICT`               | auth     | SDK authenticated from a stored Claude login instead of the gateway token                                                                                                                                    | no           |
| `PHW_AUTH_PROJECT_FETCH_FAILED`                | auth     | user/project data fetch from the PostHog API failed                                                                                                                                                          | yes          |
| `PHW_ENV_LOCAL_SERVICES_DOWN`                  | env      | a local dev target (`--local-*`) is not running                                                                                                                                                              | yes          |
| `PHW_ENV_SERVICE_OUTAGE`                       | env      | blocking external services down (interactive abort; non-interactive continues)                                                                                                                               | yes          |
| `PHW_DETECT_BAD_DIRECTORY`                     | detect   | install dir missing, not a directory, or unreadable                                                                                                                                                          | no           |
| `PHW_DETECT_NO_FRAMEWORK`                      | detect   | framework auto-detection found nothing (`ciPreRun` headless abort)                                                                                                                                           | no           |
| `PHW_DETECT_UNSUPPORTED_VERSION`               | detect   | detected framework version below the supported minimum                                                                                                                                                       | no           |
| `PHW_DETECT_UNSUPPORTED_PLATFORM`              | detect   | platform has no matching skill variant (e.g. replay vision on backend-only)                                                                                                                                  | no           |
| `PHW_DETECT_NO_POSTHOG_SDK`                    | detect   | program requires an installed PostHog SDK; none found                                                                                                                                                        | no           |
| `PHW_DETECT_NO_PROJECT_FILES`                  | detect   | no project files for the program to work on                                                                                                                                                                  | no           |
| `PHW_DETECT_NO_SOURCES`                        | detect   | no data warehouse sources detected                                                                                                                                                                           | no           |
| `PHW_DETECT_NO_PACKAGE_JSON`                   | detect   | no `package.json` anywhere in the project to scan                                                                                                                                                            | no           |
| `PHW_DETECT_NO_SDKS`                           | detect   | none of the SDKs the program needs are installed                                                                                                                                                             | no           |
| `PHW_DETECT_MISSING_STRIPE`                    | detect   | revenue analytics found PostHog but no Stripe SDK                                                                                                                                                            | no           |
| `PHW_DETECT_UNCLASSIFIED`                      | detect   | detect step failed with a `kind` this catalog has no code for                                                                                                                                                | no           |
| `PHW_SKILL_MENU_FETCH_FAILED`                  | skill    | context-mill menu fetch failed                                                                                                                                                                               | yes          |
| `PHW_SKILL_NOT_FOUND`                          | skill    | skill id absent from the context-mill menu                                                                                                                                                                   | no           |
| `PHW_SKILL_DOWNLOAD_FAILED`                    | skill    | skill download/extraction failed                                                                                                                                                                             | yes          |
| `PHW_AGENT_ABORT`                              | agent    | agent emitted `[ABORT] <reason>`; `detail.reason` carries the raw signal. A matched `abortCases` entry may override with a specific code (e.g. audit's "no posthog sdk found" → `PHW_DETECT_NO_POSTHOG_SDK`) | case-by-case |
| `PHW_AGENT_MCP_MISSING`                        | agent    | `[ERROR-MCP-MISSING]` — PostHog MCP server unreachable                                                                                                                                                       | yes          |
| `PHW_AGENT_RESOURCE_MISSING`                   | agent    | `[ERROR-RESOURCE-MISSING]` — setup resource unavailable                                                                                                                                                      | yes          |
| `PHW_AGENT_RATE_LIMIT`                         | agent    | LLM gateway rate limit                                                                                                                                                                                       | yes          |
| `PHW_AGENT_API_ERROR`                          | agent    | other API failure during the agent run                                                                                                                                                                       | yes          |
| `PHW_AGENT_YARA_VIOLATION`                     | agent    | security scanner terminated the run                                                                                                                                                                          | no           |
| `PHW_AGENT_NO_PROGRESS`                        | agent    | agent ended with zero tool calls                                                                                                                                                                             | case-by-case |
| `PHW_AGENT_INCOMPLETE_TASKS`                   | agent    | agent stopped with planned tasks open                                                                                                                                                                        | case-by-case |
| `PHW_AGENT_ORCHESTRATOR_SKILL_VARIANT_MISSING` | agent    | orchestrator preflight could not download a task skill variant                                                                                                                                               | yes          |
| `PHW_AGENT_ORCHESTRATOR_TASKS_FAILED`          | agent    | orchestrator queue drained with failed/blocked required tasks                                                                                                                                                | case-by-case |
| `PHW_AGENT_ORCHESTRATOR_SINK_INVARIANT`        | agent    | orchestrator plan violates sink coverage invariant                                                                                                                                                           | no           |
| `PHW_SETTINGS_UNFIXABLE_CONFLICT`              | settings | Claude settings conflict that cannot be auto-neutralized (managed/unwritable)                                                                                                                                | no           |
| `PHW_INTERNAL_UNHANDLED`                       | internal | catch-all: an unexpected error escaped the pipeline                                                                                                                                                          | yes          |

Retry advice is guidance for automated hosts (sandbox re-run policies), not a
guarantee.

## Detection error mapping

Program detect steps write `{ kind, ...detail }` into
`session.frameworkContext.detectError`. `detectErrorCode()`
([`src/lib/errors/detect-map.ts`](../src/lib/errors/detect-map.ts)) maps `kind`
→ code, and the whole object — `kind` included — rides along as
`OutroData.errorDetail`.

`DETECT_CODES` is keyed on `DetectErrorKind`, a union assembled from the
programs' own `DetectError` types via type-only imports. Adding a kind to any
program's union breaks the build until it gets a code, so the map cannot fall
behind (same guarantee `AGENT_ERROR_CODE` gets from keying on `AgentErrorType`).

Two rules make the detect group safe for automated retry policy:

- **Codes may be shared, `kind` is not lost.** `no-posthog-sdk`, `no-posthog`,
  and `missing-posthog` all resolve to `PHW_DETECT_NO_POSTHOG_SDK` — one failure
  class, one code. Hosts that need to tell the programs apart read
  `detail.kind`.
- **The fallback stays inside the group.** An unrecognized `kind` resolves to
  `PHW_DETECT_UNCLASSIFIED` (`retry: 'no'`), never to `PHW_INTERNAL_UNHANDLED`
  (`retry: 'yes'`). A detect failure is a property of the user's project;
  advising a sandbox to retry one costs it the whole budget for nothing.

## Auth classification

Gateway 401s are classified at the abort site by `classifyAuthFailure()`
([`src/lib/errors/auth.ts`](../src/lib/errors/auth.ts)) with priority:
stored-login conflict → settings conflict → key-type → missing scope → region
mismatch → invalid/expired. Inputs are best-effort from the run context; the
classifier degrades to `PHW_AUTH_INVALID_OR_EXPIRED` when no distinguishing
signal is available.

## Sandbox integration recipe

- **Scrape:** read stderr for the final `phw-error:` line; parse the JSON body.
- **Correlate:** the task-stream `error.code` on the terminal push matches the
  stderr code for the same session id.
- **Decide:** use the catalog `retry` column for re-run policy; `no` codes need
  human/config intervention, `yes` codes are safe to retry after backoff.
- **Zero exit without a code** means success or a Ctrl-C style cancel (exit 130
  / user dismissal).

## Extending the catalog

1. Add the code to `ErrorCodes` (`codes.ts`) and an entry to `ERROR_CATALOG`
   (`catalog.ts`) — the unit test enforces catalog completeness.
2. Pass it to `wizardAbort({ code })` or `new WizardError(msg, ctx, code)` at
   the failure site. Prefer explicit `code` over inference so call sites stay
   greppable. For agent-emitted `[ABORT] <reason>` preconditions, declare
   `errorCode` on the program's `abortCases` entry so the generic
   `PHW_AGENT_ABORT` is overridden with the specific class.
3. Add the row here.
