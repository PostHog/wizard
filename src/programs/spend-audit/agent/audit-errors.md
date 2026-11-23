---
type: audit-errors
flow: spend-audit
label: Audit error tracking volume
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-errors]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Find exception volume that a few noisy issues produce. Use the per-issue `$exception` volumes from the `measure-volumes` handoff: the share the top issues hold, exceptions without a stack trace, and exceptions from development hosts. When the code is connected, read the client init for `before_send`, ignore lists and the error tracking config. A client-side filter for the noisy issues is a code fix; suppression rules in PostHog are a setting for the notebook.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
