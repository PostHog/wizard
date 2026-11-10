---
type: capture
flow: integration-v2
label: Capture events
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-capture, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: [install, init, identify, mcp-analytics]
---

## Goal

Decide which events are worth capturing in this app, then instrument them in the
same pass — read each file once, choose the events, and add the capture calls
while the file is already open. Instrumenting the events is the job; everything
below is a rule you apply while you do it, not work of its own.

The identify step's handoff already says how this app attributes events. Read it
once, up front, and follow it:

1. Where identity is established for you — a client library that remembers it, or a
   framework middleware that binds it per request — a plain capture is already
   attributed. Write the plain call and move on. Do not add a context of your own,
   and do not go looking through the call tree to prove it.
2. Where the handoff says it is not — no middleware, or a call path that runs
   outside the request — tag that call with the distinct id and the session id.

Where the project has no identity to begin with — the identify step found nothing to
wire, because the app has no accounts or login — personless events are the right
answer. Capture plainly, with no id and no placeholder, and say so in your handoff.

The placeholder is for the third case only: identity exists in this project, but no
stable id reaches the call site. Do not guess at the id and do not invent a fallback —
pass `DISTINCT_ID` there so the gap is visible in the code, and say in your handoff
that identity exists but could not be reached, so the report calls it out as an issue
to follow up rather than claiming events that belong to nobody.

Where a web app or other application sits beside an MCP server (the detected facts
name any MCP server), the app is your target: capture its actions. Workers, queues and shared packages belong to the app. Leave a
separately run MCP server's files to the `mcp-analytics` task. If the MCP server is the whole project, it is your target.

Where the `mcp-analytics` handoff says the server now records every tool call as
`$mcp_tool_call`, those calls are already captured, with the tool's name and whether
it failed: add no event that only records that a tool ran or returned. An event
inside a tool has to carry something `$mcp_tool_call` does not — what the tool
produced or changed, in properties that vary from call to call. Where no tool has
such an outcome, add no events for them. Where that task was not needed or never
ran, instrument tool calls like any other action.

Never put PII in an event. When new information about the user surfaces, tag the
user the way the identify docs describe, not the event.

## How you know you succeeded

The meaningful user actions across the app have capture calls that fire on the
real action, not on page load, each one attributable to the user who took it, and
`.posthog-wizard-cache/.posthog-events.json` lists the events you instrumented. Only
where the MCP server is the whole project and `$mcp_tool_call` already covers every
action is no events the right result: leave that list empty and say why in your
handoff.

You do not run builds, linters, or tests — the review task verifies the whole integration after you; your edits just need to be right by reading.
