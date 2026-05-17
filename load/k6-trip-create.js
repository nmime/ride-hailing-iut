// k6 load test for POST /api/trips
//
// Run:
//   docker run --rm -i --network=host grafana/k6 run --env BASE=http://localhost --env TOKEN=<jwt> - < k6-trip-create.js
//
// Or after `pnpm install -g k6`:
//   k6 run --env BASE=http://localhost --env TOKEN=<jwt> k6-trip-create.js
//
// Use this for the R6 before/after comparison: capture p95 with the Redis
// surge cache enabled, then disable it (point the API to Postgres for
// every fare quote) and re-run. Paste both screenshots into the report.

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Ramp from 0 to 200 RPS over 30s, hold for 1m, ramp down.
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // R-NFR latency target
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE ?? 'http://localhost';
const TOKEN = __ENV.TOKEN ?? '';

export default function () {
  // Tashkent bbox jitter
  const lat = 41.3 + Math.random() * 0.06;
  const lon = 69.22 + Math.random() * 0.1;

  const res = http.post(
    `${BASE}/api/trips`,
    JSON.stringify({
      pickup: { lat, lon },
      dropoff: { lat: lat + 0.005, lon: lon + 0.005 },
    }),
    {
      headers: {
        'content-type': 'application/json',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      tags: { endpoint: 'POST_/api/trips' },
    },
  );
  check(res, {
    '201 created': (r) => r.status === 201,
  });
  sleep(0.05);
}
