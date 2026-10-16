---
type: error-tracking
flow: integration-v2
label: Add error tracking
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-error-tracking-step, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: [install, init]
---

## Goal

Make the errors the app does not catch reach PostHog, by whatever means the SDK
offers for that. Which means depends on the SDK: some autocapture exceptions once
you enable it at init, some wire into the framework's own error handler, some give
you a boundary to mount at the app entry. Follow the docs and the reference example
for this one, and set it up in one place — never manual capture calls sprinkled
across files.

The SDK is already installed and initialized (see the context from previous steps);
build on that, do not re-check it.

This is an instrument-only task. Do not install dependencies, run the build, run
tests, or start the app — a later `build` step does all verification. Stay inside
this project's directory and set up that one place; that is the whole job.

## How you know you succeeded

An error the app does not catch reaches PostHog, through the mechanism this SDK
gives you rather than one you invented. You did not install anything, run a build,
lint, or tests (the review task verifies after you), search outside the project, or read through the whole app or hand-wrap
individual components or routes.
