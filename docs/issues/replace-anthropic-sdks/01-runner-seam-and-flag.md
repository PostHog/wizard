# 01 — Runner abstraction + `wizard-runner` flag plumbing

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none · **Depends on:** —

## Summary

Introduce a `Runner` abstraction that the program pipeline calls instead of directly
invoking the SDK, and add `wizard-runner` flag plumbing. Ship a single implementation —
`SdkRunner`, wrapping today's code path verbatim — and default everyone to it. This PR
is a pure refactor: identical behavior, new seam.

## Why first

Every later PR builds the harness *behind* this seam. Landing it alone (with no second
implementation) keeps the diff reviewable and proves the wrapper is behavior-preserving
before any new agent code exists.

## Scope

1. Define `interface Runner { run(agent, prompt, ctx): Promise<AgentResult> }` (or match
   the existing `executeAgent` signature exactly) in `src/lib/agent/runner/index.ts`.
2. Extract the current `runAgent` body in `agent-interface.ts:817` into `SdkRunner` with
   **no behavior change** — it still sets the env vars (`agent-interface.ts:692`), builds
   MCP servers, and calls `sdk.query()`.
3. Add `WIZARD_RUNNER_FLAG_KEY = 'wizard-runner'` to `constants.ts` (next to
   `WIZARD_VARIANT_FLAG_KEY` at `constants.ts:139`).
4. In `runProgram` (`agent-runner.ts`), after `getAllFlagsForWizard()` (`:302`), add
   `const runner = selectRunner(flags)` where `selectRunner` returns `SdkRunner` unless
   `flags['wizard-runner'] === 'harness'` — and since `HarnessRunner` doesn't exist yet,
   it always returns `SdkRunner`. Add a `// TODO(harness):` marker.
5. Replace the `executeAgent(...)` call (`agent-runner.ts:373`) with `runner.run(...)`.

## Acceptance criteria

- [ ] `pnpm build && pnpm test && pnpm fix` all pass.
- [ ] No behavior change: existing e2e tests pass unchanged.
- [ ] `selectRunner` is unit-tested for both flag values (both resolve to `SdkRunner` for now).
- [ ] The `__mocks__/@anthropic-ai/claude-agent-sdk.ts` stub still satisfies `SdkRunner`.
- [ ] `wizard-runner` flag is created in PostHog (US + EU) as multivariate `sdk`/`harness`,
      default `sdk`, **0% on `harness`**.

## Files

- `src/lib/agent/runner/index.ts` (new — interface + `selectRunner`)
- `src/lib/agent/runner/sdk-runner.ts` (new — extracted from `agent-interface.ts:817`)
- `src/lib/agent/agent-interface.ts` (extract `runAgent`)
- `src/lib/agent/agent-runner.ts` (`:302` flag read, `:373` call site)
- `src/utils/constants.ts` (`:139` add flag key)

## Notes

Keep `SdkRunner` a thin move, not a rewrite — the goal is that `git diff` shows code
*relocated*, not changed. Resist folding in cleanups; they belong in later PRs.
