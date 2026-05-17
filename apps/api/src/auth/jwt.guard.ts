import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';

import { JwtPayload } from './auth.service';

export const PUBLIC = 'is_public';
export const Public = () => SetMetadata(PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Array<'rider' | 'driver' | 'admin'>) => SetMetadata(ROLES, roles);

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      req.user = await this.jwt.verifyAsync<JwtPayload>(auth.slice(7));
    } catch {
      throw new UnauthorizedException('invalid token');
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (requiredRoles.length && !requiredRoles.includes(req.user!.role)) {
      throw new ForbiddenException(`requires role: ${requiredRoles.join('|')}`);
    }
    return true;
  }
}
