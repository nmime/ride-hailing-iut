import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class GeoPointDto {
  @ApiProperty({ example: 41.311 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 69.279 })
  @IsLongitude()
  lon!: number;
}

export class CreateTripDto {
  @ApiProperty({ type: GeoPointDto })
  pickup!: GeoPointDto;

  @ApiProperty({ type: GeoPointDto })
  dropoff!: GeoPointDto;

  @ApiProperty({ required: false, example: 'Amir Temur Square' })
  @IsOptional() @IsString() @MaxLength(256)
  pickup_address?: string;

  @ApiProperty({ required: false, example: 'Inha University in Tashkent' })
  @IsOptional() @IsString() @MaxLength(256)
  dropoff_address?: string;
}
