---
name: adding-skill-program
description:
  Add a PostHog wizard capability backed by context-mill content. Choose a skill
  command or native program, configure an orchestrator flow, and wire any
  required CLI, screens, or prerequisites.
compatibility:
  Designed for coding agents working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: '3.0'
---

# Adding a Skill-Based Program

Read [wizard-development](../wizard-development/SKILL.md) for the shared design
policy. Use Pi for new agent work and prefer an orchestrator flow. Linear runs
are for very simple work and existing flows. The Anthropic SDK remains a
supported legacy fallback, deprecated as the default for new work; the shared
guide owns the fallback criteria and gateway model/effort/system-prompt
contract.

These are contribution defaults. Current runtime
[bindings](../../../src/lib/agent/runner/switchboard/index.ts) still default
many programs to Anthropic plus linear; documentation changes do not migrate
them.

## Choose the contribution surface

- **Content-only capability:** use the existing skill command machinery when it
  can express the workflow.
  [Context-mill](https://github.com/PostHog/context-mill) owns skill content and
  `cliEntries`. A new skill-backed child of an existing family ships through
  context-mill; inspect
  [family dispatch](../../../src/lib/programs/dispatch-family.ts). Unpromoted
  skills run through [the skill command](../../../src/commands/skill.ts).
- **Native program:** use a
  [ProgramConfig](../../../src/lib/programs/program-step.ts) when the wizard
  needs its own flow, screens, detection, composition, or other native behavior.
  Keep product instructions in context-mill.

Command names, program `id`, content-mill `agentFlow`, and `skillId` have
different roles. Use the full product name for public commands. The config field
is `id`, not the retired `flowKey`.

## Build a native orchestrator program

Use [metrics](../../../src/lib/programs/metrics/) as the current Pi/orchestrator
example and read the
[runner architecture](../wizard-development/references/ARCHITECTURE.md) when
changing execution behavior.

1. Add the program config under `src/lib/programs/<name>/`. Set `agentFlow` when
   its content-mill flow differs from `id`; setting it explicitly also documents
   the content dependency. Keep a `run` definition so the outer runner executes
   agent work.
2. Supply the flow's seed and task prompts in context-mill, including the task
   dependencies and applicable skill variants. The
   [orchestrator](../../../src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts)
   loads `agentFlow ?? id`, requires a seed prompt, and checks task-skill
   variants before running. `run.skillId` alone does not define this flow.
3. Register the config in
   [PROGRAM_REGISTRY](../../../src/lib/programs/program-registry.ts) and add its
   Pi/orchestrator entry to
   [PROGRAM_BINDINGS](../../../src/lib/agent/runner/switchboard/index.ts).
   [Existing binding checks](../../../src/lib/agent/runner/__tests__/switchboard.test.ts)
   enforce coverage; `ProgramId` currently widens to `string`.
4. For a standalone native command, create a command module with
   [nativeCommandFactory](../../../src/commands/factories/native-command-factory.ts)
   and register it in [bin.ts](../../../bin.ts). A native family child uses the
   handlers in family dispatch. Program registration derives screen sequences
   and store lookup, not the top-level CLI `.use()` chain.
5. Check [program OAuth scopes](../../../src/lib/oauth/program-scopes.ts)
   against the tools the program needs; add scopes only when the base set is
   insufficient.

Model and effort selections in flow frontmatter must be supported by the wizard
and gateway. Follow the cross-repo procedure in
[wizard-development](../wizard-development/SKILL.md) before introducing a model
or changing gateway-required prompt material.

## Simple linear programs and existing flows

For a very simple linear flow, use
[createSkillProgram](../../../src/lib/programs/agent-skill/index.ts) to
configure installation of one skill. Register the native program as above with
an explicit Pi/linear binding; the factory does not select a sequence. Read
`SkillProgramOptions` for required fields;
[audit](../../../src/lib/programs/audit/) demonstrates factory customization and
a dynamic `run(session)` that seeds a ledger.
[Revenue analytics](../../../src/lib/programs/revenue-analytics/) builds its
config directly and adds prerequisite detection.

`ProgramRun.customPrompt`, `abortCases`, `postRun`, and `buildOutroData` are
consumed by the
[linear sequence](../../../src/lib/agent/runner/sequence/linear.ts). `postRun`
runs after success; `buildOutroData` receives session and credentials, with host
information inside credentials. The orchestrator currently uses its own task
prompts, failure handling, and outro, and does not invoke those hooks. Check
this limitation before migrating a linear flow; setting an orchestrator binding
does not preserve these behaviors automatically.

## Screens, prerequisites, and composition

Reuse [AGENT_SKILL_STEPS](../../../src/lib/programs/agent-skill/steps.ts):
intro, health check, auth, run, outro, and keep-skills. Auth also applies the
shared [AI opt-in gate](../../../src/lib/programs/ai-opt-in-gate.ts) for agent
programs. Override `screenId`, not `screen`, when adapting a step. New screens
need an entry in [ScreenId](../../../src/ui/tui/screen-sequences.ts), a
component, and registration in
[screen-registry](../../../src/ui/tui/screen-registry.tsx). Follow
[ink-tui](../ink-tui/SKILL.md) for rendering and store usage.

Use a headless step's `onReady` for session-dependent detection, then render
structured `frameworkContext.detectError` data in the intro. `onInit` runs when
the TUI starts rendering with its initial session; `onReady` runs after the real
session is assigned. See [store hooks](../../../src/ui/tui/store.ts) and
[run-wizard](../../../src/lib/runners/run-wizard.ts). The
[noninteractive runner](../../../src/lib/runners/run-non-interactive.ts) also
walks `onReady` by default; set `ciPreRun` only when it needs a different
prerequisite strategy.

`requires` currently records metadata; it does not execute or enforce prior
programs. Compose real work through `ProgramStep.run`, with `onRunPrep` and
`targetDir` when needed. The
[integration run step](../../../src/lib/programs/posthog-integration/index.ts)
and [self-driving](../../../src/lib/programs/self-driving/) demonstrate this.
Composed sub-runs are structurally linear; orchestrators cannot nest.

## Validate the affected path

Reuse the relevant registry, binding, detection, or routing checks. Add a
focused behavioral test only for a meaningful gap; avoid tests that repeat
configuration fields. Check that the selected CLI route resolves the intended
program and that its content-mill flow is available. Use the
[exploration guide](../exploring-the-wizard/SKILL.md) for a warranted end-to-end
run against a disposable app. Follow
[wizard-development](../wizard-development/SKILL.md) for proportionate checks;
documentation-only changes need source/link verification.
