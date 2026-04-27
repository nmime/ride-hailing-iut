import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';

import { AuthModule } from './auth/auth.module';
import { TripsModule } from './trips/trips.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TerminusModule,
    // shared infra
    DbModule, RedisModule, KafkaModule,
    // domain
    AuthModule, TripsModule, DriversModule, AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
