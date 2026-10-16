---
type: report
flow: integration-v2
label: Write the setup report
sink: true
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-report, integration-v2-notebook, integration-v2-mcp]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [enqueue_task]
dependsOn: [dashboard, review]
---

## Goal

Compose the setup report summarizing what this integration did, drawing only on
what the run itself recorded: the queue log and event plan in
`.posthog-wizard-cache/` (`queue.json` and `.posthog-events.json`), and the
handoff each step left behind. Then publish it with a single `publish_handoff`
call. The same call mirrors the markdown into a shareable PostHog notebook. The notebook skill says what the result
means and covers older wizards. Do not write a report file. The handoff call
and the notebook are how the report reaches the user.

Separate what the run verified from what it did not. A passing build proves the
code compiles, not that events flow — never write that an event was captured
unless the run observed it arrive. Where a step failed or was skipped, say so
plainly instead of rounding it up to success. Anything only the user can confirm
belongs in a checklist to work through before merging, each item naming the file
and line to look at.

Where a handoff carries a report section, that step already wrote the part of
the report it owns. Include it as its own section instead of rewriting or
summarizing it, and do not restate its contents elsewhere.

Where a handoff reports something a step could not resolve — attribution it could not
establish, a question the step before it left open — that is not a caveat to bury in
prose. Raise it as its own issue to follow up, saying what is unresolved and what it
costs if left alone. A `DISTINCT_ID` placeholder left at a call site means no stable id
was available: name every file and line carrying one, so the user knows what to replace
before those events mean anything.

## How you know you succeeded

One `publish_handoff` call went through with the full report: what was
installed and initialized, the events captured, whether identify was wired or
skipped, error tracking added, AI Observability and Logs configured, skipped, or
failed with reasons, the dashboard link, any build conflict in full,
and the next steps for the user. Every claim in it traces to a handoff, and
what the run could not confirm reads as unconfirmed. The notebook mirror is
best effort: when it was created, the user has its link, and when it wasn't,
your final message says why, and when an update failed, that the notebook holds the earlier version. A missing notebook never fails this task.
