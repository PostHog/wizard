---
type: init
flow: replay-vision
label: Set up PostHog initialization
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-init, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure PostHog is initialized. If the project already has a working
`posthog.init(...)` (or the framework's equivalent) with its env keys wired,
leave it alone and say so in your handoff. If it doesn't, create it following
your skill — it owns the how: the framework's init point, the env-var wiring
through the wizard tools, and `.env.example`.

You only exist in this flow because the user asked for Replay vision on a
repo without PostHog. Initialize the SDK so recordings can flow and stop —
no instrumentation, no extras. Don't touch session-recording options either
way; the enable-replay task after you owns those.

## How you know you succeeded

An init point exists with the PostHog env keys present — whether it already
did or you just created it — keys in the env file, never hardcoded. Your
handoff names the files involved and how the client is constructed, so the
enable-replay task can find the init options without re-discovering them.
