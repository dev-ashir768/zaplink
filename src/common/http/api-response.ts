import { SetMetadata } from '@nestjs/common';

/** One rejected field of a request: its dotted path (`items.0.phone`) and why it was refused. */
export interface FieldError {
  field: string;
  message: string;
}

/** The body of every successful JSON API response. */
export interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  message: string;
  data: T;
}

/**
 * The body of every failed API response. Machine-readable extras an error carried before the envelope
 * existed (`code`, `sessionId`, `engine`, `retryAfterSeconds`, ...) stay as further top-level fields.
 */
export interface ApiErrorEnvelope {
  success: false;
  message: string;
  errors: FieldError[];
  data: null;
  requestId?: string;
  [extra: string]: unknown;
}

export function successEnvelope<T>(data: T, message: string): ApiSuccessEnvelope<T> {
  return { success: true, message, data };
}

/** Build an error body. Envelope keys always win over a same-named extra. */
export function errorEnvelope(
  message: string,
  extras: Record<string, unknown> = {},
  errors: FieldError[] = [],
): ApiErrorEnvelope {
  const body: ApiErrorEnvelope = { success: false, message, errors, data: null };
  for (const [key, value] of Object.entries(extras)) if (!(key in body)) body[key] = value;
  return body;
}

/** True when `body` is already an envelope (a relayed or replayed answer), so it is never wrapped twice. */
export function isEnvelope(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { success?: unknown }).success === 'boolean' &&
    'data' in body &&
    typeof (body as { message?: unknown }).message === 'string'
  );
}

export const RESPONSE_MESSAGE_KEY = 'zaplink:response-message';
export const RAW_RESPONSE_KEY = 'zaplink:raw-response';

/** The `message` a successful response from this handler carries, instead of the per-status default. */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

/** Send this handler's return value as is, without the success envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

/**
 * The error envelope for a raw Express answer written outside Nest's exception layer (a middleware that
 * must answer itself instead of calling next(err)). Carries the request id the request-context
 * middleware set, when it ran.
 */
export function rawErrorBody(
  res: { getHeader?(name: string): unknown },
  message: string,
  extras: Record<string, unknown> = {},
): ApiErrorEnvelope {
  const requestId = typeof res.getHeader === 'function' ? res.getHeader('X-Request-ID') : undefined;
  return errorEnvelope(message, { ...extras, ...(typeof requestId === 'string' ? { requestId } : {}) });
}
