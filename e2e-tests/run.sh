#!/usr/bin/env bash

# Check if volta is installed
VOLTA=$(which volta)

# Set cwd to the directory of this script
cd "$(dirname "$0")"

export RECORD_FIXTURES=false

# Set CLEANUP_UNUSED_FIXTURES based on whether any arguments were passed
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
