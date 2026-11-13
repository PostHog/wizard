---
type: setup-feature-flags
flow: feature-flags
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Glob, Grep]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan example PostHog feature flags for this project and seed the task queue.
The end state: one example flag per side of the app that exists, each
evaluated once in one place on its own side and reported back to PostHog, and
a report in a PostHog notebook telling the user how to turn the flags on.

First establish two facts from the repo.

**1. Which sides does the app have?**

- `backend`: server code that handles requests, such as route handlers, API
  views, controllers, server components, or server loaders.
- `frontend`: JavaScript or device code the app owns that runs in a browser
  or on a device, such as client components, a single-page app, inline
  scripts in its page templates, script files its pages load (directly or
  through asset helpers such as import maps or Vite), or mobile screens.

A side counts only when the app already has code there to put an evaluation
in. Never add a side to host a flag. Server-rendered templates that load no
JavaScript of the app's own are not a frontend: such an app has only a
backend. An API has only a backend; a mobile app or a static single-page app
has only a frontend.

**2. Is PostHog already integrated on each of those sides?** Look for the
PostHog SDK for that side in the dependency manifests (or, for template
scripts, the PostHog snippet) and an init call in the source. An init counts
only when the key it reads is defined in the repo's committed env template or
build config. When you cannot tell, treat it as missing: the init task
re-checks and leaves a complete init alone.

Then seed the graph. Give every task the same input: `sides`, the list of
sides you found (`["backend", "frontend"]`, `["backend"]`, or
`["frontend"]`). Pass no other inputs; each task learns the rest from the
handoffs before it.

- `install`, only when an SDK a side needs is missing from the manifest.
- `init`, whenever an init is missing or unproven on either side.
- `create-flag`, with no dependencies. It only talks to PostHog.
- `evaluate`, after `create-flag` and after whichever of `install` and
  `init` you queued.
- `report`, after every other task.

Never plan capture, dashboard, or session-replay work. This run sets up the
example flags, nothing else.

## How you know you succeeded

Every task above is queued with that dependency shape and the `sides` input,
`report` depends on every other task, and your plan states which sides the
app has, whether PostHog is integrated on each, and the files that told you.
Keep labels short.
