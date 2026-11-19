---
type: audit-flags
flow: spend-audit
label: Audit feature flag calls
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-flags]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Find feature flag evaluations the project pays for without needing them: `$feature_flag_called` far above the number of sessions, server SDKs that send flags with every capture or evaluate without local evaluation, flag reads inside loops or render paths, short polling intervals, flags that are active in PostHog but never referenced in code. Use the per-flag volumes from the `measure-volumes` handoff and the flags skill for the code patterns and the fixes.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
