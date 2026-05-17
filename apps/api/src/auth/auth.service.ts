import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import argon2 from 'argon2';

import { PG_POOL } from '../db/db.module';
import { SignupDto, LoginDto } from './dto';

export interface JwtPayload {
  sub: string; // user id
  role: 'rider' | 'driver' | 'admin';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly db: Pool,
    private readonly jwt: JwtService,
  ) {}

  /** Register a new user. Riders go straight in; drivers also provide
   *  licence details so the driver profile is complete from day one. */
  async signup(dto: SignupDto) {
    const exists = await this.db.query(`SELECT 1 FROM users WHERE email = $1 OR phone = $2`, [
      dto.email,
      dto.phone,
    ]);
    if (exists.rowCount! > 0) throw new ConflictException('email or phone in use');

    const password_hash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users (role, full_name, email, phone, password_hash)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, role`,
        [dto.role, dto.full_name, dto.email, dto.phone, password_hash],
      );
      const user = rows[0];

      if (dto.role === 'driver') {
        await client.query(
          `INSERT INTO drivers (user_id, license_number, license_expires_on, status)
           VALUES ($1, $2, $3::date, 'offline')`,
          [user.id, dto.license_number, dto.license_expires_on],
        );
      }
      await client.query('COMMIT');

      const token = await this.signToken({ sub: user.id, role: user.role });
      return { id: user.id, role: user.role, token };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async login(dto: LoginDto) {
    const { rows } = await this.db.query(
      `SELECT id, role, password_hash, is_active
         FROM users WHERE phone = $1`,
      [dto.phone],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new UnauthorizedException('bad credentials');
    const ok = await argon2.verify(user.password_hash, dto.password);
    if (!ok) throw new UnauthorizedException('bad credentials');
    const token = await this.signToken({ sub: user.id, role: user.role });
    return { id: user.id, role: user.role, token };
  }

  private signToken(payload: JwtPayload) {
    return this.jwt.signAsync(payload);
  }
}
