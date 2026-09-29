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
  version: '4.0.1'
---

# Adding a Skill-Based Program

Read [wizard-development](../wizard-development/SKILL.md) for the shared design
policy. Use Pi for new agent work and prefer an orchestrator flow. Linear runs
are for very simple work and existing flows. The Anthropic SDK remains a
supported legacy fallback, deprecated as the default for new work; the shared
guide owns the fallback criteria and gateway model/effort/system-prompt
contract.

These are contribution defaults. A program whose config sets no `binding` runs
on [DEFAULT_BINDING](../../../src/agent/runner/switchboard/index.ts), Pi and
linear.

## Choose the contribution surface

- **Content-only capability:** use the existing skill command machinery when it
  can express the workflow.
  [Context-mill](https://github.com/PostHog/context-mill) owns skill content and
  `cliEntries`. A new skill-backed child of an existing family ships through
  context-mill; inspect
  [family dispatch](../../../src/cli/commands/dispatch-family.ts). Unpromoted
  skills run through [the skill command](../../../src/cli/commands/skill.ts).
- **Native program:** use a
  [ProgramConfig](../../../src/programs/program-step.ts) when the wizard needs
  its own flow, screens, detection, composition, or other native behavior. Keep
  product instructions in context-mill.

Command names, program `id`, context-mill `agentFlow`, and `skillId` have
different roles. Use the full product name for public commands. The config field
is `id`.

## Build a native orchestrator program

Use [metrics](../../../src/programs/metrics/) as the current Pi/orchestrator
example and read the
[runner architecture](../wizard-development/references/ARCHITECTURE.md) when
changing execution behavior.

1. Add the program folder `src/programs/<id>/`. Its `index.ts` is the only
   entry: it exports the `ProgramConfig` as `config`, and any detectors or keys
   the TUI and CLI need. No other file in the folder is named `index.ts`. Copy a
   sibling's `tsconfig.json` into the folder, unchanged, and add
   `{ "path": "<id>" }` to `references` in
   [`src/programs/tsconfig.json`](../../../src/programs/tsconfig.json). The
   folder is one project, its tests included, and `pnpm typecheck` (`tsc -b`)
   builds it. Without the reference, the registry's import fails with TS6307.
   Keep tests in `<id>/__tests__`; they reach other layers through their entries
   only. Shared program code goes in `src/programs/shared/`, `detection/`,
   `warehouse-sources/`, `frameworks/` or `oauth/`, never in another program's
   folder, and has no `index.ts`. A program imports its own files and the shared
   program code by relative path, such as `../shared/skill-program`. Set
   `agentFlow` when its context-mill flow differs from `id`; setting it
   explicitly also documents the content dependency. Keep a `run` definition so
   `runProgram` executes agent work.
2. Supply the flow's seed and task prompts in context-mill, including the task
   dependencies and applicable skill variants. The
   [orchestrator](../../../src/agent/runner/sequence/orchestrator/orchestrator-runner.ts)
   loads `agentFlow ?? id`, requires a seed prompt, and checks task-skill
   variants before running. `run.skillId` alone does not define this flow.
3. Register the config: import it as
   `import { config as <name> } from '@programs/<id>'` in
   [program-registry.ts](../../../src/programs/program-registry.ts) and add it
   to `PROGRAM_REGISTRY`. Set the config's `binding` to Pi and the orchestrator.
   `ProgramId` is a `string`.
4. For a standalone native command, set `command` on the config. The CLI builds
   the command with
   [nativeCommandFactory](../../../src/cli/commands/factories/native-command-factory.ts)
   and lists it at the program's place in the registry
   ([`wizardCommands`](../../../src/cli/commands/index.ts)). A native family
   child uses the handlers in family dispatch.
5. Check the program's OAuth scopes against the tools it needs. Add
   `oauthScopeAdditions` to the config only when the base set is insufficient.
   Keep a program's own set in its folder, as
   [replay-vision](../../../src/programs/replay-vision/scopes.ts) does; sets
   several programs share live in
   [`program-scopes.ts`](../../../src/programs/oauth/program-scopes.ts).

Model and effort selections in flow frontmatter must be supported by the wizard
and gateway. Follow the cross-repo procedure in
[wizard-development](../wizard-development/SKILL.md) before introducing a model
or changing gateway-required prompt material.

## Simple linear programs and existing flows

For a very simple linear flow, use
[createSkillProgram](../../../src/programs/shared/skill-program.ts) to configure
installation of one skill. Register the native program as above. The factory
sets no `binding`, so the program runs on `DEFAULT_BINDING` unless you add one
to the config it returns. Read `SkillProgramOptions` for required fields;
[audit](../../../src/programs/audit/) demonstrates factory customization and a
dynamic `run(session)` that seeds a ledger.
[Revenue analytics](../../../src/programs/revenue-analytics/) builds its config
directly and adds prerequisite detection.

`ProgramRun.customPrompt`, `abortCases`, `postRun`, and `buildOutroData` are
consumed by the [linear sequence](../../../src/agent/runner/sequence/linear.ts).
`postRun` runs after success; `buildOutroData` receives session and credentials,
with host information inside credentials. The orchestrator currently uses its
own task prompts, failure handling, and outro, and does not invoke those hooks.
Check this limitation before migrating a linear flow; setting an orchestrator
binding does not preserve these behaviors automatically.

## Screens, prerequisites, and composition

The program's UI lives in `src/tui/programs/<id>/`: `flow.ts`, `deck/`,
`screens/`, `screen-ids.ts`, and an `index.ts(x)` entry whose `TUI_PROGRAMS`
maps each program id it serves to a
[TuiProgram](../../../src/tui/programs/types.ts) (flow, deck, tips, screens, and
control `actions`/`setters`). Outside the folder, the
[TUI program registry](../../../src/tui/programs/index.ts) imports and spreads
the entry. A program with no entry runs
[AGENT_SKILL_STEPS](../../../src/tui/programs/shared/skill-flow.ts): intro,
health check, auth, run, outro, and keep-skills, with the skill deck. Use
`skillFlow(introScreenId)` to swap in your own intro screen. Auth also applies
the shared [AI opt-in gate](../../../src/tui/ai-opt-in-gate.ts),
`withAiOptInGate(config, flow)`, for agent programs. Set `healthCheck: false` on
the config when the run skips the PostHog readiness check, and leave the
health-check step out of its flow. Flow steps are
[FlowStep](../../../src/tui/flow.ts)s. Override `screenId` when adapting one. A
new screen needs an id in the folder's `screen-ids.ts`, a component, and an
entry in its entry's `screens`; the
[screen registry](../../../src/tui/screen-registry.tsx) mounts every program's
screens. Writes only the program makes, its screens' answers and any session
fields that go with them, go in the folder's `store-actions.ts` through
`store.updateTuiState`. The folder is its own tsconfig project: it may import
the TUI core, through `@tui/*` and never by relative path, `@programs`,
`@programs/types` and its own `@programs/<id>`, never another program's folder
or the registry. Besides its line in `src/tui/programs/index.ts`, a new folder
needs a `tsconfig.json` copied from a sibling, unchanged, and
`{ "path": "programs/<id>" }` in `references` in
[`src/tui/tsconfig.json`](../../../src/tui/tsconfig.json). Then run
`pnpm typecheck`. Without both, the registry's `@tui/programs/<id>` import fails
with TS6307.

Follow [ink-tui](../ink-tui/SKILL.md) for rendering and store usage. If the
program is team-owned, add both folders to `CODEOWNERS`.

Use the config's `onReady(ctx)` for session-dependent detection, then render
structured `frameworkContext.detectError` data in the intro. A step's `onInit`
runs when the TUI starts rendering with its initial session. `onReady` runs
after the real session is assigned: `runTui` calls `runReadyHooks` in
[store.ts](../../../src/tui/store.ts) before the intro, and
[`detectProgram`](../../../src/programs/detect-program.ts) runs it as the
detection of a run whose store has none, as in headless. Set `ciPreRun` only
when a CI session needs a different prerequisite strategy: `detectProgram` runs
it in place of `onReady` for a CI session. Programs read a `ProgramSession` and
never use the UI: `run` gets a `RunnerContext`, `ciPreRun` gets a
`CiRunnerContext` and a run step's `onRunPrep` gets the runner's `log`
([runner-context.ts](../../../src/programs/runner-context.ts)).

`requires` currently records metadata; it does not execute or enforce prior
programs. Compose real work through `runSteps`, keyed by the flow step id, with
`runProgramId`, `onRunPrep` and `targetDir` when needed.
[Self-driving](../../../src/programs/self-driving/index.ts) runs
`posthog-integration` composed at its `integrate-run` step. Composed sub-runs
are structurally linear; orchestrators cannot nest. A run step without
`runProgramId` can set `targetDir` and `onRunPrep` to scope the program's own
agent to a picked project and keep its sequence, as
[error-tracking](../../../src/programs/error-tracking/index.ts) does for its
`run` step.

## Validate the affected path

Reuse the relevant registry, binding, detection, or routing checks. Add a
focused behavioral test only for a meaningful gap; avoid tests that repeat
configuration fields. Check that the selected CLI route resolves the intended
program and that its context-mill flow is available. Use the
[exploration guide](../exploring-the-wizard/SKILL.md) for a warranted end-to-end
run against a disposable app. Follow
[wizard-development](../wizard-development/SKILL.md) for proportionate checks;
documentation-only changes need source/link verification.
