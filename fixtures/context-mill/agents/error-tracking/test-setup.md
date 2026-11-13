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

You run after the report on purpose. A user who stepped away still gets a
finished setup and a report, so nothing waits on this test.

Ask before you do anything else, with `wizard_ask`:
`{ id: "test-affordance", prompt: "Error tracking is set up, and the report is in posthog-error-tracking-report.md. Optional: want me to help you test it locally? I'll add a temporary test button (or route) and build the app, so you can run it and confirm errors show up in Error Tracking with readable stack traces. Then I'll remove it.", kind: "single", options: [{ label: "Yes, help me test it", value: "yes" }, { label: "No, I'm done", value: "no" }] }`

- **"no"**, no answer (`__cancelled__`), or `wizard_ask` unavailable: report
  this task done right away, noting the test was offered and not taken. Install
  no skill and read nothing first.
- **"yes"**: install the skill your task input names (`install_skill` with the
  `skillId`) and follow its **"Test the local setup"** step for the
  platform-appropriate affordance, the `captureException` shape, the
  placement, and the read-before-edit / always-revert rules. Add the
  affordance, then run the production build yourself: it uploads the maps for
  the bundle that carries the affordance.
  When the build fails, revert, tell the user what failed, and stop. When it
  passes, pause with a second `wizard_ask` (id `"test-done"`, a single
  `Continue (revert test code)` option) whose prompt gives the rest as literal
  numbered steps: run the built app, trigger the affordance, then confirm the
  error resolves to real source in Error Tracking. When the platform's build
  and run are one step (an Xcode Run, `expo run`), give that step to the user
  instead of building. After the user continues, or when that ask comes back
  unanswered, REVERT every test edit per the skill's rules. Never leave the
  affordance in place, even if the user says it didn't work.

When the user says the test failed, add a short **"Local test"** section at the
end of `posthog-error-tracking-report.md` with what they saw, and say the same
in chat. The report task has already run, so this is the only place the
failure is written down.

## How you know you succeeded

Either the offer was declined or unanswered and no code changed, or the
affordance was added, tested, and fully reverted. Your handoff says which, and
a failure the user reported is in the report file.
