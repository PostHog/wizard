# Phase 1 — Telemetry parity PR (pi path)

**Why first:** as of current `main`, the pi harness never emits `wizard: agent completed`,
`wizard remark`, `wizard: agent initial context`, or `wizard: bash denied`, and the
terminal `setup wizard finished` event carries no flat `harness` property. Built today,
the dashboard's cost, runtime, and remarks tiles would show anthropic-only data — which
reads as "pi is broken" when it's actually "pi is mute". Close the gaps, then build.

All changes are wizard-side; no context-mill or warlock changes needed.

## Changes

### 1.1 Emit `agent completed` / `agent aborted` from the pi path — required

- **Where:** `src/lib/agent/runner/harness/pi/index.ts` (and/or the shared seam in
  `src/lib/agent/runner/sequence/linear.ts` if a harness-agnostic emission point is
  cleaner — prefer the shared seam per the design discipline: the linear runner already
  owns the error-routing events).
- **What:** on run end, capture `wizard: agent completed` with at minimum `duration_ms`,
  `duration_seconds`, `model`. Include `num_turns` and token counts **if** the
  `@earendil-works/pi-coding-agent` session exposes usage; omit fields rather than
  fabricate. Do not fabricate `total_cost_usd` — leave absent for pi (cost comes from the
  gateway; see dashboard spec tile C4).
- On the error path, capture `wizard: agent aborted` with `duration_ms` + `model`
  (today pi's error duration is logged to file only).
- **Property-name contract:** reuse the exact anthropic property names so one insight
  serves both variants.

### 1.2 Flatten `harness` / `sequence` onto `setup wizard finished` — required

- **Where:** `src/utils/analytics.ts` `shutdown()`.
- **What:** spread the tags bag flat into the terminal event's properties (keep the
  nested `tags` snapshot for back-compat). Verified live that flat `harness` has never
  been seen on this event.
- **Interim workaround** (until released), for any SQL insight:
  `JSONExtractString(properties.tags, 'harness')`.

### 1.3 Capture `bash denied` in the pi security extension — required

- **Where:** `src/lib/agent/runner/harness/pi/security.ts`.
- **What:** the extension already runs `wizardCanUseTool()` and increments
  `state.blockedCount`; add the same
  `analytics.wizardCapture('bash denied', { reason, command })` the anthropic
  `canUseTool` callback fires.

### 1.4 Remark support for pi — strongly recommended

- **Why:** remarks are one of the primary signals being monitored; anthropic collects
  them via a Stop hook (`createStopHook()` in `src/lib/agent/agent-interface.ts`), which
  pi has no equivalent of.
- **What:** pi is in-process — append the `[WIZARD-REMARK]` instruction
  (`AgentSignals.WIZARD_REMARK`, `src/lib/agent/signals.ts`) to the final prompt (honor
  the existing `requestRemark` field on `BackendRunInputs`), parse the output with
  `AgentOutputSignals.remark()`, and capture `wizard remark` with the same single
  `remark` property.
- **Fallback if deferred:** annotate the remarks tiles "anthropic only" and exclude
  remark volume from go/no-go.

### 1.5 Guard pi + orchestrator — required (test, possibly code)

- Pi throws hard on `runTask`. If `wizard-orchestrator=true` and `wizard-runner=pi` can
  resolve for the same user, that cohort crashes at runtime.
- **What:** add/extend a test in `src/lib/agent/__tests__/variant-gating.test.ts`
  asserting the resolved binding for `{wizard-runner: pi, wizard-orchestrator: true}`.
  If the switchboard does not already force `sequence: linear` for pi, add that clamp in
  the switchboard resolver (config surface, not the runner).
- **Operational belt-and-braces:** during the ramp, keep `wizard-orchestrator` at 0% or
  mutually exclusive with the pi cohort.

### 1.6 YARA triage decision for pi — decide, then either wire or annotate

- Pi's `preExecutionYaraBlock()` calls `scan()` with no LLM triage: false-positive
  matches terminate pi runs that anthropic (triage via `createTriageLLMProvider()`)
  would survive, and `yara triage overruled` never fires for pi.
- **Option A (preferred):** wire the triage provider into the pi security extension so
  security behavior is comparable across variants.
- **Option B:** accept the stricter posture; annotate yara + completion tiles and treat
  yara-caused pi aborts as a separate bucket in analysis (the `agent aborted` `reason`
  property distinguishes them).

### 1.7 Verify analytics flush on the pi error path — required check

- Events are batched; confirm `analytics.shutdown()` (which sends
  `setup wizard finished`) runs on pi crash/abort paths, not just success. If a hard
  crash can skip the flush, completion-rate denominators are biased optimistic. The
  "stuck runs" insight (dashboard E6) detects this in prod either way, but know the
  answer before reading the test results.

## Acceptance criteria

Run the wizard headlessly against one throwaway app per variant
(`WIZARD_CI_FLAG_OVERRIDES='{"wizard-runner":"pi"}'` on a `pnpm build:ci` build) and
confirm, by querying project 2 for each `run_id`:

- [ ] pi run: `wizard: agent started` → `wizard: agent completed` (with `duration_ms`,
      `model: openai/gpt-5-mini`) → `wizard: yara scan report` → `setup wizard finished`
      with **flat** `harness: pi`.
- [ ] pi run with a forced abort: `wizard: agent aborted` carries `duration_ms`.
- [ ] pi run with a blocked bash command: `wizard: bash denied` fires.
- [ ] (if 1.4) pi run: `wizard remark` fires with non-empty `remark`.
- [ ] variant-gating test covers pi + orchestrator.
- [ ] `pnpm build && pnpm test && pnpm fix` green.
