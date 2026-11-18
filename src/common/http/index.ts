import { Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

/**
 * The API's response contract as global providers: successes as `{ success, message, data }`, every error
 * as `{ success: false, message, errors, data: null, ... }`. AppModule registers them; a test module that
 * stands in for it registers the same list so it answers in the same shape.
 */
export const RESPONSE_ENVELOPE_PROVIDERS: Provider[] = [
  { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
];
