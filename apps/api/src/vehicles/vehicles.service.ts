import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../db/db.module';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicle.dto';
import { VehicleRow } from './vehicle.types';

const VEHICLE_UPDATE_COLUMNS = [
  'plate',
  'make',
  'model',
  'year',
  'color',
  'capacity',
  'is_active',
] as const;

@Injectable()
export class VehiclesService {
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
    const { fields, values, nextParam } = vehicleUpdateSet(dto);
    if (fields.length === 0) throw new BadRequestException('no fields to update');
    values.push(vehicleId, driverId);

    if (dto.is_active === true) {
      return this.updateAndActivate(driverId, vehicleId, fields, values, nextParam);
    }

    try {
      const { rows } = await this.db.query<VehicleRow>(
        `UPDATE vehicles SET ${fields.join(', ')}
          WHERE id = $${nextParam} AND driver_id = $${nextParam + 1}
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

  private async updateAndActivate(
    driverId: string,
    vehicleId: string,
    fields: string[],
    values: unknown[],
    nextParam: number,
  ) {
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
          WHERE id = $${nextParam} AND driver_id = $${nextParam + 1}
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
}

function vehicleUpdateSet(dto: UpdateVehicleDto) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let param = 1;
  for (const column of VEHICLE_UPDATE_COLUMNS) {
    if (dto[column] !== undefined) {
      fields.push(`${column} = $${param++}`);
      values.push(dto[column]);
    }
  }
  return { fields, values, nextParam: param };
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
