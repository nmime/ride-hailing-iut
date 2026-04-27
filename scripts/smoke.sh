#!/usr/bin/env bash
# Tiny end-to-end smoke test against a running RideX stack.
# Run: bash scripts/smoke.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://localhost}"
echo "== smoke test against $BASE =="

echo "-- gateway healthz"
curl -fsS "$BASE/healthz" | tee /dev/stderr | grep -q '"status":"ok"'

echo "-- swagger UI reachable"
curl -fsS -o /dev/null -w "%{http_code}\n" "$BASE/api/docs" | grep -E "^(200|301|302)$"

echo "-- signup a rider"
TOKEN=$(curl -fsS -X POST "$BASE/api/auth/signup" \
  -H 'content-type: application/json' \
  -d '{"role":"rider","full_name":"Smoke Tester","email":"smoke@ridex.test","phone":"+998900007777","password":"smokesmoke"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

echo "-- create a trip"
TRIP_ID=$(curl -fsS -X POST "$BASE/api/trips" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pickup":{"lat":41.311,"lon":69.279},"dropoff":{"lat":41.330,"lon":69.250}}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "   trip_id=$TRIP_ID"

echo "-- read trip back"
curl -fsS "$BASE/api/trips/$TRIP_ID" -H "authorization: Bearer $TOKEN" | grep -q '"status"'

echo "-- ingestor accepts a location ping"
curl -fsS -X POST "$BASE/ingest/v1/locations" \
  -H 'content-type: application/json' \
  -d '{"driver_id":"00000000-0000-0000-0000-00000000e001","lat":41.311,"lon":69.279}' \
  | grep -q '"ok":true'

echo
echo "all smoke checks passed."
