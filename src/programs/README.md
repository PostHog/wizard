# Programs

A program is a `ProgramConfig`: the steps the TUI walks, the agent run it
performs, and its program-level settings. `src/programs/` holds the program
configs, detection, the framework registry, the task stream, and `runProgram`,
which runs one program's agent from explicit inputs.

The [developer interfaces](../../docs/developer-interfaces.md) document the
callable contract: every `ProgramInput`, `ProgramSettings` and `ProgramOptions`
field, the outcome, the pipeline order, cancellation and the failure outcomes.
This page covers who owns what around that call.

## Entry points

Import runtime values from `@programs` and types from `@programs/types`.

| Entry             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@programs`       | `runProgram`, and the registry: `PROGRAM_REGISTRY`, `Program`, `getProgramConfig`, `getSubcommandPrograms`, `getCommandPath` and `getLaunchablePrograms`.                                                                                                                                                                                                                                                                                                                                                                        |
| `@programs/types` | The call types: `ProgramInput`, `ProgramSettings`, `ProgramOptions`, `ProgramOverrides`, `WizardFlagSnapshot` and `ProgramRunOutcome`. The store types: `ProgramProgress`, `ProgramRunProgress`, `ProgramDataProgress`, `ProgramInvocationData`, `ProgramDiagnostic` and `SettledProgramRun`. The host capabilities: `ProgramRunHost` and `ProgramCiHost`. The config types: `ProgramId`, `SubcommandProgram`, `ProgramConfig`, `ProgramStep`, `ProgramReadyContext`, `StoreInitContext`, `FrameworkConfig` and `SetupQuestion`. |

Code inside the repository reaches deeper modules through `@programs/*`:

- `runProgramAgent` in [`run-agent-legacy.ts`](run-agent-legacy.ts), the legacy
  adapter.
- `postAuthGateSteps` in [`program-step.ts`](program-step.ts), which lists the
  gated steps between the `auth` and `run` screens.
- `ResolvedProgramCredentials` and `CredentialsProvider` in
  [`credentials.ts`](credentials.ts).
- `ProgramStore` in [`program-store.ts`](program-store.ts).
- The detection tools in [`detection/`](detection/index.ts).

## The host

The caller of `runProgram` is the host. `runProgram` owns the policy around one
agent run. The host owns everything around the invocation.

| `runProgram` owns                                                          | The host owns                                                                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One `ProgramStore` for the invocation.                                     | Building `run` and the settings from a `ProgramConfig`.                                              |
| Calling the credentials provider, then identifying the user for analytics. | Login and project choice, inside its credentials provider.                                           |
| The AI SDK stamp, once per invocation.                                     | The consent screen behind `awaitAiApproval`.                                                         |
| Deciding when approval and post-auth gates apply.                          | The gate screens behind `awaitPostAuthGates`.                                                        |
| Loading flags when the input has none, through the host's `featureFlags`.  | Answering questions and task notices through `interaction`.                                          |
| The token refresh right before the agent starts.                           | Rendering progress from `onProgress`.                                                                |
| The route, the `switchboard resolved` event and the run tags.              | The readiness and Claude settings gates, before the call.                                            |
| Calling `runAgent` and settling one outcome.                               | File watchers, such as the audit ledger and the task stream's event plan.                            |
|                                                                            | Walking composed steps, and running programs that have no agent.                                     |
|                                                                            | Applying the outcome: exit code, auth error screen, rethrowing a crash, and `setup wizard finished`. |
|                                                                            | Cancelling through `signal`.                                                                         |

`runProgram` never calls `getUI()` and never reads a session. It still touches
process-wide state: the analytics client, the gateway auth cache and the debug
log. A dead OAuth grant during the token refresh marks the login revoked, so a
later 401 can name the cause.

A missing capability never hangs the run and never invents consent. A run that
needs approval fails without `awaitAiApproval`. A run with no `interaction` asks
no questions. A run with no `onProgress` still returns its settled run and final
data.

## The store

[`ProgramStore`](program-store.ts) holds one invocation's data and its run
ledger. `runProgram` creates one per call. The host never touches the store. It
sees copies through `onProgress` and the outcome.

- **Data.** `ProgramInvocationData`: the login, the framework context, the route
  and the AI SDK stamp latch. `setAuthenticated`, `setBinding`,
  `setAiSdkStampReported` and `setFrameworkContext` write it.
  `setAiSdkStampReported` writes only the first time. `runProgram` never calls
  `setFrameworkContext`, so `detection.frameworkContext` stays `{}`.
- **Copies.** Every write stores a `structuredClone` of its value. `readData()`
  returns a fresh clone. After each write, the store sends a
  `{ kind: 'program', data }` snapshot, itself a fresh clone.
- **Runs.** `beginRun(runId, observer)` returns an adapter with `onProgress` and
  `finish`. `onProgress` forwards a clone of each agent event as
  `{ kind: 'run', runId, event }`. `finish(result)` records the result, and
  `settledRuns()` lists every finished run. `runProgram` begins one run per
  call.
- **Diagnostics.** The store never waits for an observer. A throw or a rejected
  promise becomes a `ProgramDiagnostic` with its source and message. A run event
  after `finish` becomes a `progress after finish` diagnostic. The source is
  `{ runId, eventKind }` for a run event and `{ eventKind: 'data' }` for a data
  snapshot. The store keeps the 10 newest diagnostics.

## The adapter

`runProgramAgent(programConfig, session, { composed? })` in
[`run-agent-legacy.ts`](run-agent-legacy.ts) is the host for every existing
runner. It is the only program code that reads the session and `getUI()` on the
agent's behalf. It resolves `run` against the session and a `ProgramRunHost`,
runs the readiness and Claude settings gates, and builds the input from the
session and the config. It answers the capabilities from the UI, maps run events
onto `getUI()`, and projects data snapshots onto the session. Then it applies
the outcome with `wizardAbort` and the terminal analytics event.
[How the legacy adapter builds `run`](../../docs/developer-interfaces.md#how-the-legacy-adapter-builds-run)
lists every field it maps.

Three places call it:

- **The TUI runner.** [`run-wizard.ts`](../lib/runners/run-wizard.ts) calls it
  on the program's `run` screen. A composed step list calls it once per run
  step. Each call gets a session scoped to the step's `targetDir` when the step
  has one.
- **A composed run step.** `integrationRunStep` in
  [`posthog-integration/index.ts`](posthog-integration/index.ts) runs the
  integration with `composed: true`. Self-driving splices it into its own steps.
- **The non-interactive runner.**
  [`run-non-interactive.ts`](../lib/runners/run-non-interactive.ts) calls it
  after `ciPreRun`, for `--ci` and for headless runs.

## Host capabilities

A program's `run` and `ciPreRun` callbacks take their effects from a host
instead of calling `getUI()`. Both types live in
[`host-capabilities.ts`](host-capabilities.ts).

- **`ProgramRunHost`** reaches `ProgramConfig.run(session, host)`. It has
  `getFrameworkContext(key)`, `setFrameworkContext(key, value)` and
  `warn(message)`. The legacy adapter builds it over `getUI()`, read at each
  call. A run definition can keep the host and call it until the run returns.
  The source maps program reads the picked project in its prompt builder and
  writes `sourceMapsCompletedVariant` in `postRun`.
- **`ProgramCiHost`** reaches `ProgramConfig.ciPreRun(session, host)`. It has
  `log.info(message)` and `log.warn(message)`. The non-interactive runner builds
  it over `getUI().log`, read at each call. Project scoping logs its scan and
  its fallbacks through it.

Neither capability is a `runProgram` option. They belong to building the run
from a `ProgramConfig`, which happens before `runProgram`. The
[developer interfaces](../../docs/developer-interfaces.md#host-capabilities)
list which programs use each capability.

## Current limits

- **One agent per call.** Composition belongs to the host. The TUI walks a
  composed step list and calls the adapter once per run step. An imported run
  step, such as the integration inside self-driving, runs with `composed: true`.
- **Programs with no agent.** A config with no `run`, such as `posthog-doctor`,
  `mcp-add` or `slack`, never reaches `runProgram`. The TUI runs its steps.
- **Building `run` needs a session.** A dynamic `run`, the `ProgramRun`
  completion hooks and `seedTasks` all take a `WizardSession`. Some programs
  read session fields that a TUI step or `ciPreRun` fills, such as
  `session.frameworkConfig`.
- **The module graph.** `@programs` loads the program registry, and with it
  every program config, the TUI decks and `@ui`. `run-program.ts` also loads
  `@ui` through `authenticate.ts`, although `runProgram` never calls `getUI()`.
- **Other `getUI()` calls.** `authenticate`, the audit ledger watcher, agentic
  detection and some framework helpers still call `getUI()` directly.
- **No framework context in the data.** `data.detection.frameworkContext` stays
  `{}`. Framework context reaches the program through its run host.
- **Gates and cleanup stay with the host.** `runProgram` runs no readiness or
  Claude settings gate, starts no file watcher, and doesn't remove the skills a
  run installed.
- **Other agent paths.** Agentic detection makes its own `runAgent` calls, each
  with its own deadline. The MCP suggested-prompts screen streams through
  `runMcpPromptViaSdk`, a separate SDK path.
- **No live control.** There is no live store handle and no step-by-step control
  API. A host observes through `onProgress` and cancels through `signal`.
