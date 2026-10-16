---
type: report
flow: error-tracking
label: Summarise and hand off
model_pi: openai/gpt-5.6-luna
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: []
allowedTools: [Read, Glob, Grep, Write]
disallowedTools: [enqueue_task]
dependsOn: [capture-exceptions, wire-ci, link-releases]
---

## Goal

Tell the user what error tracking now does for them and what they still have
to do, from the handoffs of every task in the run. `read_handoffs` gives you
each task's report — the capture mechanism, the files changed, the env
variable names, the CI secrets and variables to create, and any deploy path
that could not be traced. Do not re-derive any of it from the project.

Write the hand-off to `posthog-error-tracking-report.md` at the top level of
this project's directory. When any handoff carries a manual follow-up, START
the report, right under its H1, with this warning block, one short bullet per
item. The wizard shows these bullets again when it exits.

```markdown
> ⚠️ **Needs your attention**
> - Load `.env` in the app, or set `POSTHOG_API_KEY` in its environment.
```

Then, when the run wired source-map upload or release linking, or any
follow-up has steps, add a **"What you still need to do"** section — numbered,
copy-pasteable:

1. Create a personal API key with the 'Source map upload' preset at
   `<UI_HOST>/settings/user-api-keys` (skip when the credentials handoff says
   the key is already written and no release linking was wired). The preset
   carries the error tracking write scope that both uploads and release
   linking need.
2. Add it as the CI secret the wire-ci or link-releases step referenced, named
   exactly as in the pipeline config. When link-releases also reads a project
   ID variable (such as `POSTHOG_PROJECT_ID`), add it with the value
   `<PROJECT_ID>`, and say where each goes in the CI provider's settings.
3. Any other manual follow-up the handoffs carry (an env file nothing loads,
   an untraceable deploy path, provider-side settings, installing a missing
   `posthog-cli`, an SDK upgrade across a major version).

Then cover, briefly and concretely:

- How uncaught errors reach PostHog now — the capture mechanism and the files
  that carry it.
- If the run also installed and initialized the SDK, say so — the user
  started this command without PostHog and now has it.
- When source-map upload was wired and neither the credentials nor the wire-ci
  handoff reports a skip: the files changed (paths only), the exact production
  build command, and that every production build now uploads.
- When the build was wired but the credentials or wire-ci handoff reports a
  skip: the same files and command, and that the build is set up to upload.
  Say that uploads start, and the build command succeeds, only once the
  `POSTHOG_CLI_*` values are present where the build runs.
- When it was skipped: one line saying why — readable stack traces on this
  platform, or that Astro is not supported by the uploader. An outcome, not an
  apology. Say plainly that the build command was left untouched.
- When release linking was wired: the files changed (paths only), the SDK
  version it now requires, and the deploy path the release ID takes to the
  app. Say that each production deploy resolves a release and starts the app
  with `POSTHOG_RELEASE_ID`, so every exception names the release, version, and
  commit it came from. Say plainly that local runs, tests, and pull-request
  builds are unchanged and send no release ID. When the link-releases handoff
  reports no deploy path it could follow, say what the user's deploy must do
  instead.
- How to verify: trigger any error and look at
  `<UI_HOST>/project/<PROJECT_ID>/error_tracking`; uploaded symbol sets appear
  at `<UI_HOST>/project/<PROJECT_ID>/error_tracking/configuration`. With
  release linking, check after the next production deploy that the stack trace
  shows the release, and that the exception's `$release_id` matches the ID the
  deploy resolved.

Never write a secret value into the report — only variable names. Replace
`<UI_HOST>` and `<PROJECT_ID>` from your project context. Give the same
summary in chat, warning block first.

## How you know you succeeded

`posthog-error-tracking-report.md` exists and a user who reads only it knows
how errors reach PostHog, the follow-ups they still owe (the API key and the
CI secrets and variables named exactly, when upload or release linking was
wired), and where in PostHog to see the first captured exception.
