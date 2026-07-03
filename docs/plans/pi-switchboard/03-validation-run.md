# Phase 3 — Validation run: 15 OSS projects × 2 variants

**Goal:** prove (a) the monitoring pipeline end-to-end — every dashboard tile populates
for `harness = pi` — and (b) that gpt-5-mini on the pi harness actually integrates
PostHog acceptably, before any prod traffic sees it.

**Gate:** parity PR (Phase 1) released in the build under test; dashboard (Phase 2) live.

## Design

- **30 runs = 15 repos × {anthropic, pi}.** Paired control/challenger per repo — without
  the anthropic run you can't distinguish "pi failed" from "this repo breaks any wizard".
- **Run serially** (or max 2 concurrent) to avoid self-inflicted rate limits polluting
  the `agent api error` comparison.
- **Caveat:** 15×2 catches breakage and gross regressions, not small deltas. Statistical
  claims wait for the prod ramp.

## One-time setup

1. **Fresh PostHog project** (integration target — where the test apps will send
   events). Note its numeric `project_id`. This is *not* where wizard telemetry goes
   (that's always project 2); it's the "new project, custom key" destination.
2. **Personal API key** (`phx_…`) with access to that project; store in a file, e.g.
   `~/.wizard-test/phx.txt` (never in a repo).
3. **Build:** `pnpm build:ci` — keeps `IS_PRODUCTION_BUILD = false`, which unlocks
   `--ci`, `--harness`/`--model`, and `WIZARD_CI_FLAG_OVERRIDES`.
4. **Variant forcing:** prefer `WIZARD_CI_FLAG_OVERRIDES='{"wizard-runner":"pi"}'` over
   `--harness pi` — it exercises the real flag-resolution path the prod cut will use
   (applied after live flag fetch in `src/utils/ci-flag-overrides.ts`). Control runs:
   `'{"wizard-runner":"anthropic"}'` (explicit, don't rely on defaults).
5. **Artifact home:** decide where the 30 snapshot dirs + result JSONs + diffs live
   (recommendation: a dated directory in wizard-workbench, which already owns the
   snapshot/visual-regression tooling).

## Repo selection (15)

Stratified, not purely random — one per supported framework, plus wildcards:

| # | Framework bucket | Notes |
|---|---|---|
| 1 | Next.js (app router) | |
| 2 | Next.js (pages router) | |
| 3 | React + Vite | |
| 4 | React (CRA) | legacy path coverage |
| 5 | React + TanStack | |
| 6 | Svelte / SvelteKit | |
| 7 | React Native or Expo | mobile path |
| 8 | Django | |
| 9 | Flask | |
| 10 | FastAPI | |
| 11 | Laravel | |
| 12 | Nuxt | |
| 13 | Astro | |
| 14–15 | wildcards | genuinely random picks; surprise factor is the point |

**Per-repo criteria:** actively maintained; builds/installs cleanly *before* the wizard
touches it (verify — a repo that doesn't build pre-wizard is a wasted run); no existing
PostHog; small enough to review the diff by hand.

**Prep per repo:** clone to a temp dir, install deps, verify build, `git commit` a clean
baseline so `git diff` afterwards is exactly the wizard's work. Make two copies (one per
variant) so runs don't contaminate each other.

## Execution

Primary route: the real-TUI snapshot host (`MODE=fixed`) — it self-drives the full flow,
snapshots every screen, and writes a structured result JSON. Per run:

```bash
SNAP_OUT="$ART/snaps/<repo>-<variant>" \
APP_DIR="<clone-copy>" \
POSTHOG_KEY_FILE=~/.wizard-test/phx.txt \
PROJECT_ID=<test-project-id> \
SNAP_HARNESS=<anthropic|pi> \
SNAP_MODEL=<claude-sonnet-4-6|openai/gpt-5-mini> \
E2E_RESULT_JSON="$ART/results/<repo>-<variant>.json" \
WIZARD_CI_FLAG_OVERRIDES='{"wizard-runner":"<variant>"}' \
npx tsx scripts/tui-snapshots.no-jest.ts
```

- Snapshots land as `$SNAP_OUT/NN-<screen>.txt`; replay with
  `pnpm wizard-ci-replay $SNAP_OUT` (add `--delay 1200` to auto-play).
- Result JSON records `runPhase`, `hasPosthogDep`, `newDeps`, `envFile`, `screenPath`,
  `skillsComplete`.
- Wrap the loop in a small script à la `scripts/smoke-test-ci.sh`; capture stdout/stderr
  per run, record wall-clock time and the run's `run_id` (from wizard logs) into a
  manifest CSV: `repo, variant, run_id, started_at, exit`.
- Non-TUI fallback if the host misbehaves on a given repo:
  `dist/bin.js --ci --api-key … --project-id … --region us --install-dir <clone>` (same
  env override; no snapshots, still full telemetry).

## Per-run verification

### Checklist M — monitoring works (the point of the exercise)

Query project 2 by the run's `run_id`:

- [ ] Full event chain present with `harness` = expected variant:
      `wizard: agent started` → `wizard: yara scan report` →
      `wizard: agent completed` (with `duration_ms`, `model`) →
      `setup wizard finished` (flat `harness`, correct `status`).
- [ ] `wizard remark` present (both variants, post-parity 1.4) and text is sane.
- [ ] `$ai_generation` traces in the gateway project carry the harness property and
      per-run cost sums to something plausible.
- [ ] Run appears in dashboard tiles under `build = ci` filter (spot-check A1, A2, C1,
      C4, F2 per variant; every ⚠️-marked tile must be seen populating for pi at least
      once across the matrix).
- [ ] Run does NOT appear in the `build = prod` default view.

### Checklist Q — model performs

- [ ] Run reached success (`status = success`; result JSON `runPhase` terminal).
- [ ] Post-integration `build`/typecheck of the target repo passes.
- [ ] PostHog dependency installed (`hasPosthogDep`); env vars written to the env file —
      **no hardcoded API keys anywhere in the diff**.
- [ ] **End-to-end proof:** boot the integrated app, click around, confirm events arrive
      in the *test* PostHog project (this validates the integration, not just the diff).
- [ ] `git diff` reviewed and scored (rubric below).
- [ ] Snapshot replay eyeballed for TUI weirdness (garbled frames, stuck spinners,
      hidden-prompt hangs).
- [ ] Remark read — the agent self-reporting friction is signal even when the run
      succeeds.

## Scoring

One row per run in the manifest:

| Field | Source |
|---|---|
| repo / framework / variant / run_id | manifest |
| completed (bool) + failure stage if not | telemetry + result JSON |
| wall-clock duration | manifest; cross-check `duration_ms` |
| cost (gateway USD) | `$ai_generation` sum for run |
| api errors / aborts / yara matches | telemetry |
| diff quality 1–5 | human review: 5 = mergeable as-is; 3 = works, non-idiomatic; 1 = broken or destructive |
| events verified end-to-end (bool) | checklist Q |
| remark text | telemetry |

## Go/no-go criteria (review meeting over the manifest + dashboard)

**Monitoring (hard gates — any failure blocks the cut):**
- Every dashboard tile proven to populate for `harness = pi`.
- No missing terminal events for completed runs (flush check, parity 1.7).
- Alerts test-fired successfully.

**Model (targets — judgment call on misses):**
- pi completion rate within **10 points** of anthropic on the paired set.
- **Zero** target repos left broken (failed post-run build) by a pi run — hard gate.
- No pi run terminated by a YARA false positive (else revisit parity 1.6).
- Median pi diff quality ≥ 3; no destructive diffs — hard gate.
- pi p90 runtime and mean cost within agreed budget vs anthropic (set the number before
  the run — suggested starting point: runtime ≤ 1.5× anthropic p90, cost ≤ anthropic
  mean, since cheap-model economics are the motivation).

Record the decision and the manifest location at the bottom of this file when done.
