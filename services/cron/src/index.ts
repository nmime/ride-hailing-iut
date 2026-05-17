/**
 * Nightly batch worker. Schedules materialized-view refreshes, trip CSV export,
 * and a small Prometheus-compatible metrics endpoint.
 */
import { mkdirSync } from 'fs';
import { schedule } from 'node-cron';
import { Pool } from 'pg';
import pino from 'pino';

import { requiredEnv, requiredNumberEnv } from './env';
import { createBatchJobs } from './jobs';
import { BatchMetrics, startMetricsServer } from './metrics';

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'cron' });
const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
const exportsDir = requiredEnv('EXPORTS_DIR');

mkdirSync(exportsDir, { recursive: true });

const jobs = createBatchJobs(pg, exportsDir, log);
const metrics = new BatchMetrics();

function safe(name: string, fn: () => Promise<void>) {
  return metrics.safe(name, fn, (error) => {
    log.error({ name, err: String(error) }, 'cron job failed');
  });
}

schedule(
  requiredEnv('CRON_NIGHTLY'),
  () => {
    void safe('refresh_driver_daily', jobs.refreshDriverDaily);
    void safe('refresh_hourly_demand', jobs.refreshHourlyDemand);
    void safe('export_yesterday_csv', jobs.exportYesterdayCsv);
  },
  { timezone: 'Asia/Tashkent' },
);

schedule(requiredEnv('CRON_HOURLY'), () => {
  void safe('refresh_hourly_demand_hourly', jobs.refreshHourlyDemand);
});

const metricsServer = startMetricsServer(requiredNumberEnv('CRON_METRICS_PORT'), metrics);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await pg.end();
    metricsServer.close(() => process.exit(0));
  });
}

log.info({ tz: 'Asia/Tashkent' }, 'cron scheduler started');
