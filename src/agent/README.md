# Agent

The agent runs one program's AI pipeline against a project directory. It takes
resolved data in, reports through progress events, asks through an injected
answerer, and returns a result. It never reads a session, a store or a UI.

## Signatures

Import runtime values from `@agent` and types from `@agent/types`. Nothing
outside `src/agent` imports deeper; lint and the architecture test reject it.

```ts
import { runAgent, RunOutcome } from '@agent';
import type { RunConfig, RunInput, RunResult, AgentProgress } from '@agent/types';

runAgent(config: RunConfig, input: RunInput, options?: {
  onProgress?: (event: AgentProgress) => void;
  interaction?: AgentInteraction;
  signal?: AbortSignal;
}): Promise<RunResult>
```

- `RunConfig`: the program id, its `AgentRunDefinition` (prompt, skill, tools,
  copy), the resolved `binding` (sequence, harness, model), the switchboard
  inputs, the skills origin, flag snapshot, trace tags, tool allow and deny
  lists, seed tasks and bound completion `hooks`.
- `RunInput`: install directory, resolved credentials, project and user
  payloads, skill id, detected integration, `flags` (`ci`, `signup`, `debug`,
  `e2eAsk`, `localMcp`, `captureAio`, `benchmark`, `yaraReport`) and the host
  the CLI was told.
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
- `AgentInteraction`: every member optional. `ask(question, { signal })`
  resolves with answers, and `taskNotice(notice, { signal })` resolves with
  whether to keep an optional task. Each request has its own signal, which
  aborts when that request times out, the host aborts the run, or another task
  fails the run; on abort the host dismisses that request alone, without
  throwing.
- Errors: the agent does not exit the process and returns decided failures. A
  caught coded error becomes `Failed`. An uncoded throw becomes `Crashed` with
  the error attached. A gateway 401 returns an auth failure. The host decides
  whether to show auth UI. `Aborted` means the host's signal cancelled the run;
  an agent that stops itself with `[ABORT]` returns `Failed` with its abort
  code.
- Analytics shutdown is host-owned: the agent never sends the terminal
  `setup wizard finished` event. The host sends it from the outcome: `Success`
  is `success`, `Aborted` is `cancelled`, `Failed` and `Crashed` are `error`.

Other runtime exports: `resolveBinding`, `shouldDisableAsk`, `initializeAgent`,
`executeAgent`, `buildRunTags`, `AgentSignals`,
`configureGatewayFromCIEnvironment`, `downloadSkill`, `WIZARD_TOOL_NAMES`,
`LONGER_ASK_TIMEOUT_MS`, `flushScanReport`, and `runMcpPromptViaSdk`, which
loads the streaming module on first call.

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

## Intent

Programs call the agent to do the work a skill describes. The TUI and the
headless runner observe the run through `onProgress` and answer it through
`interaction`; today `src/lib/programs/run-agent-legacy.ts` does both on top of
the session.

Without `onProgress` the run completes and its snapshot still comes back in the
result. Without `interaction` the agent installs no ask bridge: `wizard_ask`
returns its "not available" error and optional task notices are declined, which
is what a `--ci` run does. A throwing observer is logged and the run continues.

## Architecture

The agent owns run state for one invocation: the task queue, phase, status,
resolved skill, handoff text, usage and the final result. It depends on
`src/shared` and on `src/env.ts`, and on program types only until the bindings
table moves to programs.

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
                                  RunResult
```

`runner/` holds the dispatcher, sequences, harnesses and the switchboard.
`tools/` holds the wizard tools shared by both harnesses. `middleware/` holds
the benchmark pipeline. `progress.ts` defines the event and interaction
contracts; `yara-hooks.ts` scans what the run installs.
