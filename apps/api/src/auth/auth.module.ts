import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-only-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    // Apply JwtAuthGuard globally; opt-out via @Public() on a route.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
