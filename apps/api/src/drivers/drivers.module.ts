import {
  Module, Inject, Injectable, Controller, Get, Patch, Body, Param, Query, ForbiddenException, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import type Redis from 'ioredis';
import type { FastifyRequest } from 'fastify';

import { REDIS } from '../redis/redis.module';
import { Roles } from '../auth/jwt.guard';

@Injectable()
class DriversService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Returns drivers within `radiusMeters` of (lon, lat). Backed by a
   *  Redis GEO set, updated by the ingestor on every location ping. */
  async nearby(lon: number, lat: number, radiusMeters = 2000) {
    return this.redis.geosearch(
      'driver:online', 'FROMLONLAT', lon, lat,
      'BYRADIUS', radiusMeters, 'm', 'COUNT', 25, 'ASC', 'WITHCOORD',
    );
  }

  async setStatus(driverId: string, status: 'online' | 'offline' | 'on_trip') {
    if (status === 'offline') await this.redis.zrem('driver:online', driverId);
    return { driverId, status };
  }
}

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get('nearby')
  @ApiOperation({ summary: 'Find online drivers near a point (Redis-backed)' })
  @ApiQuery({ name: 'lon', type: Number, required: true })
  @ApiQuery({ name: 'lat', type: Number, required: true })
  @ApiQuery({ name: 'radius_m', type: Number, required: false })
  nearby(
    @Query('lon') lon: string,
    @Query('lat') lat: string,
    @Query('radius_m') radius?: string,
  ) {
    return this.drivers.nearby(Number(lon), Number(lat), radius ? Number(radius) : 2000);
  }

  @Roles('driver','admin')
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() body: { status: 'online' | 'offline' | 'on_trip' },
    @Req() req: FastifyRequest,
  ) {
    if (req.user!.role === 'driver' && req.user!.sub !== id) {
      throw new ForbiddenException('drivers can only change their own status');
    }
    return this.drivers.setStatus(id, body.status);
  }
}

@Module({
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
