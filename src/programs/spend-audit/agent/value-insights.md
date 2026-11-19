---
type: value-insights
flow: spend-audit
label: Create insights for unused events
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-insights]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Turn the audit's value findings into insights and dashboards the user keeps.
Read the `audit-events` and `audit-groups` handoffs and take the findings whose
`kind` is `value`: custom events nothing queries, high-volume events with no
custom properties, group analytics paid for but never aggregated on.

Each insight has to make sense for what the event is, not just count it. Read
the code where the event fires when the handoff names a file, so a start and a
finish event become a funnel, a repeated action becomes a trend by the property
that matters, and events from one feature share a dashboard. The insights
skill carries the known-good query shapes, the naming, the `spend-audit` tag,
and the description every created object starts with.

A value finding never carries a saving. Create nothing for a saving finding.

## How you know you succeeded

Every value finding has at least one insight, each attached to a dashboard,
tagged and described as the skill says. Your handoff lists every dashboard id
and insight id you created with the event and the question it answers, so the
report can embed them and the result file can list them for review.
