# Developer interfaces

There are four ways to run the wizard. Most end users run it from the TUI. The
headless runner runs the same flow without a terminal UI. `runProgram` runs just
one program, and `runAgent` runs only the agent.

| Way          | Entry                                                                                                     | Use it for                                            | Reference                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| TUI          | `npx @posthog/wizard`, through [`run-wizard.ts`](../src/lib/runners/run-wizard.ts)                        | End users setting up PostHog in a terminal            | [README](../README.md)                                                       |
| Headless     | `npx @posthog/wizard --ci`, through [`run-non-interactive.ts`](../src/lib/runners/run-non-interactive.ts) | CI and scripts, with no prompts                       | [Local credentials](local-dev.md#credentials-for-local-ci-and-headless-runs) |
| `runProgram` | `runProgram(programId, input, options)` from `@programs`                                                  | One program, from code, with its policy and telemetry | [`runProgram`](#runprogram), [programs reference](../src/programs/README.md) |
| `runAgent`   | `runAgent(config, input, options)` from `@agent`                                                          | Only the agent, from a resolved config                | [`runAgent`](#runagent), [agent reference](../src/agent/README.md)           |

![The TUI and the headless runner go through their own state to runProgram. The workbench calls runProgram directly. runProgram calls runAgent, and detection calls runAgent directly](images/wizard-run-paths.svg)

The dashed boxes are the state the TUI and the headless runner keep above
`runProgram`. The workbench and other integrations call `runProgram` directly.

`runProgram` and `runAgent` live in this repository and import through its path
aliases. The `@posthog/wizard` npm package publishes the CLI, not these
functions.

## `runProgram`

### What `runProgram` is for

`runProgram` is a clean interface between the TUI, which is the interface, and
the programmatic parts of what a wizard program does.

> ⚠️ **Temporary adapter.** The TUI and the headless runner reach `runProgram`
> through `runProgramAgent` in
> [`run-agent-legacy.ts`](../src/programs/run-agent-legacy.ts). This is a
> temporary adapter, and we will remove it in the full program.

Three things use it:

1. **The TUI and the headless runner.** Both call `runProgram` to run a full
   wizard program.
2. **Testing.** The test workbench calls `runProgram` directly, with no TUI,
   from the `wizard-program` service in
   [wizard-workbench](https://github.com/PostHog/wizard-workbench).
3. **Other integrations.** If you want to integrate with the wizard more
   directly, without everything on top, call `runProgram` yourself.

### Signatures

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

- **`programId`** says which program runs.
- **`input`** says what to run and where: the program's run definition built
  from its `ProgramConfig`, the install directory and the login.
- **`options`** is how the caller plugs in: credentials, questions, progress,
  the approval and gate waits, flags and cancellation.

`runProgram` resolves to one `ProgramRunOutcome`.

### Field definitions

| Field                                                        | Type                | What it's for                                                                    |
| ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------- |
| `programId`                                                  | `string`            | Which program runs. It names analytics, the route and the gateway spend.         |
| [`input`](../src/programs/run-program.ts#L67)                | `ProgramInput`      | What to run and where. `installDir` and `run` are required.                      |
| [`input.program`](../src/programs/run-program.ts#L57)        | `ProgramSettings`   | The program's settings from its `ProgramConfig`.                                 |
| [`options`](../src/programs/run-program.ts#L90)              | `ProgramOptions`    | The login, questions, approval and gate waits, flags, progress and cancellation. |
| [`options.onProgress`](../src/programs/program-store.ts#L17) | `ProgramProgress`   | Agent events and program data snapshots. Never awaited.                          |
| [Outcome](../src/programs/run-program.ts#L107)               | `ProgramRunOutcome` | How the run ended, the agent's result, the final data and the report path.       |

The outcome's `data` and the `kind: 'program'` progress snapshots hold PostHog
tokens, including the refresh token. Don't log or serialize them.

`flags.ci` and `flags.signup` skip the AI-processing approval. Set them only
when consent is already settled.

### Do a quack

[`run-program-quack.ts`](examples/run-program-quack.ts) is the smallest
`runProgram` call. It logs in through the wizard's browser OAuth, runs one
prompt that replies `quack`, logs status lines and prints the outcome. Each step
has a comment.

Run it from the repository root against the [local stack](local-dev.md):

```bash
QUACK_INSTALL_DIR=<a git-initialized directory> npx tsx --tsconfig tsconfig.json docs/examples/run-program-quack.ts
```

It prints `reply: quack` and `outcome: success`.

### Cancellation

Pass a `signal` to cancel the run. The credentials, approval and gate waits
receive it, and each must settle when it aborts. A cancelled run resolves to
`aborted`, not a rejection.

### Failures

Most endings resolve to an outcome instead of throwing. Check `outcome` and read
`failure`. The promise rejects only when the call itself can't run, such as an
input field that can't be copied. The cases are in
[`run-program.ts`](../src/programs/run-program.ts#L164).

### Program callbacks

A program's `run` and `ciPreRun` receive a runner context, `RunnerContext` or
`CiRunnerContext`, instead of calling `getUI()`. Both types come from
`@programs/types` and are defined in
[`runner-context.ts`](../src/programs/runner-context.ts). Build it when you
build the run from a `ProgramConfig`, before you call `runProgram`.

## `runAgent`

### What `runAgent` is for

`runAgent` runs only the agent. Call it when you have a resolved route and no
program policy to apply. It doesn't log in, ask for consent, load flags or
resolve a route. The caller does those.

### Signatures

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

- **`config`** says what the agent runs: the run definition, the route and the
  tools.
- **`input`** says where and as whom: the project, the login and the flags.
- **`options`** carries progress, questions and cancellation.

`runAgent` resolves to one `RunResult`. It mints its own gateway token from
`input.credentials`.

### Field definitions

| Field                                                                | Type                 | What it's for                                                                   |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| [`config`](../src/agent/runner/shared/types.ts#L151)                 | `RunConfig`          | What the agent runs, with its route and tools.                                  |
| [`config.run`](../src/agent/runner/shared/types.ts#L48)              | `AgentRunDefinition` | The prompt and run options, such as `collectTranscript`.                        |
| [`config.allowedTools`](../src/agent/runner/shared/types.ts#L174)    | `readonly string[]`  | Tools added to the base tools.                                                  |
| [`config.disallowedTools`](../src/agent/runner/shared/types.ts#L176) | `readonly string[]`  | Tools removed from the base tools.                                              |
| [`input`](../src/agent/runner/shared/types.ts#L205)                  | `RunInput`           | Where and as whom: the project, the login and the flags.                        |
| `options`                                                            |                      | `onProgress` for agent events, `interaction` for questions, `signal` to cancel. |
| [Result](../src/agent/runner/shared/types.ts#L307)                   | `RunResult`          | How the run ended, with a snapshot of its tasks and transcript.                 |

### Callers

| Caller                                                                            | What it runs                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `runProgram`                                                                      | One program's agent run.                        |
| `detectProjectsWithAgent` in [`agentic.ts`](../src/programs/detection/agentic.ts) | The agentic project scan, one call per attempt. |
| [`a3-fault-probe.no-jest.ts`](../scripts/a3-fault-probe.no-jest.ts)               | A fault probe against a local gateway.          |

### Do a quack

[`run-agent-quack.ts`](examples/run-agent-quack.ts) is the smallest `runAgent`
call. It logs in the same way, builds a `RunConfig` with one prompt and no
Write, Edit or Bash, and prints the transcript tail and the outcome. Each step
has a comment.

```bash
QUACK_INSTALL_DIR=<a git-initialized directory> npx tsx --tsconfig tsconfig.json docs/examples/run-agent-quack.ts
```

It prints `transcriptTail: quack` and `outcome: success`.
