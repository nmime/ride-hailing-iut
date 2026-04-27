import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck, HealthCheckService,
} from '@nestjs/terminus';
import { Public } from './auth/jwt.guard';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
  ) {}

  @Public()
  @Get('healthz')
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  @HealthCheck()
  readiness() {
    return this.health.check([
      // Add deep checks: this.db.pingCheck('postgres'), this.redis.pingCheck('redis'), etc.
      () => Promise.resolve({ kafka: { status: 'up' } }),
    ]);
  }
}
