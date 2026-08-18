#!/usr/bin/env bash
# Runs the dev server bound beyond localhost (--host), so it's reachable from a
# phone on the LAN, signed in via the GAIN_DEV_USER bypass (CLAUDE.md).
#
# Usage:
#   ./run-dev.sh                  # bypass user defaults to "dev"
#   GAIN_DEV_USER=you ./run-dev.sh
set -euo pipefail
export GAIN_DEV_USER="${GAIN_DEV_USER:-dev}"
exec npm run dev -- --host
