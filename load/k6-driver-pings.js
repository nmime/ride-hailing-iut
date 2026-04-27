// k6 load test simulating 1 000 concurrent drivers each pinging every 5s.
// This is the workload the ingestor + Redpanda + matcher + Redis chain must
// sustain in production.
//
// Run:
//   k6 run --vus 1000 --duration 60s --env BASE=http://localhost k6-driver-pings.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1000,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed:   ['rate<0.005'],
  },
};

const BASE = __ENV.BASE ?? 'http://localhost';
const driverIds = new Array(1000).fill(0).map((_, i) =>
  `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
);

export default function () {
  const id  = driverIds[__VU % driverIds.length];
  const lat = 41.28 + Math.random() * 0.10;
  const lon = 69.18 + Math.random() * 0.20;

  const res = http.post(
    `${BASE}/ingest/v1/locations`,
    JSON.stringify({ driver_id: id, lat, lon }),
    { headers: { 'content-type': 'application/json' }, tags: { endpoint: 'POST_/ingest' } },
  );
  check(res, { '202 accepted': (r) => r.status === 202 });
  sleep(5);
}
