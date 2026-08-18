#!/usr/bin/env bash
# Same as run-dev.sh, but also grants the operator role (/admin) to the bypass
# user — GAIN_DEV_ADMIN names which GAIN_DEV_USER value is treated as an admin
# (CLAUDE.md).
#
# Usage:
#   ./run-dev-admin.sh                  # bypass user defaults to "dev"
#   GAIN_DEV_USER=you ./run-dev-admin.sh
set -euo pipefail
export GAIN_DEV_USER="${GAIN_DEV_USER:-dev}"
export GAIN_DEV_ADMIN="$GAIN_DEV_USER"
exec npm run dev -- --host
