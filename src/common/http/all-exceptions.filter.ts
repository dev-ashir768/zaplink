import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { createLogger } from '../services/logger.service';
import { getRequestId } from '../services/request-context';
import { isUniqueViolation } from '../utils/db-errors';
import { ApiErrorEnvelope, errorEnvelope, FieldError } from './api-response';
import { VALIDATION_FAILED_MESSAGE } from './validation-errors';

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** Keys of Nest's built-in error body that the envelope replaces rather than carries over. */
const REPLACED_KEYS = new Set(['statusCode', 'message', 'errors', 'success', 'data']);

interface Resolved {
  status: number;
  message: string;
  errors: FieldError[];
  extras: Record<string, unknown>;
}

function reason(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/** class-validator's own messages start with the property name ("name must be a string"). */
function fieldErrorFromString(message: string): FieldError {
  const field = /^([\w.[\]-]+)\s/.exec(message)?.[1] ?? '';
  return { field, message };
}

function isFieldErrorList(value: unknown): value is FieldError[] {
  return (
    Array.isArray(value) &&
    value.every(e => typeof e === 'object' && e !== null && typeof (e as FieldError).message === 'string')
  );
}

function fromHttpException(exception: HttpException): Resolved {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (typeof body === 'string') return { status, message: body, errors: [], extras: {} };

  const record = (body ?? {}) as Record<string, unknown>;
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (REPLACED_KEYS.has(key)) continue;
    // Nest's `error` is the reason phrase, which the status line already carries; a structured
    // `error` (e.g. a health-check result) is information and stays.
    if (key === 'error' && typeof value === 'string') continue;
    extras[key] = value;
  }

  let errors: FieldError[] = isFieldErrorList(record.errors)
    ? record.errors.map(e => ({ field: String(e.field ?? ''), message: e.message }))
    : [];
  let message: string;
  const raw = record.message;
  if (Array.isArray(raw)) {
    // Nest's default ValidationPipe output (and any other list of messages): one entry per failure.
    const strings = raw.map(String);
    if (errors.length === 0) errors = strings.map(fieldErrorFromString);
    message = strings.length === 1 ? strings[0] : VALIDATION_FAILED_MESSAGE;
  } else if (typeof raw === 'string' && raw.length > 0) {
    message = raw;
  } else {
    message = typeof record.error === 'string' ? record.error : reason(status);
  }
  return { status, message, errors, extras };
}

/** An http-errors style error (body-parser, raw-body): it names its own 4xx status and says if its text is safe. */
function fromHttpError(exception: Record<string, unknown>): Resolved | undefined {
  const status = Number(exception.status ?? exception.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 599) return undefined;
  const type = exception.type;
  let message: string;
  if (type === 'entity.parse.failed') message = 'Malformed JSON in request body';
  else if (type === 'entity.too.large') message = 'Request body is too large';
  else if (type === 'encoding.unsupported' || type === 'charset.unsupported')
    message = typeof exception.message === 'string' ? exception.message : reason(status);
  else if (status < 500 && exception.expose === true && typeof exception.message === 'string')
    message = exception.message;
  else message = status >= 500 ? INTERNAL_ERROR_MESSAGE : reason(status);
  return { status, message, errors: [], extras: {} };
}

function fromTypeOrm(exception: unknown): Resolved | undefined {
  const name = (exception as { name?: unknown })?.name;
  if (name === 'EntityNotFoundError') {
    return { status: HttpStatus.NOT_FOUND, message: 'Resource not found', errors: [], extras: {} };
  }
  if (name === 'QueryFailedError' && isUniqueViolation(exception)) {
    return { status: HttpStatus.CONFLICT, message: 'Resource already exists', errors: [], extras: {} };
  }
  return undefined;
}

/** Turn any thrown value into a status and an envelope body. Exported for the raw-middleware paths and specs. */
export function resolveException(exception: unknown): Resolved {
  if (exception instanceof HttpException) return fromHttpException(exception);
  const typeorm = fromTypeOrm(exception);
  if (typeorm) return typeorm;
  if (typeof exception === 'object' && exception !== null) {
    const http = fromHttpError(exception as Record<string, unknown>);
    if (http) return http;
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: INTERNAL_ERROR_MESSAGE, errors: [], extras: {} };
}

/**
 * The one global exception filter: every error, from a handler, a guard, a pipe, the router's 404 or a
 * raw Express middleware that calls next(err), is answered with the error envelope
 * `{ success: false, message, errors, data: null, requestId, ...extras }` and its real HTTP status.
 * Headers already set (WWW-Authenticate, Retry-After, rate-limit headers) are kept. An error that is
 * not an HttpException is answered with a generic 500 and logged in full, with the request id, here.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = createLogger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const resolved = resolveException(exception);
    const requestId = getRequestId() ?? (res.getHeader?.('X-Request-ID') as string | undefined);

    if (resolved.status >= 500) {
      const known = exception instanceof HttpException;
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      const meta = {
        requestId,
        method: req?.method,
        path: (req?.originalUrl ?? '').split('?')[0],
        status: resolved.status,
      };
      if (known) this.logger.warn(`${resolved.message}`, meta);
      else this.logger.error(`Unhandled exception: ${detail}`, meta);
    }

    if (res.headersSent || res.writableEnded) {
      // Part of the answer is already on the wire; the only honest thing left is to cut it.
      if (!res.writableEnded) res.destroy();
      return;
    }
    const body: ApiErrorEnvelope = errorEnvelope(
      resolved.message,
      { ...resolved.extras, ...(requestId ? { requestId } : {}) },
      resolved.errors,
    );
    res.status(resolved.status).json(body);
  }
}
