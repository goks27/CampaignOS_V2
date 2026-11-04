#!/usr/bin/env bash
# Apply migrations + seed to a throwaway database on plain Postgres and run the pgTAP tests.
# Use this where Docker is not available. With Docker, prefer: supabase start && supabase test db
set -euo pipefail
PGURL_BASE="${PGURL_BASE:-postgresql://postgres:postgres@127.0.0.1:5432}"
DB="${DB:-campaignos_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql "$PGURL_BASE/postgres" -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
URL="$PGURL_BASE/$DB"
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/supabase-shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
done
if [ "${WITH_SEED:-0}" = "1" ]; then psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql" >/dev/null; fi
if command -v pg_prove >/dev/null 2>&1; then
  pg_prove -d "$URL" "$ROOT"/supabase/tests/*.sql
else
  for t in "$ROOT"/supabase/tests/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$t"; done
fi
