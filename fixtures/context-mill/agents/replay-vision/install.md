---
type: install
flow: replay-vision
label: Add the PostHog SDK to the manifest
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-haiku-4-5
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure the PostHog SDK is in the manifest. If it's already installed,
leave it alone and say so in your handoff. If it isn't, install it following
your skill — it owns the how: the package manager rules, the version rules,
what counts as an environment failure, and the fallback.

You only exist in this flow because the user asked for Replay vision on a
repo without PostHog. Install the client library (plus the server library if
the app sends events server-side) and stop — no instrumentation, no extras.

## How you know you succeeded

The SDK is declared in the manifest at a real version — whether it already
was or you just installed it — or your handoff plainly says why the
environment stopped you. Your handoff names the manifest and the package, so
later steps import it under the name they will actually get.
