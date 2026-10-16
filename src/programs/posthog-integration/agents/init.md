---
type: init
flow: integration-v2
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

Initialize PostHog: create the framework's init point so the SDK is configured
once and available across the app, set the PostHog environment variables through
the wizard tools, and document those keys in `.env.example` for other developers.

Try to follow these principles, in order: codebase convention, don't make any
unnecessary changes, keep the change as lean as possible for an easy review, and
follow the shape of the examples provided. How call sites reach the client is
part of the shape: reach it the way the docs and the example project reach it.

## How you know you succeeded

The init file exists and the PostHog env keys are present. Keys live in the env
file, never hardcoded in source, and `.env.example` lists the key names (with
placeholder values) so the next developer knows what to set. Your handoff names the
files you changed, how the client is constructed in them, and how a call site
reaches that client — every step after you has to reach the same one the same way.
If the app ships a Content-Security-Policy, the handoff also names exactly
which directives you touched (`script-src`, `connect-src`, `worker-src`) and
which you left alone — the review verifies directive-by-directive, and an
unnamed directive reads as unhandled, not as fine.

You do not run builds, linters, or tests — the review task verifies the whole integration after you; your edits just need to be right by reading.
