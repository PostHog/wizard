# Programs

A program is an agent run: one thing the wizard does for a user with an agent,
such as adding PostHog or setting up error tracking. Each program is a
`ProgramConfig`: the detection it runs before the flow starts, the agent run it
performs, and its settings. The screens the TUI walks for it live in the TUI. A
command that runs no agent, such as `mcp add` or `doctor`, is a tool, in
[`src/tools`](../tools/README.md); no program imports it.

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
  [`program-registry.ts`](program-registry.ts), and `{ "path": "<id>" }` in
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
| Code several programs share                   | [`shared`](shared/skill-program.ts), [`warehouse-sources`](warehouse-sources/registry.ts) and [`oauth`](oauth/program-scopes.ts) |
| The list of every program                     | [`program-registry.ts`](program-registry.ts)                                      |
| The `ProgramConfig`, ready and run-step types | [`program-step.ts`](program-step.ts)                                              |
| The session a program reads                   | [`program-session.ts`](program-session.ts)                                        |
| The session store every host builds           | [`session`](session/session-store.ts): the store and the task stream              |
| Running one program, and its input and outcome | [`run-program.ts`](run-program.ts), [`detect-program.ts`](detect-program.ts) and [`program-input.ts`](program-input.ts) |
| What a program's `run` receives from a runner | [`runner-context.ts`](runner-context.ts)                                          |
| Framework detection and project scoping       | [`detection`](detection)                                                          |
| Framework integrations                        | [`frameworks`](frameworks) and [`frameworks/registry.ts`](frameworks/registry.ts) |
| Commands that pick a program by skill         | [`dispatch-family.ts`](../cli/commands/dispatch-family.ts)                        |

Other layers import runtime values from `@programs` and types from
`@programs/types`. `@programs` exports `runProgram`, `ProgramAbort` (a decided
stop a program throws instead of exiting), `SessionStore` and `buildSession`,
`storeInteraction` (questions held in a store until a screen or an embedder
answers), `resolveApiKeyLogin` (a login from a personal API key) and
`apiKeyCredentials` (a credentials provider that makes one), `logIn`,
`TASK_OUTCOMES_KEY`, the task stream, the registry lookups, and the shared
program code the hosts call. Program code may import `@env`, `@shared/*`,
`@utils/*`, `@agent` and `@agent/types`. A program folder also imports the
shared program code, by relative path, and only the registry's entry files
import every program. Every programs project extends `tsconfig.no-tui.json`,
which maps `@programs/*`. A program's project references only the shared program
code, so an import of a sibling program or the registry fails with TS6307; see
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Add a program

Follow the
[adding-skill-program](../../.claude/skills/adding-skill-program/SKILL.md)
skill. A framework integration uses
[adding-framework-support](../../.claude/skills/adding-framework-support/SKILL.md)
instead.
