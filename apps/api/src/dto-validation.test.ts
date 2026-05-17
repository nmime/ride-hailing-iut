import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SignupDto } from './auth/dto';
import { CreateTripDto } from './trips/dto/create-trip.dto';

describe('DTO validation', () => {
  it('validates nested trip coordinates', async () => {
    const dto = plainToInstance(CreateTripDto, {
      pickup: { lat: 120, lon: 69.279 },
      dropoff: { lat: 41.33, lon: 69.25 },
    });

    const errors = await validate(dto);
    expect(JSON.stringify(errors)).toContain('pickup');
  });

  it('requires license details for driver signup', async () => {
    const dto = plainToInstance(SignupDto, {
      role: 'driver',
      full_name: 'Davron Driver',
      email: 'davron@example.test',
      phone: '+998901234567',
      password: 'ChangeMe123!',
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);
    expect(properties).toContain('license_number');
    expect(properties).toContain('license_expires_on');
  });
});
