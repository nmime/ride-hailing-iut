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
import { createHmac, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
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

const log = pino({ level: requiredEnv('LOG_LEVEL'), name: 'ingestor' });

const app = Fastify({ logger: false });
const redis = new Redis(requiredEnv('REDIS_URL'));
const pg = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
const kafka = new Kafka({
  clientId: 'ingestor',
  brokers: requiredEnv('KAFKA_BROKERS').split(','),
});
const producer = kafka.producer({ allowAutoTopicCreation: true });

const TOPIC = requiredEnv('TOPIC_DRIVER_LOCATION');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_SECRET = requiredEnv('JWT_SECRET', { minLength: 32, secret: true });

interface JwtPayload {
  sub: string;
  role: 'rider' | 'driver' | 'admin';
  exp?: number;
}

interface LocationBody {
  driver_id: string;
  lat: number;
  lon: number;
  heading_deg?: number;
  speed_mps?: number;
  ts?: number;
}

app.get('/healthz', async () => ({ status: 'ok' }));

app.post('/v1/locations', async (req, reply) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'missing bearer token' });

  let user: JwtPayload;
  try {
    user = verifyJwt(token);
  } catch {
    return reply.code(401).send({ error: 'invalid token' });
  }
  if (user.role !== 'driver') {
    return reply.code(403).send({ error: 'driver role required' });
  }

  const body = req.body as Partial<LocationBody>;

  if (!body || typeof body.driver_id !== 'string' || !UUID_RE.test(body.driver_id)
      || typeof body.lat !== 'number' || body.lat < -90 || body.lat > 90
      || typeof body.lon !== 'number' || body.lon < -180 || body.lon > 180
      || (body.heading_deg !== undefined && (typeof body.heading_deg !== 'number' || body.heading_deg < 0 || body.heading_deg > 360))
      || (body.speed_mps !== undefined && (typeof body.speed_mps !== 'number' || body.speed_mps < 0))) {
    return reply.code(400).send({ error: 'invalid payload' });
  }
  if (user.sub !== body.driver_id) {
    return reply.code(403).send({ error: 'drivers can only publish their own location' });
  }

  const ts = body.ts ?? Date.now();
  if (!Number.isFinite(ts)) return reply.code(400).send({ error: 'invalid timestamp' });
  const observedAt = new Date(ts);

  let indexAsOnline = false;
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const driver = await client.query<{ status: string; has_active_trip: boolean }>(
      `SELECT d.status::text AS status,
              EXISTS (
                SELECT 1 FROM trips t
                 WHERE t.driver_id = d.user_id
                   AND t.status IN ('matched', 'in_progress')
              ) AS has_active_trip
         FROM drivers d
        WHERE d.user_id = $1
          AND d.status <> 'suspended'
        FOR UPDATE`,
      [body.driver_id],
    );
    if (driver.rowCount === 0) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'driver not found' });
    }

    indexAsOnline = driver.rows[0].status !== 'on_trip' && !driver.rows[0].has_active_trip;
    if (indexAsOnline) {
      await client.query(`UPDATE drivers SET status = 'online' WHERE user_id = $1`, [body.driver_id]);
    }

    await client.query(
      `INSERT INTO driver_locations (driver_id, location, heading_deg, speed_mps, updated_at)
       VALUES (
         $1,
         ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,
         $4,
         $5,
         $6
       )
       ON CONFLICT (driver_id) DO UPDATE
          SET location = EXCLUDED.location,
              heading_deg = EXCLUDED.heading_deg,
              speed_mps = EXCLUDED.speed_mps,
              updated_at = EXCLUDED.updated_at`,
      [
        body.driver_id,
        body.lon,
        body.lat,
        body.heading_deg ?? null,
        body.speed_mps ?? null,
        observedAt,
      ],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Keep accepting/storing pings from busy drivers, but never leave them in
  // the matchable Redis GEO set while they are on an active trip.
  if (indexAsOnline) {
    await redis.geoadd('driver:online', body.lon, body.lat, body.driver_id);
  } else {
    await redis.zrem('driver:online', body.driver_id);
  }

  // Publish to Kafka. Key by driver_id so consumers in the same group
  // see a stable per-driver partition.
  await producer.send({
    topic: TOPIC,
    messages: [{
      key: body.driver_id,
      value: JSON.stringify({ ...body, ts }),
    }],
  });

  return reply.code(202).send({ ok: true, ts });
});

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
  await producer.connect();
  const port = requiredNumberEnv('INGESTOR_PORT');
  await app.listen({ port, host: requiredEnv('INGESTOR_HOST') });
  log.info({ port }, 'ingestor listening');
}

start().catch((e) => { log.error(e); process.exit(1); });

['SIGINT','SIGTERM'].forEach((s) => process.on(s, async () => {
  await Promise.allSettled([producer.disconnect(), redis.quit(), pg.end(), app.close()]);
  process.exit(0);
}));
