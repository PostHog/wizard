#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="d1a222795f45230e702cf6354d2f8e928b60eb04"
DEST="$ROOT/node_modules/.cache/coherence/source"

case "${1:-}" in
    install|verify|graph|context) ;;
    *) echo 'Usage: pnpm coherence <install|verify|graph|context> [options]' >&2; exit 2 ;;
esac

if [[ "${1:-}" == "install" ]]; then
    mkdir -p "$ROOT/node_modules/.cache/coherence"
    if [[ ! -d "$DEST/.git" ]]; then
        git clone https://github.com/PostHog/coherence.git "$DEST"
    fi
    if ! git -C "$DEST" cat-file -e "$PIN^{commit}" 2>/dev/null; then
        git -C "$DEST" fetch origin "$PIN"
    fi
    git -C "$DEST" checkout --detach "$PIN"
    (cd "$DEST" && npm ci --ignore-scripts && npm run build)
    printf '%s\n' "$PIN" > "$ROOT/node_modules/.cache/coherence/built-revision"
    printf 'Coherence ready at %s\n' "$PIN"
    exit 0
fi

if [[ ! -f "$DEST/dist/cli.js" ]] ||
    [[ "$(cat "$ROOT/node_modules/.cache/coherence/built-revision" 2>/dev/null || true)" != "$PIN" ]] ||
    [[ "$(git -C "$DEST" rev-parse HEAD 2>/dev/null || true)" != "$PIN" ]]; then
    echo 'Run pnpm coherence:install first (requires GitHub access and network).' >&2
    exit 1
fi

cd "$ROOT"
exec node "$DEST/dist/cli.js" "$@"
