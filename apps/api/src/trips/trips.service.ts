import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { Producer } from 'kafkajs';

import { PG_POOL }       from '../db/db.module';
import { KAFKA_PRODUCER } from '../kafka/kafka.module';
import { CreateTripDto } from './dto/create-trip.dto';

/**
 * The service layer is intentionally thin. Real fare calculation, driver
 * matching, and surge multiplier sourcing happen in the matcher service
 * (see services/matcher/). This file is the seam between HTTP and the
 * data layer + event bus.
 *
 * Each public method is left small enough that the team can extend it
 * (and explain it in viva) without re-architecting.
 */
@Injectable()
export class TripsService {
  private readonly log = new Logger(TripsService.name);

  constructor(
    @Inject(PG_POOL)        private readonly db: Pool,
    @Inject(KAFKA_PRODUCER) private readonly kafka: Producer,
  ) {}

  async create(dto: CreateTripDto, riderId: string) {
    const { rows } = await this.db.query(
      `INSERT INTO trips (rider_id, pickup, dropoff, pickup_address, dropoff_address)
       VALUES ($1,
               ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,
               ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
               $6, $7)
       RETURNING id, status, requested_at`,
      [riderId,
       dto.pickup.lon, dto.pickup.lat,
       dto.dropoff.lon, dto.dropoff.lat,
       dto.pickup_address ?? null, dto.dropoff_address ?? null],
    );
    const trip = rows[0];

    // Emit a domain event the matcher consumes (R10 stream pipeline).
    await this.kafka.send({
      topic: process.env.TOPIC_TRIP_EVENTS ?? 'trip.events.v1',
      messages: [{
        key: trip.id,
        value: JSON.stringify({ type: 'trip.requested', trip_id: trip.id, dto }),
      }],
    });

    this.log.log(`trip.requested id=${trip.id}`);
    return trip;
  }

  async list({ status, limit = 50 }: { status?: string; limit?: number }) {
    const { rows } = await this.db.query(
      `SELECT id, status, requested_at, fare_total, currency
         FROM trips
        WHERE ($1::text IS NULL OR status::text = $1)
        ORDER BY requested_at DESC
        LIMIT $2`,
      [status ?? null, limit],
    );
    return rows;
  }

  async byId(id: string) {
    const { rows } = await this.db.query(
      `SELECT id, rider_id, driver_id, status,
              ST_AsGeoJSON(pickup)  AS pickup_geo,
              ST_AsGeoJSON(dropoff) AS dropoff_geo,
              requested_at, matched_at, completed_at, fare_total, currency
         FROM trips WHERE id = $1`, [id],
    );
    if (!rows[0]) throw new NotFoundException(`trip ${id} not found`);
    return rows[0];
  }

  async cancel(id: string, actorId: string, actorRole: string) {
    // Riders cancel only their own trips; drivers cancel only trips they're matched to.
    const newStatus = actorRole === 'driver' ? 'cancelled_by_driver' : 'cancelled_by_rider';
    const ownerColumn = actorRole === 'driver' ? 'driver_id' : 'rider_id';

    const { rows } = await this.db.query(
      `UPDATE trips SET status = $3
        WHERE id = $1
          AND ${ownerColumn} = $2
          AND status IN ('requested','matched')
        RETURNING id, status`,
      [id, actorId, newStatus],
    );
    if (!rows[0]) throw new NotFoundException(`trip ${id} not cancellable`);
    await this.kafka.send({
      topic: process.env.TOPIC_TRIP_EVENTS ?? 'trip.events.v1',
      messages: [{ key: id, value: JSON.stringify({
        type: 'trip.cancelled', trip_id: id, by: actorRole,
      }) }],
    });
    return rows[0];
  }
}
