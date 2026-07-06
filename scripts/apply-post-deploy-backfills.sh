#!/usr/bin/env bash
#
# Post-deploy backfill runner.
#
# Purpose
# -------
# The container CMD runs `drizzle-kit push --force` at boot to sync the
# database DDL to `shared/schema/**`. Push creates/alters columns and
# tables — but push cannot run data backfills. Any numbered file in
# `migrations/` that carries a data-migration UPDATE must be applied
# separately by this script.
#
# What this script does
# ---------------------
# 1. Applies every backfill migration listed in BACKFILL_MIGRATIONS.
#    Each SQL file must be idempotent (safe to re-run). All included
#    migrations use `ADD COLUMN IF NOT EXISTS` and scope UPDATEs to rows
#    that have not yet been backfilled.
# 2. Runs a verification query per migration. Any non-zero result is
#    treated as a failure and exits non-zero (blocks a green deploy).
#
# When to run
# -----------
# After every deploy that includes new schema. Safe to run on every
# deploy — the script is idempotent. Recommend wiring it into the deploy
# pipeline after the app container is up (so push has completed).
#
# Requirements
# ------------
# - `DATABASE_URL` environment variable.
# - `psql` on PATH (Postgres 12+).
#
# Manual verification (when running by hand)
# ------------------------------------------
#   export DATABASE_URL="postgres://..."
#   bash scripts/apply-post-deploy-backfills.sh
#
# Add new backfills
# -----------------
# When a future migration adds a data backfill, append its filename to
# BACKFILL_MIGRATIONS and add a matching verification query below. Do
# NOT list migrations whose only job is DDL — those are already handled
# by `drizzle-kit push --force`.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found on PATH." >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Backfill migrations to apply (order matters) ────────────────────────────
BACKFILL_MIGRATIONS=(
  "migrations/0047_add_patient_screenings_clinic_id.sql"
)

echo "==> Applying post-deploy backfills"
for migration in "${BACKFILL_MIGRATIONS[@]}"; do
  path="$REPO_ROOT/$migration"
  if [[ ! -f "$path" ]]; then
    echo "  MISSING: $migration" >&2
    exit 1
  fi
  echo "  -> $migration"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$path"
done

# ─── Verifications: expected result for each check is 0 ──────────────────────
echo "==> Verifying backfills"

verify() {
  local label="$1"
  local sql="$2"
  local count
  count=$(psql "$DATABASE_URL" -Atqc "$sql")
  if [[ "$count" != "0" ]]; then
    echo "  FAIL: $label — got $count, expected 0" >&2
    return 1
  fi
  echo "  ok:   $label"
}

verify "0047 patient_screenings.clinic_id backfill" \
  "SELECT COUNT(*) FROM patient_screenings ps
     JOIN screening_batches sb ON sb.id = ps.batch_id
    WHERE ps.clinic_id IS NULL
      AND sb.clinic_id IS NOT NULL;"

echo "==> All backfills applied and verified."
