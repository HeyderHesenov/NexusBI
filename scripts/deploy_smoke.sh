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
    step "Failed — recent backend logs"
    "${COMPOSE[@]}" logs --tail 60 backend 2>&1 || true
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
WS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(ws_nonce)" \
  "$BASE_URL/ws/user?ticket=$TICKET")"
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
