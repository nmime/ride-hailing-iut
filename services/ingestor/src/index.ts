/**
 * Location-ping ingestor. Drivers POST a small JSON pin here every ~5 s.
 * The ingestor validates the payload, updates the Redis GEO availability set,
 * persists the canonical location in Postgres, and publishes the ping to
 * Redpanda topic `driver.location.v1`.
 */
import Fastify from 'fastify';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

import { requiredEnv, requiredNumberEnv } from './env';
import {
  DriverNotFoundError,
  registerHealthRoute,
  registerLocationRoutes,
} from './location.routes';

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'ingestor' });

async function start() {
  const app = Fastify({ logger: false });
  const redis = new Redis(requiredEnv('REDIS_URL'));
  const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
  const kafka = new Kafka({
    clientId: 'ingestor',
    brokers: requiredEnv('KAFKA_BROKERS').split(','),
  });
  const producer = kafka.producer({ allowAutoTopicCreation: true });

  registerHealthRoute(app);
  registerLocationRoutes(app, {
    jwtSecret: requiredEnv('JWT_SECRET', { minLength: 32, secret: true }),
    log,
    pg,
    producer,
    redis,
    topic: requiredEnv('TOPIC_DRIVER_LOCATION'),
  });

  app.setErrorHandler((error, _, reply) => {
    if (error instanceof DriverNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    log.error(error);
    return reply.code(500).send({ error: 'internal error' });
  });

  await producer.connect();
  const port = requiredNumberEnv('INGESTOR_PORT');
  await app.listen({ port, host: requiredEnv('INGESTOR_HOST') });
  log.info({ port }, 'ingestor listening');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await Promise.allSettled([producer.disconnect(), redis.quit(), pg.end(), app.close()]);
      process.exit(0);
    });
  }
}

start().catch((error) => {
  log.error(error);
  process.exit(1);
});
