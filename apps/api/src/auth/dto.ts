import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SignupDto {
  @ApiProperty({ enum: ['rider', 'driver'] })
  @IsEnum(['rider', 'driver'])
  role!: 'rider' | 'driver';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  full_name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+\d{8,15}$/, { message: 'phone must be E.164 (e.g. +998901234567)' })
  phone!: string;

  @ApiProperty()
  @MinLength(8)
  password!: string;

  @ApiProperty({ required: false, example: 'TX-4242' })
  @ValidateIf((dto: SignupDto) => dto.role === 'driver')
  @IsString()
  @MinLength(4)
  license_number?: string;

  @ApiProperty({ required: false, example: '2031-12-31' })
  @ValidateIf((dto: SignupDto) => dto.role === 'driver')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'license_expires_on must be YYYY-MM-DD' })
  license_expires_on?: string;
}

export class LoginDto {
  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+\d{8,15}$/)
  phone!: string;

  @ApiProperty()
  @MinLength(8)
  password!: string;
}
