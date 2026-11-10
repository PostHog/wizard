---
type: enable-support
flow: support
label: Turn on Support in PostHog
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-mcp]
allowedTools: [Read, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: []
---

## Goal

Turn Support on for this PostHog project. Call `products-enable` through
`exec`: run `info products-enable`, then
`call products-enable {"products": ["conversations"]}`. It is idempotent and
server-owned. `"enabled"` and `"already_enabled"` both count as success.
Enabling Support also mints the widget's public token.

The in-app widget itself stays off after this call, and no tool here turns it
on. Do not search for one under other names. Record it as a follow-up for the
report: the user turns on "In-app widget" in Support settings and sets its
allowed domains.

- **Tool missing**: if `info` says `products-enable` is unknown, run one
  `search enable` to confirm, then record a follow-up to click "Enable
  support" in Support settings. Continue.
- **Permission rejection**: record a follow-up to enable Support from a
  project-admin account. Continue. The code changes in this run still apply
  and start working once Support is on.

## How you know you succeeded

Your handoff states the Support setting (`enabled`, `already_enabled`, or not
enabled and why) and lists the follow-ups for the report. Never hand off
"enabled" without a successful call.
