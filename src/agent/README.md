# Agent

The agent runs one AI pipeline against a project directory. It takes resolved
data in, reports through progress events, asks through an injected answerer, and
returns a result. It never reads a session, a store or a UI.

## Signatures

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside `src/agent` imports deeper. Lint and the architecture test reject it.

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

- `RunConfig`: the program ID, its `AgentRunDefinition` as `run`, `composed`,
  the resolved `binding` (sequence, harness, model, effort), the switchboard
  inputs, the skills origin, the flag snapshot and its payloads, the trace tags,
  the tool allow and deny lists, `agentFlow`, `excludedTaskTypes`, `seedTasks`,
  the bound completion `hooks`, and `scanReport`.
- `RunInput`: the install directory, resolved credentials, the project and user
  payloads, the skill ID, the detected integration and its docs URL, `flags`
  (`ci`, `signup`, `debug`, `e2eAsk`, `localMcp`, `captureAio`, `benchmark`,
  `yaraReport`), and the host the CLI was told.
- `RunResult`: `outcome` is `RunOutcome.Success | Aborted | Failed | Crashed`.
  `Success` can carry an `outro`. The other three carry a `failure`
  (`AgentFailure`: message, outro data, error, exit code, error code, detail,
  auth error detail). Every result carries `skillId` and a `snapshot` of what
  the run reported: tasks, status lines, stage, token usage totals, final cost,
  dashboard and notebook URLs, handoff text, and the transcript tail when the
  run collected one.
- `AgentProgress`: one event per thing the run reports, in emission order.
  Kinds: `lifecycle`, `spinner`, `log`, `status`, `tasks`, `stage`, `url`,
  `usage`, `finalCost`, `authError`, `handoff`, `completion` and `activity`.
  Payloads are copies, never live objects.
- `AgentInteraction`: every member is optional. `ask(question, { signal })`
  resolves with answers. `taskNotice(notice, { signal })` resolves with whether
  to keep an optional task. Each request has its own signal. It aborts when that
  request times out, the host aborts the run, or another task fails the run. On
  abort the host dismisses that request alone, without throwing.
- Errors: the agent doesn't exit the process and doesn't reject. A caught coded
  error, such as a refused gateway mint, becomes `Failed`. An uncoded throw
  becomes `Crashed` with the error attached. A gateway 401 returns an auth
  failure, and the host decides whether to show auth UI. `Aborted` means the
  host's signal cancelled the run. An agent that stops itself with `[ABORT]`
  returns `Failed` with its abort code.
- Analytics shutdown is host-owned. The agent never sends the terminal
  `setup wizard finished` event. The host sends it from the outcome: `Success`
  is `success`, `Aborted` is `cancelled`, `Failed` and `Crashed` are `error`.

Other runtime exports: `RunOutcome`, `AgentSignals`, `WIZARD_TOOL_NAMES`,
`resolveBinding`, `shouldDisableAsk`, `LONGER_ASK_TIMEOUT_MS`, `buildRunTags`,
`configureGatewayFromCIEnvironment`, `flushScanReport`, `downloadSkill`,
`TASK_OUTCOMES_KEY`, and `runMcpPromptViaSdk`, which loads the streaming module
on first call.

## Run definition

`RunConfig.run` is an `AgentRunDefinition`. These fields shape the prompt and
what the run collects:

| Field               | What it does                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skillId`           | The skill the linear sequence installs before the agent starts. Omit it to let the agent discover skills.                                                 |
| `customPrompt`      | Instructions appended after the default project prompt.                                                                                                   |
| `prompt`            | Replaces the assembled project prompt. It receives the same `PromptContext`: project ID and key, host, skill path, and the organization and team opt-ins. |
| `collectTranscript` | Keeps a transcript tail on `snapshot.transcriptTail` and reports each agent step as an `activity` event.                                                  |
| `requestRemark`     | Asks for the end-of-run reflection remark. Defaults to `true`. `false` skips it.                                                                          |
| `abortCases`        | Known `[ABORT] <reason>` cases and the outro each one renders.                                                                                            |

`prompt`, `customPrompt` and `abortCases` apply on the linear sequence. The
orchestrator builds each task's prompt from its context-mill flow.
`collectTranscript` and `requestRemark` take effect on the linear sequence with
the Anthropic harness. The Pi harness always asks for the remark on a linear
run. The orchestrator never asks for it.

The other fields carry the run's copy, report file, docs URL, extra MCP servers,
question limits and step analytics. See
[`shared/types.ts`](runner/shared/types.ts).

### Transcript tail

With `collectTranscript`, the run observes every SDK message:

- Each assistant text block joins the tail. The tail keeps the newest blocks, up
  to 256 × 1024 characters, and drops the oldest first. A single block over the
  cap stays whole.
- The run's final result text follows the kept blocks.
- `snapshot.transcriptTail` is the kept blocks, one per line, then the final
  result.
- Each non-empty text block also emits `{ kind: 'activity', line }`, trimmed and
  cut at 100 characters.
- Each tool call emits `{ kind: 'activity', line }` with the tool name and its
  file path, pattern or path.

Only the caller that set `collectTranscript` wants `activity` lines. The TUI's
progress reducer ignores them.

### Scan report

The agent counts its security scans in process-wide state. At the end of a run,
`runAgent` flushes them. It sends the scan telemetry and resets the counts. With
`flags.yaraReport`, it also writes the local report file and emits its path as
an `info` log event. `RunConfig.scanReport: 'defer'` skips the flush, so the
run's scans count toward the next flush. Agentic detection defers, so its scans
land in the program run's report.

## Who calls `runAgent`

- **`runProgram`**, for every program's agent run. It resolves credentials,
  consent, flags and the route first. See the
  [developer interfaces](../../docs/developer-interfaces.md).
- **Agentic detection**, `detectProjectsWithAgent` in
  [`src/programs/detection/agentic.ts`](../programs/detection/agentic.ts). It
  sets `prompt`, `collectTranscript: true`, `requestRemark: false` and
  `scanReport: 'defer'`, and reads its report from the transcript tail.
- **The fault probe**,
  [`scripts/a3-fault-probe.no-jest.ts`](../../scripts/a3-fault-probe.no-jest.ts),
  against a local gateway with synthetic credentials.

A standalone caller supplies everything `runProgram` would resolve. `runAgent`
doesn't authenticate the user, check consent, load flags or pick a route. It
does mint gateway auth: before any agent starts, it mints a scoped gateway token
from `input.credentials` for `config.programId`, and re-mints near expiry. In
development and test builds, `configureGatewayFromCIEnvironment` loads a fixed
token from `WIZARD_CI_GATEWAY_TOKEN_FILE` instead, and `runAgent` uses it
without minting. The gateway auth cache is process-wide.

Minimal invocation:

```ts
import { runAgent, RunOutcome } from '@agent';
import type {
  AskAnswers,
  PendingQuestion,
  RunConfig,
  RunInput,
} from '@agent/types';

export async function runWithAnswers(
  config: RunConfig,
  input: RunInput,
  answersFor: (question: PendingQuestion) => Promise<AskAnswers>,
): Promise<void> {
  const result = await runAgent(config, input, {
    onProgress: (event) => {
      if (event.kind === 'log') console.log(event.message);
    },
    interaction: {
      ask: (question) => answersFor(question),
    },
  });
  if (result.outcome !== RunOutcome.Success) {
    process.exitCode = result.failure.exitCode ?? 1;
  }
}
```

`src/agent/__tests__/run-agent-standalone.test.ts` runs the agent this way with
no UI, no store and no registry.

## Intent

Programs call the agent to do the work a skill describes. The TUI and the
non-interactive runner observe the run through `onProgress` and answer it
through `interaction`. `src/programs/run-agent-legacy.ts` does both on top of
the session, through `runProgram`.

Without `onProgress` the run completes, and its snapshot still comes back in the
result. Without `interaction` the agent installs no ask bridge: `wizard_ask`
returns its "not available" error and optional task notices are declined, which
is what a `--ci` run does. A throwing or rejecting observer is logged and the
run continues.

## Architecture

The agent owns run state for one invocation: the task queue, phase, status,
resolved skill, handoff text, usage and the final result. It depends on
`src/shared` and on `src/env.ts`. It depends on program types only until the
bindings table moves to programs.

```text
caller ── RunConfig + RunInput ──▶ runAgent
                                      │ prepareRun: gateway mint, triage provider
                                      ▼
                          sequence (linear | orchestrator)
                                      │
                          harness (anthropic | pi) ── tools (MCP or pi-native)
                                      │
             onProgress ◀── events ───┤──── questions ──▶ interaction
                                      ▼
                          scan report flush (unless deferred)
                                      ▼
                                  RunResult
```

`runner/` holds the dispatcher, sequences, harnesses and the switchboard. See
the [runner reference](runner/README.md). `tools/` holds the wizard tools shared
by both harnesses. `middleware/` holds the benchmark pipeline. `progress.ts`
defines the event and interaction contracts. `yara-hooks.ts` scans what the run
installs.
