import { parseDateTimeLocal } from './dateTimeLocal';
import { toDateTimeLocal } from './sessionScope';

// The latest expiry the gateway takes: a UTC year past 9999 serializes with a six-digit year that it
// refuses. West of UTC that is earlier than 9999-12-31T23:59 local. East of it the UTC cap falls in the
// local year 10000, which new Date() cannot parse, so the local cap (still in 9999 UTC) is kept.
export function expiryMax(): string {
  const utcCap = toDateTimeLocal('9999-12-31T23:59:00.000Z');
  return utcCap.startsWith('9999-') ? utcCap : '9999-12-31T23:59';
}

// The picker only emits complete values, but a stored expiry (set from another time zone or through the API)
// can still sit past this browser's max, and new Date() cannot parse a year past 9999.
export function expiryInvalid(expires: string): boolean {
  return expires !== '' && (parseDateTimeLocal(expires) === null || expires > expiryMax());
}
