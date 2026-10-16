---
type: verify-sdk
flow: metrics
label: Verify the PostHog SDK is ready for metrics
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: []
allowedTools: [Read, Edit, Glob, Grep, Bash, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Leave your service with a PostHog SDK that can record metrics. When your
task input names a `package`, that package is your whole world — its
manifest, its init site, its `service_name`; do not touch sibling packages.
First call
`load_skill_menu` with `category: "metrics"` and `install_skill` for the
variant matching the project's platform — the menu is the source of truth,
one variant per platform, and a full-stack app takes the server variant
because metrics measure service work. The installed skill carries the
platform's install and init specifics. Then three checks, in order:

1. **Installed?** Look for the SDK in the dependency manifest. Missing →
   install it with the project's own package manager and let it resolve the
   version — never invent one.
2. **New enough?** `posthog.metrics` ships in recent SDK releases only — the
   skill states the version floor for this platform. Below it → bump with the
   package manager's upgrade command. At or above → leave it alone and say so
   in your handoff.
3. **Initialized for metrics?** Find where the client is constructed. Add the
   `metrics` config (a service name) to that existing client, as the skill
   shows. No client anywhere → initialize one, following the skill. Never
   construct a second client beside a working one, and never touch identify
   calls, event capture, or other init options.

## How you know you succeeded

The manifest holds the SDK at a metrics-capable version and exactly one client
init carries the metrics config — or your handoff plainly says why the
environment stopped you. Name the skill variant you installed, the manifest, the version, and the
init site in your handoff, so instrumentation installs the same skill and
knows what to import and where.
