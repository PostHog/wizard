# Programs

`runProgram` runs a registered Wizard program from caller-supplied data. The
program owns its invocation state, resolves its run definition and binding, and
passes one or more agent runs to [`runAgent`](../agent/README.md). Callers do
not create a `WizardSession` or a UI store. This is a repository-local
TypeScript interface; the npm package does not currently export it as a public
library API.

## Signature

Import the runtime function from `@programs` and types from `@programs/types`:

```ts
import { runProgram } from '@programs';
import type {
  ProgramInput,
  ProgramOptions,
  ProgramRunOutcome,
} from '@programs/types';

runProgram(
  programId: string,
  input: ProgramInput,
  options?: ProgramOptions,
): Promise<ProgramRunOutcome>
```

`programId` must resolve through the runtime registry. Unknown IDs return a
failed outcome. The host supplies an absolute or relative `installDir`; report
paths in the result are resolved against it.

## Intent and ownership

The host authenticates, detects the project, and chooses any workflow decisions
it needs before calling. It passes those facts as plain data. `runProgram`
resolves the program recipe, applies the program binding and policy, owns the
progress projection, and invokes the agent. An agent run receives resolved
inputs and does not read the host's session.

```text
host ── program id + input + capabilities ──▶ runProgram
  │                                          │
  │                     registry + data-only run resolver + binding
  │                                          │
  ◀── attributed progress ── ProgramStore ◀── runAgent
  ◀── outcome + settled runs + final data ───┘
```

## Inputs and capabilities

| Surface                                                    | What the caller provides                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProgramInput.installDir`                                  | Project directory for agent work and report paths.                                                                                                                                                                                                                                                            |
| `ProgramInput.credentials` or `ProgramOptions.credentials` | A resolved `{ posthog, inferenceAuth, project, apiUser }` object, or a provider with `resolve(programId)` that returns one. When used, the provider is called once for the program ID. Agent programs require credentials; a few non-agent programs do not. The host owns authentication and token storage.   |
| `ProgramInput.runId`                                       | Optional stable attribution ID; generated when absent. Composed child runs receive their own IDs.                                                                                                                                                                                                             |
| Detection data                                             | `integration`, `typescript`, `frameworkConfig`, `frameworkContext`, `warehouseSources`, `detectedTools`, `sourceMapsSelection`, and related data required by the chosen program. Dynamic recipes use these values instead of a session.                                                                       |
| Run selection                                              | Optional `run` override, `binding`, `skillId`, `flags`, `wizardFlags`, `wizardFlagPayloads`, `wizardMetadata`, `seedTasks`, `hooks`, `allowedTools`, `disallowedTools`, `agentFlow`, and `host`. These are resolved snapshots for this invocation.                                                            |
| Composition                                                | `composition.integration` can supply a prepared child integration for `self-driving`; `compositionWorkflow` can confirm the handoff and GitHub steps. Boolean decisions in `composition` are also accepted.                                                                                                   |
| Host capabilities                                          | `interaction` answers agent questions; `onProgress` observes events. `signal` cancels an active agent run. `mcp` and `workflow` serve programs without an agent. `integrationEffects` supplies the integration recipe's host effects. `awaitAiApproval` resolves the AI-processing approval gate when needed. |

The exact shapes are in [`ProgramInput` and `ProgramOptions`](run-program.ts).
`ProgramOptions['credentials']` and `ProgramInput['credentials']` expose the
provider and resolved-credential types to callers; their underlying named types
live in [`credentials.ts`](credentials.ts). Do not log the outcome's `data`: it
includes PostHog credentials.

`posthog-integration` needs a prepared `frameworkConfig` and
`integrationEffects` unless the caller supplies an explicit `run` override.
`self-driving` can compose that integration before its own run. It requires a
confirmed GitHub connection, supplied as `composition.githubConnected: true` or
through `compositionWorkflow`; a composed integration also requires a confirmed
handoff. An AI program whose organization lacks AI-processing approval needs
`awaitAiApproval` for a normal invocation; declining aborts the program.

## Outcomes and progress

`ProgramRunOutcome.outcome` is `success`, `aborted`, `failed`, or `crashed`.
Decided pre-run failures, such as an unknown program or missing credentials,
return `failed` with `failure.message`. An agent crash appears as `crashed`.
External host capabilities can still reject, so callers should also handle a
rejected promise.

`options.signal` accepts an `AbortSignal`. A signal aborted before the run
starts returns `aborted` with an agent-abort failure code. During an agent run,
the signal reaches the active harness and the result is `aborted`. It is not a
general cancellation protocol for host-supplied credential, approval, MCP, or
workflow callbacks; those callbacks should manage their own lifetime.

The result includes:

- `runResults`: completed agent results in registration order.
- `settledRuns`: actual completed agent invocations in finish order, each with
  `runId`, optional `stepId`, and its `RunResult`. This is separate from the
  progress projection.
- `progress`: the final per-run task, status, stage, usage, and outcome
  projection, plus bounded observer diagnostics.
- `data`: invocation-owned credentials, project and user data, detection
  context, captured event plan, and completed composition steps.
- `programData`: program-specific data for flows without an agent, such as
  doctor issues or MCP client results.
- `artifacts.reportFile`: the resolved report path when an agent run definition
  provides one; it does not assert that the file was written.

`onProgress` receives `{ runId, stepId?, event }`. The `event` is a copied
[`AgentProgress`](../agent/README.md#signatures) value, including `tasks` and
`status` changes. The store applies the event before calling the observer.
Observers are not awaited; thrown or rejected observers are isolated and
recorded as bounded diagnostics when observed. A late asynchronous rejection may
arrive after the returned progress snapshot. Keep observers short and use
`runId` and `stepId` to attribute composed runs. The final result remains
available when no observer is supplied.

```ts
import { runProgram } from '@programs';
import type { ProgramOptions } from '@programs/types';

export async function runMetrics(
  installDir: string,
  credentials: NonNullable<ProgramOptions['credentials']>,
  awaitAiApproval: NonNullable<ProgramOptions['awaitAiApproval']>,
  signal?: AbortSignal,
) {
  const result = await runProgram(
    'metrics',
    { installDir },
    {
      credentials,
      awaitAiApproval,
      signal,
      onProgress: ({ runId, event }) => {
        if (event.kind === 'tasks') console.log(runId, event.tasks);
        if (event.kind === 'status') console.log(runId, event.message);
      },
    },
  );

  if (result.outcome !== 'success') {
    throw new Error(result.failure?.message ?? `Metrics ${result.outcome}`);
  }
  return result;
}
```

The caller implements `credentials` and `awaitAiApproval` through its own auth
and consent flow. No token is embedded in this example.

## Current limits

The callable host does not discover credentials, choose a project, or render
questions itself. The host supplies those data and capabilities. Some legacy
recipes still need an explicit data-only run definition; unsupported
combinations return a failed outcome. Existing terminal and CI callers route
their agent work through this host via `src/lib/runners/run-program-agent.ts`,
which still owns session gates and UI translation. There is no socket controller
or step-by-step control API. For the existing process-owned CI runner, see the
[non-interactive developer interfaces](../../docs/developer-interfaces.md).
