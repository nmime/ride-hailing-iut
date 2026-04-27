import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol.for('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://redis:6379'),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
