---
type: ai-observability
flow: integration-v2
label: Add AI Observability
model_pi: openai/gpt-5.6-terra
effort_pi: high
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [capture]
optional: true
---

## Goal

Add AI Observability to the LLM calls this project already makes. Read the
upstream handoffs and inspect the call sites, not just the dependency names.
If there are no LLM calls, complete as `not needed` with the reason and make no
changes. Do not install a vendor SDK, add a demo call, or use manual capture to
invent an AI feature in an app that has none.

Where a web app or other application sits beside an MCP server (the detected facts
name any MCP server), the app's LLM calls are your target. Workers, queues and shared packages belong to the app. Trace
every caller, because a background job makes as many calls as a request does. Leave a
separately run MCP server's files alone, and name any LLM calls you find there in your
handoff so the report can point them out. If the MCP server is the whole project, it is
your target.

Instrument what runs in production. Developer tooling that calls an LLM, such as
benchmarks, evals and model comparison scripts, stays as it is even when it shares a
module with the app: no edits and no env files for it, and name it in your handoff.

For existing LLM calls, load the `ai-observability` skill menu and install the
variant matching the calling code's language and provider or agent framework.
Follow that skill's selection rules and instrumentation references. Manual
capture is appropriate only for existing calls without a supported wrapper. Never replace the
client or SDK the app already calls to make a wrapper fit, because that changes the requests it
sends: a call on a provider's own SDK with no wrapper for that SDK gets manual capture.
Instrument against the provider SDK version the app already uses; never
require, assume, or request an upgrade of the app's own dependencies — if the
wrapper cannot support the app's version, fall back to manual capture or
report why. Reuse the PostHog client and identity established earlier in this
run. Where there is no server client to reuse, create one without
`enableExceptionAutocapture`, even where the general rules ask for it: `error-tracking`
owns exception capture, and this option keeps an unhandled rejection from ending any
process that loads your code. An LLM call that succeeded must never fail or stall because
PostHog is down: add no flush the call waits on unless the general rules for that runtime
require one, and then write it the way they say. A long-running process flushes in the app's
existing shutdown path. Follow the skill's privacy-mode instructions: default new SDK clients to
`privacy_mode=False` (Python) or `privacyMode: false` (Node), so prompt and
completion content is captured. Preserve existing privacy settings, redaction,
and explicit user or project requirements. Use the variant's documented controls
where capture is configured elsewhere; do not strip manual-capture content by
default. When the code supports several providers, picked at runtime or by config,
instrument every path it has: a wrapper where one fits, manual capture where none
does, installing each variant those paths need. You don't need to know which provider
is active. Complete as `not needed` only when no variant fits any of those paths; this
default run does not ask the user to choose a provider.

This is the instrumentation part of a larger integration. Name the packages
this task needs in your handoff for review to install, and list each one in the
handoff's `packages` field; do not edit dependency
manifests, and never write a version number you invented — the package manager
resolves real versions when review installs by name. Defer the skill's
package-manager and import-check commands to that task. For Go, review adds the
modules with `go get` and `go mod tidy`; do not hand-edit `go.mod` or `go.sum`.
Do not run the app or make paid LLM calls. Use `check_env_keys` and
`set_env_values` for environment files, using the project credentials supplied
by the wizard.

## How you know you succeeded

Existing LLM calls are wired using the selected skill, or the handoff clearly
explains why this task was not needed. List the variant, changed files, declared
dependencies, and a concrete call path the user can trigger to verify the
session/trace/generation tree. Include the skill's **Privacy mode** handoff:
the effective setting, the file and line to edit, when to enable it, and the
[privacy-mode docs](https://posthog.com/docs/ai-observability/privacy-mode). Pass any
deferred dependency work to review.
Describe delivery as unverified unless this run actually observed it; do not
publish a separate setup report.
