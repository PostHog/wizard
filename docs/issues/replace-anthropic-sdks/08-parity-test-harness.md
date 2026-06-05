# 08 — SDK-vs-harness parity test suite

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (CI only) · **Depends on:** [02](02-harness-agent-loop.md)–[06](06-subagents-task-dispatch.md)

## Summary

A CI suite that runs the same program under both runners and asserts equivalent outcomes
across the framework test apps. This is the automated backstop that lets us ramp PR 07
with confidence and, eventually, delete the SDK in PR 09 without fear.

## Background

The **wizard-workbench** repo houses framework test apps (Next.js, React Router, Django,
Flask, Laravel, SvelteKit, Swift, TanStack, FastAPI) with no PostHog installed, plus the
existing e2e apps under `e2e-tests/test-applications/` (Next.js pages/instrumentation,
React Vite/CRA/TanStack, Svelte, Astro, Expo/React Native). These are the substrate for
parity runs.

## Scope

1. A test driver that runs a program against a fixture app twice — once forcing
   `wizard-runner=sdk`, once `harness` (force via the seam from PR 01, not a live flag).
2. **Outcome parity:** the resulting file diff (added/edited files, key SDK-init content)
   is equivalent under both runners. Allow benign whitespace/ordering differences;
   assert on semantic content.
3. **Security parity:** a blocked-action corpus (destructive Bash, secret writes,
   prompt-injection content) is blocked under *both* runners — extends PR 05's tests into
   the e2e layer.
4. **Tool parity:** targeted unit-level diffs for Edit/Grep/Glob/Bash on a sample repo.
5. Wire into CI (`pnpm test:e2e`) with the harness matrix; keep cost bounded by sampling
   frameworks per run and `log()`-ing what was skipped (no silent truncation).

## Acceptance criteria

- [ ] Parity driver runs both runners against ≥3 framework apps in CI.
- [ ] Semantic file-output parity asserted; diffs surfaced on failure.
- [ ] Blocked-action corpus green under both runners.
- [ ] Suite is a required check before PR 09's ramp-to-100%.

## Files

- `e2e-tests/parity/` (new — driver + fixtures)
- `e2e-tests/parity/blocked-actions.test.ts` (new — security corpus)
- CI config for the parity matrix

## Note

Parity is "semantically equivalent integration", not "byte-identical output" — the model
is non-deterministic. Assert on the things that must hold (SDK initialized, env keys set,
events instrumented, nothing destructive ran), not on exact phrasing.
