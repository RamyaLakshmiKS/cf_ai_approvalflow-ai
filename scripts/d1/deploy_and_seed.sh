#!/usr/bin/env bash
set -euo pipefail

# Usage:
#  DEPLOYED_URL=https://your-worker.example.workers.dev ADMIN_USERNAME=alice ADMIN_PASSWORD=s3cret ADMIN_EMAIL=alice@example.com \
#    ./scripts/d1/deploy_and_seed.sh
#
# This script will:
# 1. Deploy SQL migrations in ./migrations to the D1 database configured in wrangler.jsonc
# 2. (Optional) If DEPLOYED_URL is provided, POST to /api/auth/register to create an initial user

DB_NAME="approvalflow_db"
MIGRATIONS_DIR="./migrations"

echo "[d1] Deploying migrations from ${MIGRATIONS_DIR} to database ${DB_NAME}..."

if ! command -v wrangler >/dev/null 2>&1; then
  echo "Error: wrangler CLI not found in PATH. Install it (npm i -g wrangler) or ensure it's available." >&2
  exit 1
fi

echo "[d1] Applying migrations using wrangler (will apply files from ${MIGRATIONS_DIR})..."
# Use positional argument for database name (wrangler expects: wrangler d1 migrations apply <database>)
if [ -n "${WRANGLER_ENV:-}" ]; then
  echo "[d1] Using Wrangler environment: ${WRANGLER_ENV}"
  wrangler d1 migrations apply --remote "${DB_NAME}" --env "${WRANGLER_ENV}" || {
    echo "wrangler d1 migrations apply failed. Please check your wrangler version and run 'wrangler d1 migrations --help' for available commands." >&2
    exit 1
  }
else
  wrangler d1 migrations apply "${DB_NAME}" || {
    echo "wrangler d1 migrations apply failed. Please check your wrangler version and run 'wrangler d1 migrations --help' for available commands." >&2
    exit 1
  }
fi

echo "[d1] Migrations deployed."

if [ -n "${DEPLOYED_URL:-}" ]; then
  echo "[d1] DEPLOYED_URL provided. Attempting to register initial user via ${DEPLOYED_URL}/api/auth/register"

  if [ -z "${ADMIN_USERNAME:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "Error: To seed an admin user, set ADMIN_USERNAME and ADMIN_PASSWORD environment variables." >&2
    exit 1
  fi

  ADMIN_EMAIL=${ADMIN_EMAIL:-}

  PAYLOAD=$(jq -n --arg username "$ADMIN_USERNAME" --arg password "$ADMIN_PASSWORD" --arg email "$ADMIN_EMAIL" '{username: $username, password: $password, email: $email}')

  echo "[d1] Registering user ${ADMIN_USERNAME}..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${DEPLOYED_URL%/}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "[d1] User registered successfully (HTTP $HTTP_CODE)."
  else
    echo "[d1] Failed to register user, HTTP status: $HTTP_CODE" >&2
    echo "[d1] Response body (for debugging):"
    curl -s -X POST "${DEPLOYED_URL%/}/api/auth/register" -H "Content-Type: application/json" -d "$PAYLOAD" || true
    exit 1
  fi
else
  echo "[d1] DEPLOYED_URL not set; skipping user registration step. If you want to seed a user, re-run with DEPLOYED_URL, ADMIN_USERNAME, and ADMIN_PASSWORD set."
fi

echo "[d1] Done."
