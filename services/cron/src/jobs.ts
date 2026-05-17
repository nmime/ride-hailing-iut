import { writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import pino from 'pino';

interface ExportRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: string;
  completed_at?: Date;
  distance_km: string | null;
  duration_min: string | null;
  surge_multiplier: string | null;
  total: string | null;
}

export function createBatchJobs(pg: Pool, exportsDir: string, log: pino.Logger) {
  return {
    refreshDriverDaily: async () => {
      const t0 = Date.now();
      await pg.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_driver_daily');
      log.info({ ms: Date.now() - t0 }, 'refreshed mv_driver_daily');
    },

    refreshHourlyDemand: async () => {
      const t0 = Date.now();
      await pg.query('REFRESH MATERIALIZED VIEW mv_hourly_demand');
      log.info({ ms: Date.now() - t0 }, 'refreshed mv_hourly_demand');
    },

    exportYesterdayCsv: async () => {
      const { rows } = await pg.query<ExportRow>(
        `SELECT t.id, t.rider_id, t.driver_id, t.status, t.completed_at,
                f.distance_km, f.duration_min, f.surge_multiplier, f.total
           FROM trips t LEFT JOIN fare_records f ON f.trip_id = t.id
          WHERE t.completed_at >= date_trunc('day', now() - interval '1 day')
            AND t.completed_at <  date_trunc('day', now())`,
      );
      const header =
        'id,rider_id,driver_id,status,completed_at,distance_km,duration_min,surge_multiplier,total\n';
      const body = rows.map(formatCsvRow).join('\n');
      const fname = join(exportsDir, `trips-${new Date().toISOString().slice(0, 10)}.csv`);
      writeFileSync(fname, header + body);
      log.info({ rows: rows.length, fname }, 'wrote yesterday CSV');
    },
  };
}

function formatCsvRow(row: ExportRow) {
  return [
    row.id,
    row.rider_id,
    row.driver_id,
    row.status,
    row.completed_at?.toISOString(),
    row.distance_km,
    row.duration_min,
    row.surge_multiplier,
    row.total,
  ].join(',');
}
