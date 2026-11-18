import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REDIRECT_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { Observable, map } from 'rxjs';
import { isEnvelope, RAW_RESPONSE_KEY, RESPONSE_MESSAGE_KEY, successEnvelope } from './api-response';

/** Paths whose answers are not JSON API responses even when a Nest handler produces them. */
const UNWRAPPED_PATH_PREFIXES = ['/api/docs', '/api/admin/queues', '/mcp', '/socket.io', '/events'];

/** The default `message` for a successful response, by method and status. */
export function defaultSuccessMessage(method: string, status: number): string {
  if (status === 201) return 'Created';
  if (status === 202) return 'Accepted';
  if (method === 'DELETE') return 'Deleted';
  if (method === 'PUT' || method === 'PATCH') return 'Updated';
  return 'OK';
}

/**
 * Wraps every JSON handler result as `{ success: true, message, data }`. Anything that is not a JSON
 * body is passed through untouched: an empty result (204 or a void handler), a stream, a file, a
 * Buffer, a plain string (Prometheus text), a redirect, SSE, a response the handler already sent
 * itself (@Res, a proxied request), a non-JSON Content-Type, and an already-enveloped body.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, targets) ||
      Reflect.getMetadata(SSE_METADATA, context.getHandler()) ||
      Reflect.getMetadata(REDIRECT_METADATA, context.getHandler())
    ) {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (UNWRAPPED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
      return next.handle();
    }
    const custom = this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, targets);

    return next.handle().pipe(
      map((data: unknown) => {
        if (!shouldWrap(data, res)) return data;
        return successEnvelope(data, custom ?? defaultSuccessMessage(req.method, res.statusCode));
      }),
    );
  }
}

function shouldWrap(data: unknown, res: Response): boolean {
  if (data === undefined) return false;
  if (res.headersSent || res.writableEnded) return false;
  if (res.statusCode === 204 || res.statusCode === 304) return false;
  if (res.statusCode >= 300 && res.statusCode < 400) return false;
  if (typeof data === 'string') return false;
  if (data instanceof StreamableFile || data instanceof Readable || Buffer.isBuffer(data)) return false;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return false;
  const type = res.getHeader('content-type');
  if (type !== undefined && !/json/i.test(String(type))) return false;
  return !isEnvelope(data);
}
