#!/usr/bin/env bash
# Headless `wizard error-tracking` e2e run on a /tmp copy of an app; see ../SKILL.md.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <app dir | path under wizard-workbench/apps/>" >&2
  exit 2
fi

REPO=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)
WORKBENCH=${WIZARD_WORKBENCH:-$REPO/../wizard-workbench}
SRC=$1
[[ -d $SRC ]] || SRC=$WORKBENCH/apps/$1
if [[ ! -d $SRC ]]; then
  echo "app not found: $1 (looked in . and $WORKBENCH/apps)" >&2
  exit 2
fi
SRC=$(cd "$SRC" && pwd)
NAME=$(basename "$SRC")
APP=${E2E_APP_DIR:-/tmp/wizard-et-$NAME}
case $APP in
  /tmp/?*|/private/tmp/?*) ;;
  *) echo "E2E_APP_DIR must be under /tmp: $APP" >&2; exit 2 ;;
esac
SNAPS=$APP-snaps
RESULT=$APP.json
RUN_OUT=$APP-run.out
LOG_OUT=$APP-wizard.log
WIZARD_LOG=/tmp/posthog-wizard.log

# Credentials: the environment wins, else wizard-workbench/.env. Never echoed.
read_env() {
  local key=$1 line
  if [[ -n ${!key:-} || ! -f $WORKBENCH/.env ]]; then return 0; fi
  line=$(grep -E "^${key}=" "$WORKBENCH/.env" | tail -1) || return 0
  line=${line#*=}
  line=${line%\"}; line=${line#\"}; line=${line%\'}; line=${line#\'}
  export "$key=${line/#\~/$HOME}"
}
for key in POSTHOG_PERSONAL_API_KEY POSTHOG_WIZARD_PROJECT_ID \
  WIZARD_CI_GATEWAY_TOKEN_FILE SOURCE_MAPS_CLI_KEY; do
  read_env "$key"
done
for key in POSTHOG_PERSONAL_API_KEY POSTHOG_WIZARD_PROJECT_ID WIZARD_CI_GATEWAY_TOKEN_FILE; do
  if [[ -z ${!key:-} ]]; then
    echo "missing $key (export it or set it in $WORKBENCH/.env)" >&2
    exit 2
  fi
done
if [[ ! -s $WIZARD_CI_GATEWAY_TOKEN_FILE ]]; then
  echo "gateway token file is missing or empty: $WIZARD_CI_GATEWAY_TOKEN_FILE" >&2
  exit 2
fi
if [[ -z ${SOURCE_MAPS_CLI_KEY:-} ]]; then
  echo "warning: SOURCE_MAPS_CLI_KEY unset; the flow's upload-key ask gets no key" >&2
fi

# Fresh throwaway copy with a git baseline, so `git -C $APP diff` shows the run's edits.
rm -rf "$APP" "$SNAPS" "$RESULT" "$RUN_OUT" "$LOG_OUT"
mkdir -p "$APP"
rsync -a --exclude .git --exclude node_modules --exclude dist --exclude .next \
  --exclude .nuxt --exclude .svelte-kit --exclude .venv --exclude venv \
  --exclude vendor --exclude Pods --exclude target --exclude .dart_tool \
  --exclude .gradle "$SRC/" "$APP/"
git -C "$APP" init -q
git -C "$APP" add -A
git -C "$APP" -c user.name=e2e -c user.email=e2e@localhost commit -qm baseline

offset=$(wc -c < "$WIZARD_LOG" 2>/dev/null || echo 0)
echo "app: $APP (from $SRC), project $POSTHOG_WIZARD_PROJECT_ID"
echo "sequence=${SNAP_SEQUENCE:-<binding>} harness=${SNAP_HARNESS:-<binding>} model=${SNAP_MODEL:-<binding>}"

cd "$REPO"
set +e
PROGRAM=error-tracking APP_DIR="$APP" PROJECT_ID="$POSTHOG_WIZARD_PROJECT_ID" \
  E2E_ASK=true SNAP_OUT="$SNAPS" E2E_RESULT_JSON="$RESULT" \
  "$REPO/node_modules/.bin/tsx" scripts/tui-snapshots.no-jest.ts 2>&1 | tee "$RUN_OUT"
code=${PIPESTATUS[0]}
set -e

tail -c +$((offset + 1)) "$WIZARD_LOG" > "$LOG_OUT" 2>/dev/null || true
for f in "$SNAPS"/*.ans; do
  [[ -e $f ]] && perl -pe 's/\e\[[0-9;?]*[A-Za-z]//g' "$f" > "${f%.ans}.txt"
done

echo
echo "host exit:   $code"
if [[ -f $RESULT ]] && command -v jq > /dev/null; then
  jq -r '"runPhase:    \(.runPhase)",
    "screens:     \(.screenPath | join(" > "))",
    "tasks:       \([.tasks[]? | "\(.label)=\(.status)"] | join(", "))",
    "asks:        \([.asks[]?.questionIds[]] | join(", "))",
    "unanswered:  \(.unansweredAsks)  refused: \(.refusedAsks)",
    "abort:       \(.abort // "none")",
    "report:      \(.reportFile.exists // false)"' "$RESULT"
fi
echo "result:      $RESULT"
echo "snapshots:   $SNAPS"
echo "wizard log:  $LOG_OUT"
echo "app changes:"
git -C "$APP" status --short
exit "$code"
