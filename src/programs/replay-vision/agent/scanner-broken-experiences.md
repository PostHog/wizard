---
type: scanner-broken-experiences
flow: replay-vision
label: Breakage scanner
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-scanners-core, replay-vision-scanner-broken-experiences]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [enable-replay]
---

## Goal

Create the breakage monitor: the product visibly breaking, on the flow where
breaking costs the most — named and written for this product. The brief, the
locked scaffold, and the create/re-run mechanics are in your skills — you
fill the blanks from the repo:

- **`name`** — what it watches, in this product's own words.
- **`query`** — this product's key completion flow plus its immediate
  predecessors. Checkout, signup, booking, publish — whatever this product's
  "done" is. Read router files and page/route directories to find the real
  paths; never guess at `/checkout` if this app calls it `/booking`.
- **`{{WATCH_FOR}}`** — the concrete failure modes of this flow, on screen,
  in the product's vocabulary.
- **`{{PRODUCT_CONTEXT}}`** — one plain factual sentence.

If there is no identifiable completion flow, don't invent one — fall back to
the handful of highest-traffic paths and record in your handoff that you
couldn't identify a completion flow. If the enable-replay handoff says this
product has no web surface, skip creation entirely and say why — that is a
correct outcome.

## How you know you succeeded

The scanner exists in PostHog scoped to this product's real completion flow,
or your handoff says exactly why it was skipped or deferred.
