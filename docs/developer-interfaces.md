# Non-interactive developer interfaces

Wizard has two repository-local TypeScript call surfaces and one development CLI
mode for running without a terminal UI. The TypeScript aliases below are
internal to this repository. `@posthog/wizard` publishes a CLI, not these
functions as a stable package API.

| Surface                                 | Use it for                                      | Detailed contract                                                                          |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `runAgent(config, input, options)`      | One already-configured AI run                   | [Agent reference](../src/agent/README.md)                                                  |
| `runProgram(programId, input, options)` | A registered program with invocation-owned data | [Programs reference](../src/programs/README.md)                                            |
| Development `--ci`                      | A process-owned, non-interactive CLI run        | [Local CI credentials and recipe](local-dev.md#credentials-for-local-ci-and-headless-runs) |

## Standalone agent

`runAgent` takes a resolved `RunConfig` (run definition, binding, tools and
policy), `RunInput` (project, credentials, required inference-auth provider,
flags and host), and optional `onProgress`, `interaction`, and `signal` options.
Import the function from `@agent` and types from `@agent/types`. It returns a
`RunResult` with a `success`, `aborted`, `failed`, or `crashed` outcome and a
final task/status/usage snapshot. Progress is delivered in emission order.
Observer throws and rejections from thenables returned by `onProgress` are
logged without failing the run. Callbacks must handle errors from detached
asynchronous work they start. Without `interaction`, questions have no answer
bridge and optional task notices are declined. Non-success results carry a
`failure` with a code and message, and may have an attached `Error`. The caller
chooses how to log or present a failure.

```ts
import { runAgent } from '@agent';
import type { RunConfig, RunInput } from '@agent/types';

export async function runStandalone(
  config: RunConfig,
  input: RunInput,
  signal?: AbortSignal,
) {
  return runAgent(config, input, {
    signal,
    onProgress: (event) => {
      if (event.kind === 'status') console.log(event.message);
    },
  });
}
```

The caller prepares `config` and `input`. The agent doesn't authenticate the
PostHog user or detect the project. The caller must supply
`input.inferenceAuth`, whose `resolve()` returns gateway authentication and can
refresh it during a long run. There is no session control protocol on this API.
An aborted signal returns an `aborted` result. It doesn't pause the run. The
agent returns a caught coded error as `failed` and an uncoded throw as
`crashed`. Both retain the caught `Error` (or an `Error` wrapper for a
non-`Error` throw), which the host can rethrow when it needs exception
semantics. `runAgent` never sends the terminal `setup wizard finished` event.
The host sends it when its process is done.

A runnable reference host is the
[wizard-workbench](https://github.com/PostHog/wizard-workbench) harness,
`pnpm wizard-agent` with `WIZARD_REPO` set to a wizard checkout. It runs one
agent through `runAgent`, with no TUI and no programs.

### Inference authentication

For first-party inference authentication, import
`createPosthogInferenceAuthProvider` from `@programs` and pass authenticated
PostHog credentials and the run's program ID (for example, `config.programId`,
`'audit'`, or `'metrics'`). Its provider mints a gateway token and refreshes it
near expiry. The host still handles user login and project selection.
`runProgram` builds this provider itself when resolved credentials leave
`inferenceAuth` out, so you need it only when you call `runAgent` directly.
Development [CI](#development-ci-and-experimental-headless-runner) instead uses
an already-issued fixed token.

## Callable program

`runProgram` takes a registered ID, a `ProgramInput` with at least `installDir`,
and optional `ProgramOptions`. Import it from `@programs` and types from
`@programs/types`. It returns a `ProgramRunOutcome`: outcome and failure, the
settled agent runs, observer diagnostics, the data a program with no agent
returned, artifacts, and invocation data (including a captured event plan). The
invocation data contains credentials, so don't log it. Agent failures retain an
attached `Error` when one exists.

The host supplies credentials in one of two ways:

- **Resolved.** `input.credentials` carries
  `{ posthog, inferenceAuth?, project, apiUser }`.
- **A provider.** `options.credentials.resolve(programId, { signal })`.
  `runProgram` calls it once per invocation, and composed child runs reuse the
  result.

Either way, `runProgram` identifies the user for analytics, stamps the
organization's AI SDK evidence, and refreshes an OAuth token that is close to
expiry before each agent run. Launch choices go in `input.overrides` as
`{ harness?, sequence?, model? }`. `runProgram` resolves the binding from them
and the flag snapshot, and captures the switchboard decision once for each agent
run. It copies the input when it receives it, so a later host write can't reach
the run.

Awaited host capabilities receive the invocation's signal:
`credentials.resolve`, `awaitAiApproval({ programId, signal })`,
`workflow.step(request, { signal })` and `noAgentWorkflow(request)`. The
workflow connector answers the post-auth, child-run and confirm requests that
gated and composed programs make. `noAgentWorkflow` runs the programs with no
agent, such as `posthog-doctor`, `mcp-add` and `slack`. A rejection from any of
them, or from `featureFlags` or a run definition that throws, resolves as
`failed`, or as `aborted` once the signal has aborted. `featureFlags` and the
integration effects don't receive the signal. The promise rejects only on an
invocation error, such as input that can't be copied. Read the outcome, and
still catch a rejection.

`onProgress` receives two kinds of `ProgramProgress`. A run event is
`{ kind: 'run', runId, stepId?, event }`, where `event` is the agent's progress.
A program-data event is `{ kind: 'program', data }`, a copy of the invocation
data after each write. Narrow on `kind` first:

```ts
import { runProgram } from '@programs';
import type { ProgramOptions } from '@programs/types';

export async function runAudit(
  installDir: string,
  credentials: NonNullable<ProgramOptions['credentials']>,
  awaitAiApproval: NonNullable<ProgramOptions['awaitAiApproval']>,
  signal?: AbortSignal,
) {
  const result = await runProgram(
    'audit',
    { installDir },
    {
      credentials,
      awaitAiApproval,
      signal,
      onProgress: (progress) => {
        if (progress.kind !== 'run') return;
        if (progress.event.kind === 'tasks') {
          console.log(progress.runId, progress.event.tasks);
        }
      },
    },
  );
  if (result.outcome !== 'success') {
    if (result.failure?.error) throw result.failure.error;
    throw new Error(result.failure?.message ?? `Audit ${result.outcome}`);
  }
  return result.artifacts.reportFile;
}
```

The caller implements the credential and approval callbacks. Some programs
require additional prepared inputs or host effects. The
[program reference](../src/programs/README.md#inputs) describes the available
fields and capabilities. There is no live store or step-control handle.
`runProgram` never sends the terminal `setup wizard finished` event. A
long-lived host decides when to send it, from the outcome.

A runnable reference host is the workbench harness's `pnpm wizard-program`. It
runs one program against the app in `APP_DIR`, with resolved credentials and no
TUI.

### Preflight

Hosts call `preflight(programId, host)` from `@programs` before `runProgram`.
`runProgram` doesn't call it. It runs the readiness check, then the Claude
settings check, and returns `{ kind: 'proceed', restoreSettings }` or
`{ kind: 'abort', failure }`. The host supplies the presentation (`showOutage`,
`setReadinessWarnings` and `showSettingsOverride`) and its policy
(`interactive`, `signup`, and any readiness it already computed). An outage
aborts only an interactive host. An unfixable settings conflict aborts only a
non-interactive host. Call `restoreSettings()` when the run ends. See the
[program reference](../src/programs/README.md#preflight) for the details.

## Development CI and experimental headless runner

Development/test builds accept `--ci`. This is a whole-process CLI path, not an
awaitable function returning `ProgramRunOutcome`. It requires an install
directory, a PostHog personal API key, a project ID, and an already-issued
gateway token in the file named by `WIZARD_CI_GATEWAY_TOKEN_FILE`:

```bash
WIZARD_CI_GATEWAY_TOKEN_FILE="$HOME/.config/posthog/wizard-gateway-token" \
pnpm try --ci --api-key "$POSTHOG_PERSONAL_API_KEY" \
  --project-id "$POSTHOG_WIZARD_PROJECT_ID" \
  --region us --install-dir /absolute/path/to/test-app
```

The runner logs progress and writes a local task-stream JSONL dump. Callers
observe the process exit and its logs, rather than a returned result. The
gateway token file is read into a fixed provider for CI. Pre-run detection and
composed child runs use that same provider. This path doesn't mint or refresh
the token. Published builds reject `--ci`. The internal
`runWizardCI(config, options): void` entry point uses the session adapter,
`src/lib/runners/run-program-agent.ts`. The adapter runs `preflight`, then calls
`runProgram` for each program's main agent run. Agentic detection runs before
that call, through its own `runAgent` call. MCP suggested prompts use a separate
SDK path with their own progress and cancellation.

An experimental published-build headless path exists internally as
`runWizardHeadless(config, options): void`. It shares the process-owned runner,
logs progress, and can push task-stream updates to PostHog when telemetry is
enabled. Its selector is deliberately hidden and is not a supported invocation
recipe. Neither internal function returns a structured, awaitable outcome.

There is no controlled headless mode and no socket control API. No supported
route, command, or event protocol pauses a run, supplies an answer later, or
reads its live state from another process.
