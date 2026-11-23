---
type: plan-spend-audit
flow: spend-audit
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [spend-audit-queries]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan a spend audit of this PostHog project and seed the task queue. The audit
measures what the project sends to PostHog, finds the volume that buys nothing,
fixes what lives in code through a pull request, and lists what lives in
PostHog settings in a notebook the user acts on. It never changes a project or
billing setting itself.

First settle two facts, mechanically:

1. **Is this repository the one that sends the data?** Grep for the PostHog
   SDK (`posthog.init`, `new PostHog(`, `Posthog(`, `posthog-js`,
   `posthog-node`, `posthog-python`, and the mobile SDK names) and for the
   project's public token from your project context. Code checks only make
   sense when the SDK is here. A repository without the SDK still gets the
   data-side audit; the report says the code side was skipped.
2. **Which products carry volume?** Run the presence queries from the queries
   skill once: events in the last 30 days, replay sessions, `$exception`
   events, `$feature_flag_called` events, `$groupidentify` events, and the
   group type mappings. A product with no rows gets no audit task.

Then seed, in this order:

- `measure-volumes`, with no dependencies. It runs the shared 30-day
  measurements once so no audit task repeats them.
- One `audit-<area>` per product with volume, each depending on
  `measure-volumes`: `audit-identify` and `audit-events` whenever there are
  events at all, `audit-flags`, `audit-errors` and `audit-replay` only when
  their presence query returned rows, `audit-groups` when group types are
  defined or `$groupidentify` returned rows. Pass
  `inputs: { code_connected: true | false }` to each so it knows whether to scan
  the source tree.
- `apply-code-fixes`, after every `audit-*` task, only when the SDK is in this
  repository. Without it there is nothing to edit and no pull request.
- `value-insights`, after `audit-events` and `audit-groups` (whichever were
  queued). It turns the value findings into insights.
- Last, one `report` that depends on every task above. It writes the notebook,
  the pull request body and the result file, so it runs when everything else is
  settled.

Audit tasks for different areas share no edges, so they run in parallel.

## How you know you succeeded

The queue holds `measure-volumes`, one audit task per product that actually has
volume (for groups, group types defined), `apply-code-fixes` only when the SDK
is here, `value-insights`, and a `report` that waits for all of them. Every task label is the action in a few
words. Nothing was created in PostHog and no file was edited.
