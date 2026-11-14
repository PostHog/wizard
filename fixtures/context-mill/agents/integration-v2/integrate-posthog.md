---
type: integrate-posthog
flow: integration-v2
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

Plan a PostHog integration and seed the task queue with this graph:

- `install` and `init`, independent of each other.
- `identify` and `error-tracking`, each after `install` and `init` and independent
  of one another, so they run in parallel. `error-tracking` makes the errors the app
  does not catch reach PostHog, by whatever means the SDK offers for that — it needs
  the SDK installed and initialized, not the events.
- `mcp-analytics`, after `identify` — it instruments the project's own MCP server
  so every tool call is captured. Queue it only when `enqueue_task` offers it and
  the detected facts name MCP server candidates; otherwise skip it.
- `capture`, after `identify` — it decides the events and instruments them, and it
  reads how identity is already established before it instruments anything. Make it
  also wait for `mcp-analytics` only when the two share code: the MCP server is the
  whole project, or a route inside the app. There `capture` reads which tool calls
  MCP analytics already records. When the server runs separately from a web app or
  other application, they touch different files, so run them in parallel. If you
  can't tell from the code, make it wait.
- `ai-observability`, after `capture`, parallel to `error-tracking` — it instruments
  existing LLM calls, or reports that none apply. Queue it on every default run; the
  task checks applicability rather than the planner guessing from a package name.
- `logs`, after `ai-observability` — it configures log capture on supported
  platforms, or reports why it does not apply. Queue it even when AIO will be
  skipped. These tasks run sequentially because both instrument the same entry
  and initialization files, and Logs preserves any tracing provider AIO
  configures — an ordering-dependent instruction. (Their dependency installs
  are deferred to review, so manifests are not the conflict.)
- `review`, after `install`, `init`, `identify`, `mcp-analytics`, `capture`,
  `error-tracking`, `ai-observability`, and `logs` —
  it installs the dependencies, verifies the project builds/typechecks/lints, and
  reviews every change the run made, fixing what fails. There is no separate build
  step: verifying and reviewing are one pass over the same changeset.
- `dashboard`, after `capture`, and after `mcp-analytics` when you queued it,
  independent of AIO, Logs, and `review` — it builds insights from the instrumented
  events, which those tasks have already defined; it needs no code review.
- `report`, after `dashboard` **and** `review` — it writes the setup report last, so
  it describes the integration as reviewed rather than as first written.

If `enqueue_task` does not offer a task's type, this run excludes that product
— skip it rather than retrying, and hang nothing off it.

## How you know you succeeded

Every task in the graph is queued with that dependency shape, the report last,
and the first task runnable. Keep labels short — the action in a few words.
