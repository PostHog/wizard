---
type: init
flow: feature-flags
label: Set up PostHog initialization
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-init, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep, check_env_keys, set_env_values]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure PostHog is initialized on each side in your `sides` input. An
existing init counts only when the env variable it reads is defined: check it
with `check_env_keys`. When a side's init is complete, leave it alone and
say so. Otherwise create or finish it following your skill, including the
env wiring and `.env.example`. A template-script frontend gets the PostHog
snippet in its base template.

Initialize each SDK so a flag can be evaluated, and stop. Do not evaluate any
flag; the evaluate task owns that.

You do not install packages, run builds, linters, or tests, or start the app.
The install task owns packages, and your edits just need to be right by
reading.

## How you know you succeeded

PostHog initializes from a defined key on every side in `sides`. Your
handoff names, for each side, the init file, the client the evaluate task
should use, and the env variable names (never values).
