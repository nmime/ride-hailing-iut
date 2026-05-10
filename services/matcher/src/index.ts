/**
 * Matcher service. Consumes:
 *   - driver.location.v1   (high-volume location pings)
 *   - trip.events.v1       (rider trip requests)
 *
 * For each `trip.requested`, it queries Redis for nearest online drivers,
 * verifies the candidate against Postgres, reserves driver + vehicle in one
 * transaction, and emits `trip.matched`. The from-scratch consistent-hash
 * ring (R11) tells each replica which subset of driver-location streams it
 * owns; drivers not owned by this replica are ignored.
 *
 * State per driver lives in-process (recent path, candidate trips).
 * On replica add/remove, only ~1/N drivers re-shard.
 */
import Redis from 'ioredis';
import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

import { ConsistentHashRing } from '@ridex/consistent-hash';

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

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'matcher' });

const SELF_ID = requiredEnv('HOSTNAME');
const REPLICAS = requiredEnv('MATCHER_REPLICA_IDS').split(',');

const ring = new ConsistentHashRing({
  vnodes: requiredNumberEnv('MATCHER_RING_VNODES'),
});
REPLICAS.forEach((r) => ring.addNode(r));
log.info({ replicas: ring.nodes, self: SELF_ID }, 'consistent-hash ring built');

const redis = new Redis(requiredEnv('REDIS_URL'));
const pg    = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
const kafka = new Kafka({
  clientId: `matcher-${SELF_ID}`,
  brokers: requiredEnv('KAFKA_BROKERS').split(','),
});

const producer = kafka.producer();
const tripsConsumer    = kafka.consumer({ groupId: 'matcher-trips' });
const locationConsumer = kafka.consumer({ groupId: `matcher-loc-${SELF_ID}` });

const TOPIC_LOC   = requiredEnv('TOPIC_DRIVER_LOCATION');
const TOPIC_TRIPS = requiredEnv('TOPIC_TRIP_EVENTS');

interface TripRequestedEvent {
  type: string;
  trip_id: string;
  dto?: { pickup?: { lon: number; lat: number } };
}

interface MatchResult {
  tripId: string;
  driverId: string;
  vehicleId: string;
  eventId: string;
}

async function handleTripEvent({ message }: EachMessagePayload) {
  if (!message.value) return;
  const evt = JSON.parse(message.value.toString()) as TripRequestedEvent;
  if (evt.type !== 'trip.requested') return;

  const { trip_id } = evt;
  const pickup = evt.dto?.pickup ?? await loadTripPickup(trip_id);
  if (!pickup || !Number.isFinite(pickup.lon) || !Number.isFinite(pickup.lat)) {
    log.warn({ trip_id }, 'trip.requested missing pickup coordinates');
    return;
  }

  // Find the nearest online candidates in 2 km. Redis is the hot availability
  // index, while Postgres remains the authority checked below.
  const nearby = await redis.geosearch(
    'driver:online', 'FROMLONLAT', pickup.lon, pickup.lat,
    'BYRADIUS', 2000, 'm', 'COUNT', 10, 'ASC',
  ) as string[];
  if (nearby.length === 0) {
    log.warn({ trip_id }, 'no driver in radius');
    return;
  }

  for (const driverId of nearby) {
    const match = await assignDriver(trip_id, driverId);
    if (!match) continue;
    await publishTripEvent(match.eventId, {
      type: 'trip.matched',
      trip_id,
      driver_id: match.driverId,
      vehicle_id: match.vehicleId,
    });
    log.info({ trip_id, driverId: match.driverId, vehicleId: match.vehicleId }, 'trip.matched');
    return;
  }

  log.warn({ trip_id, candidates: nearby.length }, 'no available driver after authoritative checks');
}

async function loadTripPickup(tripId: string): Promise<{ lon: number; lat: number } | null> {
  const { rows } = await pg.query<{ lon: number; lat: number }>(
    `SELECT ST_X(pickup::geometry) AS lon, ST_Y(pickup::geometry) AS lat
       FROM trips
      WHERE id = $1`,
    [tripId],
  );
  return rows[0] ?? null;
}

async function assignDriver(tripId: string, driverId: string): Promise<MatchResult | null> {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');

    const driver = await client.query<{ vehicle_id: string }>(
      `SELECT v.id AS vehicle_id
         FROM drivers d
         JOIN vehicles v ON v.driver_id = d.user_id AND v.is_active = TRUE
        WHERE d.user_id = $1
          AND d.status = 'online'
        LIMIT 1
        FOR UPDATE OF d`,
      [driverId],
    );
    if (!driver.rows[0]) {
      await client.query('ROLLBACK');
      await redis.zrem('driver:online', driverId);
      log.debug({ driverId }, 'removed stale unavailable driver from Redis');
      return null;
    }

    const vehicleId = driver.rows[0].vehicle_id;
    const trip = await client.query<{ id: string }>(
      `UPDATE trips
          SET driver_id = $2,
              vehicle_id = $3,
              status = 'matched',
              matched_at = now()
        WHERE id = $1
          AND status = 'requested'
        RETURNING id`,
      [tripId, driverId, vehicleId],
    );
    if (!trip.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(`UPDATE drivers SET status = 'on_trip' WHERE user_id = $1`, [driverId]);
    const event = await client.query<{ id: string }>(
      `INSERT INTO trip_events (trip_id, event_type, payload)
       VALUES ($1, 'matched', $2::jsonb)
       RETURNING id`,
      [tripId, JSON.stringify({ driver_id: driverId, vehicle_id: vehicleId })],
    );
    await client.query('COMMIT');
    await redis.zrem('driver:online', driverId);
    return { tripId, driverId, vehicleId, eventId: event.rows[0].id };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function publishTripEvent(
  eventId: string,
  payload: Record<string, unknown> & { trip_id: string },
) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `SELECT 1
         FROM trip_events
        WHERE id = $1
          AND published_at IS NULL
        FOR UPDATE SKIP LOCKED`,
      [eventId],
    );
    if (rowCount === 0) {
      await client.query('COMMIT');
      return;
    }

    try {
      await producer.send({
        topic: TOPIC_TRIPS,
        messages: [{ key: payload.trip_id, value: JSON.stringify(payload) }],
      });
      await client.query(
        `UPDATE trip_events
            SET published_at = now(),
                publish_attempts = publish_attempts + 1,
                last_publish_error = NULL
          WHERE id = $1`,
        [eventId],
      );
    } catch (e) {
      await client.query(
        `UPDATE trip_events
            SET publish_attempts = publish_attempts + 1,
                last_publish_error = left($2, 500)
          WHERE id = $1`,
        [eventId, String(e)],
      );
      log.warn({ err: e, eventId }, 'trip matched outbox publish failed');
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw e;
  } finally {
    client.release();
  }
}

async function handleLocation({ message }: EachMessagePayload) {
  if (!message.value || !message.key) return;
  const driverId = message.key.toString();
  // R11 integration point: bail if this replica doesn't own the driver.
  // Kafka partition keying gives a strong steady-state hint, but the ring
  // is the source of truth — and survives replica add/remove with ~1/N
  // rebalance instead of a full Kafka partition reassignment.
  if (ring.getNode(driverId) !== SELF_ID) return;

  const ping = JSON.parse(message.value.toString());
  // The ingestor already updates Postgres and Redis; matcher replicas consume
  // the stream so ownership and lag are visible in logs/metrics.
  log.debug({ driverId, ping }, 'loc');
}

async function main() {
  await producer.connect();
  await tripsConsumer.connect();
  await locationConsumer.connect();
  await tripsConsumer.subscribe({ topic: TOPIC_TRIPS, fromBeginning: false });
  await locationConsumer.subscribe({ topic: TOPIC_LOC, fromBeginning: false });

  await Promise.all([
    tripsConsumer.run({ eachMessage: handleTripEvent }),
    locationConsumer.run({ eachMessage: handleLocation }),
  ]);

  log.info('matcher running');
}

main().catch((e) => { log.error(e); process.exit(1); });

['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, async () => {
    log.info({ sig }, 'shutting down');
    await Promise.allSettled([
      tripsConsumer.disconnect(), locationConsumer.disconnect(),
      producer.disconnect(), redis.quit(), pg.end(),
    ]);
    process.exit(0);
  }),
);
