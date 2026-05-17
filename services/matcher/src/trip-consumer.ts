import Redis from 'ioredis';
import { EachMessagePayload, Producer } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

interface TripRequestedEvent {
  type: string;
  trip_id: string;
  dto?: { pickup?: { lon: number; lat: number } };
}

interface MatchResult {
  tripId: string;
  driverId: string;
  vehicleId: string;
  eventId: string;
}

interface TripHandlerDeps {
  log: pino.Logger;
  pg: Pool;
  producer: Producer;
  redis: Redis;
  tripTopic: string;
}

export function createTripEventHandler(deps: TripHandlerDeps) {
  return async function handleTripEvent({ message }: EachMessagePayload) {
    if (!message.value) return;

    const evt = JSON.parse(message.value.toString()) as TripRequestedEvent;
    if (evt.type !== 'trip.requested') return;

    const { trip_id: tripId } = evt;
    const pickup = evt.dto?.pickup ?? (await loadTripPickup(deps.pg, tripId));
    if (!pickup || !Number.isFinite(pickup.lon) || !Number.isFinite(pickup.lat)) {
      deps.log.warn({ tripId }, 'trip.requested missing pickup coordinates');
      return;
    }

    const nearby = (await deps.redis.geosearch(
      'driver:online',
      'FROMLONLAT',
      pickup.lon,
      pickup.lat,
      'BYRADIUS',
      2000,
      'm',
      'COUNT',
      10,
      'ASC',
    )) as string[];

    if (nearby.length === 0) {
      deps.log.warn({ tripId }, 'no driver in radius');
      return;
    }

    for (const driverId of nearby) {
      const match = await assignDriver(deps, tripId, driverId);
      if (!match) continue;

      await publishTripEvent(deps, match.eventId, {
        type: 'trip.matched',
        trip_id: tripId,
        driver_id: match.driverId,
        vehicle_id: match.vehicleId,
      });
      deps.log.info(
        { tripId, driverId: match.driverId, vehicleId: match.vehicleId },
        'trip.matched',
      );
      return;
    }

    deps.log.warn({ tripId, candidates: nearby.length }, 'no available driver after checks');
  };
}

async function loadTripPickup(
  pg: Pool,
  tripId: string,
): Promise<{ lon: number; lat: number } | null> {
  const { rows } = await pg.query<{ lon: number; lat: number }>(
    `SELECT ST_X(pickup::geometry) AS lon, ST_Y(pickup::geometry) AS lat
       FROM trips
      WHERE id = $1`,
    [tripId],
  );
  return rows[0] ?? null;
}

async function assignDriver(
  deps: TripHandlerDeps,
  tripId: string,
  driverId: string,
): Promise<MatchResult | null> {
  const client = await deps.pg.connect();
  try {
    await client.query('BEGIN');

    const driver = await client.query<{ vehicle_id: string }>(
      `SELECT v.id AS vehicle_id
         FROM drivers d
         JOIN vehicles v ON v.driver_id = d.user_id AND v.is_active = TRUE
        WHERE d.user_id = $1
          AND d.status = 'online'
        LIMIT 1
        FOR UPDATE OF d`,
      [driverId],
    );
    if (!driver.rows[0]) {
      await client.query('ROLLBACK');
      await deps.redis.zrem('driver:online', driverId);
      deps.log.debug({ driverId }, 'removed stale unavailable driver from Redis');
      return null;
    }

    const vehicleId = driver.rows[0].vehicle_id;
    const trip = await client.query<{ id: string }>(
      `UPDATE trips
          SET driver_id = $2,
              vehicle_id = $3,
              status = 'matched',
              matched_at = now()
        WHERE id = $1
          AND status = 'requested'
        RETURNING id`,
      [tripId, driverId, vehicleId],
    );
    if (!trip.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(`UPDATE drivers SET status = 'on_trip' WHERE user_id = $1`, [driverId]);
    const event = await client.query<{ id: string }>(
      `INSERT INTO trip_events (trip_id, event_type, payload)
       VALUES ($1, 'matched', $2::jsonb)
       RETURNING id`,
      [tripId, JSON.stringify({ driver_id: driverId, vehicle_id: vehicleId })],
    );

    await client.query('COMMIT');
    await deps.redis.zrem('driver:online', driverId);
    return { tripId, driverId, vehicleId, eventId: event.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishTripEvent(
  deps: TripHandlerDeps,
  eventId: string,
  payload: Record<string, unknown> & { trip_id: string },
) {
  const client = await deps.pg.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `SELECT 1
         FROM trip_events
        WHERE id = $1
          AND published_at IS NULL
        FOR UPDATE SKIP LOCKED`,
      [eventId],
    );
    if ((rowCount ?? 0) === 0) {
      await client.query('COMMIT');
      return;
    }

    try {
      await deps.producer.send({
        topic: deps.tripTopic,
        messages: [{ key: payload.trip_id, value: JSON.stringify(payload) }],
      });
      await client.query(
        `UPDATE trip_events
            SET published_at = now(),
                publish_attempts = publish_attempts + 1,
                last_publish_error = NULL
          WHERE id = $1`,
        [eventId],
      );
    } catch (error) {
      await client.query(
        `UPDATE trip_events
            SET publish_attempts = publish_attempts + 1,
                last_publish_error = left($2, 500)
          WHERE id = $1`,
        [eventId, String(error)],
      );
      deps.log.warn({ err: error, eventId }, 'trip matched outbox publish failed');
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Transaction may already be closed.
    }
    throw error;
  } finally {
    client.release();
  }
}
