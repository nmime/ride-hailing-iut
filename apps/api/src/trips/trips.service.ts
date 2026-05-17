import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { Producer } from 'kafkajs';
import type Redis from 'ioredis';

import { PG_POOL } from '../db/db.module';
import { KAFKA_PRODUCER } from '../kafka/kafka.module';
import { REDIS } from '../redis/redis.module';
import { CreateTripDto } from './dto/create-trip.dto';
import { RateTripDto } from './dto/rate-trip.dto';
import { MetricsService } from '../metrics/metrics.service';
import type { JwtPayload } from '../auth/auth.service';
import { requiredEnv, requiredNumberEnv } from '../common/env';

/**
 * The service layer keeps HTTP concerns out of the data layer. Driver
 * assignment happens in services/matcher; trip lifecycle transitions and
 * fare snapshots are persisted here.
 *
 * Each public method is left small enough that the team can extend it
 * (and explain it in viva) without re-architecting.
 */
@Injectable()
export class TripsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TripsService.name);
  private outboxTimer?: NodeJS.Timeout;
  private outboxRunning = false;

  constructor(
    @Inject(PG_POOL) private readonly db: Pool,
    @Inject(KAFKA_PRODUCER) private readonly kafka: Producer,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    const intervalMs = requiredNumberEnv('TRIP_EVENT_OUTBOX_INTERVAL_MS', { min: 1000 });
    this.outboxTimer = setInterval(
      () => {
        void this.publishPendingTripEvents();
      },
      Math.max(1000, intervalMs),
    );
    this.outboxTimer.unref();
    void this.publishPendingTripEvents();
  }

  onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
  }

  async create(dto: CreateTripDto, riderId: string) {
    const client = await this.db.connect();
    let trip: { id: string; status: string; requested_at: Date } | undefined;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO trips (rider_id, pickup, dropoff, pickup_address, dropoff_address)
         VALUES ($1,
                 ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,
                 ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
                 $6, $7)
         RETURNING id, status, requested_at`,
        [
          riderId,
          dto.pickup.lon,
          dto.pickup.lat,
          dto.dropoff.lon,
          dto.dropoff.lat,
          dto.pickup_address ?? null,
          dto.dropoff_address ?? null,
        ],
      );
      const created = rows[0];
      if (!created) throw new BadRequestException('trip could not be created');
      trip = created;
      await this.recordTripEvent(client, created.id, 'requested', { rider_id: riderId, dto });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (!trip) throw new BadRequestException('trip could not be created');
    await this.publishPendingTripEvents();
    this.metrics.tripEvent('requested');

    this.log.log(`trip.requested id=${trip.id}`);
    return trip;
  }

  async list({
    status,
    limit = 50,
    actor,
  }: {
    status?: string;
    limit?: number;
    actor: JwtPayload;
  }) {
    const allowedStatuses = [
      'requested',
      'matched',
      'in_progress',
      'completed',
      'cancelled_by_rider',
      'cancelled_by_driver',
      'expired',
    ];
    if (status && !allowedStatuses.includes(status)) {
      throw new BadRequestException(`status must be one of: ${allowedStatuses.join(', ')}`);
    }
    const safeLimit = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));
    const { rows } = await this.db.query(
      `SELECT id, status, requested_at, fare_total, currency
         FROM trips
        WHERE ($1::text IS NULL OR status::text = $1)
          AND (
            $3::text = 'admin'
            OR ($3::text = 'rider'  AND rider_id = $4::uuid)
            OR ($3::text = 'driver' AND driver_id = $4::uuid)
          )
        ORDER BY requested_at DESC
        LIMIT $2`,
      [status ?? null, safeLimit, actor.role, actor.sub],
    );
    return rows;
  }

  async byId(id: string, actor: JwtPayload) {
    const { rows } = await this.db.query(
      `SELECT id, rider_id, driver_id, status,
              ST_AsGeoJSON(pickup)  AS pickup_geo,
              ST_AsGeoJSON(dropoff) AS dropoff_geo,
              requested_at, matched_at, completed_at, fare_total, currency
         FROM trips
        WHERE id = $1
          AND (
            $2::text = 'admin'
            OR ($2::text = 'rider'  AND rider_id = $3::uuid)
            OR ($2::text = 'driver' AND driver_id = $3::uuid)
          )`,
      [id, actor.role, actor.sub],
    );
    if (!rows[0]) throw new NotFoundException(`trip ${id} not found`);
    return rows[0];
  }

  async cancel(id: string, actorId: string, actorRole: string) {
    if (actorRole !== 'rider' && actorRole !== 'driver') {
      throw new BadRequestException('only rider or driver can cancel trips');
    }
    // Riders cancel only their own trips; drivers cancel only trips they're matched to.
    const newStatus = actorRole === 'driver' ? 'cancelled_by_driver' : 'cancelled_by_rider';
    const ownerColumn = actorRole === 'driver' ? 'driver_id' : 'rider_id';

    const client = await this.db.connect();
    let rows: Array<{ id: string; status: string; driver_id: string | null }> = [];
    try {
      await client.query('BEGIN');
      ({ rows } = await client.query(
        `UPDATE trips SET status = $3
          WHERE id = $1
            AND ${ownerColumn} = $2
            AND status IN ('requested','matched')
          RETURNING id, status, driver_id`,
        [id, actorId, newStatus],
      ));
      if (rows[0]) {
        if (rows[0].driver_id) {
          await client.query(`UPDATE drivers SET status = 'online' WHERE user_id = $1`, [
            rows[0].driver_id,
          ]);
        }
        await this.recordTripEvent(client, id, 'cancelled', { by: actorRole, status: newStatus });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    if (!rows[0]) throw new NotFoundException(`trip ${id} not cancellable`);
    if (rows[0].driver_id) await this.restoreDriverGeoIndex(rows[0].driver_id);
    await this.publishPendingTripEvents();
    this.metrics.tripEvent('cancelled');
    return rows[0];
  }

  async start(id: string, actor: JwtPayload) {
    if (actor.role !== 'driver')
      throw new BadRequestException('only the matched driver can start a trip');

    const client = await this.db.connect();
    let trip: { id: string; status: string } | undefined;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE trips
            SET status = 'in_progress', started_at = now()
          WHERE id = $1
            AND driver_id = $2
            AND status = 'matched'
          RETURNING id, status`,
        [id, actor.sub],
      );
      trip = rows[0];
      if (trip) await this.recordTripEvent(client, id, 'started', { driver_id: actor.sub });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (!trip) throw new NotFoundException(`trip ${id} not startable`);
    await this.publishPendingTripEvents();
    this.metrics.tripEvent('started');
    return trip;
  }

  async complete(id: string, actor: JwtPayload) {
    if (actor.role !== 'driver')
      throw new BadRequestException('only the matched driver can complete a trip');

    const client = await this.db.connect();
    let result:
      | {
          id: string;
          status: string;
          distance_km: string;
          duration_min: string;
          surge_multiplier: string;
          total: string;
          fare_total: string;
          currency: string;
        }
      | undefined;
    try {
      await client.query('BEGIN');
      const completed = await client.query<{
        id: string;
        distance_km: string;
        duration_min: string;
        zone_id: string | null;
        zone_multiplier: string | null;
      }>(
        `UPDATE trips
            SET status = 'completed', completed_at = now()
          WHERE id = $1
            AND driver_id = $2
            AND status = 'in_progress'
          RETURNING id,
            ROUND((ST_Distance(pickup, dropoff) / 1000.0)::numeric, 3) AS distance_km,
            ROUND(GREATEST(EXTRACT(EPOCH FROM (completed_at - COALESCE(started_at, matched_at, requested_at))) / 60.0, 1.0)::numeric, 2) AS duration_min,
            (SELECT id::text FROM surge_zones WHERE ST_Covers(polygon::geometry, pickup::geometry) LIMIT 1) AS zone_id,
            (SELECT base_multiplier::text FROM surge_zones WHERE ST_Covers(polygon::geometry, pickup::geometry) LIMIT 1) AS zone_multiplier`,
        [id, actor.sub],
      );
      const fare = completed.rows[0];
      if (!fare) {
        await client.query('ROLLBACK');
        throw new NotFoundException(`trip ${id} not completable`);
      }

      const distanceKm = Number(fare.distance_km);
      const durationMin = Number(fare.duration_min);
      const surgeMultiplier = await this.resolveSurge(fare.zone_id, fare.zone_multiplier);
      const total =
        Math.round((2.5 + distanceKm * 0.8 + durationMin * 0.18) * surgeMultiplier * 100) / 100;

      await client.query(
        `INSERT INTO fare_records (
           trip_id, base_fare, distance_km, duration_min,
           surge_multiplier, total, currency
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'USD')
         ON CONFLICT (trip_id) DO UPDATE
            SET distance_km = EXCLUDED.distance_km,
                duration_min = EXCLUDED.duration_min,
                surge_multiplier = EXCLUDED.surge_multiplier,
                total = EXCLUDED.total,
                currency = EXCLUDED.currency`,
        [id, 2.5, distanceKm, durationMin, surgeMultiplier, total],
      );
      await client.query(`UPDATE trips SET fare_total = $2, currency = 'USD' WHERE id = $1`, [
        id,
        total,
      ]);
      await client.query(`UPDATE drivers SET status = 'online' WHERE user_id = $1`, [actor.sub]);

      result = {
        id,
        status: 'completed',
        distance_km: distanceKm.toFixed(3),
        duration_min: durationMin.toFixed(2),
        surge_multiplier: surgeMultiplier.toFixed(2),
        total: total.toFixed(2),
        fare_total: total.toFixed(2),
        currency: 'USD',
      };
      await this.recordTripEvent(client, id, 'completed', {
        driver_id: actor.sub,
        fare_total: result.total,
        distance_km: result.distance_km,
        duration_min: result.duration_min,
        surge_multiplier: result.surge_multiplier,
      });
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be closed */
      }
      throw e;
    } finally {
      client.release();
    }

    if (!result) throw new NotFoundException(`trip ${id} not completable`);
    await this.restoreDriverGeoIndex(actor.sub);
    await this.publishPendingTripEvents();
    this.metrics.tripEvent('completed');
    return result;
  }

  /**
   * Submit a 1-5 rating from the rider for a completed trip. The DB
   * trigger `trip_ratings_apply_on_insert` keeps drivers.rating_avg in
   * sync; we only need to insert here.
   */
  async rate(tripId: string, riderId: string, dto: RateTripDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ driver_id: string }>(
        `SELECT driver_id FROM trips
          WHERE id = $1 AND rider_id = $2 AND status = 'completed' AND driver_id IS NOT NULL`,
        [tripId, riderId],
      );
      const trip = rows[0];
      if (!trip) {
        await client.query('ROLLBACK');
        throw new NotFoundException(`trip ${tripId} not rateable`);
      }

      await client.query(
        `INSERT INTO trip_ratings (trip_id, rider_id, driver_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [tripId, riderId, trip.driver_id, dto.rating, dto.comment ?? null],
      );
      await this.recordTripEvent(client, tripId, 'rated', { rating: dto.rating });
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be closed */
      }
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') {
        throw new ConflictException('trip already rated');
      }
      throw e;
    } finally {
      client.release();
    }
    await this.publishPendingTripEvents();
    this.metrics.tripEvent('rated');
    return { trip_id: tripId, rating: dto.rating };
  }

  /**
   * Read the surge multiplier from Redis first (sub-ms hot path written
   * by `services/surge-worker`). Fall back to the value computed by
   * PostGIS during the same UPDATE if the cache is cold.
   */
  private async resolveSurge(zoneId: string | null, pgMultiplier: string | null): Promise<number> {
    if (!zoneId) return 1.0;
    try {
      const cached = await this.redis.hget(`surge:zone:${zoneId}`, 'multiplier');
      if (cached) {
        const n = Number(cached);
        if (Number.isFinite(n) && n >= 1) return n;
      }
    } catch (e) {
      this.log.warn({ err: e }, 'redis surge cache miss/error, using DB value');
    }
    const fallback = pgMultiplier ? Number(pgMultiplier) : 1.0;
    return Number.isFinite(fallback) && fallback >= 1 ? fallback : 1.0;
  }

  private async recordTripEvent(
    client: PoolClient,
    tripId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO trip_events (trip_id, event_type, payload) VALUES ($1, $2, $3::jsonb)`,
      [tripId, eventType, JSON.stringify(payload)],
    );
  }

  private async publishTripEvent(payload: Record<string, unknown> & { trip_id: string }) {
    await this.kafka.send({
      topic: requiredEnv('TOPIC_TRIP_EVENTS'),
      messages: [{ key: payload.trip_id, value: JSON.stringify(payload) }],
    });
  }

  private async publishPendingTripEvents() {
    if (this.outboxRunning) return;
    this.outboxRunning = true;
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        trip_id: string;
        event_type: string;
        payload: Record<string, unknown> | string | null;
      }>(
        `SELECT id, trip_id, event_type, payload
           FROM trip_events
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT 50
          FOR UPDATE SKIP LOCKED`,
      );

      for (const row of rows) {
        const eventPayload = this.outboxPayload(row.trip_id, row.event_type, row.payload);
        try {
          await this.publishTripEvent(eventPayload);
          await client.query(
            `UPDATE trip_events
                SET published_at = now(),
                    publish_attempts = publish_attempts + 1,
                    last_publish_error = NULL
              WHERE id = $1`,
            [row.id],
          );
        } catch (e) {
          await client.query(
            `UPDATE trip_events
                SET publish_attempts = publish_attempts + 1,
                    last_publish_error = left($2, 500)
              WHERE id = $1`,
            [row.id, String(e)],
          );
          this.log.warn({ err: e, eventId: row.id }, 'trip event outbox publish failed');
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be closed */
      }
      this.log.warn({ err: e }, 'trip event outbox flush failed');
    } finally {
      client.release();
      this.outboxRunning = false;
    }
  }

  private outboxPayload(
    tripId: string,
    eventType: string,
    payload: Record<string, unknown> | string | null,
  ): Record<string, unknown> & { trip_id: string } {
    const parsed =
      typeof payload === 'string'
        ? (JSON.parse(payload) as Record<string, unknown>)
        : (payload ?? {});
    return {
      type: `trip.${eventType}`,
      trip_id: tripId,
      ...parsed,
    };
  }

  private async restoreDriverGeoIndex(driverId: string) {
    const { rows } = await this.db.query<{ lon: number; lat: number }>(
      `SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
         FROM driver_locations
        WHERE driver_id = $1`,
      [driverId],
    );
    if (rows[0]) await this.redis.geoadd('driver:online', rows[0].lon, rows[0].lat, driverId);
  }
}
