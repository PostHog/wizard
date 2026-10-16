---
type: logs
flow: integration-v2
label: Add log capture
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [ai-observability]
optional: true
---

## Goal

Configure PostHog log capture for this project's supported runtimes. Load the
`logs` skill menu, install its matching skill, and read the platform reference
before editing. Inspect the runtime and existing logging setup; use the
documented OTLP exporter or SDK-native log capture for that platform. If the
app already uses OpenTelemetry, write against its existing OTel version and
name exporter packages compatible with it — never require, or write code that
assumes, an upgrade of a package this integration did not introduce. A
browser-only app must not receive a server exporter. If no documented setup
applies, complete as `not needed` and explain why.

Export only log lines this integration adds. Create a dedicated logger for the
PostHog exporter and emit a few purpose-written lines at meaningful points the
app already passes through. Even where the platform reference attaches the
exporter to the application's root or existing loggers, do not — the app's
existing logs are data this run has no mandate to export, and every line that
leaves must be visible in this run's diff. Reuse any existing PostHog log
export and leave all existing handlers and outputs intact; if capture is
already configured, report that without adding a second exporter. Preserve any
tracing provider AIO configured in the previous step. Do not export secrets,
request bodies, or user data, and do not scatter logs through unrelated code.

This is the instrumentation part of a larger integration. Instead of the
standalone skill's install command, name the required packages in your handoff
and leave installation, manifest and lockfile updates, builds, and lint to
review. Do not edit dependency manifests or write a version number you
invented — the package manager resolves real versions when review installs by
name. Use `detect_package_manager` if needed. Use
the wizard's supplied project and region and the env names from upstream
handoffs; inspect and write environment files only through `check_env_keys`
and `set_env_values`. Do not request credentials or select a different project.
If required configuration is unavailable, report what is missing instead of
guessing a region.

## How you know you succeeded

Log capture is configured once for the supported runtime, was already present,
or has a clear skip reason. The handoff names the changed files, packages, env
variable names (never values), and any dependency work for review. Give a
specific code path the user can trigger to produce one of the added log lines
and find it in PostHog Logs; delivery remains unverified until observed. Note
for the report that only lines added by this run are exported, and the one-line
change that routes the app's existing loggers into the same exporter if the
user wants more. Do not publish a separate report.
