---
type: install
flow: integration-v2
label: Add the PostHog SDK to the manifest
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-haiku-4-5
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Install the PostHog SDK with the project's own package manager, so the real
published version lands in the manifest and the lockfile — not one you made up.
Run the manager's add command with the bare package name and let it resolve the
version: `npm install <pkg>` (or the project's pnpm/yarn/bun), `pip install <pkg>`,
`composer require <pkg>`, `bundle add <pkg>`, `gem install <pkg>`. Never invent a
version — one that was never published fails the whole run with `ETARGET`, and
guessing another just fails again. The only version you write by hand is one copied
from the framework reference example, and only in the environment fallback below.

Add the client library, plus the server library if the app has server-side code
that sends events. If the SDK is already installed, leave it and say so.

Some ecosystems pin an explicit version in a manifest no install command resolves
(Swift SPM, Gradle). There, declare the dependency the way the framework reference
shows and take the version from the SDK's latest release — do not invent one.

Attempt the install once. If it fails on something you own — a wrong package name or
the wrong manager — fix that and run it one more time.

But if the environment prevents the install through no fault of your change, do NOT
spiral retrying it. These are environment failures, not yours:

- a peer-dependency conflict the project already had (npm `ERESOLVE`),
- a dependency already in the manifest that itself does not resolve (a bad or yanked
  version, a package that no longer exists) — the failure names a package that is not
  PostHog,
- the package manager crashing on the project's existing dependency graph or a
  corrupt/incompatible lockfile (e.g. npm `Cannot read properties of null`),
- the package manager itself failing to run or provision — corepack unable to
  switch to a pinned version (`Failed to switch pnpm to …`, `Cannot find matching
  keyid`), a missing manager binary, a toolchain the machine does not have,
- no network or registry reachable.

The test: if the failure names your PostHog package or your command, it is yours to
fix; if it names another dependency, a version pin the project set, or the toolchain
itself, it is the environment — fall back and move on.

When you hit one of those, fall back: add the PostHog package to the manifest by hand
at a known-good version, so the dependency is still declared for the later steps and
for the user's own install. Use the framework reference example's spec if it names
one; otherwise use a caret on the SDK's current known-good release — `posthog-js`
`^1.407.2`, `posthog-node` `^5.46.1`, `posthog-php` `^4.12.1`, `posthog` (Python)
`^7.29.0`, `posthog-ruby` `^3.21.0`. The caret keeps it current without pinning a
patch; never invent a version that was never published. Then move on, and say in your
handoff exactly what failed and the command
you ran, so the review step and the report surface it.

## How you know you succeeded

The SDK resolved and installed at its real version, or you have reported plainly in
your handoff why the environment stopped it. Your handoff names the manifest and the
package, so later steps import it under the name they will actually get.
