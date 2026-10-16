---
type: report
flow: feature-flags
label: Write the setup report
sink: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-notebook, integration-v2-mcp]
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Compose the setup report from `read_handoffs` only, then publish it with a
single `publish_handoff` call. The same call mirrors the markdown into a
shareable PostHog notebook. The notebook skill says what the result means and
covers older wizards. Do not write a report file. The handoff call and the
notebook are how the report reaches the user.

Write one section per flag:

- The flag: its side, key, URL, whether it was created or reused, and whether
  it is active, as the handoff gives it. Say a flag stays off until the user
  enables it only when the handoff marks it inactive.
- Where the app evaluates it: files and call site, the constants module, and
  how the distinct id is chosen.

Then:

- If the run installed or initialized an SDK, say which and on which side.
- How to confirm it works: open the page or endpoint that evaluates each flag,
  then find the evaluation on the flag's page in PostHog. It can take a few
  minutes to show up.

The run does not check that an evaluation reached PostHog, so never write that
one did. Where a step failed or was skipped, say so plainly instead of rounding
it up to success.

## How you know you succeeded

One `publish_handoff` call went through with the full report, and a user who
reads only it knows which flags were created, which side evaluates each and
where, which are still off and need turning on, and how to confirm an
evaluation reaches PostHog. Every claim in it traces to a handoff. The notebook
mirror is best effort: when it was created, the user has its link, and when it
wasn't, your final message says why. A missing notebook never fails this task.
