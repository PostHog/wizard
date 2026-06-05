#!/usr/bin/env bash
#
# Postbuild smoke test for the compiled wizard binary.
#
#   1. Binary loads without crashing.
#   2. In production builds (WIZARD_BUILD_NODE_ENV != "ci"), --ci is rejected
#      with the tailored "CI mode is not currently supported" error and a
#      non-zero exit. Guards against a future change that re-enables --ci in
#      published builds without anyone noticing.
#
# Runs from the wizard repo root via `pnpm test:smoke` (postbuild hook).
set -e

DIST_BIN="./dist/bin.js"

# ── 1. Loads ─────────────────────────────────────────────────────────────────
node --input-type=module -e "import '$DIST_BIN'" 2>&1 | head -5 | grep -q 'PostHog Wizard' || {
  echo 'Smoke test failed: compiled binary crashed on load' >&2
  exit 1
}

# ── 2. --ci rejected in production builds ────────────────────────────────────
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
