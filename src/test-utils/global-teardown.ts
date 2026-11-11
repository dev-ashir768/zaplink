import { Client } from 'pg';
import { TEST_DATABASE_URL, TEST_SCHEMA_PREFIX, testRunId } from './pg-test-db';

/** Drops the schemas this run's suites created (t_<run>_<random>), never those of a run still going. */
export default async function globalTeardown(): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE $1`, [
      `${TEST_SCHEMA_PREFIX}${testRunId()}_%`,
    ]);
    for (const { nspname } of rows) await client.query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
  } catch {
    // The suites already report a database they could not reach; teardown has nothing to add.
  } finally {
    await client.end().catch(() => undefined);
  }
}
