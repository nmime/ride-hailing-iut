import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TokenBucket } from '@ridex/ratelimiter';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { AUTH_BUCKET, USER_BUCKET } from './ratelimit.module';
import { MetricsService } from '../metrics/metrics.service';
import { SKIP_RATELIMIT } from './skip-ratelimit.decorator';

export { SKIP_RATELIMIT, SkipRateLimit } from './skip-ratelimit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly metrics: MetricsService,
    @Inject(AUTH_BUCKET) private readonly authBucket: TokenBucket,
    @Inject(USER_BUCKET) private readonly userBucket: TokenBucket,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATELIMIT, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: { sub: string } }>();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();

    const isAuth = req.url?.startsWith('/auth') ?? false;
    const bucket = isAuth ? this.authBucket : this.userBucket;
    const key = isAuth
      ? `ip:${(req.ip ?? req.socket?.remoteAddress ?? 'unknown')}`
      : `user:${req.user?.sub ?? req.ip ?? 'anon'}`;

    const decision = await bucket.take(key);
    this.metrics.rateLimitDecision(isAuth ? 'auth' : 'user', decision.allowed);

    res.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      const retrySec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      res.header('Retry-After', String(retrySec));
      this.log.warn({ key, isAuth, retrySec }, 'rate limited');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'rate_limited',
          message: 'Too many requests',
          retry_after_ms: decision.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
