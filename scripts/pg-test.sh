#!/usr/bin/env bash
# Starts a throwaway Postgres, applies the Supabase stub + sync migration, and runs the
# server/sync integration tests (*.pg.test.ts). Needs initdb/postgres 14+ on PATH or in /usr/lib/postgresql.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")"
DIR="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
RUN=""
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown postgres "$DIR"; fi
cleanup() { $RUN "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
$RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -w -l "$DIR/log" start >/dev/null
export PG_TEST_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
psql "$PG_TEST_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/local_auth_stub.sql" -f "$ROOT/supabase/migrations/0001_sync.sql"
cd "$ROOT" && npx jest --runInBand --testPathPatterns '\.pg\.test\.ts$' "$@"
