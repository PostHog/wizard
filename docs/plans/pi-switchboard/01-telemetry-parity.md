# Phase 1 — Telemetry parity PR (pi path)

**Why first:** as of current `main`, the pi harness never emits `wizard: agent completed`,
`wizard remark`, `wizard: agent initial context`, or `wizard: bash denied`, and the
terminal `setup wizard finished` event carries no flat `harness` property. Built today,
the dashboard's runtime and remarks tiles would show anthropic-only data — which reads
as "pi is broken" when it's actually "pi is mute". (Cost, tokens, and per-call latency
are NOT affected: AI observability already covers those symmetrically — see below.)
Close the remaining gaps, then build.

All changes are wizard-side; no context-mill or warlock changes needed.

## What PostHog already tracks — do NOT re-add (verified live 2026-07-03)

The LLM gateway emits `$ai_generation` into project 2 for **both** harnesses, with the
wizard attribution set (`run_id`, `program_id`, `integration`, `build`, `harness`,
`sequence`) as flat properties. Pi traffic is already flowing (25 dev runs observed,
including `gpt-5-mini`). The parity PR must not duplicate any of this:

| Signal | Already covered by | Notes |
|---|---|---|
| LLM cost (USD) | `$ai_total_cost_usd` (+ input/output/cache cost splits) per generation | symmetric across harnesses; sum by `run_id` for per-run cost |
| Token usage | `$ai_input_tokens`, `$ai_output_tokens`, `$ai_cache_read_input_tokens`, `$ai_reasoning_tokens` | symmetric |
| Per-call latency / TTFT | `$ai_latency`, `$ai_time_to_first_token` | symmetric |
| Model / provider | `$ai_model`, `$ai_provider` | `$ai_model` is unprefixed (`gpt-5-mini`) |
| Provider-side errors | `$ai_http_status`, `$ai_stop_reason` | fires even when wizard-side events don't |
| Tool-call volume | `$ai_tool_call_count` | symmetric |

What AI observability **cannot** provide (genuinely wizard-side, hence this PR):
run-level outcome (`setup wizard finished` status), run-level wall-clock duration,
remarks, bash-denied policy hits, and YARA events. That's the whole scope below.

## Changes

### 1.1 Emit `agent completed` / `agent aborted` from the pi path — required

- **Where:** `src/lib/agent/runner/harness/pi/index.ts` (and/or the shared seam in
  `src/lib/agent/runner/sequence/linear.ts` if a harness-agnostic emission point is
  cleaner — prefer the shared seam per the design discipline: the linear runner already
  owns the error-routing events).
- **What:** on run end, capture `wizard: agent completed` with `duration_ms`,
  `duration_seconds`, `model` (plus `num_turns` if the pi session exposes it trivially).
  **Deliberately omit cost and token fields** — AI observability already tracks those
  symmetrically per generation via `$ai_generation` (see the table above); duplicating
  them wizard-side would create a second, diverging accounting.
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

### 1.4 Remark support for pi — REQUIRED (upgraded 2026-07-03)

Remarks are the #1 monitoring priority and the top tile on the shipped dashboard —
without this item that tile stays half-empty for the variant under test. Originally
"strongly recommended"; now required for the flag cut.

- **Why:** anthropic collects remarks via a Stop hook (`createStopHook()` in
  `src/lib/agent/agent-interface.ts`), which pi has no equivalent of.
- **What:** pi is in-process — append the `[WIZARD-REMARK]` instruction
  (`AgentSignals.WIZARD_REMARK`, `src/lib/agent/signals.ts`) to the final prompt (honor
  the existing `requestRemark` field on `BackendRunInputs`), parse the output with
  `AgentOutputSignals.remark()`, and capture `wizard remark` with the same single
  `remark` property.

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

### 1.8 (optional) Tag the binding before `agent started` fires

- Verified live: `wizard: agent started` carries no `harness`/`sequence` — it's
  captured in `bootstrapProgram()` before `tagBinding()` runs in `runProgram()`. The
  shipped dashboard works around this (exposure tile A1 and the stuck-runs net join
  harness from `$ai_generation` by `run_id`), so this is not blocking — but resolving
  the binding before the bootstrap capture would let wizard-side events carry the
  variant from the first event and simplify several dashboard queries later.

## Acceptance criteria

Run the wizard headlessly against one throwaway app per variant
(`WIZARD_CI_FLAG_OVERRIDES='{"wizard-runner":"pi"}'` on a `pnpm build:ci` build) and
confirm, by querying project 2 for each `run_id`:

- [ ] pi run: `wizard: agent started` → `wizard: agent completed` (with `duration_ms`,
      `model: openai/gpt-5-mini`) → `wizard: yara scan report` → `setup wizard finished`
      with **flat** `harness: pi`.
- [ ] pi run: `$ai_generation` events for the same `run_id` show `harness: pi`,
      `$ai_model: gpt-5-mini`, and non-zero `$ai_total_cost_usd` (no wizard change
      needed — this asserts the already-working gateway path stays intact).
- [ ] pi run with a forced abort: `wizard: agent aborted` carries `duration_ms`.
- [ ] pi run with a blocked bash command: `wizard: bash denied` fires.
- [ ] pi run: `wizard remark` fires with non-empty `remark` (1.4 — required).
- [ ] variant-gating test covers pi + orchestrator.
- [ ] `pnpm build && pnpm test && pnpm fix` green.
