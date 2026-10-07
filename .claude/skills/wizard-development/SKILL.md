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
  version: '2.2'
---

# Wizard development

Ask who owns the concern and what they should need to understand to change it.
Product knowledge belongs behind typed configuration boundaries; runner and UI
infrastructure should consume those boundaries.

| Concern                                               | Owner                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework detection, context, env conventions         | [FrameworkConfig](../../../src/programs/framework-config.ts) and [framework configs](../../../src/programs/frameworks/)                                                                       |
| Integration instructions and orchestrator flows/tasks | [context-mill](https://github.com/PostHog/context-mill)                                                                                                                         |
| Programs: detection, runs, prerequisites and outcomes | One folder per program in [programs](../../../src/programs/), entered through its `index.ts`                                                                                                  |
| Tools: commands that run no agent                     | [tools](../../../src/tools/), entered through `@tools`, with their screens in [TUI tools](../../../src/tui/tools/)                                                                            |
| Program screens, flows and decks                      | [TUI programs](../../../src/tui/programs/)                                                                                                                                                    |
| Sequence, harness, model and effort selection         | [switchboard](../../../src/agent/runner/switchboard/)                                                                                                                       |
| Local tool permissions and scanner adapters           | [agent-interface](../../../src/agent/agent-interface.ts), [YARA hooks](../../../src/agent/yara-hooks.ts), [Pi security](../../../src/agent/runner/harness/pi/security.ts) |
| Scanner rules                                         | [warlock](https://github.com/PostHog/warlock)                                                                                                                                   |
| Token admission and budgets                           | [PostHog mint endpoint](https://github.com/PostHog/posthog/blob/master/posthog/llm/wizard_gateway_token.py) and [ai-gateway](https://github.com/PostHog/ai-gateway)             |
| Screen resolution and rendering                       | [TUI](../../../src/tui/) through its [store](../../../src/tui/store.ts)                                                                                                                       |
| Layer import boundaries                               | One tsconfig project per layer, checked by `pnpm typecheck`, and ESLint rules for the paths the compiler can't see; see [layer boundaries](references/ARCHITECTURE.md#layer-boundaries)       |

## Execution policy and model admission

- **Pi is the default choice for new work.** Harness choice and model provider
  are separate: Pi supports gateway-backed Anthropic and OpenAI transports.
- **Prefer orchestration.** A seed agent plans work, then task agents execute
  focused conversations. Start from
  [metrics](../../../src/programs/metrics/) and its context-mill flow.
- **Linear is for very simple tasks and legacy support.** Composed program
  sub-runs are also structurally clamped to linear; orchestration cannot nest
  through that seam.
- **Anthropic Agent SDK remains supported as a legacy fallback, deprecated as
  the default.** Retain it for major Pi vulnerabilities or missing support for
  new Anthropic models.

[DEFAULT_BINDING](../../../src/agent/runner/switchboard/index.ts) selects
Pi + linear for a program whose config sets no `binding`; flags and development
overrides sit on top. Set new bindings explicitly. Migrating an existing program
requires checking its flow, tasks, and lifecycle hooks; changing the default
constant alone is insufficient. Both harnesses implement `run` and `runTask`.

Adding a model or effort is a cross-repository change:

1. Define the Wizard model ID and capabilities in
   [constants](../../../src/shared/constants.ts) and
   [models](../../../src/agent/runner/switchboard/models.ts); select it
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

Local [commandments](../../../src/agent/runner/switchboard/commandments.ts)
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
  native command needs a command module in `src/cli/commands/` and registration
  in `runCli` (`src/cli/index.ts`), as well as program registration.
- For a command that runs no agent, such as `mcp add` or `doctor`, follow
  [Add a tool](../../../src/tools/README.md#add-a-tool). A tool never goes
  through `runProgram`, and no program imports one.
- For screens or primitives, follow [ink-tui](../ink-tui/SKILL.md). A program's
  flow in `src/tui/programs/<id>/` drives its screen sequence. Programs never
  use the UI; they get a runner context. TUI code takes the store it reports
  through as an argument, and session mutations use store setters that emit
  changes.
- For headless exploration, follow
  [exploring-the-wizard](../exploring-the-wizard/SKILL.md). Drive current legal
  actions and inspect error outros and pending questions throughout execution.

For a new concern, first look for an existing typed surface. Add an abstraction
only when it gives a real owner a smaller, reusable boundary.

## Lifecycle and security

[runner/index.ts](../../../src/agent/runner/index.ts) resolves the route from
`RunConfig.routing`, bootstraps, and dispatches to a sequence.
Sequences own their lifecycle; harnesses own
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
[secret-vault](../../../src/shared/secret-vault.ts) references. Tool
implementations resolve values host-side where they are used; they must not
return the raw value to the model. Inspect the
[wizard-tools](../../../src/agent/tools/) implementations and the Pi
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

Keep desired design policy distinguishable from current runtime behavior.

Read references as needed:

- [Architecture](references/ARCHITECTURE.md): routing, lifecycle, security and
  UI boundaries.
- [Anti-patterns](references/ANTI-PATTERNS.md): evaluate whether an extension
  fits.
- [Maintaining skills](references/MAINTAINING-SKILLS.md): update skills when
  architecture or APIs change.
