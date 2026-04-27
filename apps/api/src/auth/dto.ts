import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ enum: ['rider','driver'] })
  @IsEnum(['rider','driver'])
  role!: 'rider' | 'driver';

  @ApiProperty()
  @IsString() @IsNotEmpty()
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
}

export class LoginDto {
  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+\d{8,15}$/)
  phone!: string;

  @ApiProperty()
  @MinLength(8)
  password!: string;
}
