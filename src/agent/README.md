# Agent

The agent runs one program's AI pipeline against a project directory. It takes
resolved data in, reports through progress events, asks through an injected
answerer, and returns a result. It never reads a session, a store or a UI. For
the callable program host and development CI runner, see the
[non-interactive developer interfaces](../../docs/developer-interfaces.md).

## Signatures

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside `src/agent` imports deeper; lint and the architecture test reject it.

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
  refreshed auth. See the
  [first-party provider](../../docs/developer-interfaces.md#inference-authentication)
  for gateway token minting and refresh.
- `RunResult`: `outcome` is `RunOutcome.Success | Aborted | Failed | Crashed`.
  Success may carry an `outro`; the other three carry a `failure`
  (`AgentFailure`: message, outro data, error, exit code, error code, detail).
  Every result carries `skillId` and a `snapshot` of what the run reported:
  tasks, status lines, stage, token usage totals, final cost, dashboard and
  notebook URLs, handoff text.
- `AgentProgress`: one event per thing the run reports, in emission order.
  Kinds: `lifecycle`, `spinner`, `log`, `status`, `tasks`, `stage`, `url`,
  `usage`, `finalCost`, `authError`, `handoff`, `completion`. Payloads are
  copies, never live objects.
- `AgentInteraction`: every member optional. `ask(question)` resolves with
  answers, `cancelAsk()` dismisses the open question, `taskNotice(notice)`
  resolves with whether to keep an optional task, `cancelTaskNotice()` declines
  it.
- `signal`: an optional `AbortSignal` from the host. A pre-aborted signal
  returns `Aborted` before execution; aborting during execution is passed to the
  active harness and returns `Aborted` with the current snapshot. It does not
  pause or resume a run.
- Errors: the agent does not exit the process and does not throw for a decided
  failure. An unexpected throw becomes `outcome: Crashed` with the error
  attached. A gateway 401 emits `authError` and then fails.

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
  process.exitCode = result.failure.exitCode ?? 1;
}
```

`src/agent/__tests__/run-agent-standalone.test.ts` runs this with no UI, no
store and no registry.

Pass an `AbortController` signal in the options and call `controller.abort()` to cancel an active run. The result then has `RunOutcome.Aborted`.

## Intent

Programs call the agent to do the work a skill describes. A standalone host can
observe the run through `onProgress` and answer it through `interaction`; the
legacy TUI and non-interactive runner still use
`src/lib/runners/run-program-agent.ts` for session gates and UI translation,
then call the same `runProgram` host.

Without `onProgress` the run completes and its snapshot still comes back in the
result. Without `interaction` the agent installs no ask bridge: `wizard_ask`
returns its "not available" error and optional task notices are declined, which
is what a `--ci` run does. A throwing observer is logged and the run continues.
Progress callbacks are not awaited, so an asynchronous observer must handle its
own rejected promises.

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
the benchmark pipeline. `progress.ts` defines the event and interaction
contracts; `yara-hooks.ts` scans what the run installs.
