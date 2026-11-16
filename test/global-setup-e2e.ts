import { Client } from 'pg';
import { TEST_DATABASE_URL } from '../src/test-utils/pg-test-db';

/**
 * Gives this e2e run a fresh PostgreSQL schema of its own (the suites run one at a time and share it, as they
 * shared one database file before). The name reaches every suite through ZAPLINK_E2E_SCHEMA, which the
 * workers inherit; setup-e2e.ts points POSTGRES_SCHEMA at it and teardown-e2e.ts drops it.
 */
export default async function globalSetup(): Promise<void> {
  const schema = `e2e_${process.pid}_${Date.now().toString(36)}`;
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `The e2e tests need PostgreSQL (start one with \`npm run test:db:start\`, or set TEST_DATABASE_URL): ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    for (const ext of ['uuid-ossp', 'pgcrypto', 'pg_trgm', 'unaccent']) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}" SCHEMA public`);
    }
    await client.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await client.end();
  }
  process.env.ZAPLINK_E2E_SCHEMA = schema;
}
