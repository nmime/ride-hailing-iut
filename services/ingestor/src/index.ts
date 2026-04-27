/**
 * Location-ping ingestor. Drivers POST a small JSON pin here every ~5 s.
 * The ingestor:
 *  1. Validates the payload.
 *  2. Updates the Redis GEO set `driver:online` with the new (lon, lat).
 *  3. Publishes the ping to Redpanda topic `driver.location.v1`.
 *
 * Why a separate service rather than a controller in the API?
 *  - This path is bursty and write-heavy; we want it isolated so CPU
 *    spikes from cold-start matchers don't slow down rider HTTP traffic.
 *  - It needs a Kafka producer but does not need our auth / Postgres pool.
 *
 * The ingestor is intentionally tiny (~80 lines). Don't be tempted to
 * grow it — anything stateful belongs in the matcher.
 */
import Fastify from 'fastify';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'ingestor' });

const app = Fastify({ logger: false });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
const kafka = new Kafka({
  clientId: 'ingestor',
  brokers: (process.env.KAFKA_BROKERS ?? 'redpanda:9092').split(','),
});
const producer = kafka.producer({ allowAutoTopicCreation: true });

const TOPIC = process.env.TOPIC_DRIVER_LOCATION ?? 'driver.location.v1';

app.get('/healthz', async () => ({ status: 'ok' }));

app.post('/v1/locations', async (req, reply) => {
  const body = req.body as {
    driver_id: string;
    lat: number; lon: number;
    heading_deg?: number; speed_mps?: number;
    ts?: number;
  };

  if (!body || typeof body.lat !== 'number' || typeof body.lon !== 'number'
      || typeof body.driver_id !== 'string') {
    return reply.code(400).send({ error: 'invalid payload' });
  }

  const now = body.ts ?? Date.now();

  // Update the Redis GEO index. `geoadd` returns 0 when the key already
  // exists for this member (the position is updated in place).
  await redis.geoadd('driver:online', body.lon, body.lat, body.driver_id);

  // Publish to Kafka. Key by driver_id so consumers in the same group
  // see a stable per-driver partition.
  await producer.send({
    topic: TOPIC,
    messages: [{
      key: body.driver_id,
      value: JSON.stringify({ ...body, ts: now }),
    }],
  });

  return reply.code(202).send({ ok: true, ts: now });
});

async function start() {
  await producer.connect();
  const port = Number(process.env.INGESTOR_PORT ?? 3200);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'ingestor listening');
}

start().catch((e) => { log.error(e); process.exit(1); });

['SIGINT','SIGTERM'].forEach((s) => process.on(s, async () => {
  await Promise.allSettled([producer.disconnect(), redis.quit(), app.close()]);
  process.exit(0);
}));
