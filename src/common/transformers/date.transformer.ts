import { ValueTransformer } from 'typeorm';

/**
 * Date column transformer. PostgreSQL stores a native timestamp and the driver returns a Date;
 * `from()` also accepts a string, which it parses. `to()` passes a Date through when
 * `DATABASE_TYPE=postgres` and binds its ISO string otherwise.
 */
export const DateTransformer: ValueTransformer = {
  from: (value: string | Date | null): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    return new Date(value);
  },
  to: (value: Date | null): string | Date | null => {
    if (!value) return null;
    if (value instanceof Date) {
      return process.env.DATABASE_TYPE === 'postgres' ? value : value.toISOString();
    }
    return value;
  },
};
