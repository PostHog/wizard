---
type: install
flow: support
label: Add posthog-js to the manifest
model_pi: openai/gpt-6.1-terra
effort_pi: low
model_sdk: claude-haiku-4-5
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure `posthog-js` is in the frontend's manifest. If it's already there,
leave it alone and say so in your handoff. If it isn't, install it following
your skill. It owns the package manager rules, the version rules, what counts
as an environment failure, and the fallback.

You only exist in this flow because the user asked for Support on a repo
without PostHog in the browser. Install the browser library and stop: no
server SDK, no instrumentation, no extras.

## How you know you succeeded

`posthog-js` is declared in the manifest at a real version, whether it already
was or you just installed it, or your handoff plainly says why the environment
stopped you. Your handoff names the manifest and the version.
