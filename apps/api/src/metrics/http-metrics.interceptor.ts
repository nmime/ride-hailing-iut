import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { MetricsService } from './metrics.service';

/**
 * Records every HTTP response in the `http_server_request_duration_seconds`
 * histogram with `http_route`, `http_request_method`, and `http_response_status_code`
 * labels. Errors are still recorded, with their numeric status.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const route =
      (req as unknown as { routeOptions?: { url?: string }; url?: string }).routeOptions?.url ??
      req.url ??
      'unknown';
    const method = req.method ?? 'GET';

    const finish = (status: number) => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      const elapsedS = elapsedNs / 1e9;
      this.metrics.observeHttp(elapsedS, route, method, status);
    };

    return next.handle().pipe(
      tap({
        next: () => finish(res.statusCode),
        error: (e) => finish(typeof e?.status === 'number' ? e.status : 500),
      }),
    );
  }
}
