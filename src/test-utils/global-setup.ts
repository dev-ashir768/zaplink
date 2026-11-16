import { Client } from 'pg';
import { randomBytes } from 'crypto';
import { TEST_DATABASE_URL } from './pg-test-db';

/**
 * Installs the extensions the entities and search rely on, once, in the public schema every test schema
 * keeps on its search_path: uuid-ossp for TypeORM's uuid primary keys under synchronize, pg_trgm and unaccent
 * for contains search. Fails the run early, with a hint, when the test database is unreachable.
 */
export default async function globalSetup(): Promise<void> {
  // Workers inherit it; schemas are named after it so this run's teardown leaves other runs' schemas alone.
  process.env.ZAPLINK_TEST_RUN = randomBytes(4).toString('hex');
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `The tests need PostgreSQL at ${TEST_DATABASE_URL.replace(/:[^:@/]*@/, ':***@')} ` +
        `(start one with \`npm run test:db:start\`, or set TEST_DATABASE_URL): ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    for (const ext of ['uuid-ossp', 'pgcrypto', 'pg_trgm', 'unaccent']) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}" SCHEMA public`);
    }
  } finally {
    await client.end();
  }
}
