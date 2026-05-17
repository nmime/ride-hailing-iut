/**
 * Socket.IO gateway. Forwards trip and driver-location events from Redpanda to
 * authorized WebSocket rooms.
 */
import { createServer } from 'http';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';
import { Server } from 'socket.io';

import { requiredEnv, requiredNumberEnv } from './env';
import { createFanout } from './fanout';
import { registerSocketHandlers } from './socket';

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'ws-gateway' });

async function start() {
  const tripTopic = requiredEnv('TOPIC_TRIP_EVENTS');
  const locationTopic = requiredEnv('TOPIC_DRIVER_LOCATION');
  const httpServer = createServer((_, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  const io = new Server(httpServer, {
    cors: {
      origin: requiredEnv('WS_CORS_ORIGINS')
        .split(',')
        .map((origin) => origin.trim()),
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  const redis = new Redis(requiredEnv('REDIS_URL'));
  const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
  const kafka = new Kafka({
    clientId: 'ws-gateway',
    brokers: requiredEnv('KAFKA_BROKERS').split(','),
  });
  const consumer = kafka.consumer({ groupId: `ws-${requiredEnv('HOSTNAME')}` });

  registerSocketHandlers(io, pg, requiredEnv('JWT_SECRET', { minLength: 32, secret: true }), log);

  await consumer.connect();
  await consumer.subscribe({ topic: tripTopic });
  await consumer.subscribe({ topic: locationTopic });
  await consumer.run({
    eachMessage: createFanout(io, { location: locationTopic, trip: tripTopic }),
  });

  const port = requiredNumberEnv('WS_PORT');
  httpServer.listen(port, () => log.info({ port }, 'ws-gateway listening'));

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await Promise.allSettled([consumer.disconnect(), redis.quit(), pg.end()]);
      httpServer.close(() => process.exit(0));
    });
  }
}

start().catch((error) => {
  log.error(error);
  process.exit(1);
});
