---
type: instrument-metrics
flow: metrics
label: Instrument the service with metrics
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [verify-sdk]
---

## Goal

Instrument your service with application metrics. When your task input names
a `package`, stay inside it — sibling packages belong to other chains.
Install the platform's skill the way the verify handoff names it (`load_skill_menu` category
"metrics", then `install_skill`), and follow it end-to-end — it owns where
metrics belong (request middleware, background
jobs, external calls, business commit sites), which of counter, gauge, and
histogram fits each site, and the low-cardinality attribute rules.

Import the client the way the verify handoff names it. Only additive changes:
add metric calls, never restructure the code they land in.

## How you know you succeeded

The hot paths and business commit sites record metrics through the one shared
client, the project still builds, and your handoff lists every metric name
with its type and where it fires.
