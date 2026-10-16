---
type: wire-ci
flow: error-tracking
label: Set up CI for automatic uploads
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [configure, credentials]
---

## Goal

Make the credentials reach the production build wherever it actually runs, so
source maps upload on every deploy — not just on a local build. Install the
skill your task input names (`install_skill` with the `skillId`) and follow its
**"Set up CI for automatic uploads"** step — it owns tracing where the
production build runs and wiring the credentials through every layer, whatever
the CI provider.

The `configure` and `credentials` handoffs already name the build-config keys
and the exact environment-variable names in use — carry those same names into
the pipeline; do not invent new ones. Trace the deploy path by reading the
project's own files (CI workflows, Dockerfiles, deploy scripts) — never invent
config that is not there. You cannot create the CI secret that holds the API
key; reference it by name and carry that follow-up, plus any deploy path you
could not trace, into your handoff for the report.

## Two things cross the boundary, not one

Credentials are half of it. The uploader also needs a **release identity** — a
name and a version — and it derives that from the CI's own git variables or
from a `.git` directory. A container build sees neither: `.git` is almost
always in `.dockerignore`, and the CI's variables stop at the `docker build`
command. Nor does a hardcoded release name rescue you; the uploader wants both
halves, and stops the build when it has only one.

So forward the provider's git variables into the build the same way you forward
credentials, and declare each one as `ARG` **and** `ENV` — `ARG` alone is not
visible to the uploader's environment lookup. Your skill's "Associate the
release with a git commit" step lists the variables per provider. Read that
step even though it is not the CI step: this boundary is where it applies.

Forward them only where a provider actually sets them. A project with no
pipeline — an image built and run by hand — has nothing to inherit from, and
variables declared but never filled resolve to no release at all: it reads as
wired and still fails the build. There the identity has to be supplied outright,
both halves, from something the build itself holds — a build argument the
operator passes, or the manifest's own version — so name and version are always
present. Decide which case you are in by reading the repo, not by assuming a
provider exists.

That `ARG`-plus-`ENV` shape is for the git variables and the non-secret settings
only. The API key is a secret and keeps whatever secret-carrying mechanism the
build system offers — a build secret mounted for the one step that needs it, a
masked variable, a secret file. A secret in `ARG` or `ENV` is recorded in the
build history, and the builder itself will warn you: *do not use ARG or ENV
instructions for sensitive data*. Widening the git-variable pattern to cover the
key is a downgrade, not consistency.

## The runtime boundary has names too

Upload credentials are a build-time concern. The app also reads its own
variables at **run** time, and the step that starts it is another place a name
has to match — a `docker run -e`, a compose file, a systemd unit, a platform's
environment settings. That step was written before PostHog existed here, so the
name it passes is whatever the project used back then. If `init` settled on a
different one, the deployed process starts with an undefined key.

Nothing fails loudly. In production the init guard returns quietly instead of
throwing, so the process boots, serves traffic, and reports nothing — the same
silent shape as a mismatched upload variable, one boundary later.

So read the names the app's own source reads, and make the start step pass
exactly those. Rename the deploy step's variable, not the code: the code is the
half that already exists. Name any secret the user must create under its new
name in your handoff.

## How you know you succeeded

The pipeline that runs the production build carries the upload credentials by
the same names the credentials task used and reaches the uploader with a
resolvable release identity, and the step that starts the app passes the
variable names the app's own source reads. Every secret the user still has to create is named
in your handoff. Your handoff lists the CI files you changed
and every manual follow-up, so the report can hand them to the user.
