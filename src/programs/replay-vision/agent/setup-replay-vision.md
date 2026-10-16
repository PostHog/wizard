---
type: setup-replay-vision
flow: replay-vision
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan a Replay vision setup and seed the task queue. A scanner is an LLM that
watches one session recording at a time and writes an observation — a score, a
tag, or a summary — and every observation lands as a queryable PostHog event.
Scanners only see what session replay records, so the plan has two halves:
make sure recordings flow, then create scanners tailored to this product.

First, establish one fact from the repo: **is PostHog already integrated?**
Look for `posthog-js` or a server SDK in the dependency manifests, or a
`posthog.init(...)` / snippet in the source. Check the project state for
existing events if the repo is ambiguous.

Then seed one of two graphs:

**PostHog is already integrated** — the common case:

- `enable-replay`, with no dependencies.
- The three scanner tasks — `scanner-broken-experiences`,
  `scanner-user-frustration`, `scanner-session-summaries` — each after
  `enable-replay`, independent of one another, so they run in parallel.
- `report`, after all three scanner tasks. It writes the handoff last, so it
  describes what actually shipped.

**PostHog is not integrated** — do not stop, integrate:

- `install` and `init`, independent of each other.
- `enable-replay`, after `install` and `init`.
- The three scanner tasks and `report`, wired exactly as above.

Never plan an identify, capture, or dashboard task — this run sets up Replay
vision, not the full integration. The minimal SDK footprint that `install` and
`init` leave behind is enough for recordings to flow.

## How you know you succeeded

Every task in the chosen graph is queued with that dependency shape, the
report last, and the first task runnable. Keep labels short — the action in a
few words.
