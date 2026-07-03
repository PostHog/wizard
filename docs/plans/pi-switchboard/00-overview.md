# Pi switchboard rollout — master plan

**Goal:** cut the `wizard-runner` feature flag to route a share of wizard runs through the
`pi` harness (pi.dev coding agent, `openai/gpt-5-mini`), with monitoring in place *before*
the cut so we can compare variants on remarks, cost, runtime, completion rate, errors, and
YARA activity — and validate both the monitoring and the model on 15 open-source projects
first.

**Status:** planning. Nothing in this folder has shipped.

## Documents

| Doc | Contents |
|---|---|
| [`01-telemetry-parity.md`](01-telemetry-parity.md) | Pre-work PR: close the pi-path telemetry gaps that would blank out the dashboard |
| [`02-dashboard-spec.md`](02-dashboard-spec.md) | The dashboard, every insight, and every alert, specified tile-by-tile |
| [`03-validation-run.md`](03-validation-run.md) | The 15-project × 2-variant test matrix: setup, execution, checklists, scoring, go/no-go |
| [`04-rollout.md`](04-rollout.md) | Flag cut sequence, canary, ramp schedule, rollback runbook |

## Phase order (each phase gates the next)

1. **Telemetry parity** (wizard PR) — without it, cost/runtime/remarks are silent for pi
   and the comparison is unreadable.
2. **Dashboard + alerts** (PostHog project 2) — build against `02-dashboard-spec.md`.
   Validate every tile renders with existing anthropic traffic *before* pi traffic exists;
   a tile that can't be proven with control data can't be trusted with variant data.
3. **Validation run** — 15 OSS repos × {anthropic, pi}, headless with snapshotting,
   against a fresh PostHog project + custom `phx_` key. Verifies monitoring end-to-end
   and model quality.
4. **Flag cut** — internal-user canary on the prod build, then percentage ramp with
   alerts armed.

## Key facts (verified against code + live project data, 2026-07-03)

- Flag: `wizard-runner` (multivariate: `anthropic` control, `pi` challenger), defined in
  `src/lib/constants.ts`, resolved in `src/lib/agent/runner/switchboard/harness.ts`.
  `pi` pairs with `openai/gpt-5-mini` via `RUNNER_MODEL`; capabilities already registered
  in `switchboard/models.ts` (reasoning on, medium thinking).
- Second axis: `wizard-orchestrator` (boolean) selects `linear` vs `orchestrator`
  sequence. **Pi does not implement `runTask` — pi + orchestrator throws.**
- Wizard telemetry always lands in **PostHog Cloud US project 2** ("PostHog App +
  Website", token `sTMFPsFhdP1Ssg`, hardcoded in `src/lib/constants.ts`) — regardless of
  which project the user integrates against.
- Variant is stamped as flat `harness` + `sequence` properties on nearly every event
  (via `analytics.setTag` in `tagBinding()`, `src/lib/agent/runner/index.ts`), and onto
  LLM gateway traces via `X-POSTHOG-PROPERTY-HARNESS` / `-SEQUENCE` headers.
  Verified live: `harness` exists as a property on `wizard: agent completed`,
  `wizard remark`, and the yara events.
- **AI observability already covers LLM cost, tokens, and latency for BOTH harnesses —
  no wizard-side cost/token telemetry is needed.** The gateway
  (`gateway.{us,eu}.posthog.com/wizard`, `src/utils/urls.ts`) emits `$ai_generation`
  events into the **same project 2**, carrying `$ai_total_cost_usd`, input/output/
  cache/reasoning token counts, `$ai_latency`, `$ai_time_to_first_token`,
  `$ai_http_status`, `$ai_model`, plus the wizard attribution set as lowercase
  properties from the `X-POSTHOG-PROPERTY-*` headers: `run_id`, `program_id`,
  `integration`, `build`, `harness`, `sequence`. Verified live 2026-07-03: `harness`/
  `sequence` present on wizard generations since 2026-07-01, including 25 pi runs
  (1,169 generations, $14.57) across `gpt-5-mini` / `gpt-5` / `o4-mini` dev traffic.
  Caveat: `$ai_model` values are unprefixed (`gpt-5-mini`), unlike the wizard-side
  `model` property (`openai/gpt-5-mini`) — filters must use the right form per event.
- **Exception:** the terminal `setup wizard finished` event does *not* carry flat
  `harness`/`sequence` (verified live — only a nested `tags` blob, `run_id`, `status`).
  Fixing this is part of the parity PR; a SQL workaround exists in the interim.
- `run_id` (UUID per process) is on every event and is the join/dedupe key for a run.
- Useful segmentation properties on every event: `build` (`prod`/`dev`/`ci`/`headless`),
  `integration` (framework slug), `program_id`, `model`, `$lib_version` (wizard version).

## Risks & considerations beyond the obvious

These are folded into the detail docs but collected here so none get lost:

- **Telemetry loss on crash.** Analytics events are batched; a pi run that hard-crashes
  may drop its tail events (including `setup wizard finished`). Verify flush behavior on
  the error path during the parity PR (`src/utils/analytics.ts` `shutdown()`); the
  "stuck runs" insight (dashboard spec, tile E6) is the detection net either way.
- **Two cost numbers exist — the gateway one is canonical.** `total_cost_usd` on
  `wizard: agent completed` is SDK-side accounting (anthropic-only, excludes YARA-triage
  side-calls); `$ai_generation`'s `$ai_total_cost_usd` summed per `run_id` is symmetric
  across harnesses and verified live for pi. Cost/token tiles read `$ai_generation`;
  the SDK number is at most an annotated cross-check. Never mix the two in one tile.
- **YARA asymmetry.** Pi has no LLM triage on YARA matches (blocks outright), so pi will
  abort runs anthropic would have survived, and `yara triage overruled` never fires for
  pi. Either wire triage into `harness/pi/security.ts` or annotate every yara tile and
  mentally adjust the completion comparison.
- **Sample-ratio mismatch (SRM).** If the exposure tile shows a split that drifts from
  the configured flag ratio, something upstream is biased (e.g. pi crashing before its
  first event). Watch it explicitly; don't just compare outcome metrics.
- **Version confound.** The parity PR changes what pi emits. Segment dashboards by
  `$lib_version` (or filter to versions ≥ the parity release) so pre-parity pi runs don't
  read as "pi emits nothing". Add a PostHog annotation on the flag-cut date and on each
  ramp step.
- **15×2 is not statistical power.** The validation matrix catches breakage and gross
  regressions, not small deltas. Real significance comes from the prod ramp — hence the
  optional experiment on the flag (see `02-dashboard-spec.md` §Experiment).
- **Gateway failure mode.** If the gateway rejects/blackholes `openai/gpt-5-mini`
  (outage, quota), pi runs fail with `agent api error`. There is no automatic fallback to
  anthropic. The rollback lever is the flag (see `04-rollout.md`).
- **Remarks/YARA payload hygiene.** `remark`, `command` (bash denied), and yara
  `violations` can contain user code snippets and paths. This matches existing practice
  for anthropic runs, but the remarks table on the dashboard makes it more visible —
  keep the dashboard internal.
- **Snapshot artifacts.** 30 runs of TUI frames + result JSONs + git diffs need a home
  (wizard-workbench is the natural place). Decide before the run, not after.

## Definition of done

- Parity PR merged and released; pi runs emit completed/aborted/denied events.
- Dashboard live, every tile rendering, alerts armed and test-fired once.
- 30/30 validation runs executed; per-run checklists complete; go/no-go review held.
- Flag cut per `04-rollout.md`; ramp completed or rolled back with a written postmortem.
