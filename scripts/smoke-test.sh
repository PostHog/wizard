#!/usr/bin/env bash
#
# Postbuild smoke test for the compiled wizard binary.
#
#   1. Binary loads without crashing.
#   2. In production builds (WIZARD_BUILD_NODE_ENV != "ci"), --ci is rejected
#      with the tailored "CI mode is not currently supported" error and a
#      non-zero exit. Guards against a future change that re-enables --ci in
#      published builds without anyone noticing.
#   3. In production builds, the experimental headless flag IS accepted (the
#      non-interactive published-build path) — it must not be rejected as an
#      unknown argument. It is intentionally undocumented; this check only keeps
#      the published binary from silently dropping the flag the cloud runs need.
#
# Runs from the wizard repo root via `pnpm test:smoke` (postbuild hook).
set -e

DIST_BIN="./dist/bin.js"

# ── 1. Loads ─────────────────────────────────────────────────────────────────
node --input-type=module -e "import '$DIST_BIN'" 2>&1 | head -5 | grep -q 'PostHog Wizard' || {
  echo 'Smoke test failed: compiled binary crashed on load' >&2
  exit 1
}

# ── 2. CI flag overrides physically absent from production builds ───────────
# The override path (src/utils/ci-flag-overrides.ts) is dead code in published
# builds and tsdown strips it; its env var name appearing in dist/*.js means
# dead-code elimination regressed and a prod surface leaked. Sourcemaps keep
# the original source, so only .js output counts.
OVERRIDE_MARKERS='WIZARD_CI_FLAG_OVERRIDES WIZARD_CI_EXCLUDE_TASKS'
if [ "${WIZARD_BUILD_NODE_ENV:-production}" = "ci" ]; then
  # CI builds must keep the paths — their absence means the overrides silently
  # stopped working and CI is back to testing live behavior.
  for marker in $OVERRIDE_MARKERS; do
    if ! grep -q "$marker" ./dist/*.js; then
      echo "Smoke test failed: CI build is missing the $marker path" >&2
      exit 1
    fi
  done
  # And a real invocation must accept the env var. yargs claims every
  # POSTHOG_WIZARD_-prefixed env var as a CLI option and strict-rejects
  # unknown ones during command parse (--version/--help short-circuit and
  # prove nothing). The run exits fast on the missing api key — all this
  # asserts is that yargs did not reject the environment.
  ci_probe=$(WIZARD_CI_FLAG_OVERRIDES='{"wizard-orchestrator":true}' node "$DIST_BIN" --ci --install-dir /tmp/wizard-smoke-probe 2>&1) || true
  if echo "$ci_probe" | grep -q 'Unknown argument'; then
    echo 'Smoke test failed: CI binary rejects WIZARD_CI_FLAG_OVERRIDES in the environment' >&2
    echo "$ci_probe" | head -3 >&2
    exit 1
  fi
else
  for marker in $OVERRIDE_MARKERS; do
    if grep -q "$marker" ./dist/*.js; then
      echo "Smoke test failed: $marker code leaked into a production build" >&2
      exit 1
    fi
  done
fi

# ── 3. --ci rejected in production builds ────────────────────────────────────
# build:ci sets WIZARD_BUILD_NODE_ENV=ci → --ci stays enabled → skip the check.
if [ "${WIZARD_BUILD_NODE_ENV:-production}" = "ci" ]; then
  exit 0
fi

# Capture both output and exit code without tripping `set -e`.
output=$(node "$DIST_BIN" --ci 2>&1) && exit_code=0 || exit_code=$?

if [ "$exit_code" -eq 0 ]; then
  echo 'Smoke test failed: --ci should exit non-zero in production builds' >&2
  echo "Output was:" >&2
  echo "$output" >&2
  exit 1
fi

if ! echo "$output" | grep -qi 'CI mode is not currently supported'; then
  echo 'Smoke test failed: --ci rejection message missing expected text' >&2
  echo "Output was:" >&2
  echo "$output" >&2
  exit 1
fi

# ── 4. Experimental headless flag accepted in production builds ──────────────
# The non-interactive path for published builds (cloud / CI runs). yargs must
# not reject the flag, and it must not fall through to the --ci rejection. With
# no api-key the run exits fast on "Headless mode requires --api-key" — all this
# asserts is that the flag is recognized and live in the published binary. The
# flag name is intentionally undocumented; keep it in sync with @lib/headless-mode.
HEADLESS_FLAG='--headless-DONOTUSE-EXPERIMENTAL'
hl_output=$(node "$DIST_BIN" "$HEADLESS_FLAG" --install-dir /tmp/wizard-smoke-probe 2>&1) || true
if echo "$hl_output" | grep -qiE 'unknown argument|not currently supported'; then
  echo 'Smoke test failed: headless flag not accepted in production build' >&2
  echo "Output was:" >&2
  echo "$hl_output" | head -5 >&2
  exit 1
fi
if ! echo "$hl_output" | grep -qi 'Headless mode requires --api-key'; then
  echo 'Smoke test failed: headless flag did not reach the headless install path' >&2
  echo "Output was:" >&2
  echo "$hl_output" | head -5 >&2
  exit 1
fi
