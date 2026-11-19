---
type: audit-groups
flow: spend-audit
label: Audit group analytics usage
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-groups]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Decide whether group analytics earns its add-on. Compare `$groupidentify` volume and group-aggregated insights with the code that calls `group()` or `groupIdentify()`. An add-on with calls but no insight that uses groups is a value finding, not a saving: the user already pays, so propose the group view they are missing. An add-on with no calls and no group insights is a billing finding for the notebook. Never propose removing group calls.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
