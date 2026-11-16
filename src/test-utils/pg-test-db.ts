/**
 * PostgreSQL for the test suites.
 *
 * Every test DataSource gets a schema of its own, created on connect and named uniquely, so suites run in
 * parallel against one database without seeing each other's rows. The connection comes from
 * TEST_DATABASE_URL (default: the local test container, see README "Running the tests").
 *
 * Usage: `new DataSource({ ...pgTestOptions(), entities: [Message], synchronize: true })`.
 * Two DataSources that must share tables (an app connection and a second reader) pass the same schema:
 * `const schema = testSchemaName(); ... pgTestOptions(schema) ... pgTestOptions(schema)`.
 */
import { randomBytes } from 'crypto';
import type { ClientBase } from 'pg';
import { postgresUtcExtra } from '../database/postgres-utc';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://zaplink:zaplink@127.0.0.1:55432/zaplink_test';

/** Prefix of every schema a test creates; the global teardown drops what is left of them. */
export const TEST_SCHEMA_PREFIX = 't_';

/** Id of this jest run (set by global-setup.ts), so its teardown drops only the schemas this run made. */
export function testRunId(): string {
  return process.env.ZAPLINK_TEST_RUN || 'adhoc';
}

/** A fresh, unique schema name: t_<run>_<random>. */
export function testSchemaName(): string {
  return `${TEST_SCHEMA_PREFIX}${testRunId()}_${randomBytes(6).toString('hex')}`;
}

/** The connection fields of TEST_DATABASE_URL, for code that takes them one by one (DATABASE_HOST, ...). */
export function testDatabaseEnv(): {
  DATABASE_HOST: string;
  DATABASE_PORT: string;
  DATABASE_USERNAME: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
} {
  const url = new URL(TEST_DATABASE_URL);
  return {
    DATABASE_HOST: url.hostname,
    DATABASE_PORT: url.port || '5432',
    DATABASE_USERNAME: decodeURIComponent(url.username),
    DATABASE_PASSWORD: decodeURIComponent(url.password),
    DATABASE_NAME: url.pathname.replace(/^\//, ''),
  };
}

/** Creates the schema; two pool connections racing on it is fine (the loser sees it exists). */
async function ensureSchema(client: ClientBase, schema: string): Promise<void> {
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '23505' && code !== '42P06') throw error;
  }
}

/**
 * DataSource options for a test database in its own schema. The schema is created on each new connection
 * and set as the search_path, so raw SQL without a schema prefix reaches it too. Timestamps are pinned to UTC
 * exactly as on the app's connections.
 */
export function pgTestOptions(schema: string = testSchemaName()) {
  const utc = postgresUtcExtra(undefined, { searchPath: `${schema},public` });
  return {
    type: 'postgres' as const,
    url: TEST_DATABASE_URL,
    // No `schema` option: TypeORM would issue its own CREATE SCHEMA and race the pool. The search_path set on
    // connect makes this schema the current one, which TypeORM introspects when no schema is given.
    extra: {
      max: 4,
      types: utc.types,
      onConnect: async (client: ClientBase): Promise<void> => {
        await ensureSchema(client, schema);
        await utc.onConnect(client);
      },
    },
  };
}
