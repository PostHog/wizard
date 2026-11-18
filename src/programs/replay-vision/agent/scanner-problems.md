---
type: scanner-problems
flow: replay-vision
label: Problems scanner
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-scanners-core, replay-vision-scanner-problems]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [enable-replay]
---

## Goal

Create the problems monitor: the product breaking for the user, or the user
getting stuck, named and written for this product. The brief, the locked
scaffold, and the create/re-run mechanics are in your skills — you fill the
blanks from the repo:

- **`name`** — what it watches, in this product's own words.
- **`query` and `sampling_rate`** — from the project's volume tier. A small
  project gets no filters, so every session can be watched. A busy one gets
  a `visited_page` scope on the key completion flow, written as the pages
  appear in real recordings.
- **`{{WATCH_FOR}}`** — the concrete problems a user of this product can hit,
  on screen, in the product's vocabulary.
- **`{{PRODUCT_CONTEXT}}`** — one plain factual sentence.

If the enable-replay handoff says this product has no web surface and no
recorded web sessions at all, skip creation and say why — that is a correct
outcome.

## How you know you succeeded

The scanner exists in PostHog with its tier's query and sampling rate, and a
query that matches real sessions when the project records any — or your
handoff says exactly why it was skipped or deferred.
