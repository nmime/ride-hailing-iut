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

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'surge-worker' });

const T_LOW  = Number(process.env.SURGE_T_LOW  ?? 0.5);
const T_HIGH = Number(process.env.SURGE_T_HIGH ?? 1.5);
const M_MAX  = Number(process.env.SURGE_M_MAX  ?? 3.0);
const WINDOW_MS = Number(process.env.SURGE_WINDOW_MS ?? 60_000);
const FLUSH_MS  = Number(process.env.SURGE_FLUSH_MS  ?? 30_000);

const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
const pg    = new Pool({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'surge-worker',
  brokers: (process.env.KAFKA_BROKERS ?? 'redpanda:9092').split(','),
});
const consumer = kafka.consumer({ groupId: 'surge-worker' });

interface ZoneCounts { requests: number; lastSeenIdx: number[]; multiplier: number; }
const counts = new Map<string, ZoneCounts>();   // zone_id -> rolling counts
const TICK_RING = 60;                             // 1 minute @ 1-second granularity
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
      WHERE ST_Covers(polygon, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)
      LIMIT 1`,
    [lon, lat],
  );
  return rows[0]?.id ?? null;
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
    // approximate online drivers in this zone = count members of GEO set
    // intersecting the zone bounding box. For the demo, we don't compute
    // this exactly — we use total online drivers as a proxy.
    const drivers = await redis.zcard('driver:online') || 1;
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
  await consumer.subscribe({ topic: process.env.TOPIC_TRIP_EVENTS ?? 'trip.events.v1' });
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
