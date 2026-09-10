---
name: adding-framework-support
description:
  Add or extend language and framework support in the PostHog wizard, including
  detection, framework configuration, registration, and matching context-mill
  content.
compatibility:
  Designed for coding agents working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: '2.0'
---

# Adding Framework Support

Read [wizard-development](../wizard-development/SKILL.md) for the shared design
policy and gateway contract. New agent work uses Pi and prefers the
orchestrator; adding a framework extends the integration program without
creating its own runner or changing existing routing defaults.

## Extend the framework configuration

Start with [FrameworkConfig](../../../src/lib/framework-config.ts) and a nearby
example under [src/frameworks](../../../src/frameworks/). Framework-specific
detection, context, environment conventions, and UI metadata belong here.
Integration instructions and examples belong in context-mill.

1. Add the integration to [Integration](../../../src/lib/constants.ts). Its
   order controls first-match detection and the framework picker. Keep specific
   frameworks before language fallbacks and generic Node last; preserve the
   overlap rules in the
   [detection checks](../../../src/lib/detection/__tests__/framework.test.ts).
2. Add the config under `src/frameworks/<name>/<name>-wizard-agent.ts`. Use a
   `type` for framework context so it satisfies `Record<string, unknown>`.
   Export the config; the integration program already supplies execution.
3. Import the config into [FRAMEWORK_REGISTRY](../../../src/lib/registry.ts).
   The display label comes from `metadata.name`.

Read the current interface for the complete required fields. In particular,
`detection.detectPackageManager` is required: reuse an adapter from
[package-manager detection](../../../src/lib/detection/package-manager.ts). Use
`metadata.setup.questions` for unresolved project variants; `gatherContext`
collects framework context. Optional notices and extra MCP servers also belong
in metadata.

Use `usesPackageJson: false` for frameworks without a package.json dependency.
Their required `getVersion` callback can return `undefined`. Minimum-version
checking requires both `minimumVersion` and `getInstalledVersion`; unknown
versions pass. [Context detection](../../../src/lib/detection/context.ts)
returns unsupported-version data for the integration UI rather than aborting
itself.

## Detection and examples

| Starting point                              | Pattern to reuse                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Next.js](../../../src/frameworks/nextjs/)  | `hasDeclaredDependency` from `utils/package-json`, `tryGetPackageJson` from `utils/setup-utils`, and router setup questions |
| [Django](../../../src/frameworks/django/)   | Python project files, context gathering, and Python package-manager detection                                               |
| [Laravel](../../../src/frameworks/laravel/) | Composer and framework-specific filesystem signals                                                                          |
| [Rails](../../../src/frameworks/rails/)     | Gemfile detection and Ruby conventions                                                                                      |

Use [bounded filesystem helpers](../../../src/utils/bounded-fs.ts) for project
scans and reads. They bound traversal and skip dependency/build directories; add
framework-specific exclusions with `extraIgnore`. Keep complex parsers and
detectors beside the config so they can be checked independently.

## Complete the content side

Ensure [context-mill](https://github.com/PostHog/context-mill) supplies the
matching integration reference and task-skill variants for the framework. A
registry entry alone does not provide integration knowledge. The orchestrator
resolves framework variants from the skill menu and rejects missing task
variants; see the
[orchestrator runner](../../../src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts).

Keep project-specific facts in configuration and reusable integration guidance
in that content. Model IDs, reasoning efforts, and gateway-required system
prompts follow the cross-repo contract in
[wizard-development](../wizard-development/SKILL.md); a framework config cannot
enable a new gateway model.

## Verify the changed behavior

Check detection against the target framework and the closest overlapping
framework/fallback. Reuse the existing detection checks; add a focused case only
for behavior they do not cover. Confirm package-manager selection and matching
content-mill variants. For an end-to-end run, use a disposable test app and the
[exploration guide](../exploring-the-wizard/SKILL.md).

For prompt, environment-upload, or outro changes, inspect the current
[integration program](../../../src/lib/programs/posthog-integration/) and the
selected sequence. Some fields remain in the interface without a current
consumer: `getOutroNextSteps` is not used by the integration outro. Linear
post-run/outro hooks are not shared by the orchestrator; see the
[program guide](../adding-skill-program/SKILL.md).

Use the proportionate validation guidance in
[wizard-development](../wizard-development/SKILL.md). Documentation-only changes
need source/link checks, not an agent run.
