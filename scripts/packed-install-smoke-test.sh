#!/usr/bin/env bash
#
# Smoke test for the packed wizard tarball, installed the way `npx` installs it.
#
# npm resolves the dependency ranges from the registry, not from
# pnpm-lock.yaml. This catches a transitive dependency that resolves to a
# version the wizard does not load with.
#
# Usage: ./scripts/packed-install-smoke-test.sh <path-to-wizard.tgz>
set -euo pipefail

TARBALL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cd "$WORK_DIR"
npm init -y >/dev/null
npm install "$TARBALL" --no-audit --no-fund --no-package-lock >/dev/null

cd node_modules/@posthog/wizard

# The agent harness loads these modules lazily, so loading the binary does not prove them.
for module in @earendil-works/pi-coding-agent @earendil-works/pi-ai; do
  node --input-type=module -e "await import('$module')" || {
    echo "Packed install smoke test failed: $module does not load" >&2
    (cd "$WORK_DIR" && npm ls --all 2>/dev/null | grep '@earendil-works/' >&2) || true
    exit 1
  }
done

node ./dist/bin.js --version >/dev/null || {
  echo 'Packed install smoke test failed: binary does not start' >&2
  exit 1
}

echo 'Packed install smoke test passed'
