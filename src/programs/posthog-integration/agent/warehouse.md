---
type: warehouse
flow: integration-v2
label: Connect your data sources
runnerSeeded: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-warehouse, integration-v2-mcp]
allowedTools: [Read, Glob, Grep, wizard_ask, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: []
---

## Goal

Connect the data sources listed in your task input to PostHog's data warehouse,
so the project's own data can be queried next to the events this run
instruments. The wizard found them in the project; your job is to turn each one
into a real connection, or into a link the user can finish in the browser.

You are the only step that stops to ask the user for anything, so make the ask
count: gather what a source needs in one `wizard_ask` call, tagged with that
source's kind as its `subject`. A decline answers that one source. Move on to
the next source rather than re-asking or ending the round.

Touch no project code. This step connects data; it does not edit the app.

## How you know you succeeded

Every source in your input reached a decided end: connected in PostHog, handed
back as a link to finish, or skipped with a reason. Your handoff carries a
finished report section naming each source and which of those three it was, so
the reporting step can include it as it stands.

A link is a handoff, not a connection. Your report section opens with the count
you connected, and your `complete_task` status matches it: `done` only when you
connected at least one source.
