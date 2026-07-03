# Phase 4 — Flag cut, ramp & rollback

**Gate:** Phases 1–3 complete; go/no-go passed. Dashboard + alerts are already live
([wizard-switchboard](https://us.posthog.com/project/2/dashboard/1793563); 5 alerts
armed 2026-07-03 — see `02-dashboard-spec.md` shipped inventory), but each alert still
needs one test-fire before the cut.

## Flag configuration

- **Flag:** `wizard-runner`, multivariate, in **project 2** (where the wizard's
  posthog-node client evaluates flags).
- **Variants:** `anthropic` (control), `pi` (challenger). Unknown/missing values resolve
  to `anthropic` in the switchboard, so a mis-set flag fails safe.
- **Keep `wizard-orchestrator` at 0%** for (at least) the pi cohort until pi implements
  `runTask` — pi + orchestrator throws (see parity 1.5 guard).
- Add a **dashboard annotation** at flag creation and at every ramp change.

## Step 0 — prod-build canary (internal users)

The validation run used a CI build; the one thing it cannot validate is the published
artifact — that `--harness`/`--model`/`WIZARD_CI_FLAG_OVERRIDES` are stripped and the
*live flag path* serves the variant.

- Add a targeting condition serving `pi` to internal users only (person property /
  email match on the team). Note: distinct_id is only identified after OAuth login, so
  canary runs must log in normally.
- Each team member runs the published wizard against a throwaway app; verify the full
  event chain in project 2 with `harness = pi` and `build = prod`.

## Ramp schedule

Hold each step ~2–3 days of typical traffic before advancing. At every step check, in
order:

1. **A1 exposure + SRM** — split matches the configured ratio.
2. **E1 stuck runs** — no pi skew.
3. **A2 completion rate** — pi within tolerance of anthropic.
4. **D1/D2 errors, F-row yara** — no new failure modes.
5. **G2/G3 remarks** — no recurring pi-only complaint theme.

| Step | pi rollout | Advance when |
|---|---|---|
| 1 | 5% | ≥ ~50 pi runs observed, checks 1–5 clean |
| 2 | 25% | checks clean; cost tile (C3) tracking budget |
| 3 | 50% | checks clean; if running the experiment, let it reach significance here |
| 4 | decision | hold at 50/50, ship pi as default, or roll back — written decision either way |

If running the **experiment** (dashboard spec §Experiment), start it at step 1 so
exposure accounting covers the whole ramp.

## Rollback runbook

**Lever:** set the `wizard-runner` flag to serve `anthropic` 100% (or delete the pi
variant). Takes effect on new runs immediately — flags are fetched at wizard startup; no
release needed. In-flight pi runs finish as pi.

**Triggers (any one):**
- `ALERT: pi completion rate` fires, or completion gap > 15 points sustained.
- pi-skewed stuck runs (E1) — worst case, since those users got a hung terminal.
- Any report of a pi run damaging a user project.
- `ALERT: warlock disabled` or high-severity yara pattern unique to pi.
- Gateway outage/quota exhaustion on `openai/gpt-5-mini` (D1 rate-limit spike) with no
  ETA.

**After rollback:** annotate the dashboard, keep the telemetry window, write the
postmortem into this folder, fix, re-run the affected slice of Phase 3, re-ramp from
step 1.

## Post-rollout follow-ups

- Fold pi into the standing e2e surface: add a pi variation to
  `src/lib/programs/posthog-integration/test/e2e.json` (`WizardE2eVariation`, e.g.
  `{"name": "pi-gpt5mini-linear", "harness": "pi", "model": "openai/gpt-5-mini"}`) so
  snapshots and flow tests cover it continuously, not just in this one-off matrix.
- Decide the long-term home of the dashboard (keep as the standing switchboard console —
  future variants, e.g. a `gpt-5` harness or the orchestrator sequence, reuse the same
  `harness`/`sequence` breakdowns with zero dashboard changes).
- Revisit parity 1.6 (YARA triage for pi) with real prod data on F-row tiles.
- If pi wins: flip `DEFAULT_BINDING` / `RUNNER_MODEL` in the switchboard and demote the
  flag to a kill-switch.
