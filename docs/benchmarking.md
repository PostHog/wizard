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

## Setup (from a bare machine)

```bash
# 1. The stack — the wizard (runs the benchmark) and its workbench (owns the judge)
git clone https://github.com/PostHog/wizard && cd wizard
git checkout <branch under test>            # the code you are benchmarking
pnpm install && node scripts/generate-version.cjs   # version.ts is generated, not committed
cd .. && git clone https://github.com/PostHog/wizard-workbench   # optional: automated judging

# 2. Credentials — a personal API key for a DEDICATED test project
#    (runs create real events and dashboards in it). Note the project id.
echo 'phx_...' > ~/wizard-bench-key.txt

# 3. Target apps — shallow-clone each once; treat as read-only sources
mkdir -p ~/bench/src && cd ~/bench/src
git clone --depth 1 https://github.com/<org>/<app>
```

Also install the toolchains your chosen apps need (node, python, php+composer,
ruby, gradle) — a missing toolchain fails runs for reasons that are yours, not
the model's.

Define each config as a `WIZARD_CI_FLAG_OVERRIDES` JSON (harness + model +
effort), plus the baseline as `{"wizard-use-pi-harness":"false"}`.

## Tooling

Everything below ships in this repo (`wizard/`) and its workbench
(`wizard-workbench/`); paths are from each repo's root.

- **Headless run (snapshotting CI harness):** `wizard/scripts/tui-snapshots.no-jest.ts`
  spawns the real TUI (`wizard/scripts/tui-host.no-jest.ts`) in a PTY via
  `wizard/e2e-harness/tui-capture.ts`, self-drives the fixed e2e profile
  (`wizard/e2e-harness/wizard-ci-driver.ts`, `wizard/e2e-harness/profiles.ts`)
  through auth, the agent run, and the outro, and writes each screen as an
  `NN-<screen>.ans` frame. An `NN-outro.ans` frame is the flow-completion
  signal. `tsx` runs source — no build step. Invocation: see the run-cell
  recipe below.
- **Config selection:** the three flag axes are `wizard-use-pi-harness`,
  `wizard-pi-model` (variant keys defined in
  `wizard/src/lib/agent/runner/switchboard/harness.ts`), and
  `wizard-pi-effort` (levels in
  `wizard/src/lib/agent/runner/switchboard/models.ts`). The baseline is
  `{"wizard-use-pi-harness":"false"}` — never an empty override, or live
  remote flags leak into the baseline.

## Running one cell

The canonical recipe — save as `run-cell.sh` and run from anywhere:

```bash
#!/bin/bash
# run-cell.sh <label> <app_src> <flags_json>   e.g.:
#   run-cell.sh maybe-luna-med ~/bench/src/maybe \
#     '{"wizard-use-pi-harness":"true","wizard-pi-model":"gpt-5-6-luna","wizard-pi-effort":"medium"}'
set -uo pipefail
LABEL="$1"; SRC="$2"; FLAGS="$3"
WIZARD=~/wizard            # the checkout under test
BENCH=~/bench; WORK="$BENCH/$LABEL"; OUT="$BENCH/$LABEL-out"; CAP=600

rm -rf "$WORK" "$OUT"; mkdir -p "$WORK" "$OUT"
rsync -a --exclude node_modules --exclude .git --exclude build --exclude dist \
  --exclude .next --exclude .svelte-kit --exclude .turbo "$SRC/" "$WORK/"
git -C "$WORK" init -q && git -C "$WORK" add -A
git -C "$WORK" -c user.email=b@b -c user.name=b commit -qm base --no-verify
git -C "$WORK" checkout -q -b integ

cd "$WIZARD"; SECONDS=0
SNAP_OUT="$OUT/frames" APP_DIR="$WORK" \
POSTHOG_KEY_FILE=~/wizard-bench-key.txt PROJECT_ID=<test project id> \
WIZARD_CI_FLAG_OVERRIDES="$FLAGS" \
  npx tsx scripts/tui-snapshots.no-jest.ts > "$OUT/stdout.txt" 2>&1 &
RUN=$!
( sleep $CAP; kill -TERM $RUN 2>/dev/null; sleep 3; kill -9 $RUN 2>/dev/null
  pkill -9 -f "$WORK" 2>/dev/null ) & WD=$!
wait $RUN 2>/dev/null; EL=$SECONDS
pkill -P $WD 2>/dev/null; kill $WD 2>/dev/null   # never `wait` the watchdog

git -C "$WORK" add -A >/dev/null 2>&1
git -C "$WORK" -c user.email=b@b -c user.name=b commit -qm integ --no-verify >/dev/null 2>&1
git -C "$WORK" diff main integ > "$OUT/diff.patch"
OUTRO=NO; ls "$OUT/frames" | grep -q outro && OUTRO=YES
TIMEOUT=NO; [ $EL -ge $CAP ] && TIMEOUT=YES
echo "label=$LABEL elapsed=${EL}s outro=$OUTRO timeout=$TIMEOUT \
files=$(git -C "$WORK" diff --name-only main integ | wc -l | tr -d ' ')" \
  | tee "$OUT/result.txt"
```

Both commits are `--no-verify` (see Traps). The diff, frames, stdout, and
result line are the cell's complete artifact set — everything else (the shared
debug log) is unreliable under parallelism.

## Running the matrix

- One app at a time; per app, launch its configs in parallel (≤4 on one
  machine) and `wait`. Contention inflates absolute times roughly uniformly.
- Cost: anthropic-harness cells report `modelUsage.costUSD` in
  `/tmp/posthog-wizard.log` — zero the log before each app's wave and slice
  the block per baseline run. pi-harness cells do not persist token totals;
  add a temporary hook in the pi harness success path that writes the session
  token stats to a per-run file, and price them at list rates.
- Rerun any anomalous cell solo (zeroed log, no parallelism) before drawing a
  conclusion from it.

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
