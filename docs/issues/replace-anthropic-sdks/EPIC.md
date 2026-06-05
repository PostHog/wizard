# Epic: Replace Anthropic agent SDKs with an in-house harness runner

> **Status:** Draft / local tracking doc. These files are meant to be copy-pasted into
> GitHub issues (one epic + sub-issues). Nothing here is wired up yet.

## Problem

The wizard's agent loop is wholly owned by `@anthropic-ai/claude-agent-sdk@0.3.146`
(`package.json:35`). It is the only Anthropic dependency, and it pulls in a bundled
`cli.js` (Claude Code) that we launch as a subprocess. That gives us a lot for free
(the `claude_code` tool preset, subagent dispatch, streaming), but it also means:

- **We don't control the agent loop.** Retry behavior, context management, error
  surfaces, and tool dispatch are all opaque. When the upstream SDK has an outage or a
  regression, we inherit it with no recourse.
- **We pin to a fast-moving, pre-1.0 dependency.** `0.3.x` ships breaking changes; our
  security model (YARA hooks, `canUseTool`) is wired against internal SDK hook shapes
  that can shift under us.
- **The subprocess model is heavy and hard to observe.** Env vars are set on the parent
  process (`agent-interface.ts:692`) and inherited by a child `cli.js`; introspecting
  what the agent actually did means parsing a stream we don't own.

We already speak the Anthropic Messages protocol directly to **our own gateway**
(`ANTHROPIC_BASE_URL` → `getLlmGatewayUrlFromHost`, `urls.ts:78`), with a Bedrock
fallback toggled by a request header (`agent-interface.ts:417`). So the model transport
is already ours. What we don't own is the *loop on top of it*.

## Goal

Build an in-house **harness runner** that implements the agent loop, tool dispatch,
MCP hosting, and security hooks directly against the PostHog LLM gateway — and migrate
the wizard onto it behind a feature flag, starting at **10% of authenticated users**,
with full parity and a kill-switch before we ramp.

Replace, then remove, the `@anthropic-ai/claude-agent-sdk` dependency.

## Non-goals

- Changing the gateway, the model selection, or the Bedrock fallback behavior. The
  harness reuses all of it.
- Changing program/step definitions, prompt assembly, or the TUI. The runner sits
  strictly between `runProgram` and the model.
- Changing which tools exist or what they do. This is a faithful re-implementation of
  the execution layer, not a redesign of capabilities.

## Architecture seam

The whole migration hangs off one seam: today `runProgram` (`agent-runner.ts:178`)
calls `executeAgent` (aliased `runAgent` from `agent-interface.ts:817`), which calls
`sdk.query()`. We introduce a `Runner` abstraction with two implementations —
`SdkRunner` (today's path, default) and `HarnessRunner` (new) — and select between them
by feature flag at the point flags are already evaluated (`agent-runner.ts:302`).

```
runProgram (agent-runner.ts)
  ├─ getAllFlagsForWizard()            ← flags already evaluated here (post-OAuth distinct_id)
  ├─ const runner = selectRunner(flags['wizard-runner'])   ← NEW seam
  ├─ initializeAgent(...)
  ├─ assemblePrompt(...)
  └─ runner.run(agent, prompt, ...)    ← was executeAgent(...)
        ├─ SdkRunner    → sdk.query()                 (unchanged)
        └─ HarnessRunner → in-house loop over gateway (new)
```

## Rollout strategy (feature flag)

- **Flag:** `wizard-runner` (new constant in `constants.ts`, alongside
  `WIZARD_VARIANT_FLAG_KEY` / `WIZARD_TOOLS_MENU_FLAG_KEY`).
- **Type:** multivariate — `sdk` (control) / `harness` (test). Default/fallback is
  `sdk`, so any flag-fetch failure or offline run is safe.
- **Keying:** evaluated in `getAllFlagsForWizard()` at `agent-runner.ts:302`, which runs
  *after* `setDistinctId(userData.distinct_id)` (`setup-utils.ts:564`). So assignment is
  stable per authenticated user — the same person always gets the same runner across runs.
- **Ramp:** `harness` at **10%**, held until guardrail metrics (PR 07) show parity, then
  `25% → 50% → 100%`. Each step gated on dashboards, not time.
- **Kill-switch:** flipping the flag to 0% `harness` reverts everyone to the SDK on their
  next run, no release required. The `sdk` path stays in the tree until PR 09.

## PR sequence

| # | PR | Behavior change | Depends on |
|---|---|---|---|
| [01](01-runner-seam-and-flag.md) | Runner abstraction + `wizard-runner` flag plumbing (0% harness) | None — pure refactor, SDK still runs everyone | — |
| [02](02-harness-agent-loop.md) | Harness agent loop against the gateway | None (flag off) | 01 |
| [03](03-builtin-tools.md) | Built-in tool implementations (Read/Write/Edit/Glob/Grep/Bash/Task) | None (flag off) | 02 |
| [04](04-wizard-tools-mcp.md) | In-process `wizard-tools` hosting without `createSdkMcpServer` | None (flag off) | 02 |
| [05](05-security-parity-hooks.md) | YARA Pre/PostToolUse + `canUseTool` parity in harness | None (flag off) | 03, 04 |
| [06](06-subagents-task-dispatch.md) | Subagent / `Task` dispatch parity (`wizard-variant=subagents`) | None (flag off) | 03, 05 |
| [07](07-rollout-observability.md) | Guardrail telemetry + flip `wizard-runner` to 10% | **10% on harness** | 02–06 |
| [08](08-parity-test-harness.md) | SDK-vs-harness parity tests across frameworks | None (CI only) | 02–06 |
| [09](09-ramp-and-sdk-removal.md) | Ramp to 100%, delete `SdkRunner`, drop the dependency | **100% on harness**, SDK gone | 07, 08 |

PRs 02–06 land dark (flag at 0%). The first user-visible change is PR 07.

## Definition of done

- `@anthropic-ai/claude-agent-sdk` is removed from `package.json` and no source imports it.
- The harness runner serves 100% of runs across all programs and frameworks.
- Security parity (YARA + permission gating) is proven by the parity suite (PR 08).
- Guardrail metrics (success rate, wall-clock, tool-error rate, token usage) are at or
  above the SDK baseline at every ramp step.

## Risks & mitigations

- **Security regression** — the YARA hooks and `canUseTool` gate are the wizard's safety
  boundary. Mitigation: PR 05 ports them first-class with dedicated parity tests; PR 08
  asserts a blocked-action corpus is still blocked under the harness.
- **Tool-behavior drift** — subtle differences in Edit/Bash semantics could break real
  integrations silently. Mitigation: PR 08 diffs harness vs SDK output on the e2e test apps.
- **Loop correctness** (retries, stop conditions, context limits) — Mitigation: PR 02
  mirrors the SDK's observable behavior; 10% canary (PR 07) surfaces real-world gaps before ramp.
- **Subagent parity** — the `subagents` variant is the trickiest path. Mitigation: PR 06
  is isolated and gated by both `wizard-runner` and `wizard-variant`.
