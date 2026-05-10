/**
 * Surge stream worker (R10 — stream pipeline).
 *
 * For every minute and for every surge zone, compute:
 *
 *   ratio = trips_requested_in_zone / online_drivers_in_zone
 *
 * If ratio > T_HIGH the zone's multiplier rises (capped at MAX); if
 * ratio < T_LOW it decays back toward 1.0. The new multiplier lands in
 *
 *   - Redis hash `surge:zone:<id>` { multiplier, updated_at }   — hot path
 *   - Postgres `surge_zones.base_multiplier`                     — cold/audit
 *
 * The API reads from Redis on every fare quote, so this is the read-side
 * cache for one of our hottest paths (R6 measurement).
 *
 * The implementation here is small enough to fit in your head; it leans
 * on PostGIS for "which zone contains this point" rather than re-implementing
 * point-in-polygon — the team can swap that for a from-scratch H3 lookup
 * if they want a second from-scratch component for extra credit.
 */
import Redis from 'ioredis';
import { Kafka, EachMessagePayload } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

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

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'surge-worker' });

const T_LOW  = requiredNumberEnv('SURGE_T_LOW');
const T_HIGH = requiredNumberEnv('SURGE_T_HIGH');
const M_MAX  = requiredNumberEnv('SURGE_M_MAX');
const WINDOW_MS = requiredNumberEnv('SURGE_WINDOW_MS');
const FLUSH_MS  = requiredNumberEnv('SURGE_FLUSH_MS');

const redis = new Redis(requiredEnv('REDIS_URL'));
const pg    = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
const kafka = new Kafka({
  clientId: 'surge-worker',
  brokers: requiredEnv('KAFKA_BROKERS').split(','),
});
const consumer = kafka.consumer({ groupId: 'surge-worker' });

interface ZoneCounts { requests: number; lastSeenIdx: number[]; multiplier: number; }
const counts = new Map<string, ZoneCounts>();   // zone_id -> rolling counts
const TICK_RING = Math.max(1, Math.round(WINDOW_MS / 1000));
let tickIdx = 0;

async function loadZones() {
  const { rows } = await pg.query<{ id: string; base_multiplier: string }>(
    `SELECT id, base_multiplier FROM surge_zones`,
  );
  rows.forEach((r) => counts.set(r.id, {
    requests: 0,
    lastSeenIdx: new Array(TICK_RING).fill(0),
    multiplier: Number(r.base_multiplier),
  }));
  log.info({ zones: counts.size }, 'loaded surge zones');
}

async function whichZone(lon: number, lat: number): Promise<string | null> {
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM surge_zones
      WHERE ST_Covers(polygon::geometry, ST_SetSRID(ST_MakePoint($1,$2),4326))
      LIMIT 1`,
    [lon, lat],
  );
  return rows[0]?.id ?? null;
}

async function onlineDriversInZone(zoneId: string): Promise<number> {
  const { rows } = await pg.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM driver_locations dl
       JOIN drivers d ON d.user_id = dl.driver_id
       JOIN surge_zones z ON z.id = $1
      WHERE d.status = 'online'
        AND ST_Covers(z.polygon::geometry, dl.location::geometry)`,
    [zoneId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function onTripEvent({ message }: EachMessagePayload) {
  if (!message.value) return;
  const evt = JSON.parse(message.value.toString());
  if (evt.type !== 'trip.requested' || !evt.dto?.pickup) return;
  const zoneId = await whichZone(evt.dto.pickup.lon, evt.dto.pickup.lat);
  if (!zoneId) return;
  const z = counts.get(zoneId); if (!z) return;
  z.requests += 1;
  z.lastSeenIdx[tickIdx] += 1;
}

async function tick() {
  tickIdx = (tickIdx + 1) % TICK_RING;
  for (const [zoneId, z] of counts) {
    // requests in last minute = sum over the ring
    const requests = z.lastSeenIdx.reduce((a, b) => a + b, 0);
    const drivers = await onlineDriversInZone(zoneId) || 1;
    const ratio = requests / drivers;

    let m = z.multiplier;
    if (ratio > T_HIGH)      m = Math.min(M_MAX, m * 1.10);   // raise 10%
    else if (ratio < T_LOW)  m = Math.max(1.00,  m * 0.97);   // decay 3%
    z.multiplier = Math.round(m * 100) / 100;

    await redis.hset(`surge:zone:${zoneId}`, {
      multiplier: z.multiplier, updated_at: Date.now(),
    });
    // shed the next slot so this minute's window is fresh
    z.lastSeenIdx[(tickIdx + 1) % TICK_RING] = 0;
  }
}

async function flushToDb() {
  const client = await pg.connect();
  try {
    for (const [zoneId, z] of counts) {
      await client.query(
        `UPDATE surge_zones SET base_multiplier = $2 WHERE id = $1`,
        [zoneId, z.multiplier],
      );
    }
  } finally { client.release(); }
  log.debug('flushed surge multipliers to postgres');
}

async function main() {
  await loadZones();
  await consumer.connect();
  await consumer.subscribe({ topic: requiredEnv('TOPIC_TRIP_EVENTS') });
  consumer.run({ eachMessage: onTripEvent });

  setInterval(() => { tick().catch((e) => log.error(e)); }, 1_000);
  setInterval(() => { flushToDb().catch((e) => log.error(e)); }, FLUSH_MS);

  log.info({ T_LOW, T_HIGH, M_MAX, WINDOW_MS }, 'surge-worker running');
}

main().catch((e) => { log.error(e); process.exit(1); });

['SIGINT','SIGTERM'].forEach((s) => process.on(s, async () => {
  await Promise.allSettled([consumer.disconnect(), redis.quit(), pg.end()]);
  process.exit(0);
}));
