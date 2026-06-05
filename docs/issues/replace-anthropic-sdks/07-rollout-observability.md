# 07 — Guardrail telemetry + flip `wizard-runner` to 10%

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** **10% of authenticated users on the harness** · **Depends on:** [02](02-harness-agent-loop.md)–[06](06-subagents-task-dispatch.md)

## Summary

The first user-visible step. Add guardrail telemetry that lets us compare the harness
against the SDK on the metrics that matter, then move `wizard-runner` to **10% `harness`**.
This is the canary: real users, real projects, instant revert via the flag.

## Telemetry (must land before the ramp)

Emit on every run, tagged with the resolved `wizard-runner` variant (`sdk`/`harness`) so
every metric is sliceable by runner:

- **Success rate** — did the program complete its goal (integration verified / audit
  finished)?
- **Wall-clock duration** — end-to-end run time.
- **Tool-error rate** — failed tool calls / total tool calls.
- **Token usage** — input/output/cache tokens per run (already available from gateway
  responses; surface per runner).
- **Security-block counts** — Pre/PostToolUse + `canUseTool` blocks, by category.
- **Abandonment** — runs that error or are killed before completion.

Route through the existing analytics module (`src/utils/analytics.ts`) so events land in
the same PostHog project the wizard already reports to — we dogfood our own funnel.

## Rollout

1. Confirm PRs 02–06 are merged and the PR 05 blocked-action corpus + PR 08 parity suite
   are green.
2. Build a comparison dashboard (SDK vs harness) on the six metrics above.
3. Flip `wizard-runner` to **10% `harness`** (US + EU). Assignment is stable per
   authenticated `distinct_id` (set at `setup-utils.ts:564`, evaluated at
   `agent-runner.ts:302`).
4. Watch for a defined soak window. Hold the ramp on metrics, not a timer.

## Kill-switch

Flip `wizard-runner` to **0% `harness`** → every user reverts to the SDK on their next
run, no release. The `SdkRunner` path stays fully intact until [PR 09](09-ramp-and-sdk-removal.md).

## Acceptance criteria

- [ ] All six guardrail metrics emit, tagged by runner, in both regions.
- [ ] Comparison dashboard live before the flag moves.
- [ ] `wizard-runner` at 10% `harness`; kill-switch rehearsed (flip to 0%, confirm revert).
- [ ] An alert fires if harness success rate drops below the SDK baseline by a set margin.
- [ ] Decision recorded on whether the canary covers both `wizard-variant` cohorts (see PR 06).

## Files

- `src/utils/analytics.ts` (guardrail events)
- `src/lib/agent/runner/harness-runner.ts` + `sdk-runner.ts` (emit per-runner metrics)
