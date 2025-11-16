#!/usr/bin/env bash
set -euo pipefail

# Apply D1 migrations to the configured database binding.
# Usage:
#   DB_NAME=approvalflow_db WRANGLER_ENV=preview CF_API_TOKEN=... ./scripts/d1/apply_migrations.sh

DB_NAME="approvalflow_db"

if [ -n "${1-}" ]; then
  DB_NAME="$1"
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "Error: wrangler CLI not found in PATH. Install it (npm i -g wrangler) or ensure it's available." >&2
  exit 1
fi

echo "[d1] Applying migrations for database: ${DB_NAME}"

if [ -n "${WRANGLER_ENV-}" ]; then
  echo "[d1] Using Wrangler environment: ${WRANGLER_ENV}"
  wrangler d1 migrations apply "${DB_NAME}" --env "${WRANGLER_ENV}"
else
  wrangler d1 migrations apply "${DB_NAME}"
fi

echo "[d1] Done."
