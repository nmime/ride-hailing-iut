/**
 * Socket.IO gateway. Two-way:
 *  - Server -> client: forwards trip.* and driver.location.* events
 *    from Redpanda to interested rooms (`trip:<id>`, `driver:<id>`).
 *  - Client -> server: drivers' location pings can also flow over WS for
 *    low-latency demos; today the ingestor is the canonical driver-side
 *    HTTP path.
 *
 * R7 (non-REST API style): WebSockets. Justification — the rider needs the
 * driver's pin to glide on the map at ~5 Hz and the trip's status changes
 * to land instantly. Polling would either be wasteful (every 200 ms) or
 * laggy (every 5 s); WebSocket is the natural fit.
 */
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { Kafka, EachMessagePayload } from 'kafkajs';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'ws-gateway' });

const httpServer = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
const io = new Server(httpServer, {
  cors: { origin: '*' },                  // gateway lives behind nginx anyway
  path: '/socket.io',                      // gateway routes /ws/ -> here
  transports: ['websocket', 'polling'],
});

const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
const kafka = new Kafka({
  clientId: 'ws-gateway',
  brokers: (process.env.KAFKA_BROKERS ?? 'redpanda:9092').split(','),
});
const consumer = kafka.consumer({ groupId: `ws-${process.env.HOSTNAME ?? 'one'}` });

io.on('connection', (sock) => {
  log.info({ id: sock.id }, 'ws connected');

  // Rider subscribes to live updates for a trip.
  sock.on('trip:subscribe', (tripId: string) => {
    sock.join(`trip:${tripId}`);
    log.debug({ id: sock.id, tripId }, 'joined trip room');
  });

  // Rider can also subscribe to a driver's location updates while in trip.
  sock.on('driver:subscribe', (driverId: string) => {
    sock.join(`driver:${driverId}`);
  });

  sock.on('disconnect', () => log.info({ id: sock.id }, 'ws disconnected'));
});

async function fanout({ topic, message }: EachMessagePayload) {
  if (!message.value) return;
  const evt = JSON.parse(message.value.toString());

  if (topic === (process.env.TOPIC_TRIP_EVENTS ?? 'trip.events.v1')) {
    if (evt.trip_id) io.to(`trip:${evt.trip_id}`).emit('trip:event', evt);
  } else if (topic === (process.env.TOPIC_DRIVER_LOCATION ?? 'driver.location.v1')) {
    if (evt.driver_id) io.to(`driver:${evt.driver_id}`).emit('driver:location', evt);
  }
}

async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.TOPIC_TRIP_EVENTS ?? 'trip.events.v1' });
  await consumer.subscribe({ topic: process.env.TOPIC_DRIVER_LOCATION ?? 'driver.location.v1' });
  await consumer.run({ eachMessage: fanout });

  const port = Number(process.env.WS_PORT ?? 3100);
  httpServer.listen(port, () => log.info({ port }, 'ws-gateway listening'));
}

start().catch((e) => { log.error(e); process.exit(1); });

['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, async () => {
    await Promise.allSettled([consumer.disconnect(), redis.quit()]);
    httpServer.close(() => process.exit(0));
  }),
);
