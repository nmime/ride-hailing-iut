import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

import { requiredEnv } from '../common/env';

export const REDIS = Symbol.for('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => new Redis(requiredEnv('REDIS_URL')),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
