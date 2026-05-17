import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export const VEHICLE_PLATE_PATTERN = /^[A-Za-z0-9-]{3,16}$/;

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizePlate(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class CreateVehicleDto {
  @ApiProperty({ example: '01A123BC' })
  @Transform(({ value }) => normalizePlate(value))
  @IsString()
  @Matches(VEHICLE_PLATE_PATTERN)
  @Length(3, 16)
  plate!: string;

  @ApiProperty({ example: 'Chevrolet' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 64)
  make!: string;

  @ApiProperty({ example: 'Cobalt' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 64)
  model!: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 'White' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 32)
  color!: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(8)
  capacity!: number;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => normalizePlate(value))
  @Matches(VEHICLE_PLATE_PATTERN)
  plate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 64)
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 64)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 32)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
