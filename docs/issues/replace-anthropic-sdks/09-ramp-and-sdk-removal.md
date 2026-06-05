# 09 — Ramp to 100% and remove the Anthropic SDK

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** **100% on harness, SDK removed** · **Depends on:** [07](07-rollout-observability.md), [08](08-parity-test-harness.md)

## Summary

Close out the epic: ramp `wizard-runner` from 10% to 100% in stages, then delete the
`SdkRunner` path and drop `@anthropic-ai/claude-agent-sdk` from the dependency tree.

## Ramp (gated on metrics, not time)

`10% → 25% → 50% → 100%`. At each step, the PR 07 comparison dashboard must show harness
parity-or-better on success rate, wall-clock, tool-error rate, token usage, and
security-block behavior. Hold or roll back on any regression. Each step is a flag change,
not a release.

## Removal (only after 100% has soaked clean)

1. Delete `SdkRunner` (`src/lib/agent/runner/sdk-runner.ts`) and simplify `selectRunner`
   to always return `HarnessRunner` (or inline it).
2. Remove the dynamic `import('@anthropic-ai/claude-agent-sdk')` sites:
   `agent-interface.ts:39`, `mcp-prompt-streaming.ts:29`, `wizard-tools.ts:36`.
   - `mcp-prompt-streaming.ts` (the TUI suggested-prompts chat runner) must move to the
     harness Messages client too — **do not forget this second `query()` consumer.**
3. Drop `@anthropic-ai/claude-agent-sdk` from `package.json:35` and delete the Jest mock
   `__mocks__/@anthropic-ai/claude-agent-sdk.ts` + its `package.json:155` module mapping.
4. Remove now-dead env-var plumbing specific to the bundled `cli.js`
   (`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` at
   `agent-interface.ts:692-695`) if the harness doesn't need them.
5. Optionally retire the `wizard-runner` flag once the SDK path is gone (or keep it as a
   permanent escape hatch pointing at a future alternative).

## Acceptance criteria

- [ ] `wizard-runner` at 100% `harness`, soaked clean across both regions.
- [ ] `grep -r '@anthropic-ai/claude-agent-sdk' src` returns nothing.
- [ ] `@anthropic-ai/claude-agent-sdk` removed from `package.json` and `pnpm-lock.yaml`.
- [ ] `mcp-prompt-streaming.ts` runs on the harness client.
- [ ] `pnpm build && pnpm test && pnpm test:e2e && pnpm fix` all pass.
- [ ] CHANGELOG / release notes updated; bundle size delta recorded (no more bundled `cli.js`).

## Files

- `src/lib/agent/runner/sdk-runner.ts` (delete)
- `src/lib/agent/agent-interface.ts`, `src/lib/agent/mcp-prompt-streaming.ts`,
  `src/lib/wizard-tools.ts` (remove SDK imports)
- `package.json`, `pnpm-lock.yaml`, `__mocks__/@anthropic-ai/claude-agent-sdk.ts` (remove)

## The payoff

We own the loop end-to-end: retries, context management, error surfaces, and tool
dispatch are ours to observe and tune. No pre-1.0 dependency dictating our security
hook shapes, and no bundled subprocess to ship.
