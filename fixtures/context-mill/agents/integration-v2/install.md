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
The version comes from the library doc your install skill lists under Reference.
Open it before you install, and run the add command it shows with the version it
pins, or the bare package name if it pins none, and let the manager resolve the rest:
`npm install <pkg>` (or the project's pnpm/yarn/bun), `pip install <pkg>`,
`composer require <pkg>`, `bundle add <pkg>`, `gem install <pkg>`.
EXAMPLE.md shows code patterns only; never take a version from its manifests.
If the wizard refuses that command, write the pin into the manifest and run the
manifest install. Never invent a version — one that was never published fails the
whole run with `ETARGET`, and guessing another just fails again. The only version you
write by hand is one copied from the library doc, and only in the environment
fallback below.

Add the client library, plus the server library if the app has server-side code
that sends events. If the SDK is already installed, leave it and say so.

Where a web app or other application sits beside an MCP server (the detected facts
name any MCP server), install for the app, in its own package. Review installs what a
separately run MCP server needs from the `mcp-analytics` handoff. If the MCP server is
the whole project, install for it.

Read the resolved version from the manifest or the package manager, not the lockfile:
lockfiles are huge and full of hashes, so never read one whole.

Some ecosystems pin an explicit version in a manifest no install command resolves
(Swift SPM, Gradle). There, declare the dependency the way the library doc shows, with
the version it pins — do not invent one.

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
so the dependency is still declared for the later steps and for the user's own
install. Use the version the library doc pins, or no version constraint if it pins
none; never invent one. Then move on, and say in your
handoff exactly what failed and the command
you ran, so the review step and the report surface it.

The framework reference you were given comes from a static check, and it can be wrong.
If this project doesn't use that language or framework at all, complete as `failed`,
not `not needed`, and change nothing. A different version or variant of the same framework,
such as Pages Router and App Router in Next.js, is not a mismatch: continue, and follow what
the project actually uses. Put one line in your handoff's `conflict`: what
the project actually uses, and that rerunning and choosing "Change framework" fixes
it. Every later task depends on you, so the run should stop here.

## How you know you succeeded

The SDK resolved and installed at its real version, or you have reported plainly in
your handoff why the environment stopped it. Your handoff names the manifest and the
package, so later steps import it under the name they will actually get.
