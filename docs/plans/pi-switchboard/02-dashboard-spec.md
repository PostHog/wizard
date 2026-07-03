# Phase 2 — Dashboard, insights & alerts spec

> **✅ SHIPPED 2026-07-03.** Live in project 2:
> **[wizard-switchboard (dashboard 1793563)](https://us.posthog.com/project/2/dashboard/1793563)**.
> The dashboard is deliberately curated to **10 tiles in priority order — remarks, cost,
> runtime, completion, errors, YARA** (matching the stated monitoring priorities; the
> "Wizard v2 overview" dashboard sets the curation bar). The other 20 insights from this
> spec exist as **saved deep-dive insights** (tagged `switchboard`, not on the dashboard),
> and all **5 alerts are armed** on their insights independent of dashboard membership.
> See [Shipped inventory](#shipped-inventory) for every link. Deltas discovered during
> the build are marked *(as built)* in the tile definitions below. Spot-verified live:
> A1 shows 25 pi runs; C3 shows pi at ~$0.42–0.60/run vs anthropic ~$2.6–3.3/run.

Build target: one dashboard in **PostHog Cloud US, project 2** ("PostHog App + Website" —
where the wizard's hardcoded telemetry lands).

- **Dashboard name:** `wizard-switchboard` *(as built)*
- **Insight naming convention:** every insight is prefixed `Switchboard <tile-id>:` and
  tagged `wizard` + `switchboard` so they're findable and obviously part of this set.
- **Filters (as built):** `program_id = posthog-integration` is baked into each insight
  where the event carries it (the terminal `setup wizard finished` event doesn't carry
  it flat, so A2/A3/A2i are unfiltered). `build` is deliberately NOT baked into
  dashboard tiles — apply it as a dashboard-level filter in the UI (`prod` for
  monitoring, `ci`/`dev` for the validation run). The ALERT-twin insights DO bake
  `build = prod` so alerts never fire on dev/CI noise.
- **Standard breakdown:** `harness` (values `anthropic` | `pi`). Both are flat event
  properties on all events below except where noted.
- **Date range default:** last 14 days, daily interval.
- Add a **dashboard annotation** for: parity-PR release, flag creation, each ramp step.

Dependencies from Phase 1 are marked ⚠️. Every tile must render with existing anthropic
traffic before the flag cut — build the dashboard first, verify with control data, then
trust it with variant data.

---

## Row A — Exposure & completion (the headline row)

### A1. `Switchboard A1: runs per day by harness`
- **Type:** SQL, bar. Distinct `run_id` avoids double-counting multi-agent-invocation
  runs.
- **Query** *(as built — on `$ai_generation`, because `wizard: agent started` turned out
  to carry no `harness`; see parity 1.8)*:
  ```sql
  SELECT toStartOfDay(timestamp) AS day,
         coalesce(properties.harness, 'unknown') AS harness,
         count(DISTINCT properties.run_id) AS runs
  FROM events
  WHERE event = '$ai_generation'
    AND properties.program_id = 'posthog-integration'
    AND timestamp >= now() - INTERVAL 14 DAY
  GROUP BY day, harness ORDER BY day
  ```
- **Purpose:** exposure. Also the **SRM check**: the anthropic:pi ratio must track the
  configured flag ratio; drift means biased exposure (e.g. pi dying before first event).
  Pre-2026-07-01 traffic groups as `unknown` (no harness header yet) — expected.

### A2. `Switchboard: completion rate by harness`
- **Type:** Trends, formula. ⚠️ needs parity 1.2 (flat `harness` on the terminal event).
- **Series A:** `setup wizard finished`, count, filter `status = success`.
- **Series B:** `setup wizard finished`, count.
- **Formula:** `A / B * 100`; **breakdown:** `harness`; **display:** line.
- **Interim (pre-parity) SQL equivalent:**
  ```sql
  SELECT toStartOfDay(timestamp) AS day,
         JSONExtractString(properties.tags, 'harness') AS harness,
         round(countIf(properties.status = 'success') / count() * 100, 1) AS completion_pct,
         count() AS runs
  FROM events
  WHERE event = 'setup wizard finished' AND properties.build = 'prod'
  GROUP BY day, harness ORDER BY day
  ```

### A3. `Switchboard: run outcomes by harness`
- **Type:** Trends, stacked bar. Event `setup wizard finished`, count,
  breakdowns `status` × `harness` (⚠️ 1.2).
- **Purpose:** separates `error` from `cancelled` — a pi UX problem shows up as
  cancellations, a pi model problem as errors.

## Row B — Pipeline & UX

### B1. `Switchboard: wizard funnel by harness`
- **Type:** Funnel, ordered, conversion window 2 hours, breakdown `harness`.
- **Steps:** `wizard: started` → `wizard: auth complete` → `wizard: agent started` →
  `setup wizard finished` (filter `status = success`). Breakdown uses **last-touch
  attribution** *(as built)* since steps 1–3 lack `harness`; the breakdown populates
  per-harness after parity 1.2.
- **Purpose:** *where* variants drop, not just that they drop. Steps 1–3 are pre-variant
  (harness resolves at agent start), so divergence should only appear at the last step —
  if it appears earlier, tagging is wrong.

### B2. `Switchboard: agent step progress` *(optional, opt-in data)*
- **Type:** Trends. Event `wizard: step`, count, filter `status = completed`,
  breakdowns `step_name` × `harness`.
- **Note:** only emitted where `trackStepProgress` is enabled; annotate accordingly.

## Row C — Runtime & cost

### C1. `Switchboard: agent runtime p50/p90` ⚠️ 1.1
- **Type:** Trends. Event `wizard: agent completed`.
- **Series A:** median of `duration_ms`; **Series B:** p90 of `duration_ms`.
- **Breakdown:** `harness`; **display:** line.

### C2. `Switchboard: pi runtime by framework` ⚠️ 1.1
- **Type:** Trends, bar. Event `wizard: agent completed`, p90 `duration_ms`,
  breakdown `integration`, filter `harness = pi`. Twin tile filtered
  `harness = anthropic` (or breakdowns `integration` × `harness`).
- **Purpose:** framework mix is the main confounder for runtime; this catches
  "pi is fine except on Django".

### C3. `Switchboard: LLM cost per run by harness` — canonical cost tile
- **Type:** SQL. Reads `$ai_generation` — **same project**, no parity dependency; the
  gateway already emits it symmetrically for both harnesses with wizard attribution
  properties (verified live 2026-07-03, including pi + `gpt-5-mini` runs).
- **Query:**
  ```sql
  SELECT toStartOfDay(timestamp) AS day,
         properties.harness AS harness,
         round(sum(properties.$ai_total_cost_usd), 2) AS daily_spend_usd,
         count(DISTINCT properties.run_id) AS runs,
         round(sum(properties.$ai_total_cost_usd)
               / count(DISTINCT properties.run_id), 3) AS cost_per_run_usd
  FROM events
  WHERE event = '$ai_generation'
    AND properties.program_id = 'posthog-integration'
    AND properties.build = 'prod'
    AND timestamp >= now() - INTERVAL 14 DAY
  GROUP BY day, harness ORDER BY day
  ```
- **Note:** on `$ai_generation` the model property is `$ai_model` with *unprefixed*
  values (`gpt-5-mini`); the wizard-side `model` property uses gateway ids
  (`openai/gpt-5-mini`). Pre-switchboard traffic (before 2026-07-01) has no `harness`
  property and groups as null — expected.

### C4. `Switchboard: token economics by harness`
- **Type:** Trends. Event `$ai_generation`; averages of `$ai_input_tokens`,
  `$ai_output_tokens`, `$ai_cache_read_input_tokens`, `$ai_reasoning_tokens`;
  breakdown `harness`; filter `program_id = posthog-integration`.
- **Purpose:** cache-hit and reasoning-token economics differ per provider; explains
  cost/runtime deltas. Fully symmetric — no wizard change needed.

### C5. `Switchboard: LLM latency & TTFT by harness`
- **Type:** Trends. Event `$ai_generation`; average of `$ai_latency` and average of
  `$ai_time_to_first_token`; breakdown `harness`; filter
  `program_id = posthog-integration`.
- **Purpose:** separates *model* speed from *agent-loop* speed — if C1 (run duration)
  regresses but C5 doesn't, the problem is turn count / loop behavior, not gpt-5-mini.

### C6. `Switchboard: SDK-reported cost (cross-check)` — optional
- **Type:** Trends. Event `wizard: agent completed`, average of `total_cost_usd`.
- **Caveat (annotate on the tile):** anthropic-only SDK accounting; excludes YARA-triage
  side-calls; expected to drift from C3. Exists only to catch gross gateway
  cost-attribution bugs — C3 is canonical.

## Row D — Errors

### D1. `Switchboard: API errors by type`
- **Type:** Trends, stacked bar. Event `wizard: agent api error`, count,
  breakdowns `error_type` × `harness`.
- **Purpose:** rate-limit vs API error split — a gpt-5-mini quota problem shows here first.

### D2. `Switchboard: aborts by reason`
- **Type:** Trends, bar. Event `wizard: agent aborted`, count,
  breakdowns `reason` × `harness`.
- **Purpose:** separates YARA-caused aborts from model give-ups (feeds the 1.6 decision).

### D3. `Switchboard D3: API errors per run by harness`
- **Type:** SQL *(as built — a trends formula can't breakdown by `harness` when the
  denominator event lacks the property; `$ai_generation` distinct `run_id` is the
  denominator instead)*: `countIf(api error) / count(DISTINCT run_id)` per day per
  harness over `events IN ('wizard: agent api error', '$ai_generation')`.

### D4. `Switchboard: exceptions by harness`
- **Type:** Trends. Event `$exception`, count, breakdown `harness`, filter
  `$app_name = wizard`.
- **Note:** exceptions re-attach tags via `before_send`, so `harness` is present.

### D5. `Switchboard: gateway HTTP errors by harness`
- **Type:** Trends. Event `$ai_generation`, count, filter `$ai_http_status ≥ 400` and
  `program_id = posthog-integration`, breakdown `harness`.
- **Purpose:** provider-side failures (quota, outage, bad request against gpt-5-mini)
  observed at the gateway — fires even when the wizard-side error event is lost with a
  crashed run. Complements D1, which only sees errors the wizard survived to report.

## Row E — Reliability nets

### E1. `Switchboard: stuck runs` — the silent-failure detector
- **Type:** SQL, table. Runs that started > 2h ago with no terminal event (crash,
  hang, or lost flush — see parity 1.7).
  ```sql
  SELECT properties.run_id AS run_id,
         any(properties.harness) AS harness,
         any(properties.integration) AS integration,
         min(timestamp) AS started_at
  FROM events
  WHERE event IN ('wizard: agent started', 'setup wizard finished')
    AND properties.build = 'prod'
    AND timestamp > now() - INTERVAL 7 DAY
  GROUP BY run_id
  HAVING countIf(event = 'setup wizard finished') = 0
     AND min(timestamp) < now() - INTERVAL 2 HOUR
  ORDER BY started_at DESC LIMIT 50
  ```
- **Purpose:** completion rate only counts runs that *reported*; this catches the ones
  that didn't. A harness-skewed stuck list is the strongest "pull the flag" signal.

### E2. `Switchboard E2: wizard version mix by harness`
- **Type:** Trends. Event `wizard: agent completed` *(as built — `agent started` lacks
  `harness`)*, count, breakdowns `$lib_version` × `harness`.
- **Purpose:** isolates the parity-PR release; pre-parity pi runs must not be read as
  "pi emits nothing".

## Row F — YARA / security

### F1. `Switchboard: YARA matches by rule`
- **Type:** Trends, bar. Event `wizard: yara rule matched`, count,
  breakdowns `rule` × `harness`. Companion filter variant: `severity` high only.

### F2. `Switchboard: violations per scan report`
- **Type:** Trends. Event `wizard: yara scan report`, average of `violation_count`
  (and average `total_scans` as second series), breakdown `harness`.

### F3. `Switchboard: triage overruled` — annotate **anthropic-only** (see parity 1.6)
- **Type:** Trends. Event `wizard: yara triage overruled`, count, breakdown `rule`.

### F4. `Switchboard: warlock kill-switch` — must stay at zero
- **Type:** Trends, bold number. Event `wizard: warlock disabled`, count.

### F5. `Switchboard: bash denied` ⚠️ 1.3
- **Type:** Trends, bar. Event `wizard: bash denied`, count,
  breakdowns `reason` × `harness`.

## Row G — Remarks

### G1. `Switchboard: remark volume` ⚠️ 1.4
- **Type:** Trends. Event `wizard remark` (no `wizard:` prefix), count, breakdown
  `harness`.
- **Purpose:** doubles as the canary that pi remark parity works (should track ~1 per
  successful run).

### G2. `Switchboard: recent remarks` ⚠️ 1.4 for pi rows
- **Type:** SQL, table.
  ```sql
  SELECT timestamp, properties.harness AS harness,
         properties.integration AS integration,
         properties.model AS model, properties.remark AS remark
  FROM events
  WHERE event = 'wizard remark' AND properties.build = 'prod'
    AND timestamp > now() - INTERVAL 7 DAY
  ORDER BY timestamp DESC LIMIT 100
  ```
- **Hygiene note:** remarks can quote user code/paths — keep this dashboard internal.

### G3. Daily AI remark digest *(subscription, not a tile)*
- **Type:** recurring AI report subscription (daily, to the team Slack channel).
- **Prompt sketch:** "Summarize the last 24h of `wizard remark` events in project 2,
  split by `harness`. Group recurring complaints/themes, quote one representative remark
  per theme, and flag any theme that appears for `pi` but not `anthropic`."

---

## Alerts (armed before the flag cut; test-fire each once)

Insight alerts are simplest on dedicated single-series insights, so create thin
`ALERT:`-prefixed twins rather than alerting on the breakdown tiles:

*(As built — all 5 armed and enabled 2026-07-03, subscribed: vincent@posthog.com. The
warlock alert sits directly on F4; the other four have thin ALERT-twin insights with
`build = prod` baked in. Slack delivery can be added later via a CDP destination.)*

| Alert (as built) | On insight | Config | Why |
|---|---|---|---|
| `Switchboard: pi completion rate below 70%` | ALERT twin ([PD8zw80V](https://us.posthog.com/project/2/insights/PD8zw80V)) — daily pi completion % via tags-JSON (works pre-parity) | daily, absolute, lower bound 70 (retune to anthropic baseline − 10pts once measured) | primary regression tripwire |
| `Switchboard: pi API errors spiking (>100% day-over-day)` | ALERT twin ([Uk9MaDf8](https://us.posthog.com/project/2/insights/Uk9MaDf8)) | daily, relative_increase, +100% | quota/outage on gpt-5-mini |
| `Switchboard: warlock kill-switch fired` | F4 directly ([zZVpQ8t3](https://us.posthog.com/project/2/insights/zZVpQ8t3)) | **hourly**, absolute, upper bound 0 (any event fires) | kill-switch must never fire silently |
| `Switchboard: pi high-severity YARA match` | ALERT twin ([PlN2GPOE](https://us.posthog.com/project/2/insights/PlN2GPOE)) — `severity in (high, critical)` | daily, absolute, upper bound 0 | pi has no triage (1.6); relax after ramp week |
| `Switchboard: stuck pi runs (3+ in 24h)` | ALERT twin ([55w4IwfY](https://us.posthog.com/project/2/insights/55w4IwfY)) | daily, absolute, upper bound 2 | silent-failure net |

## Optional: formalize as an experiment

`wizard-runner` is already a multivariate flag in project 2, so the comparison can be a
PostHog **experiment** on that flag rather than eyeballed dashboard deltas:

- **Exposure:** custom exposure event `wizard: agent started` (the wizard evaluates flags
  via posthog-node and won't reliably emit `$feature_flag_called`; `harness` on
  `agent started` reflects the served variant). Verify exposure counts match A1 before
  trusting results.
- **Primary metric:** funnel `wizard: agent started` → `setup wizard finished`
  (`status = success`).
- **Secondaries:** mean `duration_ms` (sum-type metric on `agent completed`), mean
  `total_cost_usd` (anthropic-only caveat), `wizard: agent api error` count per user.
- **Value:** significance testing + exposure accounting for free. The dashboard remains
  the operational surface (yara, remarks, stuck runs — things an experiment won't show).

## Build checklist

- [x] All insights created with `Switchboard <tile-id>:` prefix, tagged
      `wizard`/`switchboard`, assembled on the dashboard in row order (2026-07-03).
- [x] Spot-verified computing insights against live data: A1 (25 pi runs visible),
      C1 (anthropic percentiles render), C3 (pi ~$0.42–0.60/run vs anthropic
      ~$2.6–3.3/run in early tagged traffic).
- [x] Alert twins created and armed with thresholds (see table above).
- [x] `$ai_generation` tiles (A1, C3–C5, D3, D5) verified against live pi dev traffic.
- [ ] Each alert test-fired once (temporarily invert the threshold to force a fire).
- [ ] Annotations added at parity release and flag creation (do when those happen).
- [ ] G3 daily AI remark digest subscription — deliberately deferred to flag-cut time
      so it doesn't email anthropic-only summaries for weeks first.
- [ ] Full post-parity tile sweep during the Phase 3 validation run (every ⚠️ tile must
      be seen populating for `harness = pi`).

## Shipped inventory

Dashboard: **[wizard-switchboard — 1793563](https://us.posthog.com/project/2/dashboard/1793563)** (pinned, tags `wizard`/`switchboard`).

### On the dashboard — 10 tiles, priority order (two per row)

| # | Priority | Tile | Insight |
|---|---|---|---|
| 1 | remarks | G2 recent remarks table | [mTiRZTvj](https://us.posthog.com/project/2/insights/mTiRZTvj) |
| 2 | cost | C3 LLM cost per run (canonical) | [T7eVkhiq](https://us.posthog.com/project/2/insights/T7eVkhiq) |
| 3 | runtime | C1 runtime p50/p90 | [W2f0NFjX](https://us.posthog.com/project/2/insights/W2f0NFjX) |
| 4 | runtime | C5 LLM latency & TTFT | [8Hmai6ey](https://us.posthog.com/project/2/insights/8Hmai6ey) |
| 5 | completion | A2i completion rate % (interim; swap for A2 post-parity) | [Sb3G7gAa](https://us.posthog.com/project/2/insights/Sb3G7gAa) |
| 6 | completion | A3 run outcomes | [r7iojoAC](https://us.posthog.com/project/2/insights/r7iojoAC) |
| 7 | completion | A1 runs/day (exposure/SRM) | [5RGn3QKe](https://us.posthog.com/project/2/insights/5RGn3QKe) |
| 8 | errors | D1 API errors by type | [AjCvWuo0](https://us.posthog.com/project/2/insights/AjCvWuo0) |
| 9 | errors | E1 stuck runs table | [eFKdijAJ](https://us.posthog.com/project/2/insights/eFKdijAJ) |
| 10 | yara | F1 YARA matches by rule | [Ngk3X9hY](https://us.posthog.com/project/2/insights/Ngk3X9hY) |

### Deep-dive insights — saved, tagged `switchboard`, NOT on the dashboard

| Tile | Insight |
|---|---|
| A2 completion rate % (post-parity trends; promote onto the dashboard replacing A2i once parity 1.2 ships) | [92V7p8Jw](https://us.posthog.com/project/2/insights/92V7p8Jw) |
| B1 wizard funnel | [Pr7WSZry](https://us.posthog.com/project/2/insights/Pr7WSZry) |
| B2 agent step progress | [khNVjCEG](https://us.posthog.com/project/2/insights/khNVjCEG) |
| C2 runtime p90 by framework | [6Yi7mbRJ](https://us.posthog.com/project/2/insights/6Yi7mbRJ) |
| C4 token economics | [JYUTFPEa](https://us.posthog.com/project/2/insights/JYUTFPEa) |
| C6 SDK cost cross-check | [LVxIoaOw](https://us.posthog.com/project/2/insights/LVxIoaOw) |
| D2 aborts by reason | [YujUyOtB](https://us.posthog.com/project/2/insights/YujUyOtB) |
| D3 API errors per run | [txvaDMn6](https://us.posthog.com/project/2/insights/txvaDMn6) |
| D4 wizard exceptions | [khHLCSFL](https://us.posthog.com/project/2/insights/khHLCSFL) |
| D5 gateway HTTP errors | [MZeJAs4p](https://us.posthog.com/project/2/insights/MZeJAs4p) |
| E2 version mix | [dAohPkbs](https://us.posthog.com/project/2/insights/dAohPkbs) |
| F2 YARA violations per report | [dliVo8Ol](https://us.posthog.com/project/2/insights/dliVo8Ol) |
| F3 YARA triage overruled | [ryG3mBhX](https://us.posthog.com/project/2/insights/ryG3mBhX) |
| F4 warlock kill-switch (hourly alert lives here) | [zZVpQ8t3](https://us.posthog.com/project/2/insights/zZVpQ8t3) |
| F5 bash denied | [ZT7H4uQ1](https://us.posthog.com/project/2/insights/ZT7H4uQ1) |
| G1 remark volume | [pMpVC2js](https://us.posthog.com/project/2/insights/pMpVC2js) |
| ALERT twin: pi completion rate | [PD8zw80V](https://us.posthog.com/project/2/insights/PD8zw80V) |
| ALERT twin: pi API errors | [Uk9MaDf8](https://us.posthog.com/project/2/insights/Uk9MaDf8) |
| ALERT twin: pi high-severity YARA | [PlN2GPOE](https://us.posthog.com/project/2/insights/PlN2GPOE) |
| ALERT twin: stuck pi runs | [55w4IwfY](https://us.posthog.com/project/2/insights/55w4IwfY) |

Alerts are attached to insights, not tiles — all 5 remain armed regardless of dashboard
membership.
