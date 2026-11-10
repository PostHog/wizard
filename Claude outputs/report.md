---
type: report
flow: support
label: Write the setup report
sink: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-notebook, integration-v2-mcp]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Compose the setup report from `read_handoffs` only, then publish it with a
single `publish_handoff` call. The same call mirrors the markdown into a
shareable PostHog notebook. Do not write a report file.

Cover, in this order:

- **Support in PostHog**: enabled, already enabled, or not enabled and why.
- **Code changes**: whether the run installed or initialized `posthog-js`,
  removed `disable_conversations`, wired an existing link to
  `posthog.conversations.open()`, or added identification. Name each file.
  When nothing changed, say so.
- **Turn on the widget**: the widget stays off until the user turns on
  "In-app widget" in Support settings. Tell them to set "Allowed domains"
  there too: an empty list shows the widget on every domain.
- **Deploy**: when code changed, the widget only appears after this change
  ships, with any env variables the handoffs name set in production.
- **Connect a channel**: email, Slack, Microsoft Teams or GitHub tickets land
  in the same inbox. Link https://posthog.com/docs/support/email.
- **Follow-ups**: every follow-up a handoff recorded.

Where a step failed or was skipped, say so plainly instead of rounding it up
to success. The run does not check that a ticket reached PostHog, so never
write that one did.

## How you know you succeeded

One `publish_handoff` call went through with the full report. A user who
reads only it knows whether Support is on, what changed in their code, and
the steps left before customers can reach them: turning on the widget,
deploying, and connecting a channel. Every claim traces to a handoff. The
notebook mirror is best effort and a missing notebook never fails this task.
