import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

import { requiredEnv } from '../common/env';

export const PG_POOL = Symbol.for('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => new Pool({
        connectionString: requiredEnv('DATABASE_URL'),
        max: 10,
        idleTimeoutMillis: 30_000,
      }),
    },
  ],
  exports: [PG_POOL],
})
export class DbModule {}
