#!/usr/bin/env bash
# Corre las pruebas de la base en un Postgres temporal. Uso: tests/db/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
# Postgres no corre como root: en ese caso se usa el usuario postgres.
AS=(); [ "$(id -u)" = 0 ] && AS=(runuser -u postgres --)
DATA="$(mktemp -d)"; chmod 777 "$DATA"; [ "$(id -u)" = 0 ] && chown postgres "$DATA"
trap '"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
"${AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-k $DATA -c listen_addresses=''" -l "$DATA/log" start >/dev/null
PSQL=(psql -h "$DATA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/supabase_stub.sql"
"${PSQL[@]}" -c "create extension pgcrypto with schema extensions"
sed 's/^create extension if not exists pgcrypto with schema extensions;//' "$HERE/../../supabase/migrations/"*.sql | "${PSQL[@]}"
"${PSQL[@]}" -o /dev/null -f "$HERE/tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
