---
type: install
flow: feature-flags
label: Add the PostHog SDKs to the manifest
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure each side in your `sides` input has its PostHog SDK in the
manifest: the server library for `backend`, the browser or mobile library
for `frontend`. Leave an SDK that is already there alone and say so.
Install a missing one following your skill, which owns the package manager
and version rules.

A frontend that is only scripts in server-rendered templates has no package
to install: the init task adds the PostHog snippet there. Install nothing for
that side, and install nothing beyond these SDKs.

## How you know you succeeded

Each side's SDK is declared in the manifest at a real version, or your
handoff says plainly why the environment stopped you. Your handoff names the
manifest and package for each side.
