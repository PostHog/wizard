---
name: wizard-development
description: >
  Architectural guidance for changes to the PostHog Wizard: program and
  framework boundaries, agent routing, gateway admission, security, and TUI
  state. Read before structural changes, then load the relevant procedural
  skill.
compatibility: Coding agents working in the PostHog Wizard repository.
metadata:
  author: posthog
  version: '2.0'
---

# Wizard development

Ask who owns the concern and what they should need to understand to change it.
Product knowledge belongs behind typed configuration boundaries; runner and UI
infrastructure should consume those boundaries.

| Concern                                               | Owner                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework detection, context, env conventions         | [FrameworkConfig](../../../src/lib/framework-config.ts) and [framework configs](../../../src/frameworks/)                                                                       |
| Integration instructions and orchestrator flows/tasks | [context-mill](https://github.com/PostHog/context-mill)                                                                                                                         |
| Programs, steps, prerequisites and outcomes           | [programs](../../../src/lib/programs/)                                                                                                                                          |
| Sequence, harness, model and effort selection         | [switchboard](../../../src/lib/agent/runner/switchboard/)                                                                                                                       |
| Local tool permissions and scanner adapters           | [agent-interface](../../../src/lib/agent/agent-interface.ts), [YARA hooks](../../../src/lib/yara-hooks.ts), [Pi security](../../../src/lib/agent/runner/harness/pi/security.ts) |
| Scanner rules                                         | [warlock](https://github.com/PostHog/warlock)                                                                                                                                   |
| Token admission and budgets                           | [PostHog mint endpoint](https://github.com/PostHog/posthog/blob/master/posthog/llm/wizard_gateway_token.py) and [ai-gateway](https://github.com/PostHog/ai-gateway)             |
| Screen resolution and rendering                       | [TUI](../../../src/ui/tui/) through [WizardUI](../../../src/ui/wizard-ui.ts)                                                                                                    |

## Execution policy and model admission

- **Pi is the default choice for new work.** Harness choice and model provider
  are separate: Pi supports gateway-backed Anthropic and OpenAI transports.
- **Prefer orchestration.** A seed agent plans work, then task agents execute
  focused conversations. Start from
  [metrics](../../../src/lib/programs/metrics/) and its context-mill flow.
- **Linear is for very simple tasks and legacy support.** Composed program
  sub-runs are also structurally clamped to linear; orchestration cannot nest
  through that seam.
- **Anthropic Agent SDK remains supported as a legacy fallback, deprecated as
  the default.** Retain it for major Pi vulnerabilities or missing support for
  new Anthropic models.

Existing routing has not all migrated:
[DEFAULT_BINDING](../../../src/lib/agent/runner/switchboard/index.ts) still
selects Anthropic + linear, with per-program and flag overrides. Set new
bindings explicitly. Migrating an existing program requires checking its flow,
tasks, and lifecycle hooks; changing the default constant alone is insufficient.
Both harnesses implement `run` and `runTask`.

Adding a model or effort is a cross-repository change:

1. Define the Wizard model ID and capabilities in
   [constants](../../../src/lib/constants.ts) and
   [models](../../../src/lib/agent/runner/switchboard/models.ts); select it
   through the switchboard or supported context-mill stage metadata.
2. Check the PostHog mint's `WIZARD_MODEL_ALLOWLIST` and allowed efforts. The
   token's policy is enforced by the gateway; a local constant or CLI override
   cannot authorize a model.
3. Check the gateway's provider/catalog support and **required Wizard
   system-prompt policy**, including the security-triage request shape. A model
   not supported by that infrastructure needs a coordinated gateway/mint change
   before use.
4. Verify the chosen harness transport and effective effort with the same
   admission policy used by the target environment.

Local [commandments](../../../src/lib/agent/runner/switchboard/commandments.ts)
provide runtime and tool guidance. They do not replace the gateway's required
safety prompt. Keep gateway policy owned there rather than copying it into
skills. Do not infer per-model effort authorization merely from the local
capabilities table.

## Choose the extension surface

- For a framework, follow
  [adding-framework-support](../adding-framework-support/SKILL.md). Detection is
  pure; use bounded filesystem helpers and preserve specific-before-generic
  ordering.
- For a capability, follow
  [adding-skill-program](../adding-skill-program/SKILL.md). Prefer a
  context-mill command within an existing family when that is sufficient. A
  native command needs a command module and registration in `bin.ts`, as well as
  program and binding registration.
- For screens or primitives, follow [ink-tui](../ink-tui/SKILL.md). Program
  steps drive screen sequences; business logic calls `getUI()`, and session
  mutations use store setters that emit changes.
- For headless exploration, follow
  [exploring-the-wizard](../exploring-the-wizard/SKILL.md). Drive current legal
  actions and inspect error outros and pending questions throughout execution.

For a new concern, first look for an existing typed surface. Add an abstraction
only when it gives a real owner a smaller, reusable boundary.

## Lifecycle and security

[runner/index.ts](../../../src/lib/agent/runner/index.ts) bootstraps, resolves a
binding, and dispatches to a sequence. `agent-runner.ts` is a compatibility
re-export, not the implementation. Sequences own their lifecycle; harnesses own
SDK calls. `ProgramRun.postRun`, `buildOutroData`, `customPrompt`, and
`abortCases` are consumed by the linear sequence, not by the orchestrator. Put
orchestrated work in its flow/tasks and inspect its completion path when
extending it.

Keep tool enforcement at the boundary: shared permissions, harness-specific
adapters, and warlock scanning. Scanner failure must not silently allow an
unsafe operation. Review each adapter's blocking and termination behavior rather
than assuming every rejection terminates the run. New scanner rules belong in
warlock; changes to how a match is handled belong in Wizard.

User-provided secrets should travel through
[secret-vault](../../../src/lib/secret-vault.ts) references. Tool
implementations resolve values host-side where they are used; they must not
return the raw value to the model. Inspect the
[wizard-tools](../../../src/lib/wizard-tools/) implementations and the Pi
adapter when extending this shared tool surface.

## Verification and maintenance

Reuse existing tests for routing, registration, detection, state transitions,
and security behavior. Add a focused regression only when it protects a
meaningful failure mode that existing checks do not cover. Avoid tests of prose,
duplicated shape checks, and assertions already enforced by TypeScript.

For docs, verify local links and claimed APIs, then format edited files. For
code, run `pnpm typecheck` and the relevant existing Vitest files; build when
the change affects bundling or runtime behavior. `pnpm test` already builds.
Avoid repository-wide `pnpm fix` for a scoped edit. Keep new code comments to
one line.

[Coherence](../../../docs/coherence.md) anchors selected contracts to source and
existing tests. Its fast check does not execute tests or certify arbitrary
prose. Keep desired design policy distinguishable from current runtime behavior.

Read references as needed:

- [Architecture](references/ARCHITECTURE.md): routing, lifecycle, security and
  UI boundaries.
- [Anti-patterns](references/ANTI-PATTERNS.md): evaluate whether an extension
  fits.
- [Maintaining skills](references/MAINTAINING-SKILLS.md): update skills when
  architecture or APIs change.
