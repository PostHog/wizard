---
type: scanner-user-frustration
flow: replay-vision
label: User frustration scanner
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-scanners-core, replay-vision-scanner-user-frustration]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [enable-replay]
---

## Goal

Create the frustration monitor: the user getting stuck, named and written
for this product. It is gated on `$rageclick` — cheap and high-precision,
because here the gating event *is* the friction. The brief, the locked
scaffold, and the create/re-run mechanics are in your skills — you fill the
blanks from the repo:

- **`name`** — what it watches, in this product's own words.
- **`{{STUCK_MOMENTS}}`** — where a user of this product realistically gets
  stuck, on screen, in the product's vocabulary.
- **`{{PRODUCT_CONTEXT}}`** — one plain factual sentence.

If the enable-replay handoff says this product has no web surface and no
recorded web sessions at all, skip creation and say why — that is a correct
outcome.

## How you know you succeeded

The scanner exists in PostHog gated on `$rageclick` alone, or your handoff
says exactly why it was skipped or deferred.
