---
type: evaluate
flow: feature-flags
label: Evaluate the flags in the app
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-feature-flags-step]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

For each flag the create-flag handoff names, add one evaluation on that
flag's side of this app: the backend flag in server code through the server
SDK, the frontend flag in browser or device code through the client SDK.
Never evaluate a flag on the other side. Your skill carries the SDK flag docs
and the best-practices page; follow them for the exact calls.

The SDKs are installed and initialized, either already or by the tasks before
you. Build on that; do not re-check it.

For each flag, choose a call site where a real request or screen passes
through. On the backend, evaluate once for that request and pass the value
down; never re-evaluate deeper in the call stack. Put the keys in a constants
module the call site imports, one module per language; a template script that
cannot import it gets the key from the server's constant, never a literal.
Evaluate with the identified user's distinct id, the same id on both sides,
and report each evaluation back to PostHog the way the docs show for that SDK.
Gate something harmless on each value, such as a log line or a small label,
so the app behaves the same while the flags are off.

This is an edit-only task. Do not install dependencies, run the build, or
start the app.

## How you know you succeeded

Each flag is evaluated once, at one call site on its own side, with its key
imported from a constants module, and its evaluation is reported. Your
handoff names, for each flag, the files changed and the call site, plus how
the distinct id is chosen on each side.
