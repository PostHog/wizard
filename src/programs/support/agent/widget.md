---
type: widget
flow: support
label: Let posthog-js load the widget
model_pi: openai/gpt-6.1-terra
effort_pi: low
model_sdk: claude-sonnet-5-5
effort_sdk: medium
skills: [posthog-best-practices]
allowedTools: [Read, Edit, Glob, Grep]
disallowedTools: [Write, Bash, enqueue_task]
dependsOn: [install, init]
---

## Goal

Make sure nothing in the app's browser code stops the Support widget from
loading. The widget is part of `posthog-js` and loads on its own once Support
and the in-app widget are on in PostHog. Usually no code change is needed.

1. Find the `posthog.init(...)` call or the snippet. If it sets
   `disable_conversations: true`, remove that option. It stops the module
   from loading. Leave every other option alone.
2. If the app already has a "Contact support" or "Chat with us" link or
   button, wire its click to `posthog.conversations.open()`. Leave "Help"
   links and links to docs alone. Change only that handler. Never add a new
   button or redesign the UI. `open()` needs `posthog-js` 1.442.0 or later.
   Read the resolved version from the lockfile (a snippet loads the latest).
   If it is older, or there is no lockfile to read, leave the link alone and
   record a follow-up to upgrade.
3. If you can't confidently locate or edit the init, record a follow-up
   instead of guessing.

Never restructure the init, add capture calls, or touch replay or flag
settings.

You do not install packages, run builds, linters, or tests, or start the app.

## How you know you succeeded

Your handoff says whether you changed code, names each file and what changed,
and lists any follow-ups. When nothing needed changing, say so plainly.
