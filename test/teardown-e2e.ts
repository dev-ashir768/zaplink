import { readdirSync, rmSync, statSync } from 'fs';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from '../src/test-utils/pg-test-db';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Remove the throwaway state roots earlier runs left behind.
 *
 * Every suite gets its own root (setupFiles runs once per test file), so a run leaves one directory
 * per suite behind. Nothing removed them before and the temp dir accumulated hundreds of entries.
 * Only entries older than an hour are swept, so this run's own roots and key files stay
 * until a later run removes them: the age bound keeps this from deleting a root a concurrent run is
 * still using, and a killed run's litter goes the same way.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

export default async function teardown(): Promise<void> {
  const schema = process.env.ZAPLINK_E2E_SCHEMA;
  if (schema) {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    try {
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch {
      // An unreachable database already failed the run; nothing more to clean.
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  const root = tmpdir();
  const cutoff = Date.now() - MAX_AGE_MS;
  let entries: string[];
  try {
    entries = readdirSync(root).filter(name => name.startsWith('zaplink-e2e-'));
  } catch {
    return;
  }
  for (const name of entries) {
    const target = join(root, name);
    try {
      if (statSync(target).mtimeMs < cutoff) rmSync(target, { force: true, recursive: true });
    } catch {
      // A root the OS or another run removed underneath us is already the outcome we wanted.
    }
  }
}
