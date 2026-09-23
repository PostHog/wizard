# Programs

`runProgram` runs a registered Wizard program from caller-supplied data. The
program owns its invocation state, resolves its run definition and binding, and
passes any main agent run and composed child runs to
[`runAgent`](../agent/README.md). Callers do not create a `WizardSession` or a
UI store. This is a repository-local TypeScript interface; the npm package does
not currently export it as a public library API.

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

| Surface                                                    | What the caller provides                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProgramInput.installDir`                                  | Project directory for agent work and report paths.                                                                                                                                                                                                                                                          |
| `ProgramInput.credentials` or `ProgramOptions.credentials` | A resolved `{ posthog, inferenceAuth, project, apiUser }` object, or a provider with `resolve(programId)` that returns one. When used, the provider is called once for the program ID. Agent programs require credentials; a few non-agent programs do not. The host owns authentication and token storage. |
| `ProgramInput.runId`                                       | Optional stable attribution ID; generated when absent. Composed child runs receive their own IDs.                                                                                                                                                                                                           |
| Detection data                                             | `integration`, `typescript`, `frameworkConfig`, `frameworkContext`, `warehouseSources`, `detectedTools`, `sourceMapsSelection`, and related data required by the chosen program. Dynamic recipes use these values instead of a session.                                                                     |
| Run selection                                              | Optional `run` override, `binding`, `skillId`, `flags`, `wizardFlags`, `wizardFlagPayloads`, `wizardMetadata`, `seedTasks`, `hooks`, `allowedTools`, `disallowedTools`, `agentFlow`, and `host`. These are resolved snapshots for this invocation.                                                          |
| Composition                                                | `composition.integration` can supply a prepared child integration for `self-driving`; `compositionWorkflow` can confirm the handoff and GitHub steps. Boolean decisions in `composition` are also accepted.                                                                                                 |
| Host capabilities                                          | `interaction` answers agent questions; `onProgress` observes events. `signal` requests cancellation. `mcp` and `workflow` serve programs without an agent. `integrationEffects` supplies the integration recipe's host effects. `awaitAiApproval` resolves the AI-processing approval gate when needed.     |

The exact shapes are in [`ProgramInput` and `ProgramOptions`](run-program.ts).
`ProgramOptions['credentials']` and `ProgramInput['credentials']` expose the
provider and resolved-credential types to callers; their underlying named types
live in [`credentials.ts`](credentials.ts). Do not log the outcome's `data`: it
includes PostHog credentials.

For first-party inference auth, use
[`createPosthogInferenceAuthProvider`](../../docs/developer-interfaces.md#inference-authentication)
with authenticated PostHog credentials and the program ID. The development
`--ci` runner instead uses an already-issued fixed gateway token.

`posthog-integration` needs a prepared `frameworkConfig` and
`integrationEffects` unless the caller supplies an explicit `run` override. For
a normal source-map upload, pass a detected `sourceMapsSelection.variant`;
without it, the fallback prompt still starts an agent before asking it to abort.
`self-driving` can compose that integration before its own run. It requires a
confirmed GitHub connection, supplied as `composition.githubConnected: true` or
through `compositionWorkflow`; a composed integration also requires a confirmed
handoff. An AI program whose organization lacks AI-processing approval needs
`awaitAiApproval` for a normal invocation; declining aborts the program.
`flags.ci` and `flags.signup` bypass that approval check and do not call
`awaitAiApproval`. Hosts should use those flags only when consent has already
been handled by their CI authorization or signup flow; the flags do not prove
consent.

When `composition.integration` is supplied, its agent runs before the handoff
and GitHub confirmations, then the self-driving agent runs. A declined later
confirmation returns `aborted` without rolling back integration edits. Hosts
that need both decisions before any project write must establish them before
calling `runProgram`; `compositionWorkflow` takes precedence over boolean
decisions and is queried at those later checkpoints.

## Outcomes and progress

`ProgramRunOutcome.outcome` is `success`, `aborted`, `failed`, or `crashed`.
Decided pre-run failures, such as an unknown program or missing credentials,
return `failed` with `failure.message`. An agent crash appears as `crashed`.
Handled credential-resolution, approval, and composition callback rejections
also resolve as `failed` with a message, not the callback's original error
class. An unexpected invocation throw, such as a duplicate composed `runId`,
rejects the promise. Non-success agent outcomes carry the agent's `failure`,
including any attached `Error`. `failure.error` is optional, as are its code and
message. Read the outcome to decide how the run ended, and use the attached
error for diagnostics or an upstream rethrow. The host owns logging and
user-facing error messages. Hosts should inspect the outcome and separately
catch rejected promises.

`options.signal` accepts an `AbortSignal`. A signal aborted before the run
starts returns `aborted` with an agent-abort failure code. Agent programs check
again before startup and pass the signal to the active harness. Programs without
an agent recheck after credential resolution and host work; an abort returns
`aborted` even if a callback has completed. Workflow requests receive the
signal, but in-flight host effects must cooperate with cancellation and
completed external effects are not rolled back.

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
- `artifacts.reportFile`: the intended absolute report path once the run
  definition resolves and the agent is about to run. Pre-run failure or abort
  leaves it absent, and the path does not prove that a file was written. A
  failed composed child can return its own report path.

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
    if (result.failure?.error) throw result.failure.error;
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
their main program runs through this host via
`src/lib/runners/run-program-agent.ts`, which still owns session gates and UI
translation. Agentic detection and MCP suggested-prompt streaming call the agent
separately, with their own progress and cancellation contracts. There is no
socket controller or step-by-step control API. For the existing process-owned CI
runner, see the
[non-interactive developer interfaces](../../docs/developer-interfaces.md).
