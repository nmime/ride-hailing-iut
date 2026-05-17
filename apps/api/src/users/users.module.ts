import { Controller, Get, Inject, Module, NotFoundException, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { PG_POOL } from '../db/db.module';

interface MeRow {
  id: string;
  role: string;
  full_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  created_at: Date;
  // Driver-specific (nullable for riders / admin)
  license_number: string | null;
  license_expires_on: Date | null;
  driver_status: string | null;
  rating_avg: string | null;
  rating_count: number | null;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller()
class UsersController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the currently authenticated profile' })
  async me(@Req() req: FastifyRequest) {
    const sub = req.user!.sub;
    const { rows } = await this.db.query<MeRow>(
      `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.is_active, u.created_at,
              d.license_number, d.license_expires_on,
              d.status::text  AS driver_status,
              d.rating_avg::text AS rating_avg,
              d.rating_count
         FROM users u
         LEFT JOIN drivers d ON d.user_id = u.id
        WHERE u.id = $1`,
      [sub],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException(`user ${sub} not found`);

    const driverProfile =
      row.role === 'driver'
        ? {
            license_number: row.license_number,
            license_expires_on: row.license_expires_on,
            status: row.driver_status,
            rating_avg: row.rating_avg !== null ? Number(row.rating_avg) : null,
            rating_count: row.rating_count,
          }
        : null;

    return {
      id: row.id,
      role: row.role,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      is_active: row.is_active,
      created_at: row.created_at,
      driver: driverProfile,
    };
  }
}

@Module({
  controllers: [UsersController],
})
export class UsersModule {}
