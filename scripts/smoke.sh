#!/usr/bin/env bash
# Tiny end-to-end smoke test against a running RideX stack.
# Run: bash scripts/smoke.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://localhost}"
: "${RIDEX_SEED_PASSWORD:?RIDEX_SEED_PASSWORD must be set}"
: "${RIDEX_SMOKE_RIDER_PHONE:?RIDEX_SMOKE_RIDER_PHONE must be set}"
: "${RIDEX_SMOKE_DRIVER_PHONE:?RIDEX_SMOKE_DRIVER_PHONE must be set}"
: "${RIDEX_SMOKE_ADMIN_PHONE:?RIDEX_SMOKE_ADMIN_PHONE must be set}"
: "${RIDEX_SMOKE_DRIVER_ID:?RIDEX_SMOKE_DRIVER_ID must be set}"
PASSWORD="$RIDEX_SEED_PASSWORD"
DRIVER_ID="$RIDEX_SMOKE_DRIVER_ID"
echo "== smoke test against $BASE =="

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"
}

login() {
  local phone="$1"
  curl -fsS -X POST "$BASE/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"password\":\"$PASSWORD\"}" \
    | json_field token
}

echo "-- gateway healthz"
curl -fsS "$BASE/healthz" | grep -q '"status":"ok"'

echo "-- swagger UI reachable"
curl -fsS -o /dev/null -w "%{http_code}\n" "$BASE/api/docs" | grep -E "^(200|301|302)$"

echo "-- login seeded users"
RIDER_TOKEN="$(login "$RIDEX_SMOKE_RIDER_PHONE")"
DRIVER_TOKEN="$(login "$RIDEX_SMOKE_DRIVER_PHONE")"
ADMIN_TOKEN="$(login "$RIDEX_SMOKE_ADMIN_PHONE")"

echo "-- put seeded driver online with a real location"
curl -fsS -X PATCH "$BASE/api/drivers/$DRIVER_ID/status" \
  -H "authorization: Bearer $DRIVER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"status":"online"}' \
  | grep -q '"status":"online"'

curl -fsS -X POST "$BASE/ingest/v1/locations" \
  -H "authorization: Bearer $DRIVER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"driver_id\":\"$DRIVER_ID\",\"lat\":41.311,\"lon\":69.279}" \
  | grep -q '"ok":true'

echo "-- create a trip"
TRIP_ID=$(curl -fsS -X POST "$BASE/api/trips" \
  -H "authorization: Bearer $RIDER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pickup":{"lat":41.311,"lon":69.279},"dropoff":{"lat":41.330,"lon":69.250}}' \
  | json_field id)
echo "   trip_id=$TRIP_ID"

echo "-- wait for matcher to assign driver"
MATCHED_DRIVER=""
for _ in $(seq 1 20); do
  TRIP_JSON="$(curl -fsS "$BASE/api/trips/$TRIP_ID" -H "authorization: Bearer $RIDER_TOKEN")"
  STATUS="$(printf '%s' "$TRIP_JSON" | json_field status)"
  MATCHED_DRIVER="$(printf '%s' "$TRIP_JSON" | json_field driver_id)"
  if [ "$STATUS" = "matched" ] && [ "$MATCHED_DRIVER" = "$DRIVER_ID" ]; then
    break
  fi
  sleep 1
done
test "$MATCHED_DRIVER" = "$DRIVER_ID"

echo "-- complete matched trip"
curl -fsS -X POST "$BASE/api/trips/$TRIP_ID/start" \
  -H "authorization: Bearer $DRIVER_TOKEN" \
  | grep -q '"status":"in_progress"'
curl -fsS -X POST "$BASE/api/trips/$TRIP_ID/complete" \
  -H "authorization: Bearer $DRIVER_TOKEN" \
  | grep -q '"status":"completed"'

echo "-- admin reports reachable"
curl -fsS "$BASE/api/admin/reports/daily" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  | grep -q '\['

echo
echo "all smoke checks passed."
