#!/usr/bin/env bash
#
# Smoke test: build wizard, pack it, install into a real Next.js app from
# wizard-workbench, and run in CI mode.
#
# Prerequisites:
#   - POSTHOG_PERSONAL_API_KEY env var (or in .env)
#   - ../wizard-workbench repo checked out (for the test app)
#
# Usage:
#   ./scripts/smoke-test-ci.sh                          # default: next-js/15-app-router-todo
#   ./scripts/smoke-test-ci.sh next-js/15-pages-router-saas
#
# Examples:
#   # With API key inline:
#   POSTHOG_PERSONAL_API_KEY=phx_your_key_here ./scripts/smoke-test-ci.sh
#
#   # With project ID override:
#   POSTHOG_PERSONAL_API_KEY=phx_your_key_here POSTHOG_PROJECT_ID=12345 ./scripts/smoke-test-ci.sh
#
#   # Specific app:
#   POSTHOG_PERSONAL_API_KEY=phx_your_key_here ./scripts/smoke-test-ci.sh next-js/15-pages-router-saas
#
#   # If ../wizard-workbench/.env has POSTHOG_PERSONAL_API_KEY, just:
#   ./scripts/smoke-test-ci.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIZARD_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKBENCH_ROOT="$(cd "$WIZARD_ROOT/../wizard-workbench" 2>/dev/null && pwd)" || {
  echo "ERROR: wizard-workbench not found at ../wizard-workbench"
  echo "Clone it: git clone https://github.com/PostHog/wizard-workbench.git ../wizard-workbench"
  exit 1
}

APP="${1:-next-js/15-app-router-todo}"
APP_SRC="$WORKBENCH_ROOT/apps/$APP"

if [ ! -d "$APP_SRC" ]; then
  echo "ERROR: App not found: $APP_SRC"
  echo "Available apps:"
  ls -d "$WORKBENCH_ROOT"/apps/*/* 2>/dev/null | sed "s|$WORKBENCH_ROOT/apps/||"
  exit 1
fi

# Load .env from workbench if it exists (for POSTHOG_PERSONAL_API_KEY)
if [ -f "$WORKBENCH_ROOT/.env" ]; then
  set -a
  source "$WORKBENCH_ROOT/.env"
  set +a
fi

API_KEY="${POSTHOG_PERSONAL_API_KEY:-}"
if [ -z "$API_KEY" ]; then
  echo "ERROR: POSTHOG_PERSONAL_API_KEY not set"
  echo "Set it in your environment or in $WORKBENCH_ROOT/.env"
  exit 1
fi

PROJECT_ID="${POSTHOG_PROJECT_ID:-}"

# ── Build & Pack ────────────────────────────────────────────────────────────
echo "==> Building wizard..."
cd "$WIZARD_ROOT"
pnpm build

echo "==> Packing wizard..."
PACK_FILE=$(pnpm pack --pack-destination /tmp 2>/dev/null | tail -1)
PACK_PATH="$PACK_FILE"
echo "    Pack: $PACK_FILE"

# ── Copy app to temp dir ────────────────────────────────────────────────────
WORK_DIR=$(mktemp -d /tmp/wizard-smoke.XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Copying $APP to $WORK_DIR..."
cp -r "$APP_SRC/." "$WORK_DIR/"

# Init git (wizard requires it)
cd "$WORK_DIR"
git init -q
git add -A
git config user.email "smoke-test@test.local"
git config user.name "Smoke Test"
git commit -q -m "init"

# ── Install app deps ────────────────────────────────────────────────────────
echo "==> Installing app dependencies..."
if [ -f pnpm-lock.yaml ]; then
  pnpm install --no-frozen-lockfile 2>&1 | tail -3
elif [ -f package-lock.json ]; then
  npm install 2>&1 | tail -3
else
  npm install 2>&1 | tail -3
fi

# ── Run wizard in CI mode ───────────────────────────────────────────────────
echo "==> Running wizard in CI mode..."
echo "    App:        $APP"
echo "    Dir:        $WORK_DIR"
if [ -n "$PROJECT_ID" ]; then
  echo "    Project ID: $PROJECT_ID"
fi
echo ""

CMD=(
  node "$WIZARD_ROOT/dist/bin.js"
  --ci
  --api-key "$API_KEY"
  --install-dir "$WORK_DIR"
  --debug
)

if [ -n "$PROJECT_ID" ]; then
  CMD+=(--project-id "$PROJECT_ID")
fi

"${CMD[@]}"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "==> Smoke test PASSED"

  # Quick sanity checks
  echo "==> Post-install checks:"
  if grep -q "posthog" "$WORK_DIR/package.json"; then
    echo "    [PASS] posthog found in package.json"
  else
    echo "    [FAIL] posthog NOT found in package.json"
    EXIT_CODE=1
  fi
else
  echo "==> Smoke test FAILED (exit code $EXIT_CODE)"
fi

exit $EXIT_CODE
