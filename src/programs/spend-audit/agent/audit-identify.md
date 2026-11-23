---
type: audit-identify
flow: spend-audit
label: Audit identify and person profile calls
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [spend-audit-findings, spend-audit-queries, spend-audit-identify]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Find `$identify`, `$set` and person-profile usage that buys nothing. Two lenses: how often the code identifies (every page load, every request, without an `_isIdentified()` guard, duplicate `$identify` per session) and whether `person_profiles` matches the traffic (mostly anonymous visitors on a project that processes a profile for every event). Read the volumes from the `measure-volumes` handoff; add only the identify-specific queries the identify skill lists. Scan the source tree for identify, reset and init sites when your input says the code is connected.

Every finding follows the findings skill: one record, one output. A saving
carries the measured monthly volume, the expected range after the change, the
query it came from, the tradeoff and the effort. What you cannot measure is an
unpriced finding, never a guessed number. A check that found nothing wrong is a
passed finding, so the report can say so.

## How you know you succeeded

Your handoff carries the findings for this area as the findings skill shapes
them, each with its evidence, and no number you did not measure. The source
tree and the PostHog project are unchanged.
