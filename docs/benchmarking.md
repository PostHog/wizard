# Benchmarking wizard agent configs

A repeatable process for comparing harness/model/effort configurations on real
applications, measured by time, cost, and the quality of the diff each run
produces. Written to be followed by any agent (Claude or otherwise) on any
machine with the wizard repo, git, and a PostHog test project.

## Principles

- **One run = one cell.** A cell is (app × config). Runs are non-deterministic;
  n = 1 per cell is a sample, not a truth. Rerun anomalies before concluding.
- **Real apps only.** In-production open-source products, non-monorepo, with no
  existing PostHog integration (grep the repo for `posthog` first). Cover
  several frameworks — results do not transfer between them.
- **The diff is the result.** Judge what landed in the working tree, never the
  agent's transcript or its self-reported summary. Agents mark their own tasks
  complete and describe work in the outro; only `git diff` is evidence.
- **Cap every run.** Pick a wall-clock cap (a run slower than your current
  production baseline is worthless) and kill the run at the cap. Record capped
  runs as timeouts, never as data points.
- **Exclude, don't delete.** A cell invalidated by a harness or tooling gap is
  excluded from aggregates and documented with its cause. Silently dropping it
  hides the bug; averaging it in corrupts the comparison.

## Selecting apps

Selection criteria, checked in this order:

1. **Real product, in production** — an open-source app people actually run
   (stars are a proxy; a hosted instance is better evidence).
2. **Single-app repo** — reject monorepos: fetch the repo's top-level listing
   and reject on `pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, or
   top-level `apps/`/`packages/` directories.
3. **Greenfield** — grep the repo for `posthog` (manifest and source). An app
   that already integrates PostHog measures augmentation discipline, not
   integration quality; keep at most one such app and exclude it from quality
   scoring.
4. **Framework coverage** — spread picks across the frameworks the wizard
   supports; results do not transfer between them.
5. **Locally installable** — its toolchain (node/python/php/ruby/gradle)
   exists on the bench machine, or its runs will fail for reasons that are
   yours, not the model's.

Apps used in the 2026-07 benchmark, as worked examples of the spread:

| app | upstream | stack |
|---|---|---|
| Maybe | `maybe-finance/maybe` | Rails |
| Outline | `outline/outline` | React + Koa / TS |
| WordPress-Android | `wordpress-mobile/WordPress-Android` | native Kotlin |
| healthchecks | `healthchecks/healthchecks` | Django |
| Firefly III | `firefly-iii/firefly-iii` | Laravel, server-rendered |
| Monica | `monicahq/monica` | Laravel + Inertia/Vue |
| Papermark | `mfts/papermark` | Next.js — already shipped posthog-js; kept as the augment-existing case, excluded from quality scoring |

## Setup

1. Shallow-clone each target app once; treat the clone as a read-only source.
2. Define each config as a set of flag overrides (harness, model, effort) plus
   a baseline config with the overrides off.
3. Provision a test-project API key. Never commit it; read it from a file.

## Tooling

Everything below ships in this repo (`wizard/`) and its workbench
(`wizard-workbench/`); paths are from each repo's root.

- **Headless run (snapshotting CI harness):** `wizard/scripts/tui-snapshots.no-jest.ts`
  spawns the real TUI (`wizard/scripts/tui-host.no-jest.ts`) in a PTY via
  `wizard/e2e-harness/tui-capture.ts`, self-drives the fixed e2e profile
  (`wizard/e2e-harness/wizard-ci-driver.ts`, `wizard/e2e-harness/profiles.ts`)
  through auth, the agent run, and the outro, and writes each screen as an
  `NN-<screen>.ans` frame. An `NN-outro.ans` frame is the flow-completion
  signal. `tsx` runs source — no build step.

  ```bash
  SNAP_OUT=<frames dir> APP_DIR=<app copy> \
  POSTHOG_KEY_FILE=<key file> PROJECT_ID=<test project id> \
  WIZARD_CI_FLAG_OVERRIDES='{"wizard-use-pi-harness":"true","wizard-pi-model":"<variant>","wizard-pi-effort":"<level>"}' \
    npx tsx scripts/tui-snapshots.no-jest.ts
  ```

- **Config selection:** the three flag axes are `wizard-use-pi-harness`,
  `wizard-pi-model` (variant keys defined in
  `wizard/src/lib/agent/runner/switchboard/harness.ts`), and
  `wizard-pi-effort` (levels in
  `wizard/src/lib/agent/runner/switchboard/models.ts`). The baseline is
  `{"wizard-use-pi-harness":"false"}` — never an empty override, or live
  remote flags leak into the baseline.
- **Cost capture:** anthropic-harness runs report `modelUsage` (with
  `costUSD`) in the debug log (`/tmp/posthog-wizard.log`); pi-harness runs
  expose session token totals — price them at the model's list rate. Capture
  per run: the shared log interleaves under parallelism.

## Per-run procedure

For each cell, in a fresh working directory:

1. Copy the app source, excluding dependency and build directories.
2. `git init`, commit everything as `base` **with `--no-verify`**, branch `integ`.
3. Run the wizard headlessly against the copy (the e2e harness drives the TUI
   to the outro; select the config via `WIZARD_CI_FLAG_OVERRIDES`), with a
   watchdog that kills the run and all its children at the cap.
4. `git add -A && git commit --no-verify` on `integ`.
5. Record per run, to per-run files (never a shared log):
   - elapsed seconds, whether the outro was reached, whether the cap fired
   - the diff (`base..integ`) and its file count
   - token usage → cost at the model's list price (input, cached input, output)

## Traps — each of these has produced a wrong conclusion

- **Target-app git hooks.** Your `git commit` runs the app's husky/lint-staged
  hooks if a prior install activated them; a failing hook silently rolls the
  tree back and the run measures as zero-diff. Always commit `--no-verify`.
  On any zero-diff run, check `git stash list` before believing it.
- **Zero-diff has many causes.** Distinguish: the agent honestly declined
  (read its setup report), the agent's tool calls failed, your harness ate the
  work, or `.gitignore` hid it (env files never show in diffs). Attribute
  before you blame the model.
- **"Reached the outro" is not success.** The flow completes even when nothing
  was integrated. Treat completion as outro + a non-trivial diff.
- **Parallel runs interleave shared state.** The shared debug log cannot be
  attributed per-run; capture everything per-run or run solo when attribution
  matters.
- **Sandbox/allowlist gaps look like model failures.** If a config produces
  empty or thin work, check whether a blocked command (package-manager
  install, formatter) caused it, and whether other models worked around the
  same block. File the gap; exclude the affected cells.
- **Repo-wide format scripts.** An agent running the app's `format`/`lint
  --fix` buries its real diff under hundreds of churn files. Count "real
  files" excluding scaffolding, lockfiles, env files — and read a sample of
  the churn before scoring.
- **A stale credential fails silently mid-batch.** Read the key per run, not
  per session.

## Judging

Use the wizard-workbench PR evaluator's rubric — do not invent your own. It
lives at `wizard-workbench/services/pr-evaluator/`:

- **Rubric criteria:** `wizard-workbench/services/pr-evaluator/prompts/evaluation.md`
  — per-item YES/NO/N-A checks grouped into four dimensions.
- **Scoring math:** `wizard-workbench/services/pr-evaluator/evaluator.ts` —
  each dimension scores `max(1, round(pass_rate × 5))` over its applicable
  items; confidence = `min(app_sanity, round(mean of the four))`.
- **Automated run:** from `wizard-workbench/`,
  `pnpm run evaluate --branch <integ> --base <base> --test-run` (needs
  `POSTHOG_PERSONAL_API_KEY`; judge model via `EVALUATOR_MODEL`). Output lands
  in `wizard-workbench/test-evaluations/<name>/` as `rubric.json` +
  `scores.json`.
- **Manual run:** an agent applies the same rubric directly to each cell's
  diff — faster for many cells, and what the 2026-07 benchmark did. Either
  way, report the four dimensions under their full names, 1–5 each
  (5 production-ready, 3 works with real issues, 1 broken or empty):

- **Files** (`file_analysis`) — right files touched, nothing unrelated,
  imports valid
- **App** (`app_sanity`) — nothing broken: builds, existing code and configs
  preserved, changes minimal
- **PostHog** (`posthog_implementation`) — SDK installed, initialized at the
  right entry points, env-based keys, real distinct id, identify, error
  tracking
- **Events** (`event_quality`) — real user actions, useful properties, no PII,
  consistent names

Verify claims against the diff (grep for `capture`/`identify` call sites,
check the init file, check the manifest), and build or typecheck where cheap.
Judge the same subset of apps for every config you compare.

## Publishing evidence

Push each cell's diff as a draft PR on a fork so every number in the report is
inspectable:

1. Fork each app to the operator's account.
2. Pin a `bench-base` branch at the exact commit the runs used.
3. Per cell: branch from `bench-base`, apply the **sanitized** patch, push,
   open a draft PR against `bench-base`.
4. Sanitize before anything touches a public fork: drop env files, wizard
   scaffolding, and lockfiles from the patch; redact every token literal.
   Verify zero secrets in the pushed diff before opening the PR.

## Report template

```markdown
# <project> — model benchmark

<one paragraph: what ran, how many apps/configs, the cap, where the evidence PRs live>

## Summary — configs that completed everywhere
| config | completed | median time | median cost | quality (judged on) |
<one row per config under consideration; drop dominated/dead configs into a
one-paragraph note with their numbers>

## Results
<legend: cell format, cost source, symbols for timeout/excluded/not-run>
| config | <app 1> | <app 2> | … |
<time · cost per cell>

### Exclusions
<each excluded cell: cause, evidence link. Root-cause analysis links here.>

## Per-app quality
<per app: | config | real files | Files | App | PostHog | Events | notes |,
one PR link per row. Full column names — never abbreviations.>

## Code evidence
<same-site snippets across configs: where they are identical, and where they
differ (coverage, funnel depth, client vs server). Short, real excerpts.>

## Failure log
| observation | where | evidence |

## Method & caveats
<procedure in three sentences; n = 1; what was and wasn't build-verified;
anything that changed mid-benchmark>
```

Data only in the report: no verdicts or recommendations unless asked.
Aggregates use medians; the completion column counts real (non-hollow,
non-excluded) finishes.
