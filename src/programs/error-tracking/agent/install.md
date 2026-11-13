---
type: install
flow: error-tracking
label: Add the PostHog SDK to the manifest
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-haiku-4-5
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure the PostHog SDK is in the manifest. If it's already installed,
leave it alone and say so in your handoff. If it isn't, install it following
your skill — it owns the version rules, what counts as an environment failure,
and the fallback. The package manager comes from the section below, which wins
over your skill's own rule: the skill looks at this directory only.

You only exist in this flow because the user asked for error tracking on a
repo without PostHog. Install the SDK the init will construct — the browser
SDK for an app with a browser side, the server SDK for a server-only app — and
stop: no instrumentation, no extras. A second, server-side library for an app
that has both is not yours to add. The `capture-exceptions` task adds it when
it wires server-side capture, so the manifest never carries a library no code
imports.

## Pick the package manager first

Call `detect_package_manager`. When it names a manager, use it. When it answers
`No lockfile found. Default to npm`, do not run npm yet: this directory may be
a package inside a workspace, whose lockfile sits at the repository root. Read
`../package.json` and `../../package.json` up to the root, and look there for a
lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`) or a
`packageManager` field. Reading them is part of this task even though they sit
above this directory; edit nothing there. Use the manager they name, from this
directory. npm is right only when no parent holds either: npm in a pnpm or Yarn
workspace fails on `workspace:*` dependencies (`EUNSUPPORTEDPROTOCOL`) or
leaves a second lockfile behind.

## Python

In a Python project, install into the virtualenv the project already keeps in
its directory. When it has none, add the package to the manifest and stop. Do
not create one: it would stay behind in the user's project.

## How you know you succeeded

The SDK is declared in the manifest at a real version — whether it already
was or you just installed it — or your handoff plainly says why the
environment stopped you. Your handoff names the manifest and the package, so
later steps import it under the name they will actually get.
