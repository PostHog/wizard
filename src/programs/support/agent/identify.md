---
type: identify
flow: support
label: Identify users for Support tickets
model_pi: openai/gpt-6.1-terra
effort_pi: medium
model_sdk: claude-sonnet-5-5
effort_sdk: high
skills: [integration-v2-identify, posthog-best-practices]
allowedTools: [Read, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: [widget]
---

## Goal

Make sure the browser identifies logged-in users, so each Support ticket shows
who sent it and support can reply by email.

If the app already calls `posthog.identify(...)` on login or registration and
`posthog.reset()` on logout, leave it alone and say so.

Otherwise wire it following your skill: identify once when the user logs in
or registers, with the app's own stable user id as the distinct id, and pass
`email` and `name` as person properties when the app has them. Reset on
logout. Never use the email as the distinct id unless the app has no other
stable key, and say so if you do.

Only touch browser code. Server-side identification is out of scope for this
run.

You do not run builds, linters, or tests.

## How you know you succeeded

Your handoff names the files you changed, where identify and reset are
called, which person properties are sent, or that identification was already
in place. If the app has no login, say so and stop.
