# Non-interactive developer interfaces

Wizard has two repository-local TypeScript call surfaces and one development CLI
mode for running without a terminal UI. The TypeScript aliases below are
internal to this repository; `@posthog/wizard` currently publishes a CLI, not
these functions as a stable package API.

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

The caller prepares `config` and `input`; the agent does not authenticate the
PostHog user or detect the project. The caller must supply
`input.inferenceAuth`, whose `resolve()` returns gateway authentication and can
refresh it during a long run. There is no session control protocol on this API.
An aborted signal returns an `aborted` result; it does not pause the run. The
agent returns a caught coded error as `failed` and an uncoded throw as
`crashed`. Both retain the caught `Error` (or an `Error` wrapper for a
non-`Error` throw), which the host can rethrow when it needs exception
semantics.

A runnable reference host is `scripts/e2e-agent.no-jest.ts`, run by
`pnpm test:e2e:agent`. It runs a `quack` skill from a loopback skills server in
an empty directory. Its environment is described in
`e2e-harness/surface-e2e.ts`: `PROJECT_ID`, a PostHog key from
`POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE`, and a gateway token from
`WIZARD_CI_GATEWAY_TOKEN_FILE`.

### Inference authentication

For first-party inference authentication, import
`createPosthogInferenceAuthProvider` from `@programs` and pass authenticated
PostHog credentials and the run's program ID (for example, `config.programId`,
`'audit'`, or `'metrics'`). Its provider mints a gateway token and refreshes it
near expiry; the host still handles user login and project selection.
Development [CI](#development-ci-and-experimental-headless-runner) instead uses
an already-issued fixed token.

## Callable program

`runProgram` takes a registered ID, `ProgramInput` with at least `installDir`,
and optional `ProgramOptions`. The host supplies resolved credentials or a
credential provider, prepared detection and framework context where needed, and
callbacks for questions, approvals, progress, or program-specific effects. An
optional `signal` requests cancellation. It returns a `ProgramRunOutcome`:
outcome and failure, final progress, actual settled agent runs, program-specific
data, artifacts, and invocation data (including a captured event plan). The
latter contains credentials and should not be logged. Agent failures retain an
attached `Error` when one exists. Rejections from the credential, approval and
composition callbacks resolve as `failed`. The promise rejects only on an
unexpected invocation error, such as a duplicate composed `runId` or a run
definition that throws, so callers read the outcome and still catch a rejection.

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
      onProgress: ({ runId, event }) => {
        if (event.kind === 'tasks') console.log(runId, event.tasks);
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
require additional prepared inputs or host effects; the
[program reference](../src/programs/README.md#inputs) describes the available
fields and capabilities. Host callbacks such as credential resolution, approval,
and MCP work do not receive the signal. There is no live store or step-control
handle.

A runnable reference host is `scripts/e2e-programs.no-jest.ts`, run by
`pnpm test:e2e:programs`. It runs posthog-integration against the app in
`APP_DIR`, with the same environment as the agent route
(`e2e-harness/surface-e2e.ts`).

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
composed child runs use that same provider; this path does not mint or refresh
the token. Published builds reject `--ci`. The internal
`runWizardCI(config, options): void` entry point still uses the legacy session
adapter, which calls `runProgram` for each program's main agent run. Agentic
detection can call the agent separately before that run; MCP suggested prompts
also use a separate agent path with their own progress and cancellation.

An experimental published-build headless path exists internally as
`runWizardHeadless(config, options): void`. It shares the process-owned runner,
logs progress, and can push task-stream updates to PostHog when telemetry is
enabled. Its selector is deliberately hidden and is not a supported invocation
recipe. Neither internal function returns a structured, awaitable outcome.

Controlled headless and socket control APIs are not available yet. There is no
supported route, command, or event protocol for pausing a run, supplying an
answer later, or reading its live state from another process.
