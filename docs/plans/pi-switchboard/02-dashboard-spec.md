# Phase 2 — Dashboard, insights & alerts spec

Build target: one dashboard in **PostHog Cloud US, project 2** ("PostHog App + Website" —
where the wizard's hardcoded telemetry lands).

- **Dashboard name:** `Wizard switchboard: anthropic vs pi`
- **Insight naming convention:** every insight is prefixed `Switchboard:` so they're
  findable and obviously part of this set.
- **Dashboard-level filters (defaults):** `program_id = posthog-integration`,
  `build = prod`. During the validation run, view with `build = ci` (or `headless`)
  and the test window instead — same tiles, different filter.
- **Standard breakdown:** `harness` (values `anthropic` | `pi`). Both are flat event
  properties on all events below except where noted.
- **Date range default:** last 14 days, daily interval.
- Add a **dashboard annotation** for: parity-PR release, flag creation, each ramp step.

Dependencies from Phase 1 are marked ⚠️. Every tile must render with existing anthropic
traffic before the flag cut — build the dashboard first, verify with control data, then
trust it with variant data.

---

## Row A — Exposure & completion (the headline row)

### A1. `Switchboard: runs per day by harness`
- **Type:** SQL (trends-style bar over time). Distinct `run_id` avoids double-counting
  multi-agent-invocation runs.
- **Query:**
  ```sql
  SELECT toStartOfDay(timestamp) AS day,
         properties.harness AS harness,
         count(DISTINCT properties.run_id) AS runs
  FROM events
  WHERE event = 'wizard: agent started'
    AND properties.build = 'prod'
    AND properties.program_id = 'posthog-integration'
  GROUP BY day, harness ORDER BY day
  ```
- **Purpose:** exposure. Also the **SRM check**: the anthropic:pi ratio must track the
  configured flag ratio; drift means biased exposure (e.g. pi dying before first event).

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
  `setup wizard finished` (filter `status = success`, ⚠️ 1.2 for breakdown on this step).
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

### D3. `Switchboard: error events per run`
- **Type:** Trends, formula. Series A: `wizard: agent api error` count; Series B:
  `wizard: agent started` count. Formula `A / B`; breakdown `harness`.

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

### E2. `Switchboard: wizard version mix`
- **Type:** Trends. Event `wizard: agent started`, count, breakdowns `$lib_version` ×
  `harness`.
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

| Alert insight | Definition | Threshold | Why |
|---|---|---|---|
| `ALERT: pi completion rate` | A2 formula, filtered `harness = pi`, no breakdown | absolute: below **70%** over 24h (tune to anthropic baseline − 10pts once measured) | primary regression tripwire |
| `ALERT: pi api errors` | D1 count, filtered `harness = pi` | relative: increase > 100% day-over-day, min volume guard | quota/outage on gpt-5-mini |
| `ALERT: warlock disabled` | F4 | absolute: ≥ 1 | kill-switch should never fire silently |
| `ALERT: pi high-severity yara` | F1 count, `harness = pi`, `severity` high | absolute: ≥ 1 during ramp week, relax later | pi has no triage (1.6) |
| `ALERT: stuck runs (pi)` | E1 reduced to a count, `harness = pi` | absolute: ≥ 3/day | silent-failure net |

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

- [ ] All insights created with `Switchboard:` prefix; dashboard assembled in row order.
- [ ] Every tile renders non-empty with anthropic-only prod data (except tiles marked
      pi-dependent, which must render post-parity with `build=ci` test traffic).
- [ ] Alert twins created, thresholds set, each test-fired once (temporarily invert the
      threshold to force a fire).
- [ ] Annotations added: parity release, flag creation.
- [ ] `$ai_generation` tiles (C3–C5, D5) verified against live pi dev traffic
      (`build = dev/ci`) — property names already confirmed 2026-07-03.
- [ ] Dashboard link recorded in `03-validation-run.md` runbook and team channel.
