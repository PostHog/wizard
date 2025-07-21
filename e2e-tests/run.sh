#!/usr/bin/env bash

VOLTA=$(which volta)
cd "$(dirname "$0")" || exit

# Only cleanup fixtures if running all tests.
if [ "$#" -gt 0 ]; then
  export CLEANUP_UNUSED_FIXTURES=false
else
  export CLEANUP_UNUSED_FIXTURES=true
fi

# Run the tests with volta if it is installed
if [ -x "$VOLTA" ]; then
  echo "Running tests with volta"
  volta run pnpm test "$@"
else
  echo "Running tests without volta"
  pnpm test "$@"
fi
