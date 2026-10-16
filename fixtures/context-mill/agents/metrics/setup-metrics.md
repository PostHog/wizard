---
type: setup-metrics
flow: metrics
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Glob, Grep]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan an application-metrics setup and seed the task queue. Metrics are a
per-service concern: every service gets its own SDK install and its own
`service_name`.

First map the repo — mechanically, before any judgment. Run one `find` per
manifest pattern across the whole tree, every time, even when the root looks
like a plain npm workspace (repos mix ecosystems, and the workspace list in a
root manifest is not the whole map):

    **/package.json  **/pyproject.toml  **/requirements.txt  **/Pipfile
    **/go.mod  **/composer.json  **/Gemfile

Every directory holding a hit is a package. Classify each: a **service** runs
server-side work (server entrypoints, workers, APIs — whatever the language);
browser-only apps and libraries are not services and get no chain (the report
notes them). Ignore installed-dependency and scaffolding directories
(`node_modules`, `.claude`, caches) — they are not packages.

Then seed, per service:

- `verify-sdk`, with no dependencies — it settles that service's SDK question
  (installed, new enough, initialized for metrics) before any
  instrumentation. Pass `inputs: { package: "<path>", service_name: "<name>" }`
  so the task knows which package it owns; omit `package` in a single-package
  repo.
- `instrument-metrics`, after that service's `verify-sdk`, with the same
  inputs.

Chains for different services are independent — do not wire edges between
them, so they run in parallel. Last, one `report` that depends on every
`instrument-metrics`. It writes the handoff last, so it describes what
actually shipped.

Metrics ride each service's existing PostHog SDK (`posthog.metrics`), so the
graph is the same whether or not the repo has PostHog today — `verify-sdk`
absorbs the difference. Never plan an identify, capture, or dashboard task:
this run sets up application metrics, not the full integration.

## How you know you succeeded

Every service has its own verify → instrument chain carrying its package and
service name, the chains share no edges, the report depends on all of them,
and every `verify-sdk` is runnable. Keep labels short — the action in a few
words, naming the service when there are several.
