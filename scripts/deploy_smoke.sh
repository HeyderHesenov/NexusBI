#!/usr/bin/env bash
#
# Faza 0 exit criterion, executed rather than asserted.
#
# Stands up docker-compose.prod.yml on empty volumes and checks the claims the
# production stack makes about itself: it is not in demo mode, it migrated
# before serving, it runs unprivileged, it survives a restart with its data, it
# elects exactly one scheduler among its workers, and it reports itself unready
# when the database dies.
#
# Runs under its own compose project against a throwaway env file, so it can
# never touch a real deployment's secrets or volumes on the same host.
#
#   ./scripts/deploy_smoke.sh
#
# Needs ports 80 and 443 free.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="nexusbi-smoke"
ENV_FILE=".env.smoke"
BASE_URL="http://localhost"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml)

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cleanup() {
  local code=$?
  if [ $code -ne 0 ]; then
    # Every service, not just the backend. The first failure of this script was
    # Caddy refusing to start on a config error, and a backend-only dump showed
    # a perfectly healthy backend with no clue as to why nothing reached it.
    step "Failed — container states"
    "${COMPOSE[@]}" ps -a 2>&1 || true
    for svc in web backend migrate db redis; do
      step "Failed — $svc logs"
      "${COMPOSE[@]}" logs --tail 40 "$svc" 2>&1 || true
    done
  fi
  step "Cleaning up"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  exit $code
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
step "Writing throwaway secrets to $ENV_FILE"

# NEXUSBI_ENV_FILE is read back by docker-compose.prod.yml's `env_file:`, so the
# containers get these values and the operator's own .env.prod is never opened.
#
# Minted per run rather than written as literals. Two reasons: a committed
# credential-shaped string is a leak scanner's job to flag whether or not it is
# real, and a script that hands out the same "throwaway" key to every reader is
# the wrong thing to copy from.
rand_b64() { python3 -c "import base64,os,sys; print(base64.urlsafe_b64encode(os.urandom(int(sys.argv[1]))).decode())" "$1"; }

# RFC 6455 wants Sec-WebSocket-Key to be standard base64 of 16 bytes, and the
# `websockets` server validates the alphabet — so the url-safe variant above
# (which substitutes - and _) will not do for that one header.
ws_nonce() { python3 -c "import base64,os; print(base64.b64encode(os.urandom(16)).decode())"; }

cat > "$ENV_FILE" <<EOF
NEXUSBI_ENV_FILE=$ENV_FILE
POSTGRES_USER=nexusbi
POSTGRES_PASSWORD=$(rand_b64 18)
POSTGRES_DB=nexusbi
SECRET_KEY=$(rand_b64 36)
FERNET_KEY=$(rand_b64 32)
MODEL_SIGNING_KEY=$(rand_b64 24)
# Deliberately empty: a keyless deploy must boot and serve its deterministic
# fallbacks. If this stack needs a model key to come up, that is the bug.
AI_API_KEY=
AI_MODEL=
NEXUSBI_SITE_ADDRESS=http://localhost
WEB_CONCURRENCY=4

# The scheduler sleeps before its first election, so the default 60s would make
# the leader check below a minute of dead waiting.
SCHEDULER_INTERVAL_SECONDS=5
EOF
pass "$ENV_FILE written"

# ─────────────────────────────────────────────────────────────────────────────
step "Building and starting the production stack on empty volumes"
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --build
pass "stack up"

# A long-running service that has already exited is never coming back in a way
# the readiness loop would notice — it just burns the full timeout. `migrate` is
# excluded because exiting is its whole job.
sleep 5
for svc in web backend db redis; do
  state="$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}}' | awk -v s="$svc" '$1==s {print $2}')"
  # 'restarting' is not tolerated: with `restart: unless-stopped` that is what a
  # container crash-looping on a bad config looks like, which is precisely the
  # case this check exists to catch.
  [ "$state" = "running" ] || die "$svc is '$state' five seconds after start"
done
pass "every long-running service is up"

# ─────────────────────────────────────────────────────────────────────────────
step "Waiting for readiness through the edge proxy"
# Through Caddy, not straight at the backend: this is also the proof that the
# proxy routes /ready at all.
for _ in $(seq 1 180); do
  curl -sf "$BASE_URL/ready" >/dev/null 2>&1 && break
  sleep 1
done
READY="$(curl -sf "$BASE_URL/ready")" || die "not ready after 180s"
echo "$READY" | grep -q '"status":"ready"' || die "unexpected /ready body: $READY"
echo "$READY" | grep -q '"migrations":"ok"' || die "database is not at the migration head"
echo "$READY" | grep -q '"cache":"ok"' || die "Redis is not reachable, but this stack depends on it"
pass "/ready is 200 with database, migrations and cache ok"

echo "$READY" | grep -q '"ai":"degraded' \
  || die "expected AI to report degraded with no API key, got: $READY"
pass "keyless deploy boots and reports AI degradation instead of refusing to start"

# ─────────────────────────────────────────────────────────────────────────────
step "Checking what the image actually is"

DEMO="$("${COMPOSE[@]}" exec -T backend python -c \
  'from app.config import settings; print(settings.DEMO_MODE)' | tr -d '\r')"
[ "$DEMO" = "False" ] || die "DEMO_MODE is $DEMO — this is not a production stack"
pass "DEMO_MODE is false"

UID_IN_CONTAINER="$("${COMPOSE[@]}" exec -T backend id -u | tr -d '\r')"
[ "$UID_IN_CONTAINER" != "0" ] || die "backend runs as root"
pass "backend runs unprivileged (uid $UID_IN_CONTAINER)"

if "${COMPOSE[@]}" exec -T backend python -c 'import pytest' >/dev/null 2>&1; then
  die "pytest is installed in the production image"
fi
pass "no test runner in the production image"

# ─────────────────────────────────────────────────────────────────────────────
step "Exercising the product end to end"

EMAIL="smoke-$(date +%s)@example.com"
TOKEN="$(curl -sf -X POST "$BASE_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-password\",\"full_name\":\"Smoke\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
[ -n "$TOKEN" ] || die "registration returned no token"
pass "registered a user"

CSV="$(mktemp -d)/smoke_sales.csv"
printf 'region,revenue\nBaku,100\nGanja,250\nSumqayit,75\n' > "$CSV"
DS_ID="$(curl -sf -X POST "$BASE_URL/api/v1/datasource/upload" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$CSV" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
[ -n "$DS_ID" ] || die "upload returned no datasource id"
pass "uploaded a CSV (datasource $DS_ID)"

ROWS="$(curl -sf -X POST "$BASE_URL/api/v1/query/run" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sql\":\"SELECT region, revenue FROM smoke_sales ORDER BY revenue DESC\",\"datasource_id\":\"$DS_ID\"}" \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]))')"
[ "$ROWS" = "3" ] || die "expected 3 rows back, got $ROWS"
pass "ran a query and got the data back"

# ─────────────────────────────────────────────────────────────────────────────
step "Checking the WebSocket upgrade survives the proxy"
# The frontend's chat badge, presence and dashboard collaboration all ride this.
# A proxy that quietly answers 200 instead of 101 breaks every one of them, and
# nothing else in this script would notice.
TICKET="$(curl -sf -X POST "$BASE_URL/api/v1/chat/user-ticket" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["ticket"])')"
# --max-time, because curl has no idea it is done. The status line is all this
# check wants, but after a 101 the socket stays open by design and curl waits on
# a body that is never coming — the first passing run sat here for 40 seconds
# until something else closed the connection. Unbounded, a socket that stays
# open would burn the whole job timeout and report nothing. Non-zero exit is
# expected on that cutoff and %{http_code} still carries the status curl saw.
WS_CODE="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(ws_nonce)" \
  "$BASE_URL/ws/user?ticket=$TICKET" || true)"
[ "$WS_CODE" = "101" ] || die "WebSocket handshake returned $WS_CODE, expected 101"
pass "/ws/user completes the upgrade handshake through Caddy"

# ─────────────────────────────────────────────────────────────────────────────
step "Checking only one worker schedules"
sleep 12  # two election intervals

STARTED="$("${COMPOSE[@]}" logs backend 2>/dev/null | grep -c 'scheduler_started' || true)"
[ "$STARTED" -ge 2 ] \
  || die "only $STARTED workers started a scheduler loop — the election is untested with one"
pass "$STARTED workers are competing for the lock"

LEADER_KEYS="$("${COMPOSE[@]}" exec -T redis redis-cli --raw KEYS 'nexusbi:leader:*' \
  | tr -d '\r' | grep -c . || true)"
[ "$LEADER_KEYS" = "1" ] || die "expected exactly 1 leader key, found $LEADER_KEYS"
HOLDER="$("${COMPOSE[@]}" exec -T redis redis-cli --raw GET 'nexusbi:leader:scheduler' | tr -d '\r')"
[ -n "$HOLDER" ] || die "the scheduler leader key has no holder"
pass "exactly one of them holds nexusbi:leader:scheduler ($HOLDER)"

# ─────────────────────────────────────────────────────────────────────────────
step "Restarting the whole stack"
"${COMPOSE[@]}" restart >/dev/null
for _ in $(seq 1 120); do
  curl -sf "$BASE_URL/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$BASE_URL/ready" >/dev/null || die "not ready again after a restart"
pass "ready again"

SURVIVED="$(curl -sf "$BASE_URL/api/v1/datasource/" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; print(any(d['id']=='$DS_ID' for d in json.load(sys.stdin)))")"
[ "$SURVIVED" = "True" ] || die "the uploaded datasource did not survive the restart"
pass "the uploaded data and the session survived"

# ─────────────────────────────────────────────────────────────────────────────
step "Checking the database enum types against the models"
# This is the only place in CI with a real Postgres, so it is the only place the
# question can actually be answered. `powerbi` sat in DBType with no matching
# ALTER TYPE for months: SQLite renders Enum as VARCHAR, so every unit test
# passed while connect-powerbi failed on Postgres alone. Reading pg_enum after
# the migrations have run proves the type, not the intent.
"${COMPOSE[@]}" exec -T backend python scripts/check_enum_labels.py \
  || die "a model enum can write labels the database type does not have"
pass "every model enum label exists in the database"

# ─────────────────────────────────────────────────────────────────────────────
step "Diffing the migrated schema against the models"
# The enum check above answers one question about one column type. This answers
# the general form of it: the unit suite builds its schema with
# Base.metadata.create_all and stamps alembic_version by hand, so the schema it
# tests comes from the models while production's comes from the migrations, and
# nothing compares the two. Measured when this was added: they disagreed in 56
# places, one of them a server_default that left the model describing a
# fail-open rls_mode. That one was fixed, so the baseline this ratchets against
# holds the other 55. See scripts/schema_drift_baseline.txt.
"${COMPOSE[@]}" exec -T backend python scripts/check_schema_drift.py \
  || die "the migrated schema and the models disagree outside the accepted baseline"
pass "no schema drift outside the documented baseline"

# ─────────────────────────────────────────────────────────────────────────────
step "Rolling the whole schema back and forward again"
# Can this deployment be rolled back? Until this step, nothing answered that.
# The unit suite builds its schema with create_all and never runs a migration,
# and everything above only ever runs `upgrade head`, so across 52 revisions no
# downgrade() had ever executed automatically. A broken one would first surface
# during a production rollback.
#
# tests/test_migrations_roundtrip.py runs the same cycle on SQLite for free on
# every push. It is not a substitute for this one: written first, it passed
# cleanly while the initial migration's downgrade left the `dbtype` enum type
# behind, because SQLite renders sa.Enum as VARCHAR and there was no type to
# leak. On a real Postgres the second upgrade died with `type "dbtype" already
# exists` — a rollback that made the database un-redeployable. This is the only
# place in CI with a real Postgres, so it is the only place that can see it.
#
# Deliberately last: `downgrade base` drops every table, so everything above
# that needs data has already run.

# The backend comes DOWN first, and that is not tidiness. DROP TABLE needs
# ACCESS EXCLUSIVE on Postgres, while any in-flight SELECT holds ACCESS SHARE;
# this stack runs four uvicorn workers plus a scheduler polling every 5s
# (SCHEDULER_INTERVAL_SECONDS above), so a poll landing in the wrong millisecond
# blocks the DDL until migration_lock.py's 5-minute lock_timeout expires and then
# fails the job — intermittently, inside a 25-minute budget. Routing the DDL
# through `run --rm migrate` changes which container issues it, not who is
# holding locks, so it does not help on its own.
"${COMPOSE[@]}" stop backend >/dev/null
# One container start, not two: `run` on this image pays for pandas/scipy/sklearn
# imports, and `downgrade && upgrade` is a single shell away.
"${COMPOSE[@]}" run --rm --no-deps -T migrate \
  sh -c 'alembic downgrade base && alembic upgrade head' \
  || die "the schema does not survive a rollback — this is what a production rollback would hit"
"${COMPOSE[@]}" start backend >/dev/null
pass "downgrade base → upgrade head completes on a real Postgres"

# The application has to come back, not just the schema. Without this the next
# assertion is /ready == 503 with the database deliberately stopped, which passes
# whether the backend is healthy or permanently wedged — and asyncpg caches
# prepared statements per connection against tables this step just dropped and
# recreated, so InvalidCachedStatementError on every query is the realistic
# failure. 503-because-the-db-is-down and 503-because-the-app-is-broken are
# indistinguishable, so the check has to happen while the database is still up.
for _ in $(seq 1 120); do
  curl -sf "$BASE_URL/ready" 2>/dev/null | grep -q '"status":"ready"' && break
  sleep 1
done
curl -sf "$BASE_URL/ready" | grep -q '"status":"ready"' \
  || die "the backend does not serve again after a rollback and rebuild"
pass "the application still serves against the rebuilt schema"

# check_enum_labels reads pg_enum, i.e. exactly the state the rollback could get
# wrong — it is the one that would have caught the dbtype leak. check_schema_drift
# compares against the MODELS (not against the pre-rollback schema, which nothing
# records), so its job here is narrower: catching a non-deterministic migration.
"${COMPOSE[@]}" exec -T backend python scripts/check_enum_labels.py \
  || die "the rebuilt database is missing enum labels the models write"
"${COMPOSE[@]}" exec -T backend python scripts/check_schema_drift.py \
  || die "the rebuilt schema disagrees with the models outside the accepted baseline"
pass "the rebuilt schema still matches the models"

# ─────────────────────────────────────────────────────────────────────────────
step "Stopping the database"
"${COMPOSE[@]}" stop db >/dev/null
sleep 3
DOWN_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/ready")"
[ "$DOWN_CODE" = "503" ] || die "/ready returned $DOWN_CODE with the database down, expected 503"
pass "/ready reports 503 so a load balancer stops routing here"

LIVE_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/live")"
[ "$LIVE_CODE" = "200" ] || die "/live returned $LIVE_CODE — a restart would not fix a dead database"
pass "/live stays 200, so the container is not restart-looped"

printf '\n\033[32mDeploy smoke passed.\033[0m\n'
