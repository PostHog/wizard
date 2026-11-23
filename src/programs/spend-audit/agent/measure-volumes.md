---
type: measure-volumes
flow: spend-audit
label: Measure 30-day volumes
model_pi: openai/gpt-5.6-sol
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-queries]
allowedTools: [Read, posthog_exec]
disallowedTools: [Write, Edit, Bash, Glob, Grep, enqueue_task]
dependsOn: []
---

## Goal

Measure, once, the volumes every later task sizes its savings from. Run the
shared measurement set from the queries skill against the last 30 days: events
by name, anonymous versus identified events, `$identify` and `$groupidentify`
per session, `$feature_flag_called` by flag, `$exception` by issue, recordings
and their duration distribution. Run every measurement in the skill. A product
the project does not use returns zero rows, which is a measurement too; the
seed already decided which audits run.

Record every number under the name the skill gives its query. A later task
cites that name as the evidence for a saving, so a number without it is
useless to it. Do not quote the SQL.

## How you know you succeeded

Your handoff carries one JSON block, shaped as the queries skill describes,
with every measured number keyed by its query name, under 8,000 characters. A
query that failed is listed with its error instead of a guessed number, so
downstream tasks mark that area unmeasured rather than sizing it.
