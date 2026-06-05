# 02 — Harness agent loop against the gateway

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (flag at 0%) · **Depends on:** [01](01-runner-seam-and-flag.md)

## Summary

Build the core `HarnessRunner` agent loop: a direct Anthropic Messages API client that
talks to the PostHog LLM gateway, accumulates assistant/tool turns, and runs the
tool-use loop until a stop condition — replacing what `sdk.query()` does today. No tools
are dispatched yet (PR 03); this PR proves text-only turns, streaming, and stop handling.

## Background

We already point the SDK at our gateway via env vars (`agent-interface.ts:692-695`):
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN` =
`config.posthogApiKey`. The gateway speaks the Anthropic Messages protocol, so the
harness can POST `/v1/messages` directly. The Bedrock fallback is a request header
(`x-posthog-use-bedrock-fallback: true`, `agent-interface.ts:417`), and per-run metadata
rides in `ANTHROPIC_CUSTOM_HEADERS` (`agent-interface.ts:1058`).

## Scope

1. A thin Messages client (use the gateway URL from `getLlmGatewayUrlFromHost`,
   `urls.ts:78`; auth via `config.posthogApiKey`). Streaming (SSE) with incremental
   assistant-text emission to the existing UI sink.
2. The agent loop: send messages → receive assistant turn → if `tool_use` blocks, hand
   them to a dispatcher (stubbed in this PR, real in PR 03) and append `tool_result` →
   repeat until `stop_reason` is `end_turn`/`stop_sequence` or max-turns guard.
3. Reuse model selection (`agent-interface.ts:747` — `claude-opus-4-6` for `audit-3000`,
   else `claude-sonnet-4-6`) and forward the same custom headers (variant metadata,
   Bedrock fallback).
4. Honor the same stop conditions and the `Stop` hook contract (`agent-interface.ts:1099`).
5. Map errors to the same surfaces the SDK path produces (so UI/telemetry don't diverge).

## Acceptance criteria

- [ ] `HarnessRunner` wired into `selectRunner` (PR 01) behind `wizard-runner=harness`.
- [ ] A text-only program run completes end-to-end against a local gateway
      (`localhost:3308/wizard`) with no tools.
- [ ] Streaming text reaches the TUI identically to the SDK path.
- [ ] Bedrock fallback header and custom headers are sent and verified against the gateway.
- [ ] Max-turns / runaway guard exists and is unit-tested.
- [ ] Flag remains **0% harness**; SDK is unaffected.

## Files

- `src/lib/agent/runner/harness-runner.ts` (new)
- `src/lib/agent/runner/messages-client.ts` (new — SSE client)
- `src/utils/urls.ts` (reuse `getLlmGatewayUrlFromHost`)

## Risks

Loop correctness (retries, context-window handling, stop reasons) is the crux of the
whole epic. Mirror the SDK's *observable* behavior rather than inventing new semantics;
the 10% canary in PR 07 is what validates this against real projects.
