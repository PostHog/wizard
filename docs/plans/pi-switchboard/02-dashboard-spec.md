# Phase 2 — Dashboard, insights & alerts (SHIPPED, as built)

Live in **PostHog Cloud US, project 2**:
**[wizard-switchboard (dashboard 1793563)](https://us.posthog.com/project/2/dashboard/1793563)**.
Built 2026-07-03, revised twice after review — this doc describes the **as-built state**
and is the source of truth for what exists.

## Guiding principles (from review feedback — apply to any future change)

1. **Every insight must directly answer "how is the pi runner different from
   anthropic?"** Insights that structurally can't were deleted (the breakdown funnel
   whose steps fire before the runner is chosen; the opt-in step-progress tile; a
   duplicate completion tile).
2. **Plain names, no jargon.** Insights are named as the comparison they answer
   (`Pi vs anthropic: <metric>`); descriptions say what a difference means and when pi
   data appears. No "post-parity", no tile codes in PostHog itself.
3. **≤ 12 curated tiles, ordered by the stated priorities:** remarks, cost, runtime,
   completion, errors, YARA. Everything else is a saved deep-dive insight tagged
   `switchboard`.
4. **This is an exclusive basic-integration experiment** — everything filters to
   `program_id = posthog-integration` where the event carries it (the terminal
   `setup wizard finished` and `auth complete` events don't carry it flat; they're
   constrained by adjacent funnel steps instead).

`build` is deliberately NOT baked into dashboard tiles — apply it as a dashboard-level
filter (`prod` for monitoring, `ci`/`dev` for validation runs). ALERT-twin insights DO
bake `build = prod` so alerts never fire on dev noise.

## The dashboard — 12 tiles (two per row, priority order)

| Row | Left | Right |
|---|---|---|
| 1 | [Agent remarks](https://us.posthog.com/project/2/insights/mTiRZTvj) — table; **pi rows need parity item 1.4** | [Cost per run (USD)](https://us.posthog.com/project/2/insights/T7eVkhiq) — gateway, works today |
| 2 | [Run duration p50/p90](https://us.posthog.com/project/2/insights/W2f0NFjX) — SDK event, exact; **pi needs parity 1.1** | [Speed per LLM call](https://us.posthog.com/project/2/insights/8Hmai6ey) — gateway, works today |
| 3 | [Completion rate %](https://us.posthog.com/project/2/insights/Sb3G7gAa) — tags JSON, works today | [Run volume / flag-split check](https://us.posthog.com/project/2/insights/5RGn3QKe) — gateway, works today |
| 4 | [Funnel: basic integration on PI](https://us.posthog.com/project/2/insights/vxdYeuHV) | [Funnel: basic integration on ANTHROPIC](https://us.posthog.com/project/2/insights/LgLe5Tb1) |
| 5 | [Funnel: conversion over time (before/after)](https://us.posthog.com/project/2/insights/UPFoweZN) | [LLM API errors](https://us.posthog.com/project/2/insights/AjCvWuo0) |
| 6 | [Stuck runs](https://us.posthog.com/project/2/insights/eFKdijAJ) — works today | [Runs hit by YARA enforcement](https://us.posthog.com/project/2/insights/NjVbU3Ce) — works today |

Key design decisions per row:

- **Remarks first** (top priority). The pi runner emits no remarks until parity 1.4 —
  which is why 1.4 is a **required** parity item, not optional.
- **Cost** reads `$ai_generation` (symmetric, canonical). Early data: pi (gpt-5-mini)
  ~$0.5/run vs anthropic (sonnet) ~$3/run.
- **Duration** deliberately keeps the exact SDK source (decision 2026-07-03): pi stays
  blank until parity 1.1 rather than switching to a gateway-derived approximation.
  Read together with "speed per LLM call" to separate model speed from turn count.
- **Completion rate** reads the runner from the nested `tags` JSON on
  `setup wizard finished`, so it works before AND after parity 1.2.
- **Funnels are side-by-side per runner**, not one breakdown funnel. The runner
  property doesn't exist on pre-agent events, so each funnel filters by **cohort**:
  - [Wizard runs on pi (392518)](https://us.posthog.com/project/2/cohorts/392518)
  - [Wizard runs on anthropic (392519)](https://us.posthog.com/project/2/cohorts/392519)
  - Cohort = person performed `$ai_generation` with `harness=<runner>` +
    `program_id=posthog-integration` in the last 30 days. Caveat: people who ran both
    runners (dogfooders, CI identities) appear in both funnels.
- **Funnel steps — carefully traced basic-integration sequence** (capture sites in
  wizard code):
  1. `wizard: started` (`src/ui/tui/start-tui.ts`) — TUI entry *(program filter)*
  2. `wizard: auth complete` (`src/ui/tui/store.ts`) — OAuth done *(no program_id on
     this event; constrained by neighbors)*
  3. `wizard: setup confirmed` (`store.ts`) — user confirmed framework/project
     *(program filter)*
  4. `wizard: agent started` (`src/lib/agent/runner/shared/bootstrap.ts`) — agent
     begins; **the runner is chosen here**, so divergence between the two funnels
     before this step means something besides the runner is wrong *(program filter)*
  5. `wizard: mcp complete` (`store.ts`) — post-agent MCP screen reached; agent phase
     survived
  6. `setup wizard finished` with `status=success` (`src/utils/analytics.ts
     shutdown()`) — terminal
  - Conversion window 2h; date range 30d.
- **Before/after** = the conversion-over-time funnel (row 5, funnel-trends viz).
  **Add a PostHog annotation at every `wizard-runner` flag change** — the bend after a
  ramp step is the before/after read.
- **YARA on the board is the impact number** — distinct runs where the scanner
  `blocked`/`reverted` (verified `action` values), per runner. Since pi has no LLM
  triage, a pi-heavy gap directly prices the missing triage (parity decision 1.6).
  Per-rule diagnosis is a deep-dive.

## Deep-dive insights (saved, tagged `switchboard`, NOT on the dashboard)

| Insight | Works today? |
|---|---|
| [How runs end (success/error/cancelled)](https://us.posthog.com/project/2/insights/r7iojoAC) — parked here until parity 1.2 gives it a per-runner split, then consider promoting | aggregate only |
| [YARA security blocks by rule](https://us.posthog.com/project/2/insights/Ngk3X9hY) — per-rule diagnosis behind the enforcement tile | yes |
| [Framework mix](https://us.posthog.com/project/2/insights/h4VYFnWz) — confounder check: does pi's framework distribution match anthropic's? | yes |
| [Run duration by framework](https://us.posthog.com/project/2/insights/6Yi7mbRJ) | parity 1.1 |
| [Token usage per LLM call](https://us.posthog.com/project/2/insights/JYUTFPEa) — explains WHY cost differs | yes |
| [Why runs abort](https://us.posthog.com/project/2/insights/YujUyOtB) | yes |
| [Time lost per aborted run](https://us.posthog.com/project/2/insights/3jWEsC7N) — borrowed from the anomaly monitor; failing fast vs failing after 20 min | parity 1.1 |
| [API errors per run](https://us.posthog.com/project/2/insights/txvaDMn6) | yes |
| [Wizard crashes ($exception)](https://us.posthog.com/project/2/insights/khHLCSFL) | yes |
| [Provider HTTP errors at the gateway](https://us.posthog.com/project/2/insights/MZeJAs4p) | yes |
| [Wizard version mix](https://us.posthog.com/project/2/insights/dAohPkbs) — avoid misreading pre-parity pi data; delete ~a month after parity ships | yes |
| [YARA violations per run](https://us.posthog.com/project/2/insights/dliVo8Ol) | yes |
| [YARA triage overrules (anthropic only)](https://us.posthog.com/project/2/insights/ryG3mBhX) — every overrule is a run pi would have killed | yes |
| [Remark volume](https://us.posthog.com/project/2/insights/pMpVC2js) — canary that pi remark parity works | parity 1.4 |
| [SDK-reported cost (anthropic only)](https://us.posthog.com/project/2/insights/LVxIoaOw) — gateway sanity check only | yes |
| [Warlock kill-switch fired](https://us.posthog.com/project/2/insights/zZVpQ8t3) — pure ops canary; hosts the hourly alert | yes |

Deleted (couldn't answer the comparison question): the breakdown funnel, the opt-in
step-progress tile, the duplicate trends completion tile.

## Alerts — 5 armed (2026-07-03), subscribed: vincent@posthog.com

Alerts attach to insights, not tiles, so they run regardless of dashboard membership.
ALERT-twin insights bake `build = prod`.

| Alert | On insight | Config |
|---|---|---|
| pi completion rate below 70% | [PD8zw80V](https://us.posthog.com/project/2/insights/PD8zw80V) (tags JSON — works pre-parity) | daily, absolute, lower 70 (retune to anthropic baseline − 10pts once measured) |
| pi API errors spiking | [Uk9MaDf8](https://us.posthog.com/project/2/insights/Uk9MaDf8) | daily, relative increase, +100% |
| warlock kill-switch fired | [zZVpQ8t3](https://us.posthog.com/project/2/insights/zZVpQ8t3) | **hourly**, absolute, upper 0 |
| pi high-severity YARA match | [PlN2GPOE](https://us.posthog.com/project/2/insights/PlN2GPOE) (`severity in (high, critical)`) | daily, absolute, upper 0 |
| stuck pi runs (3+ in 24h) | [55w4IwfY](https://us.posthog.com/project/2/insights/55w4IwfY) | daily, absolute, upper 2 |

**Suggested addition after the flag cut** (from the anomaly-monitor pattern): anomaly
detection alerts (`detector_config`, e.g. zscore) on pi cost-per-run and pi call
latency — threshold alerts catch cliffs, anomaly detectors catch drifts.

## What the dashboard needs from the wizard codebase (code to ship)

The authoritative spec is `01-telemetry-parity.md`; summary of which tiles depend on
which parity item:

| Parity item | Unblocks |
|---|---|
| 1.1 pi emits `agent completed`/`aborted` (duration, model) | run duration tile, duration-by-framework, time-lost-per-abort |
| 1.2 flatten `harness` onto `setup wizard finished` | how-runs-end split (then promote it), cleaner completion tile, funnel last-step filtering |
| 1.3 pi captures `bash denied` | blocked-bash deep-dive |
| **1.4 pi emits remarks — REQUIRED (top-priority signal)** | remarks tile (row 1), remark-volume canary |
| 1.5 pi + orchestrator guard | prevents a crashing cohort at flag time |
| 1.6 YARA triage decision for pi | interprets the YARA enforcement tile |
| 1.7 flush check on pi error path | trustworthy completion denominator |
| 1.8 (optional) tag binding before `agent started` | would let funnels drop the cohort workaround |

## Remaining checklist

- [ ] Cohorts finish first calculation → spot-check both funnels render sensible
      step counts (they were created minutes before this doc).
- [ ] Verify `harness` actually appears on `wizard: agent api error` /
      `agent aborted` with the first real pi error traffic (assumed, not yet observed).
- [ ] Test-fire each alert once (temporarily invert its threshold).
- [ ] Annotations at parity release, flag creation, and every ramp change (feeds the
      before/after funnel).
- [ ] G3 daily AI remark digest subscription — create at flag-cut time.
- [ ] Post-parity: promote "how runs end", swap the completion tile to flat-property
      filtering, consider dropping the cohort workaround (1.8).
