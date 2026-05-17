/**
 * Surge stream worker. Computes zone multipliers from trip-request demand and
 * online-driver supply, then writes the hot value to Redis and the durable
 * value back to Postgres.
 */
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

import { requiredEnv, requiredNumberEnv } from './env';
import { SurgeEngine } from './surge-engine';

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'surge-worker' });

async function main() {
  const redis = new Redis(requiredEnv('REDIS_URL'));
  const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
  const kafka = new Kafka({
    clientId: 'surge-worker',
    brokers: requiredEnv('KAFKA_BROKERS').split(','),
  });
  const consumer = kafka.consumer({ groupId: 'surge-worker' });
  const engine = new SurgeEngine(pg, redis, log, {
    flushMs: requiredNumberEnv('SURGE_FLUSH_MS'),
    maxMultiplier: requiredNumberEnv('SURGE_M_MAX'),
    thresholdHigh: requiredNumberEnv('SURGE_T_HIGH'),
    thresholdLow: requiredNumberEnv('SURGE_T_LOW'),
    windowMs: requiredNumberEnv('SURGE_WINDOW_MS'),
  });

  await engine.loadZones();
  await consumer.connect();
  await consumer.subscribe({ topic: requiredEnv('TOPIC_TRIP_EVENTS') });
  await consumer.run({ eachMessage: engine.onTripEvent });

  const tickTimer = setInterval(() => {
    engine.tick().catch((error) => log.error(error));
  }, 1_000);
  const flushTimer = setInterval(() => {
    engine.flushToDb().catch((error) => log.error(error));
  }, engine.flushMs);

  log.info('surge-worker running');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      await Promise.allSettled([consumer.disconnect(), redis.quit(), pg.end()]);
      process.exit(0);
    });
  }
}

main().catch((error) => {
  log.error(error);
  process.exit(1);
});
