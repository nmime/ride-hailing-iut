import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { Producer } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';
import { verifyJwt } from '@ridex/service-utils';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LocationBody {
  driver_id: string;
  lat: number;
  lon: number;
  heading_deg?: number;
  speed_mps?: number;
  ts?: number;
}

interface LocationRouteDeps {
  jwtSecret: string;
  log: pino.Logger;
  pg: Pool;
  producer: Producer;
  redis: Redis;
  topic: string;
}

export function registerHealthRoute(app: FastifyInstance) {
  app.get('/healthz', async () => ({ status: 'ok' }));
}

export function registerLocationRoutes(app: FastifyInstance, deps: LocationRouteDeps) {
  app.post('/v1/locations', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'missing bearer token' });

    let user;
    try {
      user = verifyJwt(token, deps.jwtSecret);
    } catch {
      return reply.code(401).send({ error: 'invalid token' });
    }
    if (user.role !== 'driver') {
      return reply.code(403).send({ error: 'driver role required' });
    }

    const body = req.body as Partial<LocationBody>;
    if (!isValidLocationBody(body)) {
      return reply.code(400).send({ error: 'invalid payload' });
    }
    if (user.sub !== body.driver_id) {
      return reply.code(403).send({ error: 'drivers can only publish their own location' });
    }

    const ts = body.ts ?? Date.now();
    if (!Number.isFinite(ts)) return reply.code(400).send({ error: 'invalid timestamp' });

    const indexAsOnline = await persistLocation(deps, body, new Date(ts));
    await updateAvailabilityIndex(deps.redis, body, indexAsOnline);
    await publishLocation(deps, body, ts);

    deps.log.debug({ driverId: body.driver_id, indexAsOnline }, 'accepted location ping');
    return reply.code(202).send({ ok: true, ts });
  });
}

function isValidLocationBody(body: Partial<LocationBody> | undefined): body is LocationBody {
  return Boolean(
    body &&
    typeof body.driver_id === 'string' &&
    UUID_RE.test(body.driver_id) &&
    typeof body.lat === 'number' &&
    body.lat >= -90 &&
    body.lat <= 90 &&
    typeof body.lon === 'number' &&
    body.lon >= -180 &&
    body.lon <= 180 &&
    (body.heading_deg === undefined ||
      (typeof body.heading_deg === 'number' && body.heading_deg >= 0 && body.heading_deg <= 360)) &&
    (body.speed_mps === undefined || (typeof body.speed_mps === 'number' && body.speed_mps >= 0)),
  );
}

async function persistLocation(
  deps: LocationRouteDeps,
  body: LocationBody,
  observedAt: Date,
): Promise<boolean> {
  const client = await deps.pg.connect();
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
    if ((driver.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      throw new DriverNotFoundError();
    }

    const indexAsOnline = driver.rows[0].status !== 'on_trip' && !driver.rows[0].has_active_trip;
    if (indexAsOnline) {
      await client.query(`UPDATE drivers SET status = 'online' WHERE user_id = $1`, [
        body.driver_id,
      ]);
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
    return indexAsOnline;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateAvailabilityIndex(redis: Redis, body: LocationBody, indexAsOnline: boolean) {
  if (indexAsOnline) {
    await redis.geoadd('driver:online', body.lon, body.lat, body.driver_id);
    return;
  }
  await redis.zrem('driver:online', body.driver_id);
}

async function publishLocation(deps: LocationRouteDeps, body: LocationBody, ts: number) {
  await deps.producer.send({
    topic: deps.topic,
    messages: [
      {
        key: body.driver_id,
        value: JSON.stringify({ ...body, ts }),
      },
    ],
  });
}

export class DriverNotFoundError extends Error {
  constructor() {
    super('driver not found');
  }
}
