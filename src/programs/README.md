# Programs

A program is an agent run: one thing the wizard does for a user with an agent,
such as adding PostHog or setting up error tracking. Each program is a
`ProgramConfig`: the detection it runs before the flow starts, the agent run it
performs, and its settings. The screens the TUI walks for it live in the TUI. A
command that runs no agent, such as `mcp add` or `doctor`, is a tool, in
[`src/tools`](../tools/README.md); no program imports it.

The program layer has three parts, which import in one direction: the
program contract ([`program-contract`](program-contract/index.ts)), the
[services](../services/README.md) and the programs.
[`program-runner`](program-runner/run-program.ts) runs them: `runProgram`, the registry,
detection lookup, the run's input and outcome types, and login.

To run a program from code, call `runProgram`. The
[developer interfaces](../../docs/developer-interfaces.md) cover it.

## One folder per program

Each program lives in `src/programs/<id>/`, and its `index.ts` is the only
entry. It exports the program's `ProgramConfig` as `config`, and the detectors
and keys the TUI and the CLI use. An entry that registers several programs, such
as `audit`, exports them as `configs`, a readonly array, instead. The TUI, the
CLI and the registry import it as `@programs/<id>`, and no program folder's
source imports another program's folder. A program folder has no other
`index.ts`, since `@programs/<id>/<dir>` would reach it.

Adding a program touches its own folders and a few lines outside them. Its own
folders:

- **`src/programs/<id>/`.** The `index.ts` entry, the program's code and its
  tests in `<id>/__tests__`. Its `tsconfig.json`, copied from a sibling
  unchanged, makes the folder one project, tests included. It references only
  [`tsconfig.core.json`](tsconfig.core.json), the shared program code, so a
  program can't compile another program's files. An optional `test/e2e.json` is
  the program's e2e test definition, which the harness finds by its `program`
  field.
- **`src/tui/programs/<id>/`.** The flow, the LearnCard deck, the screens and
  their commits, entered through its `index` module. It has its own
  `tsconfig.json` too, copied the same way from a sibling. It references only
  [`src/tui/tsconfig.core.json`](../tui/tsconfig.core.json), the TUI core. A
  program with no TUI folder runs the generic skill flow and deck.

The lines outside them:

- **Registry.** The program's import and its entry in `PROGRAM_REGISTRY`, in
  [`program-registry.ts`](program-runner/program-registry.ts), and `{ "path": "<id>" }` in
  `references` in [`tsconfig.json`](tsconfig.json).
- **TUI registry.** Its import and spread in
  [`src/tui/programs/index.ts`](../tui/programs/index.ts), and
  `{ "path": "programs/<id>" }` in `references` in
  [`src/tui/tsconfig.json`](../tui/tsconfig.json), when it has a TUI folder.
- **Intro.** Its id in `INTRO_ENTRIES`, in
  [`intro-menu.ts`](../tui/programs/posthog-integration/intro-menu.ts), only
  when the intro hands off to it.
- **Owners.** Both folders in [`CODEOWNERS`](../../.github/CODEOWNERS), and the
  [ownership table](../../README.md#wizard-ownership) that mirrors it, when a
  team owns the program.
- **Command.** A command file in `src/cli/commands/`, and a `.use(...)` line for
  it in `runCli`, in [`src/cli/index.ts`](../cli/index.ts), only when the
  program has a CLI command.

Then run `pnpm typecheck`, which is `tsc -b`. A folder with no `tsconfig.json`,
or one no `references` entry lists, fails at the registry's import with TS6307.
ESLint, in [`.eslintrc.cjs`](../../.eslintrc.cjs), covers what references can't:
a relative import stays in its layer's folder, and another layer's deep alias is
out.

What other code needs to know about a program is on its config and derived from
the registry:

- **CLI command.** `command` and `cliOptions` are what the program's command
  file builds its command from, usually with `nativeCommandFactory`.
- **OAuth scopes.** `oauthScopeAdditions` widen the base set its login asks for.
  `completionScopeOptional` lets a login without `event_definition:write`
  proceed, for a program that creates no event definitions.
- **Route.** `binding` sets the sequence, harness and model; without one the
  program runs on `DEFAULT_BINDING`.

## What goes in and out of `runProgram`

- **In.** A `ProgramInput` with the caller's `SessionStore`, and options for the
  login, questions, progress and the workflow that answers the run's steps.
- **Out.** One `ProgramRunOutcome` at the end, and the run recorded in the
  store: detection, the login, readiness, progress, the outro or the failure.
- **Never in.** The UI. Each host builds its own store: the TUI's `WizardStore`
  sits on top of its session store, headless uses one as is, and an embedder
  builds its own with `new SessionStore(buildSession(...))`.

A program's `run` reads the `ProgramSession` and gets a runner context. It never
reaches the UI.

## Where things live

| What                                          | Where                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| One program's config, detection and prompt    | Its own folder, such as [`metrics`](metrics/index.ts)                             |
| One program's flow, deck and screens          | `src/tui/programs/<id>/`, registered in [`src/tui/programs/index.ts`](../tui/programs/index.ts) |
| One program's e2e test definition             | Its folder's `test/e2e.json`, read by [`e2e-harness/profiles.ts`](../../e2e-harness/profiles.ts) |
| One orchestrator program's task graph and prompts | Its folder's `flow.ts` and `agent/<type>.md`; see [orchestrator flows](#orchestrator-flows) |
| Code several programs share                   | [`shared`](shared/skill-program.ts): program builders and [`program-scopes.ts`](shared/program-scopes.ts) |
| The list of every program                     | [`program-registry.ts`](program-runner/program-registry.ts)                                      |
| Running one program, and its input and outcome | [`run-program.ts`](program-runner/run-program.ts), [`detect-program.ts`](program-runner/detect-program.ts) and [`program-input.ts`](program-runner/program-input.ts) |
| Commands that pick a program by skill         | [`dispatch-family.ts`](../cli/commands/dispatch-family.ts)                        |
| The program contract: `ProgramConfig`, `ProgramSession`, `RunnerContext`, `FrameworkConfig` | [`program-contract`](program-contract/index.ts), its own project below the services |
| The session store, detection, frameworks, codebase scan and tool catalog | [`src/services`](../services/README.md) |

Other layers import runtime values from `@programs` and types from
`@programs/types`, which re-exports the program contract. `@programs` exports
`runProgram`, `ProgramAbort` (a decided stop a program throws instead of
exiting), `SessionStore` and `buildSession`, `storeInteraction` (questions held
in a store until a screen or an embedder answers), `resolveApiKeyLogin` (a login
from a personal API key) and `apiKeyCredentials` (a credentials provider that
makes one), `logIn`, `TASK_OUTCOMES_KEY`, the task stream, the registry lookups,
and the shared program code the hosts call. Program code may import `@env`,
`@shared/*`, `@utils/*`, `@agent`, `@agent/types`, the program contract,
`@programs/program-contract`, and the service entries, `@services/<service>`. A program folder also imports the shared program code, by
relative path, and only the registry's entry files import every program. Every
programs project extends `tsconfig.no-tui.json`, which maps `@programs/*`. A
program's project references only the shared program code, so an import of a
sibling program or the registry fails with TS6307; see
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Orchestrator flows

An orchestrator program declares its task graph in `flow.ts` with `defineFlow`
from the program contract: one node per task type, keyed by type, with
`dependsOn`, an optional `when` over the run's project traits and flags,
`picked` for a node the planner or the program decides to queue, and
`matchInputs` for a fanned-out chain. `resolveFlow` applies the conditions; a
dropped node's dependents inherit its edges. The run hands the result to the
orchestrator as `RunConfig.taskGraph`. A `when` treats a missing trait as "run
the node". The run's traits come from
[`@services/project-traits`](../services/README.md).

Each task's prompt is `agent/<type>.md`, the job to be done; the skills it
names carry the implementation detail. `pnpm bundle:agent-prompts` regenerates
the program's `agent-prompts.ts` from that folder, which `agentPrompts` loads on
first use. Tests in [`__tests__`](__tests__) fail when the module is stale, when
a prompt differs from the recorded context-mill release in
`fixtures/context-mill/`, when a graph's nodes differ from its prompts, or when
a node misses the sink.

With `wizard-agent-dag` on, the orchestrator loads the bundled prompts (falling
back to context-mill's on any failure) and rewires the planner's queue to the
typed graph. Off, it fetches the prompts and logs where the typed graph and the
planner's graph differ as `orchestrator graph diff`.

## Session store and task streams

The session store and the task stream that pushes it to PostHog are services.
See [session store and task streams](../services/README.md#session-store-and-task-streams).

## Login and signup

[`login.ts`](program-runner/login.ts) logs in once per store. The root README covers
[scopes](../../README.md#required-api-key-scopes), the
[OAuth app scope ceiling](../../README.md#oauth-app-scope-ceiling), and
[signup](../../README.md#headless-signup--install-agents--ci).

## Add a program

Follow the
[adding-skill-program](../../.claude/skills/adding-skill-program/SKILL.md)
skill. A framework integration uses
[adding-framework-support](../../.claude/skills/adding-framework-support/SKILL.md)
instead.
