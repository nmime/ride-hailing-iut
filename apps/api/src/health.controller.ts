import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck, HealthCheckError, HealthCheckService, HealthIndicatorResult,
} from '@nestjs/terminus';
import { Kafka } from 'kafkajs';
import type { Pool } from 'pg';
import type Redis from 'ioredis';

import { Public } from './auth/jwt.guard';
import { SkipRateLimit } from './ratelimit/skip-ratelimit.decorator';
import { PG_POOL } from './db/db.module';
import { REDIS } from './redis/redis.module';
import { requiredEnv } from './common/env';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(PG_POOL) private readonly db: Pool,
    @Inject(REDIS)   private readonly redis: Redis,
  ) {}

  @Public()
  @SkipRateLimit()
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe — process is up' })
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @SkipRateLimit()
  @Get('readyz')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — Postgres + Redis + Kafka reachable' })
  readiness() {
    return this.health.check([
      () => this.checkDb(),
      () => this.checkRedis(),
      () => this.checkKafka(),
    ]);
  }

  private async checkDb(): Promise<HealthIndicatorResult> {
    try {
      await this.db.query('SELECT 1');
      return { postgres: { status: 'up' } };
    } catch (e) {
      throw new HealthCheckError('postgres unavailable', {
        postgres: { status: 'down', message: String(e) },
      });
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`unexpected ping response: ${pong}`);
      }
      return { redis: { status: 'up' } };
    } catch (e) {
      throw new HealthCheckError('redis unavailable', {
        redis: { status: 'down', message: String(e) },
      });
    }
  }

  private async checkKafka(): Promise<HealthIndicatorResult> {
    const kafka = new Kafka({
      clientId: `${requiredEnv('KAFKA_CLIENT_ID')}-health`,
      brokers: requiredEnv('KAFKA_BROKERS').split(','),
    });
    const admin = kafka.admin();
    try {
      await Promise.race([
        (async () => {
          await admin.connect();
          await admin.describeCluster();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('kafka health timeout')), 1500)),
      ]);
      return { kafka: { status: 'up' } };
    } catch (e) {
      throw new HealthCheckError('kafka unavailable', {
        kafka: { status: 'down', message: String(e) },
      });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }
}
