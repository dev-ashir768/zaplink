import { QueryFailedError } from 'typeorm';

/** Structural view of the driver errors these predicates classify, so classification survives realms. */
type DriverErrorShape = { code?: string; message?: string };
type DriverErrorWrapperShape = { name?: unknown; code?: string; message?: string; driverError?: DriverErrorShape };

// Classify on the stable `name` rather than `instanceof` alone: each copy of typeorm carries a distinct
// QueryFailedError class, and TypeORMError sets `name` via `get name()`.
function isNamedError(err: unknown, name: string): err is DriverErrorWrapperShape {
  return typeof err === 'object' && err !== null && (err as DriverErrorWrapperShape).name === name;
}

function isQueryFailedErrorLike(err: unknown): err is DriverErrorWrapperShape {
  return err instanceof QueryFailedError || isNamedError(err, 'QueryFailedError');
}

/**
 * Unique-constraint violation (Postgres `23505`). Lets insert-or-converge paths tell a real duplicate
 * from an unrelated failure.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as DriverErrorWrapperShape;
  return (e.driverError?.code ?? e.code) === '23505';
}

/**
 * "The table does not exist" (Postgres `42P01` undefined_table). Keeps a table-clearing DELETE tolerant of a
 * genuinely-absent table while still surfacing every other failure.
 */
export function isMissingTableError(err: unknown): boolean {
  return isQueryFailedErrorLike(err) && err.driverError?.code === '42P01';
}

/**
 * Postgres codes meaning "not now", not "your query is wrong": admin_shutdown (57P01), cannot_connect_now
 * (57P03) and too_many_connections (53300).
 */
const TRANSIENT_DB_CODES = new Set(['57P01', '57P03', '53300']);

/**
 * A database failure worth one retry: the database or its pool said "not now" (lock contention, a
 * dropped connection, pg-pool's connection timeout), not a rejected statement. A unique violation is
 * never transient: callers read it as the dedup oracle.
 */
export function isTransientDbError(err: unknown): boolean {
  if (err == null || typeof err !== 'object' || isUniqueViolation(err)) return false;
  const e = err as DriverErrorWrapperShape;
  const code = e.driverError?.code ?? e.code;
  if (typeof code === 'string' && TRANSIENT_DB_CODES.has(code)) return true;
  return /connection|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|terminating connection|timeout exceeded when trying to connect/i.test(
    typeof e.message === 'string' ? e.message : '',
  );
}
