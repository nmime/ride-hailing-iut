import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { SignupDto, LoginDto } from './dto';
import { Public } from './jwt.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new rider or driver' })
  @ApiResponse({ status: 201, description: '{ id, role, token }' })
  @ApiResponse({ status: 409, description: 'email or phone already in use' })
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange phone+password for a JWT' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
