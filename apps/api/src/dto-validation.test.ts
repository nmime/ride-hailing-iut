import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { demoPhonesFromEnv } from './auth/demo-users';
import { DemoLoginDto, SignupDto } from './auth/dto';
import { CreateTripDto } from './trips/dto/create-trip.dto';
import { CreateVehicleDto } from './vehicles/vehicle.dto';

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
      password: 'ExamplePass123!',
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);
    expect(properties).toContain('license_number');
    expect(properties).toContain('license_expires_on');
  });

  it('validates one-click demo login input without requiring a password', async () => {
    const valid = plainToInstance(DemoLoginDto, {
      phone: '+998901111111',
      expected_role: 'rider',
    });
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = plainToInstance(DemoLoginDto, {
      phone: '901111111',
      expected_role: 'pilot',
    });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['phone', 'expected_role']),
    );
  });

  it('requires an explicit demo login phone allow-list', () => {
    expect([...demoPhonesFromEnv(undefined)]).toEqual([]);
    expect([...demoPhonesFromEnv(' +998901111111, ,+998903333333 ')]).toEqual([
      '+998901111111',
      '+998903333333',
    ]);
  });

  it('normalizes and validates vehicle plates', async () => {
    const dto = plainToInstance(CreateVehicleDto, {
      plate: '  01a-123  ',
      make: ' Chevrolet ',
      model: ' Cobalt ',
      year: 2022,
      color: ' White ',
      capacity: 4,
    });

    expect(dto.plate).toBe('01A-123');
    expect(dto.make).toBe('Chevrolet');
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });

  it('rejects unsafe vehicle plate characters', async () => {
    const dto = plainToInstance(CreateVehicleDto, {
      plate: 'bad plate!',
      make: 'Chevrolet',
      model: 'Cobalt',
      year: 2022,
      color: 'White',
      capacity: 4,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('plate');
  });
});
