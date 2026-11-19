---
type: audit-replay
flow: spend-audit
label: Audit session replay settings
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-replay]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Find recordings the project pays for but gets no value from. Read the replay settings through `posthog_exec` (sampling, minimum duration, URL and event triggers, linked flag, network payload capture) and the duration distribution and watched share from the `measure-volumes` handoff. Settings live in PostHog, so almost everything here is a notebook finding with the exact value to set; only client-side `session_recording` config in the code is a pull request fix. Never change a setting yourself.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
