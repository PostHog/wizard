# 06 — Subagent / `Task` dispatch parity

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (flag at 0%) · **Depends on:** [03](03-builtin-tools.md), [05](05-security-parity-hooks.md)

## Summary

Implement subagent dispatch (the `Task` tool) in the harness, matching the SDK's behavior
— especially for the `wizard-variant=subagents` cohort. This is the most intricate
loop-behavior PR and is deliberately isolated so it can be gated independently.

## Background

The existing `wizard-variant` flag (`WIZARD_VARIANT_FLAG_KEY`, `constants.ts:139`,
evaluated at `agent-runner.ts:302`) selects `{ VARIANT: 'base' }` vs
`{ VARIANT: 'subagents' }`, forwarded as `ANTHROPIC_CUSTOM_HEADERS`. Under the SDK, the
`subagents` variant leans on the SDK's built-in subagent dispatch. The harness has no
such machinery — it must spawn, run, and collect subagents itself.

A known SDK quirk (see [PR 05](05-security-parity-hooks.md)): the SDK does **not**
propagate `disallowedTools` to dispatched subagents, so `canUseTool` is the only gate.
The harness must apply the full security layer to every subagent tool call.

## Scope

1. Implement `Task` dispatch: spawn a child harness loop with its own message history,
   its own (restricted) tool set, and a result that returns to the parent as a
   `tool_result`.
2. Apply the PR 05 security layer (`canUseTool` + YARA) to **every** subagent tool call.
3. Honor the `subagents` vs `base` variant: same prompt/metadata wiring as the SDK path,
   forwarded via the same custom headers.
4. Concurrency/limits parity: match the SDK's subagent count/recursion bounds, with a
   hard cap as a runaway backstop.

## Acceptance criteria

- [ ] A program that triggers subagents completes under the harness with equivalent output.
- [ ] Both `wizard-variant` values behave correctly under `wizard-runner=harness`.
- [ ] Subagent tool calls are security-gated (asserted by tests extending PR 05's corpus).
- [ ] Recursion/concurrency caps are enforced and unit-tested.
- [ ] Flag remains **0% harness**.

## Files

- `src/lib/agent/runner/harness-runner.ts` (Task dispatch)
- `src/lib/agent/runner/subagent.ts` (new)
- `src/lib/agent/runner/security.ts` (apply to subagent calls)

## Note on interaction with rollout

PR 07 ramps `wizard-runner` to 10% across *both* `wizard-variant` cohorts. If subagent
parity lags, consider initially restricting the harness canary to `wizard-variant=base`
and ramping `subagents` separately. Flag the decision in PR 07.
