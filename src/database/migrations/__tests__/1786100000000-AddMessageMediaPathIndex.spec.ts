import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddMessageMediaPathIndex1786100000000 } from '../1786100000000-AddMessageMediaPathIndex';

describe('AddMessageMediaPathIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // Post-AddMessageMediaArchive shape of the messages table (only the columns this index needs).
    await ds.query(
      `CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
        `"mediaPath" varchar NULL)`,
    );
    // Mostly-NULL mediaPath (the archive is opt-in) with a handful of archived rows.
    const rows: string[] = [];
    for (let i = 0; i < 200; i++) {
      rows.push(`('id${i}', 's1', ${i % 20 === 0 ? `'media/${i}.bin'` : 'NULL'})`);
    }
    await ds.query(`INSERT INTO "messages" ("id","sessionId","mediaPath") VALUES ${rows.join(',')}`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  // Postgres EXPLAIN on one connection with sequential scans (and bitmap scans) disabled, so the
  // plan names the index a tiny test table would otherwise skip in favour of a scan.
  const explain = async (sql: string, params: unknown[] = []): Promise<string> => {
    const qr = ds.createQueryRunner();
    try {
      await qr.query('SET enable_seqscan = off');
      await qr.query('SET enable_bitmapscan = off');
      const rows = (await qr.query(`EXPLAIN ${sql}`, params)) as Array<{ 'QUERY PLAN': string }>;
      return rows.map(r => r['QUERY PLAN']).join(' | ');
    } finally {
      await qr.query('RESET enable_seqscan');
      await qr.query('RESET enable_bitmapscan');
      await qr.release();
    }
  };

  const indexNames = async (): Promise<string[]> => {
    const rows = await ds.query<{ name: string }[]>(
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'messages'`,
    );
    return rows.map(r => r.name).sort();
  };

  it('creates the partial mediaPath index', async () => {
    const runner = ds.createQueryRunner();
    await new AddMessageMediaPathIndex1786100000000().up(runner);

    expect(await indexNames()).toContain('IDX_messages_mediaPath');
  });

  it('is idempotent (re-running up is a no-op) and down() drops the index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessageMediaPathIndex1786100000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain('IDX_messages_mediaPath');

    await migration.down(runner);
    expect(await indexNames()).not.toContain('IDX_messages_mediaPath');
  });

  it('the orphan sweep mediaPath IN (...) predicate is served by the index, not a table scan', async () => {
    const runner = ds.createQueryRunner();
    await new AddMessageMediaPathIndex1786100000000().up(runner);

    const detail = await explain(
      `SELECT "mediaPath" FROM "messages" WHERE "mediaPath" IN ('media/0.bin', 'media/20.bin')`,
    );
    expect(detail).toContain('IDX_messages_mediaPath');
    expect(detail).not.toContain('Seq Scan');
  });
});
