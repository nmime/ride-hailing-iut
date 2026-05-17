/**
 * Matcher service. Consumes driver location and trip events, reserves an
 * available driver/vehicle pair, and publishes `trip.matched`.
 */
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

import { requiredEnv, requiredNumberEnv } from './env';
import { buildReplicaRing, createLocationHandler } from './location-consumer';
import { createTripEventHandler } from './trip-consumer';

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'matcher' });

async function main() {
  const selfId = requiredEnv('HOSTNAME');
  const replicas = requiredEnv('MATCHER_REPLICA_IDS').split(',');
  const ring = buildReplicaRing(replicas, requiredNumberEnv('MATCHER_RING_VNODES'), log);

  const redis = new Redis(requiredEnv('REDIS_URL'));
  const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
  const kafka = new Kafka({
    clientId: `matcher-${selfId}`,
    brokers: requiredEnv('KAFKA_BROKERS').split(','),
  });

  const producer = kafka.producer();
  const tripsConsumer = kafka.consumer({ groupId: 'matcher-trips' });
  const locationConsumer = kafka.consumer({ groupId: `matcher-loc-${selfId}` });
  const locationTopic = requiredEnv('TOPIC_DRIVER_LOCATION');
  const tripTopic = requiredEnv('TOPIC_TRIP_EVENTS');

  await producer.connect();
  await tripsConsumer.connect();
  await locationConsumer.connect();
  await tripsConsumer.subscribe({ topic: tripTopic, fromBeginning: false });
  await locationConsumer.subscribe({ topic: locationTopic, fromBeginning: false });

  await Promise.all([
    tripsConsumer.run({
      eachMessage: createTripEventHandler({ log, pg, producer, redis, tripTopic }),
    }),
    locationConsumer.run({ eachMessage: createLocationHandler(ring, selfId, log) }),
  ]);

  log.info({ selfId }, 'matcher running');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      log.info({ signal }, 'shutting down');
      await Promise.allSettled([
        tripsConsumer.disconnect(),
        locationConsumer.disconnect(),
        producer.disconnect(),
        redis.quit(),
        pg.end(),
      ]);
      process.exit(0);
    });
  }
}

main().catch((error) => {
  log.error(error);
  process.exit(1);
});
