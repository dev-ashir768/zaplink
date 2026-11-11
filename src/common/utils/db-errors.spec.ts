import { QueryFailedError } from 'typeorm';
import { isUniqueViolation, isMissingTableError } from './db-errors';

// Realistic driver errors: better-sqlite3 / pg both throw an Error carrying a `code` property, which
// TypeORM wraps in QueryFailedError (message copied from the driver error). better-sqlite3 messages are
// UNPREFIXED ('no such table: x'); the legacy sqlite3 driver prefixed them ('SQLITE_ERROR: no such
// table: x') — the classifiers must keep matching both shapes.
const driverErr = (message: string, code: string): Error => Object.assign(new Error(message), { code });
const qfe = (message: string, code: string): QueryFailedError =>
  new QueryFailedError('DELETE FROM x', [], driverErr(message, code));

describe('isMissingTableError', () => {
  it('recognizes a Postgres undefined_table by its precise code (42P01)', () => {
    expect(isMissingTableError(qfe('relation "templates" does not exist', '42P01'))).toBe(true);
  });

  it('does not classify a non-QueryFailedError (even if its text mentions a missing table)', () => {
    expect(isMissingTableError(new Error('no such table: x'))).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });

  it('leaves isUniqueViolation behaviour intact (regression guard for the shared module)', () => {
    expect(isUniqueViolation(qfe('duplicate key value violates unique constraint', '23505'))).toBe(true);
    expect(isMissingTableError(qfe('duplicate key value violates unique constraint', '23505'))).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('recognizes a PostgreSQL unique_violation (code 23505), wrapped or raw-shaped', () => {
    expect(isUniqueViolation(qfe('duplicate key value violates unique constraint', '23505'))).toBe(true);
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
  });

  it('returns false for an unrelated error and for null', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('isTransientDbError', () => {});
