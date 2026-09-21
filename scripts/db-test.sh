#!/usr/bin/env bash
# Applies migrations/ to a throwaway database and runs tests/sql/*.test.sql,
# then walks the migrations back down and up again to prove both directions.
#
#   DATABASE_URL=postgresql://postgres@localhost:5432/postgres scripts/db-test.sh
#   scripts/db-test.sh                # starts a temporary cluster (not as root)
#
# The database is a plain Postgres with tests/sql/supabase-shim.sql on top
# (the API roles, auth.users, auth.uid()); never point DATABASE_URL at a real
# Supabase project, the shim would try to redefine auth.uid().
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ -z "${DATABASE_URL:-}" ]; then
  PGBIN=$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
  TMP=$(mktemp -d)
  cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
  trap cleanup EXIT
  "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 54329 -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
  DATABASE_URL="postgresql://postgres@localhost:54329/postgres?host=$TMP"
fi

DB="fundocap_dbtest_$$"
ADMIN="$DATABASE_URL"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "create database $DB"
trap 'psql "$ADMIN" -q -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
# same server, the new database
TEST_URL=$(node -e 'const u=new URL(process.argv[1]); u.pathname="/"+process.argv[2]; console.log(u.toString())' "$ADMIN" "$DB")

run() { PGOPTIONS="-c client_min_messages=warning" psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -X -1 -f "$1"; }
policies() {
  psql "$TEST_URL" -X -c "select tablename, policyname, cmd, roles, coalesce(qual, '') as using, coalesce(with_check, '') as with_check from pg_policies where schemaname = 'public' order by tablename, policyname;"
}

echo "== shim"
run tests/sql/supabase-shim.sql
echo "== up: 0000 (baseline = live state before this package)"
run migrations/0000_baseline.up.sql
echo "-- pg_policies BEFORE"
policies
for f in $(ls migrations/*.up.sql | sort | grep -v 0000_); do
  echo "== up: $f"
  run "$f"
done
echo "-- pg_policies AFTER"
policies

for f in $(ls tests/sql/*.test.sql | sort); do
  echo "== test: $f"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -X -f "$f"
done

echo "== down, in reverse (drops the test data with the tables)"
for f in $(ls migrations/*.down.sql | sort -r); do
  echo "   $f"
  run "$f"
done
echo "== up again (idempotent + reversible)"
for f in $(ls migrations/*.up.sql | sort); do
  run "$f"
done
echo "== up a second time on top (no-op re-run)"
for f in $(ls migrations/*.up.sql | sort); do
  run "$f"
done
echo "db-test: all migrations apply, revert and re-apply; all SQL tests pass"
