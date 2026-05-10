/**
 * Nightly batch worker (R10 — batch pipeline).
 *
 * One node-cron job per workflow:
 *   - 03:00 daily: REFRESH MATERIALIZED VIEW mv_driver_daily, mv_hourly_demand
 *   - 03:05 daily: write CSV export of yesterday's trips to /var/exports
 *   - hourly:      cheap mat-view refresh of mv_hourly_demand only
 *
 * Each run emits a Prometheus-compatible counter line; the OTel collector
 * scrapes /metrics and forwards it. We do NOT implement a workflow engine
 * here — node-cron is enough for our scale and easy to defend in viva.
 */
import { schedule } from 'node-cron';
import { Pool } from 'pg';
import pino from 'pino';
import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';
import { join } from 'path';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function requiredNumberEnv(name: string) {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'cron' });
const pg  = new Pool({ connectionString: requiredEnv('DATABASE_URL') });

const EXPORTS_DIR = requiredEnv('EXPORTS_DIR');
mkdirSync(EXPORTS_DIR, { recursive: true });

let runs = 0, failures = 0;

async function refreshDriverDaily() {
  const t0 = Date.now();
  await pg.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_driver_daily');
  log.info({ ms: Date.now() - t0 }, 'refreshed mv_driver_daily');
}

async function refreshHourlyDemand() {
  const t0 = Date.now();
  await pg.query('REFRESH MATERIALIZED VIEW mv_hourly_demand');
  log.info({ ms: Date.now() - t0 }, 'refreshed mv_hourly_demand');
}

async function exportYesterdayCsv() {
  const { rows } = await pg.query(
    `SELECT t.id, t.rider_id, t.driver_id, t.status, t.completed_at,
            f.distance_km, f.duration_min, f.surge_multiplier, f.total
       FROM trips t LEFT JOIN fare_records f ON f.trip_id = t.id
      WHERE t.completed_at >= date_trunc('day', now() - interval '1 day')
        AND t.completed_at <  date_trunc('day', now())`,
  );
  const header = 'id,rider_id,driver_id,status,completed_at,distance_km,duration_min,surge_multiplier,total\n';
  const body = rows.map((r) => [
    r.id, r.rider_id, r.driver_id, r.status, r.completed_at?.toISOString(),
    r.distance_km, r.duration_min, r.surge_multiplier, r.total,
  ].join(',')).join('\n');
  const fname = join(EXPORTS_DIR, `trips-${new Date().toISOString().slice(0,10)}.csv`);
  writeFileSync(fname, header + body);
  log.info({ rows: rows.length, fname }, 'wrote yesterday CSV');
}

async function safe(name: string, fn: () => Promise<void>) {
  runs += 1;
  try { await fn(); }
  catch (e) {
    failures += 1;
    log.error({ name, err: String(e) }, 'cron job failed');
  }
}

// 03:00 daily — full nightly aggregates
schedule(requiredEnv('CRON_NIGHTLY'), () => {
  safe('refresh_driver_daily',   refreshDriverDaily);
  safe('refresh_hourly_demand',  refreshHourlyDemand);
  safe('export_yesterday_csv',   exportYesterdayCsv);
}, { timezone: 'Asia/Tashkent' });

// :05 every hour — keep mv_hourly_demand fresh for surge / capacity views
schedule(requiredEnv('CRON_HOURLY'), () => {
  safe('refresh_hourly_demand_hourly', refreshHourlyDemand);
});

log.info({ tz: 'Asia/Tashkent' }, 'cron scheduler started');

// Tiny /metrics so Prometheus can scrape run/failure counters.
import { createServer } from 'http';
createServer((_, res) => {
  res.setHeader('content-type', 'text/plain; version=0.0.4');
  res.end(
    `# HELP ridex_batch_runs_total Number of batch jobs attempted\n` +
    `# TYPE ridex_batch_runs_total counter\n` +
    `ridex_batch_runs_total ${runs}\n` +
    `# HELP ridex_batch_failures_total Number of batch jobs that errored\n` +
    `# TYPE ridex_batch_failures_total counter\n` +
    `ridex_batch_failures_total ${failures}\n`,
  );
}).listen(requiredNumberEnv('CRON_METRICS_PORT'));
