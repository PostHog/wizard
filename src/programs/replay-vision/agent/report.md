---
type: report
flow: replay-vision
label: Report and hand off
sink: true
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: []
allowedTools: [Read, Glob, Grep, Write, posthog_exec]
disallowedTools: [enqueue_task]
dependsOn: [scanner-problems, scanner-flow-outcome, scanner-session-summaries]
---

## Goal

Tell the user what Replay vision is now doing for them, from the handoffs of
every task in the run.

Open the report with whatever still stands between the user and their first
observation, from the enable-replay handoff, before anything else:

- **Session replay is off**: lead with it as an error, not a follow-up —
  session replay is off in this project, and no scanner runs until a project
  admin turns on "Record user sessions" under Settings → Session replay.
- **The replay setting is unknown**: don't call it off. Ask the user to check
  "Record user sessions" under Settings → Session replay.
- **This run changed code**: lead with "Deploy this change: session replay
  only records from code your users run, so your scanners start when the
  first recording arrives." Name the files to deploy from the handoff (never
  an env file or anything gitignored), and the env vars that must be set in
  production. When replay is also off, list this second,
  after the error.
- **Nothing changed, but the project has no recordings yet**: don't ask for a
  deploy. Say the scanners start with the first recording. Add that if people
  already use the app, the version they run may not include the PostHog SDK
  yet.

Say the scanners cost nothing until recordings arrive only when the
recordings count is 0 or unknown. When recordings already exist, they start
scanning, and spending, right away. Say session replay is recording only when
the project already has recordings. Then, briefly and concretely:

- Each scanner created or updated: its name, what it watches, its query
  scope, and its estimated monthly credit spend.
- Anything skipped or deferred, with the reason — a skipped scanner on a
  backend-only project is an outcome, not an apology.
- Where results appear: the Replay vision page in PostHog, with the first
  observations arriving as new recordings complete.

If the run also installed and initialized the SDK, say so — the user started
this command without PostHog and now has it.

Write the report to `./posthog-replay-vision-report.md` (the wizard shows this
file at the end of the run), then publish the same content as your handoff.

## How you know you succeeded

A user who reads only your report knows what watches their product, what it
costs, what still needs them, and where to look first.
