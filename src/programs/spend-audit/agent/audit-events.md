---
type: audit-events
flow: spend-audit
label: Audit event capture and autocapture
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-events]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Find event volume that buys nothing and events that nobody looks at. Use the volumes from the `measure-volumes` handoff: autocapture, `$pageview`, `$pageleave`, heatmap and `$feature_flag_called` share of total; events from development or staging hosts; custom events no insight, dashboard, cohort or experiment references; high-volume events with no custom properties. Scan the source tree for `capture()` sites and the init config when your input says the code is connected. Unused and property-less events are value findings for `value-insights`, never a removal.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
