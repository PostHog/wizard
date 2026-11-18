---
type: scanner-flow-outcome
flow: replay-vision
label: Key flow outcome scanner
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-scanners-core, replay-vision-scanner-flow-outcome]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [enable-replay]
---

## Goal

Create the key flow outcome classifier: one tag per session for how this
product's key flow went — completed, abandoned, blocked by an error,
confused, or not attempted. The brief, the locked scaffold and tags, and the
create/re-run mechanics are in your skills — you fill the blanks from the
repo:

- **`name`** — the flow's outcome, in this product's own words.
- **`{{FLOW}}`** — the key completion flow from start to finish. Read router
  files and page/route directories to find it; never guess at a checkout if
  this app calls it a booking.
- **`query` and `sampling_rate`** — from the project's volume tier.
- **`{{PRODUCT_CONTEXT}}`** — one plain factual sentence.

If the repo shows no completion flow, skip this scanner and say why. If the
enable-replay handoff says this product has no web surface and no recorded
web sessions at all, skip it too. Both are correct outcomes.

## How you know you succeeded

The classifier exists in PostHog with its tier's query and sampling rate,
about a flow the repo actually has — or your handoff says exactly why it was
skipped or deferred.
