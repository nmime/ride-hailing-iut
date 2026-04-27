import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Pool } from 'pg';

import { PG_POOL } from '../db/db.module';
import { Roles } from '../auth/jwt.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
class AdminController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  /** Daily per-driver summary, served from the materialised view (R6). */
  @Roles('admin')
  @Get('reports/daily')
  @ApiOperation({ summary: 'Per-driver daily revenue + km (mat view)' })
  async daily() {
    const { rows } = await this.db.query(
      `SELECT * FROM mv_driver_daily ORDER BY day DESC LIMIT 200`,
    );
    return rows;
  }

  @Roles('admin')
  @Get('surge')
  @ApiOperation({ summary: 'Current surge multipliers per zone' })
  async surge() {
    const { rows } = await this.db.query(
      `SELECT id, name, base_multiplier, ST_AsGeoJSON(polygon) AS polygon_geo
         FROM surge_zones ORDER BY name`,
    );
    return rows;
  }
}

@Module({
  controllers: [AdminController],
})
export class AdminModule {}
