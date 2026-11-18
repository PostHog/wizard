---
type: setup-support
flow: support
seed: true
model_pi: openai/gpt-6.1-terra
effort_pi: medium
model_sdk: claude-sonnet-5-5
effort_sdk: high
skills: []
allowedTools: [Read, Glob, Grep]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan a PostHog Support setup and seed the task queue. Support (code name:
conversations) gives the app an in-app chat widget, loaded by `posthog-js`.
Every ticket sent through it carries the sender's identity, session replay and
events. The plan has two halves: turn the product on in PostHog, then make
sure the app's browser code loads the widget and identifies its users.

First establish two facts from the repo.

**1. Does the app have a web frontend?** That means browser code the app owns:
client components, a single-page app, or page templates that can take the
PostHog snippet. A pure API or a mobile app has none, so there is nothing to
put the widget in. Plan only `enable-support` and `report` in that case.

**2. Is `posthog-js` (or the snippet) already integrated?** Look for
`posthog-js` in the dependency manifests, or the snippet in a base template,
and a `posthog.init(...)` call in the source. When you cannot tell, treat it
as missing: the init task re-checks and leaves a complete init alone.

Then seed the graph:

- `install`, only when `posthog-js` is missing from a frontend that has a
  manifest. A template-only frontend gets the snippet from `init`, not a
  package.
- `init`, whenever the init is missing or unproven.
- `enable-support`, with no dependencies. It only talks to PostHog.
- `widget`, after whichever of `install` and `init` you queued.
- `identify`, after `widget`, only when the app has a login or user concept.
- `report`, after every other task.

Never plan capture, dashboard, replay or feature-flag work. This run sets up
Support, nothing else.

## How you know you succeeded

Every task above is queued with that dependency shape, `report` depends on
every other task, and your plan states whether the app has a web frontend,
whether `posthog-js` is integrated, and the files that told you. Keep labels
short.
