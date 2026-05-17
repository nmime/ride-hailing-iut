import { parseJsonMessage } from '@ridex/service-utils';
import Redis from 'ioredis';
import { EachMessagePayload } from 'kafkajs';
import { Pool } from 'pg';
import pino from 'pino';

interface SurgeConfig {
  flushMs: number;
  maxMultiplier: number;
  thresholdHigh: number;
  thresholdLow: number;
  windowMs: number;
}

interface ZoneCounts {
  requests: number;
  lastSeenIdx: number[];
  multiplier: number;
}

export class SurgeEngine {
  private readonly counts = new Map<string, ZoneCounts>();
  private readonly tickRing: number;
  private tickIdx = 0;

  constructor(
    private readonly pg: Pool,
    private readonly redis: Redis,
    private readonly log: pino.Logger,
    private readonly config: SurgeConfig,
  ) {
    this.tickRing = Math.max(1, Math.round(config.windowMs / 1000));
  }

  get flushMs() {
    return this.config.flushMs;
  }

  async loadZones() {
    const { rows } = await this.pg.query<{ id: string; base_multiplier: string }>(
      `SELECT id, base_multiplier FROM surge_zones`,
    );
    rows.forEach((row) =>
      this.counts.set(row.id, {
        requests: 0,
        lastSeenIdx: new Array(this.tickRing).fill(0),
        multiplier: Number(row.base_multiplier),
      }),
    );
    this.log.info({ zones: this.counts.size }, 'loaded surge zones');
  }

  onTripEvent = async ({ message }: EachMessagePayload) => {
    if (!message.value) return;
    const evt = parseJsonMessage<{
      type?: string;
      dto?: { pickup?: { lon: number; lat: number } };
    }>(message, this.log, { topic: 'trip-events' });
    if (evt?.type !== 'trip.requested' || !evt.dto?.pickup) return;

    const zoneId = await this.whichZone(evt.dto.pickup.lon, evt.dto.pickup.lat);
    if (!zoneId) return;

    const zone = this.counts.get(zoneId);
    if (!zone) return;
    zone.requests += 1;
    zone.lastSeenIdx[this.tickIdx] += 1;
  };

  tick = async () => {
    this.tickIdx = (this.tickIdx + 1) % this.tickRing;
    for (const [zoneId, zone] of this.counts) {
      const requests = zone.lastSeenIdx.reduce((total, count) => total + count, 0);
      const drivers = (await this.onlineDriversInZone(zoneId)) || 1;
      const ratio = requests / drivers;

      zone.multiplier = this.nextMultiplier(zone.multiplier, ratio);
      await this.redis.hset(`surge:zone:${zoneId}`, {
        multiplier: zone.multiplier,
        updated_at: Date.now(),
      });
      zone.lastSeenIdx[(this.tickIdx + 1) % this.tickRing] = 0;
    }
  };

  flushToDb = async () => {
    const client = await this.pg.connect();
    try {
      for (const [zoneId, zone] of this.counts) {
        await client.query(`UPDATE surge_zones SET base_multiplier = $2 WHERE id = $1`, [
          zoneId,
          zone.multiplier,
        ]);
      }
    } finally {
      client.release();
    }
    this.log.debug('flushed surge multipliers to postgres');
  };

  private nextMultiplier(current: number, ratio: number) {
    let multiplier = current;
    if (ratio > this.config.thresholdHigh) {
      multiplier = Math.min(this.config.maxMultiplier, multiplier * 1.1);
    } else if (ratio < this.config.thresholdLow) {
      multiplier = Math.max(1, multiplier * 0.97);
    }
    return Math.round(multiplier * 100) / 100;
  }

  private async whichZone(lon: number, lat: number): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id FROM surge_zones
        WHERE ST_Covers(polygon::geometry, ST_SetSRID(ST_MakePoint($1,$2),4326))
        LIMIT 1`,
      [lon, lat],
    );
    return rows[0]?.id ?? null;
  }

  private async onlineDriversInZone(zoneId: string): Promise<number> {
    const { rows } = await this.pg.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM driver_locations dl
         JOIN drivers d ON d.user_id = dl.driver_id
         JOIN surge_zones z ON z.id = $1
        WHERE d.status = 'online'
          AND ST_Covers(z.polygon::geometry, dl.location::geometry)`,
      [zoneId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
