---
type: test-setup
flow: error-tracking
label: Offer an optional local test
sink: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, load_skill_menu, install_skill, wizard_ask]
disallowedTools: [enqueue_task]
dependsOn: [report]
---

## Goal

The setup is done and the report is written. Offer the user an optional,
one-time, end-to-end check that errors reach PostHog with readable stack traces.
Install the skill your task input names (`install_skill` with the `skillId`) and
follow its **"Test the local setup"** step for the platform-appropriate
affordance, the `captureException` shape, the placement, and the
read-before-edit / always-revert rules.

You run after the report on purpose. A user who stepped away still gets a
finished setup and a report, so nothing waits on this test.

First ask with `wizard_ask`:
`{ id: "test-affordance", prompt: "Error tracking is set up, and the report is in posthog-error-tracking-report.md. Optional: want me to help you test it locally? I'll add a temporary test button (or route) so you can confirm errors show up in Error Tracking with readable stack traces after your next build, then remove it.", kind: "single", options: [{ label: "Yes, help me test it", value: "yes" }, { label: "No, I'm done", value: "no" }] }`

- **"no"**, no answer (`__cancelled__`), or `wizard_ask` unavailable: do nothing
  to the code and report this task done, noting the test was offered and not
  taken.
- **"yes"**: add the affordance per the skill, then pause with a second
  `wizard_ask` (id `"test-done"`, a single `Continue (revert test code)`
  option) whose prompt gives the build, run, and Error-Tracking-check as
  literal numbered steps (build first — it uploads the maps — then trigger the
  affordance, then confirm the error resolves to real source in Error
  Tracking). After the user continues, or when that ask comes back unanswered,
  REVERT every test edit per the skill's rules. Never leave the affordance in
  place, even if the user says it didn't work.

When the user says the test failed, add a short **"Local test"** section at the
end of `posthog-error-tracking-report.md` with what they saw, and say the same
in chat. The report task has already run, so this is the only place the
failure is written down.

## How you know you succeeded

Either the offer was declined or unanswered and no code changed, or the
affordance was added, tested, and fully reverted. Your handoff says which, and
a failure the user reported is in the report file.
