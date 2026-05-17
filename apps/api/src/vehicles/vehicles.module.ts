import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { PG_POOL } from '../db/db.module';
import { Roles } from '../auth/jwt.guard';

const UUID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

class CreateVehicleDto {
  @ApiProperty({ example: '01A123BC' })
  @IsString()
  @Length(3, 16)
  plate!: string;

  @ApiProperty({ example: 'Chevrolet' })
  @IsString()
  @Length(1, 64)
  make!: string;

  @ApiProperty({ example: 'Cobalt' })
  @IsString()
  @Length(1, 64)
  model!: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 'White' })
  @IsString()
  @Length(1, 32)
  color!: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(8)
  capacity!: number;
}

class UpdateVehicleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  make?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  model?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{3,16}$/)
  plate?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  color?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  capacity?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

interface VehicleRow {
  id: string;
  driver_id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
class VehiclesService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async list(driverId: string) {
    const { rows } = await this.db.query<VehicleRow>(
      `SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY created_at DESC`,
      [driverId],
    );
    return rows;
  }

  async create(driverId: string, dto: CreateVehicleDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const active = await client.query<{ has_active: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM vehicles WHERE driver_id = $1 AND is_active = TRUE
         ) AS has_active`,
        [driverId],
      );
      const shouldActivate = !active.rows[0]?.has_active;

      const { rows } = await client.query<VehicleRow>(
        `INSERT INTO vehicles (driver_id, plate, make, model, year, color, capacity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          driverId,
          dto.plate,
          dto.make,
          dto.model,
          dto.year,
          dto.color,
          dto.capacity,
          shouldActivate,
        ],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throwVehicleConflict(e);
      throw e;
    } finally {
      client.release();
    }
  }

  async update(driverId: string, vehicleId: string, dto: UpdateVehicleDto) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const k of ['plate', 'make', 'model', 'year', 'color', 'capacity', 'is_active'] as const) {
      if (dto[k] !== undefined) {
        fields.push(`${k} = $${i++}`);
        values.push(dto[k]);
      }
    }
    if (fields.length === 0) throw new BadRequestException('no fields to update');
    values.push(vehicleId, driverId);

    if (dto.is_active === true) {
      // Database has a partial unique index ensuring at most one active
      // vehicle per driver. Deactivate the previously active vehicle in
      // the same transaction to avoid violating it.
      const client = await this.db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE vehicles SET is_active = FALSE
            WHERE driver_id = $1 AND is_active = TRUE AND id <> $2`,
          [driverId, vehicleId],
        );
        const result = await client.query<VehicleRow>(
          `UPDATE vehicles SET ${fields.join(', ')}
            WHERE id = $${i++} AND driver_id = $${i}
          RETURNING *`,
          values,
        );
        await client.query('COMMIT');
        if (!result.rows[0]) throw new NotFoundException(`vehicle ${vehicleId} not found`);
        return result.rows[0];
      } catch (e) {
        await client.query('ROLLBACK');
        throwVehicleConflict(e);
        throw e;
      } finally {
        client.release();
      }
    }

    try {
      const { rows } = await this.db.query<VehicleRow>(
        `UPDATE vehicles SET ${fields.join(', ')}
          WHERE id = $${i++} AND driver_id = $${i}
        RETURNING *`,
        values,
      );
      if (!rows[0]) throw new NotFoundException(`vehicle ${vehicleId} not found`);
      return rows[0];
    } catch (e) {
      throwVehicleConflict(e);
      throw e;
    }
  }

  async remove(driverId: string, vehicleId: string) {
    const { rowCount } = await this.db.query(
      `DELETE FROM vehicles WHERE id = $1 AND driver_id = $2`,
      [vehicleId, driverId],
    );
    if (rowCount === 0) throw new NotFoundException(`vehicle ${vehicleId} not found`);
    return { id: vehicleId, deleted: true };
  }
}

function uniqueViolationConstraint(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const pgError = e as { code?: string; constraint?: string };
  return pgError.code === '23505' ? (pgError.constraint ?? 'unknown') : null;
}

function throwVehicleConflict(e: unknown): void {
  const constraint = uniqueViolationConstraint(e);
  if (!constraint) return;
  if (constraint === 'vehicles_plate_key') {
    throw new ConflictException('plate already registered');
  }
  if (constraint === 'one_active_vehicle_per_driver') {
    throw new ConflictException('driver already has an active vehicle');
  }
  throw new ConflictException('vehicle conflict');
}

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Roles('driver')
  @Get()
  @ApiOperation({ summary: 'List the caller-driver vehicles' })
  list(@Req() req: FastifyRequest) {
    return this.vehicles.list(req.user!.sub);
  }

  @Roles('driver')
  @Post()
  @ApiOperation({ summary: 'Register a new vehicle for the caller-driver' })
  create(@Req() req: FastifyRequest, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(req.user!.sub, dto);
  }

  @Roles('driver')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing vehicle' })
  async update(
    @Req() req: FastifyRequest,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    if (req.user!.role === 'driver') {
      // Drivers can only edit their own vehicles.
      const owners = await this.vehicles.list(req.user!.sub);
      if (!owners.some((v) => v.id === id)) {
        throw new ForbiddenException('vehicle does not belong to caller');
      }
    }
    return this.vehicles.update(req.user!.sub, id, dto);
  }

  @Roles('driver')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a vehicle from the caller-driver' })
  remove(@Req() req: FastifyRequest, @Param('id', UUID_PIPE) id: string) {
    return this.vehicles.remove(req.user!.sub, id);
  }
}

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
