# Developer interfaces

Wizard has two TypeScript call surfaces for code that runs without the terminal
UI. `runProgram` runs one program. `runAgent` runs one agent. Both live in this
repository and import through its path aliases. The `@posthog/wizard` npm
package publishes the CLI, not these functions.

| Surface                                 | Import from                               | Use it for                                                              |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `runProgram(programId, input, options)` | `@programs`, types from `@programs/types` | One program's agent run, with the program's policy, route and telemetry |
| `runAgent(config, input, options)`      | `@agent`, types from `@agent/types`       | One agent run from a resolved config, with no program policy            |

The [programs reference](../src/programs/README.md) covers the store, the
adapter and the current limits. The [agent reference](../src/agent/README.md)
covers the run contract.

## What `runProgram` is for

`runProgram` runs one program's agent from explicit inputs. It needs no
`WizardSession`, no TUI store and no `getUI()` call. The caller is the host. The
host supplies the run definition, the credentials, consent, the gate waits and
the answers. `runProgram` applies the program policy around the agent run. It
resolves credentials, checks AI-processing approval, waits for post-auth gates,
loads flags, refreshes the token and resolves the route. Then it calls
`runAgent` and returns one outcome.

Two hosts call it:

- **The legacy adapter.** `runProgramAgent` in
  [`run-agent-legacy.ts`](../src/programs/run-agent-legacy.ts) serves the TUI
  and the `--ci` runner. See
  [how the legacy adapter builds `run`](#how-the-legacy-adapter-builds-run).
- **The workbench.**
  [PostHog/wizard-workbench#4190](https://github.com/PostHog/wizard-workbench/pull/4190)
  adds `services/wizard-program/`. Its `pnpm wizard-program` imports
  `runProgram` from `@programs` in the wizard checkout that `WIZARD_REPO` names.
  It runs one program against an app copy with no TUI.

## Signatures

```ts
import { runProgram } from '@programs';
import type {
  ProgramInput,
  ProgramOptions,
  ProgramRunOutcome,
} from '@programs/types';

// The shape `@programs` exports.
export const signature: (
  programId: string,
  input: ProgramInput,
  options?: ProgramOptions,
) => Promise<ProgramRunOutcome> = runProgram;
```

`programId` names the program for analytics, the route, the gateway spend pin
and the commandments. `runProgram` doesn't look it up in the program registry.
An ID with no entry in `PROGRAM_BINDINGS` runs on `DEFAULT_BINDING`.

`@programs/types` exports the input, settings, option, outcome and progress
types. The credential types are the exception. Name them as
`ProgramInput['credentials']` and `ProgramOptions['credentials']`. They live in
[`credentials.ts`](../src/programs/credentials.ts) as
`ResolvedProgramCredentials` and `CredentialsProvider`.

## `ProgramInput`

`installDir` and `run` are required. Every other field is optional.

| Field                                                            | What `runProgram` does with it                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installDir`                                                     | The agent's working directory. `artifacts.reportFile` resolves against it.                                                                                                                                      |
| `run`                                                            | The program's `AgentRunDefinition`, built by the host from its `ProgramConfig`. It becomes `RunConfig.run`. Its `reportFile` names the report. Its `integrationLabel` and `skillId` label analytics and traces. |
| `program`                                                        | The `ProgramSettings` read from the same `ProgramConfig`. See [`ProgramSettings`](#programsettings). Defaults to `{}`.                                                                                          |
| `credentials`                                                    | A resolved login: `{ posthog, project, apiUser }`. It wins over `options.credentials`.                                                                                                                          |
| `runId`                                                          | Labels the agent run in `settledRuns` and in run progress events. A random UUID when absent. It isn't the analytics run ID.                                                                                     |
| `overrides`                                                      | `{ harness?, sequence?, model? }`, the launch overrides such as `--harness`. The switchboard applies them in development and test builds and ignores them in published builds.                                  |
| `composed`                                                       | `true` for a sub-run inside a host program. The switchboard clamps it to linear, and the agent leaves the terminal outro to the host. Defaults to `false`.                                                      |
| `skillId`                                                        | The run's skill, for question attribution and the result's `skillId`. The orchestrator uses it as the framework key when `integration` is absent. Defaults to `run.skillId`, then `run.integrationLabel`.       |
| `integration`                                                    | The detected framework.                                                                                                                                                                                         |
| `frameworkDocsUrl`                                               | The framework's docs page, for the orchestrator's preflight message.                                                                                                                                            |
| `flags`                                                          | Run flags: `ci`, `signup`, `debug`, `e2eAsk`, `localMcp`, `captureAio`, `benchmark` and `yaraReport`. A missing flag is `false`.                                                                                |
| `host`                                                           | Where PostHog is: `baseUrl`, `region`, `email`, `projectId` and `apiKey`. `baseUrl` also points the token refresh.                                                                                              |
| `wizardFlags`                                                    | An evaluated feature flag snapshot. When it's absent, `runProgram` calls `options.featureFlags`.                                                                                                                |
| `wizardFlagPayloads`                                             | The flag payloads from the same snapshot.                                                                                                                                                                       |
| `seedTasks`                                                      | Returns the tasks the orchestrator queues before its planner runs.                                                                                                                                              |
| `hooks`                                                          | `RunHooks`, each called with the run's credentials: `postRun`, `buildOutroData`, `buildOutroNextSteps` and `recordTaskOutcomes`.                                                                                |
| `discoveredFeatures`, `warehouseSources`, `mayReportScanResults` | Evidence for the organization's AI SDK stamp. When `mayReportScanResults` is absent or `false`, no stamp is sent.                                                                                               |
| `aiSdkStampReported`                                             | `true` when the host already considered the stamp for this login. `runProgram` then skips it.                                                                                                                   |

The agent calls completion hooks only through `hooks`. It never calls the
`postRun`, `buildOutroData` or `buildOutroNextSteps` of a `ProgramRun`, because
those take a session. Bind them into `hooks` yourself. The linear sequence
installs `run.skillId`, not `input.skillId`.

`runProgram` copies the input when it receives it. `credentials`, `run`,
`program`, `hooks` and `seedTasks` stay by reference, because they can carry
functions or class instances. `structuredClone` copies every other field. A
later host write to the input doesn't reach the run. A copied field that
`structuredClone` can't copy, such as a function in `host`, rejects the call.

## `ProgramSettings`

`input.program` carries the program-level settings from `ProgramConfig`.

| Field               | What `runProgram` does with it                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `requiresAi`        | `false` skips the AI-processing approval. Any other value, including absent, keeps the check.                  |
| `agentFlow`         | The context-mill flow the orchestrator loads. Defaults to the program ID.                                      |
| `allowedTools`      | Tools added on top of the base allowed set.                                                                    |
| `disallowedTools`   | Tools removed from the base allowed set.                                                                       |
| `excludedTaskTypes` | `(flags) => types`. The task types this run excludes for its flag snapshot.                                    |
| `postAuthGates`     | Step IDs the host settles after auth and before the agent starts. `runProgram` passes them to the gate option. |

## `ProgramOptions`

Every option is optional. An awaited capability receives the invocation's
`signal`. Without `options.signal`, it receives a signal that never aborts.

| Option               | What `runProgram` does with it                                                                      | When it's absent                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `credentials`        | Calls `resolve(programId, { signal })` once, only when `input.credentials` is absent.               | Without `input.credentials`, the run fails.                          |
| `awaitAiApproval`    | Calls it with `{ programId, signal }` when the run needs approval. `true` proceeds. `false` aborts. | A run that needs approval fails.                                     |
| `awaitPostAuthGates` | Calls it once with `{ programId, gates, signal }` when `program.postAuthGates` isn't empty.         | The run doesn't wait.                                                |
| `featureFlags`       | Calls it once when `input.wizardFlags` is absent. It receives no signal.                            | The run uses the input's flags, or none.                             |
| `interaction`        | Passes it to `runAgent`, which asks it the agent's questions and task notices.                      | The agent installs no ask bridge and declines optional task notices. |
| `onProgress`         | Receives run events and data snapshots. See [progress](#progress). It is never awaited.             | The outcome still carries the settled run and the final data.        |
| `signal`             | Cancels the invocation. See [cancellation](#cancellation).                                          | Nothing cancels it.                                                  |

A run needs approval when all three hold:

- `program.requiresAi` isn't `false`.
- Neither `flags.ci` nor `flags.signup` is set.
- The organization's `is_ai_data_processing_approved` isn't `true`.

`flags.ci` and `flags.signup` skip the check. Set them only when the host has
already handled consent.

## The outcome

`runProgram` resolves with a `ProgramRunOutcome`.

| Field                  | What it holds                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `programId`            | The ID the call ran.                                                                                                                                                                                                                       |
| `outcome`              | A `RunOutcome`: `success`, `aborted`, `failed` or `crashed`.                                                                                                                                                                               |
| `failure`              | Present on every outcome except `success`. An `AgentFailure` with a `code` and a `message`. An agent failure can also carry `outroData`, `error`, `exitCode`, `detail` and `authErrorDetail`. A crash always carries the original `error`. |
| `settledRuns`          | `{ runId, result }` for the agent run, once `runAgent` returned. Empty when the invocation ended before the agent.                                                                                                                         |
| `data`                 | A copy of the invocation's `ProgramInvocationData` when it settled.                                                                                                                                                                        |
| `diagnostics`          | Up to 10 observer failures and late events, newest last.                                                                                                                                                                                   |
| `artifacts.reportFile` | The absolute report path: `run.reportFile` resolved against `installDir`. Set just before the agent starts. It doesn't prove the agent wrote the file.                                                                                     |

`ProgramInvocationData` has these fields:

| Field                                  | What it holds                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `credentials`, `apiProject`, `apiUser` | The resolved login, updated when the token refresh returns new credentials. `null` until credentials resolve.  |
| `detection.frameworkContext`           | Always `{}` from `runProgram`. Framework context reaches a program through its [run host](#host-capabilities). |
| `binding`                              | The resolved route: `sequence`, `harness`, `model` and `thinkingLevel`. `null` until the route resolves.       |
| `aiSdkStampReported`                   | `true` once the organization's AI SDK stamp was considered.                                                    |

Data and progress are `structuredClone` copies. A class instance comes back as a
plain object: `data.credentials.host` has the `HostResolution` fields but isn't
an instance. `data` holds PostHog tokens, so don't log it.

`runProgram` writes to the process-wide analytics client. It sends
`agent started` and `switchboard resolved`, sets the `sequence` and `harness`
tags, and identifies the user. It never sends `setup wizard finished`. The host
sends it from the outcome with `analytics.shutdown(status)`.

### Progress

`onProgress` receives a `ProgramProgress`, a union of two kinds. Narrow on
`kind` first.

- **`{ kind: 'run', runId, event }`.** One agent event. `event` is a copied
  [`AgentProgress`](../src/agent/README.md#signatures).
- **`{ kind: 'program', data }`.** A copy of `ProgramInvocationData`, sent after
  each write. A write happens when credentials resolve, when the AI SDK stamp
  latches, when the refresh returns new credentials, and when the route
  resolves.

`runProgram` never awaits the observer. A throw or a rejection becomes a
diagnostic. So does a run event that arrives after the agent run finished. The
outcome copies `diagnostics` when it settles, so a rejection that lands later
isn't in it.

## Pipeline order

1. Copy the input. If `signal` is already aborted, return `aborted`.
2. Send the `agent started` analytics event.
3. Resolve credentials from `input.credentials`, else from
   `options.credentials`. Without either, fail.
4. Store the login. Identify the user for analytics and set the organization
   group.
5. Consider the AI SDK stamp once, unless `aiSdkStampReported` is `true`.
6. When the run needs approval, await `awaitAiApproval`.
7. When `program.postAuthGates` isn't empty, await `awaitPostAuthGates`.
8. When `input.wizardFlags` is absent, await `featureFlags`.
9. Refresh the OAuth token when it has a refresh token, an expiry, and less than
   50 minutes left. A failed refresh keeps the current token.
10. Resolve the route from the program ID, `composed`, the flags and
    `overrides`. Tag analytics with the sequence and harness, and send
    `switchboard resolved`.
11. Build the run tags, set `artifacts.reportFile`, and call `runAgent` with
    `interaction`, the run's progress and `signal`.
12. Record the agent's result and settle.

The [runner reference](../src/agent/runner/README.md) describes what `runAgent`
does from step 11.

## Cancellation

`runProgram` checks `signal` before it starts and after each await in steps 3
to 9. An abort at any of those points returns `aborted` with the message
`Run cancelled by host.`, even when the capability already resolved. A
capability that rejects after the abort also returns `aborted`.

`runProgram` doesn't race a capability against the signal. It waits for the
capability to settle, so a capability must settle when its signal aborts.
`featureFlags` receives no signal.

After step 9, `runProgram` doesn't check the signal itself. `runAgent` receives
it. An abort before the agent's setup returns `aborted` right away. An abort
during the run returns the agent's `aborted` result. Both carry the message
`Agent run cancelled`.

## Failure outcomes

Most endings resolve. A rejected promise means the call itself broke.

| Cause                                                    | `outcome`           | `failure.code`           | `failure.message`                                                 |
| -------------------------------------------------------- | ------------------- | ------------------------ | ----------------------------------------------------------------- |
| No `input.credentials` and no `options.credentials`      | `failed`            | `PHW_INTERNAL_UNHANDLED` | `Credentials are required to run <programId>.`                    |
| The run needs approval and there is no `awaitAiApproval` | `failed`            | `PHW_INTERNAL_UNHANDLED` | `AI processing approval is required before this program can run.` |
| `awaitAiApproval` resolves `false`                       | `aborted`           | `PHW_AGENT_ABORT`        | `AI processing approval declined.`                                |
| An await in steps 3 to 9 rejects                         | `failed`            | `PHW_INTERNAL_UNHANDLED` | The error's message                                               |
| The host's signal aborts before the agent                | `aborted`           | `PHW_AGENT_ABORT`        | `Run cancelled by host.`                                          |
| The agent run doesn't succeed                            | The agent's outcome | The agent's code         | The agent's message                                               |
| A copied input field can't be cloned                     | The promise rejects |                          |                                                                   |

The agent returns `failed` for a coded error, a decided failure or an agent that
stops itself with `[ABORT]`. It returns `aborted` only for the host's signal. It
returns `crashed` for an uncoded throw, with the original `Error` attached. See
the [agent reference](../src/agent/README.md#signatures).

## Example

This host runs the `metrics` program with a login it already holds. It asks its
own consent flow for approval:

```ts
import { RunOutcome } from '@agent';
import { getProgramConfig, runProgram } from '@programs';
import type { ProgramInput, ProgramOptions } from '@programs/types';

type Login = NonNullable<ProgramInput['credentials']>;
type AskForApproval = NonNullable<ProgramOptions['awaitAiApproval']>;

export async function runMetrics(
  installDir: string,
  login: Login,
  askForApproval: AskForApproval,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const config = getProgramConfig('metrics');
  if (!config.run || typeof config.run === 'function') {
    throw new Error('metrics has a static run definition');
  }

  const result = await runProgram(
    config.id,
    {
      installDir,
      run: config.run,
      credentials: login,
      program: {
        requiresAi: config.requiresAi,
        agentFlow: config.agentFlow,
        allowedTools: config.allowedTools,
        disallowedTools: config.disallowedTools,
        excludedTaskTypes: config.excludedTaskTypes,
      },
    },
    {
      awaitAiApproval: askForApproval,
      signal,
      onProgress: (progress) => {
        if (progress.kind !== 'run') return;
        if (progress.event.kind === 'status') {
          console.log(progress.event.message);
        }
      },
    },
  );

  if (result.outcome !== RunOutcome.Success) {
    throw result.failure?.error ?? new Error(result.failure?.message);
  }
  return result.artifacts.reportFile;
}
```

## How the legacy adapter builds `run`

`runProgramAgent(programConfig, session, { composed? })` is the host for the TUI
and for `--ci`. It builds the input from the `ProgramConfig` and the session,
then calls `runProgram` once:

1. It throws when the config has no `run`.
2. It starts the audit ledger watcher when the config names `auditLedgerFile`,
   before `run` resolves. It stops the watcher when the run returns.
3. It resolves `run`. A static `ProgramRun` passes as is. A function is called
   as `run(session, host)`, with a [`ProgramRunHost`](#host-capabilities) over
   `getUI()`.
4. It sets `session.skillId`, starts the log file, and runs the health gate and
   the Claude settings gate.
5. It calls `runProgram` with the input and options below.
6. It applies the outcome.

The input comes from the config and the session:

| `ProgramInput` field                                                                   | Source                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `run`                                                                                  | `ProgramConfig.run`, resolved in step 3.                                                                      |
| `program`                                                                              | `requiresAi`, `agentFlow`, `allowedTools`, `disallowedTools` and `excludedTaskTypes` from the config.         |
| `program.postAuthGates`                                                                | The IDs of `postAuthGateSteps(config.steps)`, the gated steps between the `auth` screen and the `run` screen. |
| `hooks`                                                                                | `run.postRun`, `run.buildOutroData` and `run.buildOutroNextSteps`, bound to the session.                      |
| `hooks.recordTaskOutcomes`                                                             | Writes the drained queue's outcomes to `session.frameworkContext[TASK_OUTCOMES_KEY]`.                         |
| `seedTasks`                                                                            | `config.seedTasks`, bound to the session.                                                                     |
| `installDir`, `composed`, `skillId`, `integration`                                     | The session and the `composed` option.                                                                        |
| `overrides`                                                                            | `session.harness`, `session.sequence` and `session.model`.                                                    |
| `frameworkDocsUrl`                                                                     | The `FRAMEWORK_REGISTRY` docs URL for `session.integration`, else for `session.skillId`.                      |
| `flags`, `host`                                                                        | The session's run flags, and its `baseUrl`, `region`, `email`, `projectId` and `apiKey`.                      |
| `aiSdkStampReported`, `discoveredFeatures`, `warehouseSources`, `mayReportScanResults` | The session's stamp latch, detection results and scan consent.                                                |

The options come from the UI:

| `ProgramOptions` field | Source                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `credentials`          | `authenticate(session, programId)`, then the session's credentials, project and user. |
| `awaitAiApproval`      | Waits for the AI opt-in screen to clear, then resolves `true`.                        |
| `awaitPostAuthGates`   | Waits for each gate in order with `ui.waitForGate`.                                   |
| `featureFlags`         | The analytics client's flags and payloads.                                            |
| `onProgress`           | Run events go to the UI reducer. Data snapshots project onto the session and the UI.  |
| `interaction`          | The UI's ask overlay and task notice modal.                                           |
| `signal`               | Not set.                                                                              |

The projection copies a refreshed token onto the session and the UI, and latches
the AI SDK stamp on the session. When the route first resolves, it registers a
cleanup that flushes the scan report. On a linear route, it also restores the
Claude settings when the outro screen opens.

The adapter applies the outcome the way the CLI roots expect:

- A login failure or a flag load failure rethrows after `runProgram` resolves.
- `crashed` rethrows `failure.error`.
- Any other non-success shows the auth error screen when `authErrorDetail` is
  set. Then it calls `wizardAbort` with the failure, with status `cancelled` for
  `aborted` and `error` otherwise.
- A `success` that isn't composed sends `setup wizard finished` through
  `analytics.shutdown('success')`. A failed flush is logged, and the run stays a
  success.

A host with no TUI can build the input the same way. A dynamic `run` and the
program hooks take a `WizardSession`, so the host builds one and fills what the
program reads:

```ts
import { buildSession } from '@lib/wizard-session';
import { getProgramConfig } from '@programs';
import { postAuthGateSteps } from '@programs/program-step';
import type { ProgramId, ProgramInput, ProgramRunHost } from '@programs/types';

export async function buildProgramInput(
  programId: ProgramId,
  installDir: string,
  host: ProgramRunHost,
): Promise<ProgramInput> {
  const config = getProgramConfig(programId);
  if (!config.run) throw new Error(`${programId} has no run`);

  const session = buildSession({ installDir, ci: true });
  const run =
    typeof config.run === 'function'
      ? await config.run(session, host)
      : config.run;
  const { postRun, buildOutroData, buildOutroNextSteps } = run;
  const { seedTasks } = config;

  return {
    installDir,
    run,
    program: {
      requiresAi: config.requiresAi,
      agentFlow: config.agentFlow,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      excludedTaskTypes: config.excludedTaskTypes,
      postAuthGates: postAuthGateSteps(config.steps).map((step) => step.id),
    },
    seedTasks: seedTasks && (() => seedTasks(session)),
    hooks: {
      postRun: postRun && ((credentials) => postRun(session, credentials)),
      buildOutroData:
        buildOutroData &&
        ((credentials) => buildOutroData(session, credentials) ?? undefined),
      buildOutroNextSteps:
        buildOutroNextSteps &&
        ((credentials, completed) =>
          buildOutroNextSteps(session, credentials, completed)),
    },
  };
}
```

Some programs read session fields that a TUI step or `ciPreRun` fills. For
example, the `posthog-integration` run reads `session.frameworkConfig`, which
its detect step sets.

## Host capabilities

A program's `run` and `ciPreRun` callbacks take their effects from a host. They
don't call `getUI()`. Both types come from `@programs/types`:

```ts
import type { ProgramCiHost, ProgramRunHost } from '@programs/types';

const frameworkContext = new Map<string, unknown>();

export const runHost: ProgramRunHost = {
  getFrameworkContext: (key) => frameworkContext.get(key),
  setFrameworkContext: (key, value) => {
    frameworkContext.set(key, value);
  },
  warn: (message) => console.warn(message),
};

export const ciHost: ProgramCiHost = {
  log: {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
  },
};
```

| Capability       | Received by                             | What programs use it for                                                                                                                                                                                                                                                   | Supplied by                                                             |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ProgramRunHost` | `ProgramConfig.run(session, host)`      | `posthog-integration` warns when the SDK package or `package.json` is missing. `error-tracking` warns from the `posthog-cli` preinstall. `error-tracking-upload-source-maps` reads the picked project and writes the completed variant. `audit` passes it to its base run. | The legacy adapter. Each call reads `getUI()` when it runs.             |
| `ProgramCiHost`  | `ProgramConfig.ciPreRun(session, host)` | Project scoping logs its scan progress and its fallbacks. `posthog-integration`, `error-tracking` and `replay-vision` scope the project this way.                                                                                                                          | The non-interactive runner. Each call reads `getUI().log` when it runs. |

A run definition keeps its host. The source maps program reads the picked
project when the agent's prompt is built, after the picker screen, and writes
`sourceMapsCompletedVariant` in `postRun`. So a `ProgramRunHost` must stay
usable until the run returns.

Neither capability is a `runProgram` option. Both belong to building the run
from a `ProgramConfig`, before `runProgram` starts.

## `runAgent` for detection and standalone callers

Call `runAgent` directly when you have a resolved route and no program policy to
apply. It doesn't authenticate, check consent, load flags, resolve a route or
send `setup wizard finished`. The caller does those.

```ts
import { runAgent } from '@agent';
import type {
  AgentInteraction,
  AgentProgress,
  RunConfig,
  RunInput,
  RunResult,
} from '@agent/types';

// The shape `@agent` exports.
export const signature: (
  config: RunConfig,
  input: RunInput,
  options?: {
    onProgress?: (event: AgentProgress) => unknown;
    interaction?: AgentInteraction;
    signal?: AbortSignal;
  },
) => Promise<RunResult> = runAgent;
```

These callers use it:

| Caller                                                                            | What it runs                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `runProgram`                                                                      | One program's agent run.                                           |
| `detectProjectsWithAgent` in [`agentic.ts`](../src/programs/detection/agentic.ts) | The agentic project scan, one `runAgent` call per attempt.         |
| [`a3-fault-probe.no-jest.ts`](../scripts/a3-fault-probe.no-jest.ts)               | A fault probe against a local gateway, with synthetic credentials. |

`runAgent` mints a gateway token from `input.credentials` for `config.programId`
before any agent starts, and re-mints near expiry. A refused mint returns
`failed`. In development and test builds,
`configureGatewayFromCIEnvironment(projectId, region)` from `@agent` loads a
fixed gateway token from the file that `WIZARD_CI_GATEWAY_TOKEN_FILE` names.
`runAgent` then uses that token and doesn't mint. The gateway auth is
process-wide.

### Detection

Agentic detection scans a repository for its projects through `runAgent`.
`scopeInstallDirToProject`, the self-driving and error tracking project scans,
and the source maps scan call it. It needs `session.credentials` and throws
without them. Each attempt passes this run:

| Setting                 | Value                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| `binding`               | Linear, Anthropic, Haiku.                                                   |
| `run.prompt`            | The scan prompt. It replaces the assembled project prompt.                  |
| `run.collectTranscript` | `true`. The report is read from `snapshot.transcriptTail`.                  |
| `run.requestRemark`     | `false`.                                                                    |
| `composed`              | `true`.                                                                     |
| `allowedTools`          | `Read`, `Grep` and `Glob`.                                                  |
| `scanReport`            | `'defer'`. The scan's security scans count toward the program run's report. |
| `programId`             | The caller's program, so the scan's spend is attributed to it.              |
| `wizardMetadata`        | The run tags plus `call_type: detection`.                                   |

Each attempt has its own deadline signal. A first attempt that times out retries
once. A second timeout throws `AgenticDetectionTimeoutError`. Any other
non-success throws the failure's error. The scan parses verdict lines from the
transcript tail. A tail with no verdicts that contains `[ABORT]` is an empty
report. A tail with no verdicts retries once, then throws.

Detection forwards each `activity` line to its `onEvent` callback. The UI
receives every other event except `lifecycle`, `completion`, `spinner`, and log
lines below `warn`.

### Standalone example

```ts
import { runAgent, RunOutcome } from '@agent';
import type { RunConfig, RunInput } from '@agent/types';
import {
  getSkillsBaseUrl,
  Harness,
  HAIKU_MODEL,
  Sequence,
} from '@shared/constants';

export async function listProjectFiles(
  programId: string,
  input: RunInput,
  signal?: AbortSignal,
): Promise<string> {
  const config: RunConfig = {
    programId,
    run: {
      integrationLabel: 'list-files',
      prompt: () => 'List the files in the working directory. Change nothing.',
      collectTranscript: true,
      requestRemark: false,
      spinnerMessage: 'Listing files...',
      successMessage: 'Listed files',
      estimatedDurationMinutes: 1,
      reportFile: '',
      docsUrl: 'https://posthog.com/docs',
    },
    composed: true,
    binding: {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: HAIKU_MODEL,
    },
    switchboard: { program: programId, composed: true, flags: {} },
    skillsBaseUrl: getSkillsBaseUrl(),
    wizardFlags: {},
    wizardFlagPayloads: {},
    wizardMetadata: {},
    allowedTools: ['Read', 'Glob'],
  };

  const result = await runAgent(config, input, {
    signal,
    onProgress: (event) => {
      if (event.kind === 'activity') console.log(event.line);
    },
  });
  if (result.outcome !== RunOutcome.Success) {
    throw result.failure.error ?? new Error(result.failure.message);
  }
  return result.snapshot.transcriptTail ?? '';
}
```

`collectTranscript` and `requestRemark: false` take effect on the linear
sequence with the Anthropic harness. See the
[agent reference](../src/agent/README.md#run-definition).

## Process-owned CLI runs

Development and test builds accept `--ci`. It is a whole-process run, not a
function that returns an outcome. The non-interactive runner installs the
`LoggingUI`, builds a session, and loads the fixed CI gateway token. It runs the
program's `ciPreRun` with a `ProgramCiHost`, or the steps' `onReady` hooks. Then
it calls `runProgramAgent(config, session)`. The process exit code and the logs
report the result. Published builds don't accept `--ci`. For the credentials it
needs, see
[local credentials](local-dev.md#credentials-for-local-ci-and-headless-runs).
