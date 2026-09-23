# Agent

The agent runs one program's AI pipeline against a project directory. It takes
resolved data in, reports through progress events, asks through an injected
answerer, and returns a result. It never reads a session, a store or a UI. For
the callable program host and development CI runner, see the
[non-interactive developer interfaces](../../docs/developer-interfaces.md).

## Layout

| Folder        | Holds                                                    |
| ------------- | -------------------------------------------------------- |
| `security/`   | what the agent may run or read, and the scanner          |
| `prompt/`     | what the agent is told                                   |
| `progress/`   | what the agent reports and asks back                     |
| `sdk/`        | Claude SDK wrappers, streaming, capture and stored login |
| `runner/`     | entry, sequences, harnesses and the switchboard          |
| `tools/`      | the wizard tools the agent calls                         |
| `middleware/` | benchmark and phase pipeline                             |

## Signatures

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside `src/agent` imports deeper; the compiler rejects it (`pnpm typecheck`).

```ts
import { runAgent, RunOutcome } from '@agent';
import type { RunConfig, RunInput, RunResult, AgentProgress, AgentInteraction } from '@agent/types';

runAgent(config: RunConfig, input: RunInput, options?: {
  signal?: AbortSignal;
  onProgress?: (event: AgentProgress) => void;
  interaction?: AgentInteraction;
  signal?: AbortSignal;
}): Promise<RunResult>
```

- `RunConfig`: the opaque program id, its `AgentRunDefinition` (prompt, skill,
  tools, copy), the resolved `binding` (sequence, harness, model and task-role
  routes), supplied program commandments and stage policy, the skills origin,
  flag snapshot, trace tags, tool allow and deny lists, seed tasks and bound
  completion `hooks`.
- `RunInput`: install directory, resolved PostHog credentials, required
  `inferenceAuth`, project and user payloads, skill id, detected integration,
  `flags` (`ci`, `signup`, `debug`, `e2eAsk`, `localMcp`, `captureAio`,
  `benchmark`, `yaraReport`) and the host the CLI was told. The caller supplies
  an `InferenceAuthProvider` whose `resolve()` returns gateway authentication.
  The agent resolves it before execution and again when the harness needs
  refreshed auth.
- `RunResult`: `outcome` is `RunOutcome.Success | Aborted | Failed | Crashed`.
  Success may carry an `outro`; the other three carry a `failure`
  (`AgentFailure`: a stable error code and a message, plus optional outro data,
  `Error`, exit code and detail). `failure.error` may be present when the agent
  caught an `Error`; `Crashed` requires one. A missing `Error` object does not
  mean the outcome succeeded. Every result carries `skillId` and a `snapshot` of
  what the run reported: tasks, status lines, stage, token usage totals, final
  cost, dashboard and notebook URLs, handoff text.
- `AgentProgress`: one event per thing the run reports, in emission order.
  Kinds: `lifecycle`, `spinner`, `log`, `status`, `tasks`, `stage`, `url`,
  `usage`, `finalCost`, `authError`, `handoff`, `completion`. Payloads are
  copies, never live objects.
- `AgentInteraction`: every member optional. `ask(question)` resolves with
  answers, `cancelAsk()` dismisses the open question, `taskNotice(notice)`
  resolves with whether to keep an optional task, `cancelTaskNotice()` declines
  it.
- `signal`: an optional `AbortSignal` from the host. A pre-aborted signal
  returns `Aborted` before execution. Aborting during execution is passed to the
  active harness and returns `Aborted` with the current snapshot, unless the run
  had already decided a failure; that failure stays the outcome. It does not
  pause or resume a run.
- Errors: the agent does not exit the process or throw for a decided failure. It
  catches errors in its run body and logs them: a coded error becomes `Failed`,
  and an uncoded throw becomes `Crashed` with the caught `Error` attached (or an
  `Error` wrapper for a non-`Error` throw). A gateway 401 emits `authError` and
  returns an auth failure. The host decides how to present a returned failure,
  show auth UI, set an exit code, or rethrow an attached error. Failed-run skill
  cleanup and the final scan-report flush are best effort and never replace the
  outcome.

Other runtime exports: `DEFAULT_AGENT_BINDING` for standalone callers, the
generic `resolveBinding` and `resolveHarness` helpers, `shouldDisableAsk`,
`initializeAgent`, `executeAgent`, `buildRunTags`, `AgentSignals`,
`downloadSkill`, `WIZARD_TOOL_NAMES`, `LONGER_ASK_TIMEOUT_MS`,
`flushScanReport`, and `runMcpPromptViaSdk`, which loads the streaming module on
first call.

Minimal invocation:

```ts
const result = await runAgent(config, input, {
  onProgress: (event) => {
    if (event.kind === 'log') console.log(event.message);
  },
  interaction: {
    ask: async (question) => answersFor(question),
  },
});
if (result.outcome !== RunOutcome.Success) {
  console.error(
    result.failure.error ?? result.failure.message ?? `Agent ${result.outcome}`,
  );
  process.exitCode = result.failure.exitCode ?? 1;
}
```

The result is the agent's termination report. Check `outcome` first and then
read `failure`; a failed result can have no attached `Error`. If a higher layer
uses exceptions, it can rethrow `failure.error` when present and construct an
error from `failure.message` otherwise. Preserve the original `Error` object
when rethrowing so its stack and cause remain available.

`src/agent/__tests__/run-agent-standalone.test.ts` runs this with no UI, no
store and no registry.

## Intent

Programs call the agent to do the work a skill describes. A standalone host can
observe the run through `onProgress` and answer it through `interaction`; the
legacy TUI and non-interactive runner still use
`src/cli/runners/run-program-agent.ts` for session gates and UI translation,
then call the same `runProgram` host.

Without `onProgress` the run completes and its snapshot still comes back in the
result. Without `interaction` the agent installs no ask bridge: `wizard_ask`
returns its "not available" error and optional task notices are declined, which
is what a `--ci` run does. A throwing observer is logged and the run continues.

## Architecture

The agent owns run state for one invocation: the task queue, phase, status,
resolved skill, handoff text, usage and the final result. It depends on
`src/shared` and `src/env.ts`; callers supply program routing and policy through
`RunConfig`.

```text
caller ── RunConfig + RunInput ──▶ runAgent
                                      │ prepareRun: supplied gateway auth, triage provider
                                      ▼
                          sequence (linear | orchestrator)
                                      │
                          harness (anthropic | pi) ── tools (MCP or pi-native)
                                      │
             onProgress ◀── events ───┤──── questions ──▶ interaction
                                      ▼
                                  RunResult
```

`runner/` holds the dispatcher, sequences, harnesses and the switchboard.
`tools/` holds the wizard tools shared by both harnesses. `middleware/` holds
the benchmark pipeline. `progress/progress.ts` defines the event and interaction
contracts; `security/yara-hooks.ts` scans what the run installs.
