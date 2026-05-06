import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';

import { MetricsModule } from './metrics/metrics.module';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';
import { RateLimitModule } from './ratelimit/ratelimit.module';
import { RateLimitGuard } from './ratelimit/ratelimit.guard';
import { ErrorFilter } from './common/error.filter';

import { AuthModule } from './auth/auth.module';
import { TripsModule } from './trips/trips.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TerminusModule,
    // shared infra
    DbModule, RedisModule, KafkaModule,
    // observability + cross-cutting
    MetricsModule, RateLimitModule,
    // domain
    AuthModule, UsersModule, VehiclesModule,
    TripsModule, DriversModule, AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD,        useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR,  useClass: HttpMetricsInterceptor },
    { provide: APP_FILTER,       useClass: ErrorFilter },
  ],
})
export class AppModule {}
