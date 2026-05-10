import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RateTripDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  rating!: number;

  @ApiProperty({ required: false, example: 'Smooth ride, friendly driver.' })
  @IsOptional() @IsString() @MaxLength(512)
  comment?: string;
}
