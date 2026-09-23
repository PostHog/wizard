# Agent

The agent runs one program's AI pipeline against a project directory. It takes
resolved data in, reports through progress events, asks through an injected
answerer, and returns a result. It never reads a session, a store or a UI. For
the callable program host and development CI runner, see the
[non-interactive developer interfaces](../../docs/developer-interfaces.md).

## Signatures

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside `src/agent` imports deeper. Lint and the architecture test reject it.

```ts
import { runAgent, RunOutcome } from '@agent';
import type { RunConfig, RunInput, RunResult, AgentProgress, AgentInteraction } from '@agent/types';

runAgent(config: RunConfig, input: RunInput, options?: {
  onProgress?: (event: AgentProgress) => unknown;
  interaction?: AgentInteraction;
  signal?: AbortSignal;
}): Promise<RunResult>
```

- `RunConfig`: the opaque program id, its `AgentRunDefinition` (prompt, skill,
  tools, copy), the resolved `binding` (sequence, harness, model and task-role
  routes), supplied program commandments and stage policy, the skills origin,
  flag snapshot, trace tags, tool allow and deny lists, seed tasks, bound
  completion `hooks` and `scanReport`. `scanReport: 'defer'` leaves this run's
  scans to the host run's report. The default, `'flush'`, writes the report when
  this run ends.
- Two `AgentRunDefinition` options shape the run's output.
  `collectTranscript: true` keeps the last 256 KiB of assistant text as
  `snapshot.transcriptTail` and reports each step as `activity` progress. It
  works on the linear sequence with the Anthropic harness.
  `requestRemark: false` skips the end-of-run reflection remark, which is on by
  default.
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
  Success may carry an `outro`. The other three carry a `failure`
  (`AgentFailure`: required code and message, optional outro data, `Error`, exit
  code, detail, and authentication detail). `failure.error` may be attached, and
  `Crashed` requires one. A failed result need not have an attached `Error`.
  Every result carries a `snapshot` of what the run reported: tasks, status
  lines, stage, token usage totals, final cost, dashboard and notebook URLs,
  handoff text, and the transcript tail when the run definition sets
  `collectTranscript`. It may also carry `skillId`.
- `AgentProgress`: one event per thing the run reports, in emission order.
  Kinds: `lifecycle`, `spinner`, `log`, `status`, `tasks`, `stage`, `url`,
  `usage`, `finalCost`, `authError`, `handoff`, `completion`, and `activity`
  (one line per step, only from a run that collects its transcript). Payloads
  are copies, never live objects.
- `AgentInteraction`: every member optional. `ask(question, { signal })`
  resolves with answers, and `taskNotice(notice, { signal })` resolves with
  whether to keep an optional task. Each request has its own signal, which
  aborts when that request times out, the host aborts the run, or another task
  fails the run. On abort the host dismisses that request alone, without
  throwing.
- `signal`: an optional `AbortSignal` from the host. A pre-aborted signal
  returns `Aborted` before execution. An abort during execution reaches the
  active harness and returns `Aborted` with the current snapshot. It does not
  pause or resume a run. `Aborted` means only that the host's signal cancelled
  the run.
- Errors: the agent does not exit the process or throw for a decided failure. A
  caught coded error returns `Failed`, and an uncoded throw returns `Crashed`.
  Both retain the caught `Error` (or an `Error` wrapper for a non-`Error`
  throw). An agent that stops itself with `[ABORT]` returns `Failed` with its
  abort code. A gateway 401 returns an authentication failure with detail for
  the host to present. The host decides how to present a returned failure, set
  an exit code, or rethrow an attached error. Final scan-report flushing is best
  effort and does not replace the run result.
- Analytics shutdown is host-owned: the agent never sends the terminal
  `setup wizard finished` event, and `runProgram` doesn't either. The host sends
  it from the outcome: `Success` is `success`, `Aborted` is `cancelled`,
  `Failed` and `Crashed` are `error`.

`@agent` exports ten runtime names, and
`src/agent/__tests__/public-entry.test.ts` holds that list:

- **`runAgent` and `RunOutcome`.** The run and its outcome enum.
- **`OutroKind`.** The kind of an outro in `completion` progress and in failure
  outro data.
- **`DEFAULT_AGENT_BINDING`.** The Pi and linear binding for standalone callers.
- **`resolveHarness` and `harnessRunsTasks`.** What programs resolve a binding
  with. `harnessRunsTasks` says which harnesses the orchestrator can drive.
- **`AgentSignals` and `WIZARD_TOOL_NAMES`.** The marker strings that program
  prompts embed, and the tool ids that go in tool allow and deny lists.
- **`downloadSkill` and `runMcpPromptViaSdk`.** The skill installer and the
  suggested-prompts stream. Each loads its module on first call.

Minimal invocation:

```ts
const result = await runAgent(config, input, {
  onProgress: (event) => {
    if (event.kind === 'log') console.log(event.message);
  },
  interaction: {
    ask: async (question, { signal }) => answersFor(question, signal),
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
read `failure`. A failed result can have no attached `Error`. If a higher layer
uses exceptions, it can rethrow `failure.error` when present and construct an
error from `failure.message` otherwise. Preserve the original `Error` object
when rethrowing so its stack and cause remain available.

`src/agent/__tests__/run-agent-standalone.test.ts` runs this with no UI, no
store and no registry.

Pass an `AbortController` signal in the options and call `controller.abort()` to
cancel an active run. The result then has `RunOutcome.Aborted`.

## Intent

Programs call the agent to do the work a skill describes. `runProgram` builds
the `RunConfig` and `RunInput` for every program run. The TUI and the `--ci`
runner reach it through `src/lib/runners/run-program-agent.ts`, which supplies
session capabilities and maps progress back onto `getUI()`.

Agentic detection calls `runAgent` itself, before the program runs. It uses a
linear Haiku run on the Anthropic harness, with `collectTranscript`,
`requestRemark: false` and `scanReport: 'defer'`. It reads its report from the
transcript tail and makes up to two attempts, with deadlines of 60 and 90
seconds. A standalone host builds the config and input itself, as
`scripts/e2e-agent.no-jest.ts` does.

Without `onProgress` the run completes and its snapshot still comes back in the
result. Without `interaction` the agent installs no ask bridge: `wizard_ask`
returns its "not available" error and optional task notices are declined. Plain
`--ci` runs also disable the ask bridge and decline notices. A throwing observer
is logged and the run continues. Progress callbacks are not awaited. Throws and
rejections from returned thenables are logged. Observers must handle errors from
detached work they start.

## Architecture

The agent owns run state for one invocation: the task queue, phase, status,
resolved skill, handoff text, usage and the final result. It depends on
`src/shared` and `src/env.ts`. Callers supply program routing and policy through
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
contracts. `yara-hooks.ts` scans what the run installs.
