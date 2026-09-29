---
title: Runner architecture and data flow
description:
  Source map for routing, lifecycle, security boundaries, and screen resolution.
---

# Architecture

## Runner and lifecycle

The CLI picks a host and hands it the launch values.
[runTui](../../../../src/tui/run.ts) owns the interactive lifecycle: start the
TUI, build and assign the session, run the readiness hooks, settle the intro,
and call `runProgram` once, with the flow's screens answering its steps through
[tuiWorkflow](../../../../src/tui/workflow.ts).
[store.ts](../../../../src/tui/store.ts) runs each flow step's `onInit` when the
TUI starts. `runReadyHooks` awaits the program's `ProgramConfig.onReady` once,
after the real session is assigned, and marks detection complete. Keep
session-dependent detection in `onReady`. Noninteractive execution has its own
host, [runHeadless](../../../../src/headless/run.ts), which builds its own
session store and calls `runProgram` with no workflow; `runProgram` then runs
the same `onReady` as its detection, or `ciPreRun` when the program sets one.

[runProgram](../../../../src/programs/run-program.ts) runs detection when the
store hasn't, resolves the program's `run` definition, applies its readiness,
login, approval and flag policy, and calls `runAgent` for each run step the host
confirms and then the program's own run, writing everything into the caller's
[SessionStore](../../../../src/programs/session/session-store.ts).
[runner/index.ts](../../../../src/agent/runner/index.ts) resolves the route from
`RunConfig.routing`, calls shared bootstrap, dispatches the sequence, and
flushes the scanner report on cleanup.

| Layer           | Source and responsibility                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap       | [shared/bootstrap.ts](../../../../src/agent/runner/shared/bootstrap.ts): logging targets, the gateway mint and the scan-triage classifier; health, settings, login and flags arrive resolved from `runProgram` |
| Switchboard     | [switchboard/index.ts](../../../../src/agent/runner/switchboard/index.ts): resolve sequence, harness, model and effort override                                                                                |
| Linear sequence | [sequence/linear.ts](../../../../src/agent/runner/sequence/linear.ts): one conversation, skill/prompt assembly, post-run hooks and outro                                                                       |
| Orchestrator    | [orchestrator-runner.ts](../../../../src/agent/runner/sequence/orchestrator/orchestrator-runner.ts): seed plan, task queue, focused conversations, handoffs and completion                                     |
| Harness         | [harness/types.ts](../../../../src/agent/runner/harness/types.ts): SDK boundary, implemented by Pi and Anthropic                                                                                               |

The contribution policy is
[Pi by default, orchestration preferred](../SKILL.md#execution-policy-and-model-admission).
Linear remains useful for very simple tasks and legacy support. Existing
bindings and composed sub-runs still use it; the Anthropic SDK remains a
supported legacy fallback. These are separate choices: sequence describes the
work shape, harness selects the SDK, and the model selects a gateway/provider
route.

### Configuration hooks

Read [ProgramRun](../../../../src/programs/program-run.ts) and
[AgentRunDefinition](../../../../src/agent/runner/shared/types.ts) for exact
signatures.

| Surface                                | Current consumer                                               |
| -------------------------------------- | -------------------------------------------------------------- |
| `customPrompt`, `abortCases`           | Linear prompt assembly and abort handling                      |
| `postRun(session, credentials)`        | Linear success path, before outro                              |
| `buildOutroData(session, credentials)` | Linear custom outro; otherwise defaults from run metadata      |
| `buildOutroNextSteps(session, ...)`    | Orchestrated outro bullets                                     |
| `agentFlow` and task skill variants    | Orchestrator flow selection and task execution                 |
| `ProgramConfig.binding`                | The program's route; `DEFAULT_BINDING` when unset              |
| `ProgramConfig.runSteps`               | Explicit program composition in the outer lifecycle            |
| `ProgramConfig.requires`               | Dependency metadata; it does not execute prerequisite programs |

Do not migrate a linear program merely by changing its binding if it depends on
these hooks. Inspect the orchestrator's flow and completion path instead.
[Metrics](../../../../src/programs/metrics/) is a current Pi/orchestrator
example. A program with a top-level `command` gets its CLI command from the
registry through [wizardCommands](../../../../src/cli/commands/index.ts), and
screen sequences derive from each program's TUI flow.

## Switchboard contract

`resolveBinding(ctx, role?)` is the routing seam. Read its exported types rather
than copying their fields into another document. It receives the program, flag
snapshot/payloads, composition state, and development overrides, returning the
binding and stamping a trace of the selected precedence rungs.

- Harness/model: development CLI override, declared flag route, the program's
  binding (`DEFAULT_BINDING` when it declares none).
- Sequence: composed linear clamp, development CLI override, `runTask`
  capability clamp, program flag route, sequence experiment, binding/default.

[Harness](../../../../src/agent/runner/switchboard/harness.ts) and
[sequence](../../../../src/agent/runner/switchboard/sequence.ts) contain the
exact chains. Published builds omit CLI overrides. `RUN_SURFACE` can disable
harness experiments; static bindings and harness capabilities also affect
resolution. Composed sub-runs remain linear even when a CLI override requests
orchestration.

Effort resolves in two stages: the binding supplies an override, then
[modelCapabilities](../../../../src/agent/runner/switchboard/models.ts) applies
capabilities and defaults. All selected models and efforts must also be admitted
by the minted token and gateway. Local routing cannot bypass that external
policy; see the
[model admission checklist](../SKILL.md#execution-policy-and-model-admission).

Flags belong in
[switchboard/flags](../../../../src/agent/runner/switchboard/flags/).
Experiments declare their program scope; malformed payloads yield no experiment
route. Reuse the
[switchboard tests](../../../../src/agent/runner/__tests__/switchboard.test.ts)
and experiment tests to check full bindings and isolation of unrelated programs;
they run on synthetic programs, and each program pins its own binding in its
`__tests__`. Do not add a second flag-reading path inside a harness or sequence.

## Security boundaries

The gateway admits scoped tokens, models, efforts, and required prompt policy.
Wizard's local tool boundary separately restricts operations on the user's
project. Local commandments provide model guidance; they are not an enforcement
mechanism.

- [agent-interface.ts](../../../../src/agent/agent-interface.ts) configures the
  Anthropic SDK's tool permissions, sandbox, and gateway transport.
- [yara-hooks.ts](../../../../src/agent/yara-hooks.ts) adapts warlock scans to
  SDK tool hooks.
- [Pi security](../../../../src/agent/runner/harness/pi/security.ts) adapts
  shared permissions and scanning to Pi tool-call/result events, including
  blocking, violation latching, and tool-call limits.
- [Pi harness](../../../../src/agent/runner/harness/pi/) explicitly supplies
  tools, scrubs shell environments, and disables project-controlled
  extensions/context loading.
- [triage-provider.ts](../../../../src/agent/triage-provider.ts) supplies
  gateway-backed classification for scanner findings.

Scanner rules live in [warlock](https://github.com/PostHog/warlock); Wizard owns
how its returned categories, severities, and actions affect execution. Scanner
failures must not silently permit unsafe operations, but not every blocked call
terminates the run. Check each adapter's state machine when changing rejection
handling. Preserve useful rejection diagnostics without logging secret content.

Both SDK paths use a scoped gateway token minted through
[gateway-session.ts](../../../../src/agent/gateway-session.ts), not the user's
raw OAuth credential as a model API key. Rejection and refresh behavior belong
at that seam; do not restore a legacy-gateway fallback to bypass admission.

### Secret vault: keeping values out of the model

[secret-vault.ts](../../../../src/shared/secret-vault.ts) stores user-provided
values in memory and returns opaque references. Sensitive `wizard_ask` answers
become `secret:<uuid>` refs; `set_env_values` resolves the ref host-side when
writing. Follow [wizard-tools](../../../../src/agent/tools/) and the Pi adapters
when adding a secret-consuming tool. Return references and metadata to the
agent, never the raw value. References are session-scoped, not durable
credentials.

## UI state and agent output

Programs never use the UI. A program's `run` gets a `RunnerContext` and its
`ciPreRun` gets a `CiRunnerContext`, both from
[runner-context.ts](../../../../src/programs/runner-context.ts), and it reads a
`ProgramSession`. Each host reports through its own renderer, with no UI
interface shared between them: TUI code takes the
[WizardStore](../../../../src/tui/store.ts) it reports through as an argument,
headless prints through its
[LoggingUI](../../../../src/headless/renderers/logging-ui.ts), and CLI commands
through `consoleLog` (`@shared/console-log`). There are no process-global sinks.
An agent run's debug lines are info log progress, which the host's progress
handler shows. An abort takes its presenter as an argument:
[abortOnScreens](../../../../src/tui/abort.ts) in the TUI, `printAbortOutro` in
headless and before the TUI mounts. `runProgram` writes run state into the
session store; `displayProgress` updates the TUI's display state; `LoggingUI`
prints log lines for `--ci` and headless runs. A missing TTY does not
automatically mean an arbitrary caller prints log lines; snapshot CI drives Ink
in a PTY. `requestQuestion` and task notices are supported interactions, not
console prompts to invent in business logic.

Harness adapters translate SDK messages, status markers, task updates and tool
activity into `AgentProgress` events. The agent never renders:
[agent-progress.ts](../../../../src/tui/agent-progress.ts) writes each event to
the store. Anthropic message processing lives in
[agent-interface.ts](../../../../src/agent/agent-interface.ts); Pi uses its own
session event handlers. Orchestrated tasks also have queue and handoff state. Do
not assume all harness output passes through `handleSDKMessage`.

Session changes go through explicit store setters. They emit updates,
re-evaluate gates, detect transitions, and refresh rendering. The
[router](../../../../src/tui/router.ts) routes a failed agent run to the
mint-failure handoff, then resolves overlays, then the first visible incomplete
screen from [screen-sequences.ts](../../../../src/tui/screen-sequences.ts).
Those sequences are projected from each registered program's or tool's flow,
which [`flowOwner`](../../../../src/tui/flow-owner.ts) looks up by id: the TUI
tool registry first, then the TUI program registry. Change the state/predicate
that represents progress rather than adding imperative navigation.

## MCP and instrumentation

Remote PostHog tools, local wizard tools, and optional framework MCP servers are
separate surfaces. The Anthropic SDK's MCP integration and Pi's adapter expose
them differently; inspect the selected harness rather than assuming identical
tool names or discovery. Context-mill supplies skills and flow/task prompts.

[Middleware](../../../../src/agent/middleware/) provides opt-in message/phase
instrumentation. The linear sequence creates the benchmark pipeline. Inspect the
actual consumer before extending instrumentation to another sequence or harness.

## Layer boundaries

Each layer is a TypeScript project, and `pnpm typecheck` is `tsc -b` on the root
[tsconfig.json](../../../../tsconfig.json), which only lists them. The build
orders itself by `references` and emits declarations into `.tsbuild/`. A layer's
`tsconfig.json` extends [tsconfig.no-tui.json](../../../../tsconfig.no-tui.json)
(the TUI extends [tsconfig.base.json](../../../../tsconfig.base.json)), holds
its folder with its tests, and `references` only the layers it may import.
Importing a file of a project it doesn't reach fails with TS6307. A few ESLint
rules close the paths the compiler can't see. CI runs `pnpm typecheck` in
[build.yml](../../../../.github/workflows/build.yml).

`tsconfig.base.json` holds the compiler options and the aliases, entries only:
`@env`, `@shared/*`, `@utils/*`, `@host/*`, `@agent`, `@agent/types`,
`@programs`, `@programs/types`, `@programs/<id>`, `@tools`, `@tui`, `@headless`
and `@cli`. Three deep aliases stay for the layer that owns them: `@agent/*`,
`@programs/*` and `@cli/*` in tests and source, and `@tui/*` in the TUI.
`extends` copies `compilerOptions` but not `references`, and replaces `paths`
whole, so the projects that need other aliases list them again.

| Layer               | Project                                                                                                                                          | References                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| env                 | `src/tsconfig.json`: `env.ts`                                                                                                                    | Nothing                                                              |
| shared              | `src/shared/tsconfig.json`                                                                                                                       | env                                                                  |
| host                | `src/host/tsconfig.json`                                                                                                                         | env, shared                                                          |
| agent               | `src/agent/tsconfig.json`                                                                                                                        | env, shared                                                          |
| tools               | `src/tools/tsconfig.json`                                                                                                                        | env, shared, agent                                                   |
| shared program code | `src/programs/tsconfig.core.json`                                                                                                                | env, shared, agent                                                   |
| one program         | `src/programs/<id>/tsconfig.json`                                                                                                                | The shared program code                                              |
| programs entry      | `src/programs/tsconfig.json`: `index.ts`, `types.ts`, `program-registry.ts`, `run-program.ts`, `detect-program.ts`, `detect-map.ts`, `__tests__` | The shared program code and every program                            |
| headless            | `src/headless/tsconfig.json`                                                                                                                     | env, shared, host, agent, programs entry                             |
| TUI core            | `src/tui/tsconfig.core.json`                                                                                                                     | env, shared, host, agent, programs entry, tools                      |
| one TUI program     | `src/tui/programs/<id>/tsconfig.json`                                                                                                            | The TUI core                                                         |
| one TUI tool        | `src/tui/tools/<id>/tsconfig.json`                                                                                                               | The TUI core                                                         |
| TUI entry           | `src/tui/tsconfig.json`: `index.ts`, `programs/index.ts`, `tools/index.ts`, `playground/` and the core's tests                                   | The TUI core, every TUI program and tool                             |
| cli                 | `src/cli/tsconfig.json`                                                                                                                          | env, shared, host, agent, programs entry, tools, TUI entry, headless |
| bin                 | `tsconfig.bin.json`: `bin.ts`, `tsdown.config.ts`, `vitest.config.ts`                                                                            | env, shared, cli                                                     |
| harness             | `e2e-harness/tsconfig.json`: `e2e-harness/`, `scripts/` and `docs/examples/`                                                                     | env, shared, host, agent, tools, programs entry, TUI entry, headless |
| mocks               | `__mocks__/tsconfig.json`                                                                                                                        | Nothing                                                              |

The host layer, `src/host`, is how the hosts end a run: `startHostExit`,
`wizardAbort`, `registerShutdown` and `withControlledAbort` in
`@host/wizard-abort`. A host resolves its run's exit code; `wizardAbort` shows a
decided failure's outro through the presenter its caller passes and hands the
code to it, and only the CLI calls `process.exit`. It also holds the control
API, `@host/control`, which each host attaches to its own store: the server
knows no program, so a host passes the program ids a request may name. Headless,
the TUI, the CLI and the harness reference it. The agent and the programs don't,
so an import of it there fails with TS6307.

The TUI, headless and the CLI each have one entry, their `index.ts`. Each entry
function loads its module on first call, so importing an entry is as cheap as
importing its launch types:

| Entry       | Exports                                                                                                                                                                                                                                                    | Imported by                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `@tui`      | `runTui` with `TuiLaunch`, `TuiLaunchChoices` and `TuiControlAttach`, `runTuiTool` with `TuiToolLaunch`, `renderFamilyPicker` with `FamilyPickerOption`, `runPlayground`, `createTuiTarget` and `tuiProgramFlow` with `FlowStep`, `ScreenId` and `Overlay` | The CLI and the e2e harness |
| `@headless` | `runHeadless`, `HeadlessLaunch` and `HeadlessMode`                                                                                                                                                                                                         | The CLI                     |
| `@cli`      | `runCli`                                                                                                                                                                                                                                                   | `bin.ts`                    |

### Splits and stubs

The programs and the TUI each split in two so a folder can't import its sibling.
The core (`tsconfig.core.json`) holds the shared code, and each program, TUI
program and TUI tool folder is its own project that references it, so a
sibling's folder fails with TS6307. The entry project (`tsconfig.json` beside
the core) holds the registry and references the core and every folder, so a
registry imports the folders and nothing imports the registry back. The entry
project also holds the layer's tests, since a test may import any part. The TUI
core calls the registries through two signature stubs, `types/tui-programs.d.ts`
and `types/tui-tools.d.ts`, that its own `paths` map to `@tui/programs/index`
and `@tui/tools/index`; it reads a flow through `flowOwner`, so a tool's id
never falls back to the skill flow.

A new program, TUI program or TUI tool folder needs its own `tsconfig.json`,
copied from a sibling, and a `references` line in its entry project. See
[adding-skill-program](../../adding-skill-program/SKILL.md).

### Fences

Outside the TUI, `ink`, `ink/*`, `react`, `react/*`, `@inkjs/ui` and
`ink-testing-library` map, in `tsconfig.no-tui.json` and `tsconfig.bin.json`, to
`types/tui-only.fence`. That resolves to `types/tui-only.d.fence.ts`, and
TypeScript rejects every import of a `.d.ts` file with an arbitrary extension
while `allowArbitraryExtensions` is off, so never turn it on. A named, default,
namespace or side-effect import, `import()`, `typeof import()` and `export *`
all fail with TS6263. A missing fence file falls back to the real package, so
keep it. Three more options close the rest:

| Option                         | Effect                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `noUncheckedSideEffectImports` | `import 'x'` resolves like any other import, so it meets the fences and fails when nothing resolves     |
| `moduleDetection: "force"`     | Every `.ts` file is a module, so `declare module 'ink'` in one augments the fence and fails with TS6263 |
| `resolveJsonModule: false`     | A JSON import fails with TS2732. The MCP prompt copy is a TS data module, `mcp-role-prompts.copy.ts`    |

### What each import fails with

A project reaches what it references, and what those reference. TypeScript
doesn't stop that second hop, and `paths` can't stop a relative path, so
`tsconfig.bin.json` maps only `@cli` for `bin.ts`, and ESLint closes the rest.

| Import                                                                                                            | Fails with                    |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| A layer's file from a layer that doesn't reference it: `@programs/audit` in the agent, `@headless` in the TUI     | TS6307                        |
| A sibling program or TUI program folder, or a registry from a program or TUI folder                               | TS6307                        |
| An alias the project doesn't map: `@tui/run` in the CLI, `@tui`, `@headless` or `@agent` in `bin.ts`              | TS2307                        |
| `ink`, `react`, `@inkjs/ui` or `ink-testing-library` outside the TUI, in any form                                 | TS6263                        |
| A relative path that leaves the layer's folder: `../tui/run` in the CLI, `../src/programs/audit/x` in the harness | ESLint `no-restricted-syntax` |
| A deep alias outside its layer: `@programs/audit/x` or `@agent/runner/x` in the harness                           | ESLint `no-restricted-syntax` |

TS6307 lands on the import line, and again at the imports of every file that
import pulls in. tsc sorts errors by path, so an import of another program or
the registry can print dozens of errors in other program folders before the one
in your file.

### What ESLint checks

TypeScript can't see these paths, so `pnpm lint` rejects each with a rule in
[.eslintrc.cjs](../../../../.eslintrc.cjs):

| Rule                                                                                                                            | Rejects                                                                                     | Why the compiler can't                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-imports`, patterns `.tsbuild` and `node_modules`                                                                 | An import or re-export whose path has a `.tsbuild/` or `node_modules/` segment              | `paths` never sees a relative path, so `../../node_modules/ink/build/index.js` compiles past the fence                                                                                                                                                          |
| `no-restricted-syntax` on `import()` and `typeof import()`                                                                      | The same paths in `import('...')`, a template-literal `import()` and `typeof import('...')` | The same, and `no-restricted-imports` sees only import and export declarations                                                                                                                                                                                  |
| `no-restricted-imports`, paths `module` and `node:module`, and `no-restricted-syntax` on their `import()` and `typeof import()` | Any import, re-export, `import()` or `typeof import()` of `module` or `node:module`         | Its loaders, such as `createRequire`, return `any` and load what no project resolves. Two uses carry a disable line with their reason: the SDK's CLI path in `src/agent/agent-interface.ts` and the `@xterm/headless` CJS entry in `e2e-harness/tui-capture.ts` |
| `no-restricted-globals`, `require`                                                                                              | A bare `require`                                                                            | `@types/node` declares it, so TypeScript types a call as `any` and resolves no path. A local `require` from `createRequire` is not the global                                                                                                                   |
| `@typescript-eslint/triple-slash-reference`, `path: 'never'`                                                                    | `/// <reference path="..." />`                                                              | It loads a declaration file past the project's file list, and a `declare module` in that file beats `paths`                                                                                                                                                     |
| `no-restricted-syntax` on `vi.mock` and `vi.doMock`                                                                             | A string-form mock, `vi.mock('<path>')`                                                     | A string is not an import, so no project resolves it. `vi.mock(import('<path>'))` resolves in the test's project, and its factory must match the module's exports                                                                                               |
| `no-restricted-syntax`, one override per layer folder and depth                                                                 | A relative import that leaves its layer's folder, and a deep alias outside its own layer    | A project reaches every file of a project it references, by any path. `@agent/types` and each `@programs/<id>` stay allowed                                                                                                                                     |

Neither the compiler nor these rules stop an `import()` of a computed path,
which TypeScript types as `any`, or the string a test hands `vi.importActual`,
which no project resolves. ESLint ignores `scripts/`, so the rules don't reach
it; the harness project still compiles it against its references only.

Don't widen a layer's `paths` or `references` to make an import compile, and
don't route an import through one of these gaps. Move the code, or add the name
to the entry it should come through. A test of another layer's internals belongs
in that layer's tests. A test mocks another layer through the entry it imports,
`vi.mock(import('<entry>'))`. The factory's value must match the module's
exports; a partial stub of an object or a function with a narrower return is
cast `as never`. A harness test reads a TUI program's flow through
`tuiProgramFlow` on `@tui`.
