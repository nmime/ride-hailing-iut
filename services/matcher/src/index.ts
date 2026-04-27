/**
 * Matcher service. Consumes:
 *   - driver.location.v1   (high-volume location pings)
 *   - trip.events.v1       (rider trip requests)
 *
 * For each `trip.requested`, it queries Redis for the nearest online drivers
 * (Redis GEO, written by the ingestor) and emits `trip.matched` with the
 * chosen driver. The from-scratch consistent-hash ring (R11) tells each
 * replica which subset of *drivers* it owns; drivers not owned by this
 * replica are ignored — the other replica handles them.
 *
 * State per driver lives in-process (recent path, candidate trips).
 * On replica add/remove, only ~1/N drivers re-shard.
 */
import Redis from 'ioredis';
import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

import { ConsistentHashRing } from '@ridex/consistent-hash';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'matcher' });

const SELF_ID = process.env.HOSTNAME!;                    // docker assigns container hostname
const REPLICAS = (process.env.MATCHER_REPLICA_IDS ?? SELF_ID).split(',');

const ring = new ConsistentHashRing({
  vnodes: Number(process.env.MATCHER_RING_VNODES ?? 128),
});
REPLICAS.forEach((r) => ring.addNode(r));
log.info({ replicas: ring.nodes, self: SELF_ID }, 'consistent-hash ring built');

const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
const pg    = new Pool({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: `matcher-${SELF_ID}`,
  brokers: (process.env.KAFKA_BROKERS ?? 'redpanda:9092').split(','),
});

const producer = kafka.producer();
const tripsConsumer    = kafka.consumer({ groupId: 'matcher-trips' });
const locationConsumer = kafka.consumer({ groupId: `matcher-loc-${SELF_ID}` });

const TOPIC_LOC   = process.env.TOPIC_DRIVER_LOCATION ?? 'driver.location.v1';
const TOPIC_TRIPS = process.env.TOPIC_TRIP_EVENTS     ?? 'trip.events.v1';

async function handleTripEvent({ message }: EachMessagePayload) {
  if (!message.value) return;
  const evt = JSON.parse(message.value.toString());
  if (evt.type !== 'trip.requested') return;

  const { trip_id, dto } = evt;
  // Find the 3 nearest online drivers in 2 km
  const nearby = await redis.geosearch(
    'driver:online', 'FROMLONLAT', dto.pickup.lon, dto.pickup.lat,
    'BYRADIUS', 2000, 'm', 'COUNT', 3, 'ASC',
  );
  if (nearby.length === 0) {
    log.warn({ trip_id }, 'no driver in radius');
    return;
  }
  const driverId = nearby[0] as string;

  // Persist match to Postgres + emit event
  await pg.query(
    `UPDATE trips
        SET driver_id = $2, status = 'matched', matched_at = now()
      WHERE id = $1 AND status = 'requested'`,
    [trip_id, driverId],
  );
  await producer.send({
    topic: TOPIC_TRIPS,
    messages: [{ key: trip_id, value: JSON.stringify({ type: 'trip.matched', trip_id, driver_id: driverId }) }],
  });
  log.info({ trip_id, driverId }, 'trip.matched');
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
  // The ingestor already updates the Redis GEO set; we keep per-driver
  // in-process state for matching heuristics (recent path, last-trip).
  // ... team will extend.
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
