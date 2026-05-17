import { Global, Module } from '@nestjs/common';
import { TokenBucket, RedisTokenBucketStore, InMemoryTokenBucketStore } from '@ridex/ratelimiter';
import type Redis from 'ioredis';

import { REDIS } from '../redis/redis.module';
import { MetricsModule } from '../metrics/metrics.module';
import { requiredNumberEnv } from '../common/env';

export const AUTH_BUCKET = Symbol.for('AUTH_BUCKET');
export const USER_BUCKET = Symbol.for('USER_BUCKET');

function makeBucket(redis: Redis | null, prefix: string, burst: number, refillPerSecond: number) {
  const store = redis
    ? new RedisTokenBucketStore({ redis: redis as any, burst, refillPerSecond, keyPrefix: prefix })
    : new InMemoryTokenBucketStore();
  return new TokenBucket({ burst, refillPerSecond, store });
}

@Global()
@Module({
  imports: [MetricsModule],
  providers: [
    {
      provide: AUTH_BUCKET,
      inject: [REDIS],
      useFactory: (redis: Redis) =>
        makeBucket(
          redis,
          'rl:auth',
          requiredNumberEnv('RATELIMIT_AUTH_BURST', { min: 1 }),
          requiredNumberEnv('RATELIMIT_AUTH_PER_SECOND', { min: 0.001 }),
        ),
    },
    {
      provide: USER_BUCKET,
      inject: [REDIS],
      useFactory: (redis: Redis) =>
        makeBucket(
          redis,
          'rl:user',
          requiredNumberEnv('RATELIMIT_USER_BURST', { min: 1 }),
          requiredNumberEnv('RATELIMIT_USER_PER_SECOND', { min: 0.001 }),
        ),
    },
  ],
  exports: [AUTH_BUCKET, USER_BUCKET],
})
export class RateLimitModule {}
