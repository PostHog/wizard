---
type: tracing
flow: integration-v2
label: Add distributed tracing
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [logs]
optional: true
---

## Goal

Configure PostHog distributed tracing for this project's server runtimes. Load the
`tracing` skill menu, install its matching skill, and read the platform reference
before editing. Choose the capture path the skill describes for this runtime. If
the app already uses OpenTelemetry, write against its existing OTel version and
name exporter packages compatible with it — never require, or write code that
assumes, an upgrade of a package this integration did not introduce. A
browser-only app gets no tracing. If no documented setup applies, complete as
`not needed` and explain why.

Where a web app or other application sits beside an MCP server (the detected facts
name any MCP server), the app is your target, and MCP analytics owns the MCP server.
Workers, queues and shared packages belong to the app. Leave a separately run MCP
server's files alone. If the MCP server is the whole project, it is your target.

This run cannot ask questions, so where the skill says to ask, decide as follows:

- If the app already exports traces to another tracing backend, do not add PostHog
  as a second destination. Complete as `not needed`, name the backend, and give the
  user the exporter change that would add PostHog beside it.
- If the app already exports OpenTelemetry traces to PostHog, report that without
  adding a second exporter.
- If the setup needs a new launch command (such as `opentelemetry-instrument` or a
  Java agent flag), do not change how the app starts. Use a code-based setup the
  platform reference documents, or skip with that reason.

Preserve any tracer provider AIO or Logs configured in earlier steps. Reuse it and
add a separate span processor with its own exporter to `/i/v1/traces`; never repoint
an exporter another step set up, and never send spans to `/i/v0/ai/otel`. Set a
service name. Do not put secrets, tokens, request bodies, or user data in span
names or attributes, and add manual spans only where the skill says auto
instrumentation has no coverage.

Never wait on span export before the app starts serving, because a slow PostHog
host would hold up its boot. Let the batch processor export on its interval, and
flush only at shutdown, or at the end of each invocation where the skill says a
short-lived or serverless handler needs it.

This is the instrumentation part of a larger integration. Instead of the
standalone skill's install command, name the required packages in your handoff,
list each one in the handoff's `packages` field,
and leave installation, manifest and lockfile updates, builds, and lint to
review. Do not run `opentelemetry-bootstrap` or any other installer. Do not edit
dependency manifests or write a version number you invented — the package manager
resolves real versions when review installs by name. Use `detect_package_manager`
if needed. Use the wizard's supplied project and region and the env names from
upstream handoffs; inspect and write environment files only through
`check_env_keys` and `set_env_values`. Do not request credentials or select a
different project. If required configuration is unavailable, report what is
missing instead of guessing a region.

## How you know you succeeded

Tracing is configured once for the supported runtime, was already present, or has
a clear skip reason. The handoff names the changed files, packages, env variable
names (never values), the service name, and any dependency work for review. Give a
specific request the user can send to produce a trace and where to find it in
PostHog Tracing, filtered by that service name; delivery remains unverified until
observed. Do not publish a separate report.
