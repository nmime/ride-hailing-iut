import {
  Module, Inject, Injectable, Controller, Get, Patch, Body, Param, Query,
  BadRequestException, ForbiddenException, HttpStatus, NotFoundException,
  ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import type Redis from 'ioredis';
import type { FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { REDIS } from '../redis/redis.module';
import { PG_POOL } from '../db/db.module';
import { Roles } from '../auth/jwt.guard';

type DriverRuntimeStatus = 'online' | 'offline' | 'on_trip';
const UUID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

@Injectable()
class DriversService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_POOL) private readonly db: Pool,
  ) {}

  /** Returns drivers within `radiusMeters` of (lon, lat). Backed by a
   *  Redis GEO set, updated by the ingestor on every location ping. */
  async nearby(lon: number, lat: number, radiusMeters = 2000) {
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new BadRequestException('lon must be between -180 and 180');
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new BadRequestException('lat must be between -90 and 90');
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 10_000) {
      throw new BadRequestException('radius_m must be between 1 and 10000');
    }
    const raw = await this.redis.geosearch(
      'driver:online', 'FROMLONLAT', lon, lat,
      'BYRADIUS', radiusMeters, 'm', 'COUNT', 25, 'ASC', 'WITHCOORD',
    ) as Array<[string, [string, string]]>;
    return raw.map(([driverId, coords]) => ({
      driver_id: driverId,
      lon: Number(coords[0]),
      lat: Number(coords[1]),
    }));
  }

  async setStatus(driverId: string, status: DriverRuntimeStatus) {
    if (!['online', 'offline', 'on_trip'].includes(status)) {
      throw new BadRequestException('status must be online, offline, or on_trip');
    }

    const { rows } = await this.db.query<{ user_id: string; status: DriverRuntimeStatus }>(
      `UPDATE drivers
          SET status = $2
        WHERE user_id = $1
          AND status <> 'suspended'
        RETURNING user_id, status`,
      [driverId, status],
    );
    if (!rows[0]) throw new NotFoundException(`driver ${driverId} not found`);

    if (status !== 'online') {
      await this.redis.zrem('driver:online', driverId);
      return {
        driverId: rows[0].user_id,
        driver_id: rows[0].user_id,
        status: rows[0].status,
        redis_indexed: false,
      };
    }

    const latest = await this.db.query<{ lon: number; lat: number }>(
      `SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
         FROM driver_locations
        WHERE driver_id = $1`,
      [driverId],
    );
    if (latest.rows[0]) {
      await this.redis.geoadd('driver:online', latest.rows[0].lon, latest.rows[0].lat, driverId);
    }
    return {
      driverId: rows[0].user_id,
      driver_id: rows[0].user_id,
      status: rows[0].status,
      redis_indexed: Boolean(latest.rows[0]),
    };
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
    @Param('id', UUID_PIPE) id: string,
    @Body() body: { status: DriverRuntimeStatus },
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
