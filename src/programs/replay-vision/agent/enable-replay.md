---
type: enable-replay
flow: replay-vision
label: Make session replay record
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [replay-vision-enable-replay]
allowedTools: [Read, Edit, Glob, Grep, posthog_exec]
disallowedTools: [Write, Bash, enqueue_task]
dependsOn: [install, init]
---

## Goal

Make session replay actually record. Recording has a server half and a client
half, and either one can silently cancel the other.

Server half: call `products-enable` (via `exec`: `info products-enable`, then
`call products-enable {"products": ["session_replay"]}`). It is idempotent and
server-owned; `"enabled"` and `"already_enabled"` are both success.

- **Tool missing on this deploy**: don't fail the task — record a follow-up in
  your handoff telling the user to turn on "Record user sessions" under
  Settings → Session replay, and finish.
- **Permission rejection**: record a follow-up to enable it from a
  project-admin account, and finish — scanners created later sit idle until
  recording is on, then start working with no re-setup.

Client half, web apps only: check the `posthog.init(...)` options.
`disable_session_recording: true` cancels the server flip — remove it (or set
it `false`). If nothing overrides recording, leave the init alone. This is the
only code edit this task may make: never restructure the init, never add new
instrumentation. If you can't confidently locate or edit the init, record a
follow-up instead of guessing.

Pure backend or mobile app with no web surface: nothing records browser
sessions here. Say so in your handoff and finish — scanner tasks read your
handoff and skip what doesn't apply.

## How you know you succeeded

Recording is on server-side and nothing in the client init cancels it — or
your handoff names exactly which half needs the user and why. Later tasks
trust your handoff, so state plainly whether recordings will flow.
