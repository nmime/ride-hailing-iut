import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  trace_id?: string;
  details?: unknown;
}

/**
 * Single error envelope for the whole API. Maps NestJS HttpExceptions to
 * `{ statusCode, code, message, trace_id, details? }` so client UIs can
 * key on `code` and operators can paste `trace_id` straight into Tempo.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    const span = trace.getActiveSpan();
    const traceId = span?.spanContext()?.traceId;

    let envelope: ErrorEnvelope;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const isObject = typeof res === 'object' && res !== null;
      const obj = isObject ? (res as Record<string, unknown>) : { message: String(res) };
      envelope = {
        statusCode: status,
        code: typeof obj.code === 'string' ? obj.code : codeFor(status),
        message: typeof obj.message === 'string'
          ? obj.message
          : Array.isArray(obj.message)
            ? (obj.message as string[]).join('; ')
            : exception.message,
        trace_id: traceId,
        details: 'errors' in obj ? obj.errors : (obj.details ?? undefined),
      };
    } else {
      this.log.error({ err: exception, url: req.url }, 'unhandled exception');
      envelope = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_error',
        message: 'Internal server error',
        trace_id: traceId,
      };
    }

    reply.status(envelope.statusCode).send(envelope);
  }
}

function codeFor(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 422: return 'validation_error';
    case 429: return 'rate_limited';
    default:  return 'error';
  }
}
