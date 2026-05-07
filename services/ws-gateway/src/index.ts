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
import { createHmac, timingSafeEqual } from 'crypto';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { Kafka, EachMessagePayload } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

function requiredEnv(name: string, options: { minLength?: number; secret?: boolean } = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  if (options.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters long`);
  }
  if (options.secret && ['change_me_to_a_long_random_string', 'ChangeMe123!'].includes(value)) {
    throw new Error(`${name} must not use a known placeholder value`);
  }
  return value;
}

function requiredNumberEnv(name: string) {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'ws-gateway' });
const tripTopic = requiredEnv('TOPIC_TRIP_EVENTS');
const locationTopic = requiredEnv('TOPIC_DRIVER_LOCATION');

const httpServer = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
const io = new Server(httpServer, {
  cors: { origin: requiredEnv('WS_CORS_ORIGINS').split(',').map((origin) => origin.trim()) },
  path: '/socket.io',                      // gateway routes /ws/ -> here
  transports: ['websocket', 'polling'],
});

const redis = new Redis(requiredEnv('REDIS_URL'));
const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
const kafka = new Kafka({
  clientId: 'ws-gateway',
  brokers: requiredEnv('KAFKA_BROKERS').split(','),
});
const consumer = kafka.consumer({ groupId: `ws-${requiredEnv('HOSTNAME')}` });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_SECRET = requiredEnv('JWT_SECRET', { minLength: 32, secret: true });

interface JwtPayload {
  sub: string;
  role: 'rider' | 'driver' | 'admin';
  exp?: number;
}

declare module 'socket.io' {
  interface Socket {
    user?: JwtPayload;
  }
}

io.use((sock, next) => {
  const authToken = sock.handshake.auth?.token;
  const header = sock.handshake.headers.authorization;
  const token = typeof authToken === 'string'
    ? authToken
    : typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : null;
  if (!token) return next(new Error('missing bearer token'));
  try {
    sock.user = verifyJwt(token);
    return next();
  } catch {
    return next(new Error('invalid token'));
  }
});

io.on('connection', (sock) => {
  log.info({ id: sock.id }, 'ws connected');

  // Rider subscribes to live updates for a trip.
  sock.on('trip:subscribe', async (tripId: string) => {
    if (!UUID_RE.test(tripId)) {
      sock.emit('trip:error', { code: 'bad_trip_id' });
      return;
    }
    if (!(await canSubscribeToTrip(sock.user!, tripId))) {
      sock.emit('trip:error', { code: 'forbidden' });
      return;
    }
    await sock.join(`trip:${tripId}`);
    log.debug({ id: sock.id, tripId, user: sock.user!.sub }, 'joined trip room');
  });

  // Rider can also subscribe to a driver's location updates while in trip.
  sock.on('driver:subscribe', async (driverId: string) => {
    if (!UUID_RE.test(driverId)) {
      sock.emit('driver:error', { code: 'bad_driver_id' });
      return;
    }
    if (!(await canSubscribeToDriver(sock.user!, driverId))) {
      sock.emit('driver:error', { code: 'forbidden' });
      return;
    }
    await sock.join(`driver:${driverId}`);
  });

  sock.on('disconnect', () => log.info({ id: sock.id }, 'ws disconnected'));
});

async function fanout({ topic, message }: EachMessagePayload) {
  if (!message.value) return;
  const evt = JSON.parse(message.value.toString());

  if (topic === tripTopic) {
    if (evt.trip_id) io.to(`trip:${evt.trip_id}`).emit('trip:event', evt);
  } else if (topic === locationTopic) {
    if (evt.driver_id) io.to(`driver:${evt.driver_id}`).emit('driver:location', evt);
  }
}

async function canSubscribeToTrip(user: JwtPayload, tripId: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  const { rows } = await pg.query<{ rider_id: string; driver_id: string | null }>(
    `SELECT rider_id, driver_id FROM trips WHERE id = $1`,
    [tripId],
  );
  const trip = rows[0];
  if (!trip) return false;
  return trip.rider_id === user.sub || trip.driver_id === user.sub;
}

async function canSubscribeToDriver(user: JwtPayload, driverId: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role === 'driver') return user.sub === driverId;
  const { rowCount } = await pg.query(
    `SELECT 1
       FROM trips
      WHERE rider_id = $1
        AND driver_id = $2
        AND status IN ('matched', 'in_progress')
      LIMIT 1`,
    [user.sub, driverId],
  );
  return (rowCount ?? 0) > 0;
}

function verifyJwt(token: string): JwtPayload {
  const [rawHeader, rawPayload, rawSignature] = token.split('.');
  if (!rawHeader || !rawPayload || !rawSignature) throw new Error('malformed jwt');
  const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8')) as { alg?: string };
  if (header.alg !== 'HS256') throw new Error('unsupported jwt algorithm');

  const expected = createHmac('sha256', JWT_SECRET!)
    .update(`${rawHeader}.${rawPayload}`)
    .digest('base64url');
  const a = Buffer.from(rawSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad signature');

  const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8')) as JwtPayload;
  if (!payload.sub || !payload.role) throw new Error('missing claims');
  if (payload.exp && payload.exp * 1000 <= Date.now()) throw new Error('jwt expired');
  return payload;
}

async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: tripTopic });
  await consumer.subscribe({ topic: locationTopic });
  await consumer.run({ eachMessage: fanout });

  const port = requiredNumberEnv('WS_PORT');
  httpServer.listen(port, () => log.info({ port }, 'ws-gateway listening'));
}

start().catch((e) => { log.error(e); process.exit(1); });

['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, async () => {
    await Promise.allSettled([consumer.disconnect(), redis.quit(), pg.end()]);
    httpServer.close(() => process.exit(0));
  }),
);
