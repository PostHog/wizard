---
type: dashboard
flow: integration-v2
label: Create a starter dashboard
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-dashboard, integration-v2-insight, integration-v2-mcp]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [capture]
---

## Goal

Create a starter PostHog dashboard with a few insights built on the events this
integration instruments, using the PostHog MCP.

## How you know you succeeded

A dashboard exists with a handful of insights on the captured events, and you hand
off its URL for the report to link.
