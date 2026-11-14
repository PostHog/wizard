---
type: scanner-session-summaries
flow: replay-vision
label: Session summaries scanner
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-scanners-core, replay-vision-scanner-session-summaries]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [enable-replay]
---

## Goal

Create the summary scanner: plain-language session summaries in this
product's own vocabulary, so the user sees the breadth of what scanners
produce. The brief, the locked scaffold, and the create/re-run
mechanics are in your skills — you fill the blanks from the repo:

- **`name`** — in this product's own words.
- **`{{VOCABULARY}}`** — the nouns and verbs this product's UI uses for its
  key flows, so summaries read like the product.
- **`{{PRODUCT_CONTEXT}}`** — one plain factual sentence.

It has no query scope. Its sampling rate comes from the project's volume
tier in `replay-vision-scanners-core` — never raise it beyond that.

If the enable-replay handoff says this product has no web surface and no
recorded web sessions at all, skip creation and say why — that is a correct
outcome.

## How you know you succeeded

The scanner exists in PostHog at its tier's sampling rate, or your handoff
says exactly why it was skipped or deferred.
