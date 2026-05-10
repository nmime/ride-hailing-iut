import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type Redis from 'ioredis';

import { Public } from '../auth/jwt.guard';
import { SkipRateLimit } from '../ratelimit/skip-ratelimit.decorator';
import { MetricsService } from './metrics.service';
import { PG_POOL } from '../db/db.module';
import { REDIS } from '../redis/redis.module';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private lastRefreshMs = 0;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(PG_POOL) private readonly db: Pool,
    @Inject(REDIS)   private readonly redis: Redis,
  ) {}

  @Public()
  @SkipRateLimit()
  @Get()
  async render(@Res() reply: FastifyReply) {
    await this.refreshGauges();
    reply.header('content-type', 'text/plain; version=0.0.4');
    reply.send(this.metrics.render());
  }

  /** Refresh slow-changing gauges at most once per 10s. */
  private async refreshGauges() {
    const now = Date.now();
    if (now - this.lastRefreshMs < 10_000) return;
    this.lastRefreshMs = now;

    try {
      const onlineRedis = await this.redis.zcard('driver:online');
      const onlineDb = await this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM drivers WHERE status = 'online'`,
      );
      this.metrics.setGauge('ridex_drivers_online_redis', onlineRedis);
      this.metrics.setGauge('ridex_drivers_online', Number(onlineDb.rows[0]?.c ?? 0));
    } catch {
      // Don't tank /metrics if a backing store is briefly unavailable.
    }
  }
}
