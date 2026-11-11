import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddStatusMediaPathIndex1791800000000 } from '../1791800000000-AddStatusMediaPathIndex';

describe('AddStatusMediaPathIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // The status_updates table, with only the columns this index needs.
    await ds.query(
      `CREATE TABLE "status_updates" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
        `"mediaPath" varchar NULL)`,
    );
    // Many stories carry no media; a handful have a stored file.
    const rows: string[] = [];
    for (let i = 0; i < 200; i++) {
      rows.push(`('id${i}', 's1', ${i % 20 === 0 ? `'statuses/s1/${i}.jpg'` : 'NULL'})`);
    }
    await ds.query(`INSERT INTO "status_updates" ("id","sessionId","mediaPath") VALUES ${rows.join(',')}`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  // Postgres EXPLAIN on one connection with sequential and bitmap scans disabled, so the plan names the
  // index a small test table would otherwise skip in favour of a scan.
  const explain = async (sql: string): Promise<string> => {
    const qr = ds.createQueryRunner();
    try {
      await qr.query('SET enable_seqscan = off');
      await qr.query('SET enable_bitmapscan = off');
      const rows = (await qr.query(`EXPLAIN ${sql}`)) as Array<{ 'QUERY PLAN': string }>;
      return rows.map(r => r['QUERY PLAN']).join(' | ');
    } finally {
      await qr.query('RESET enable_seqscan');
      await qr.query('RESET enable_bitmapscan');
      await qr.release();
    }
  };

  const indexNames = async (): Promise<string[]> => {
    const rows = await ds.query<{ name: string }[]>(
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'status_updates'`,
    );
    return rows.map(r => r.name).sort();
  };

  it('creates the partial mediaPath index', async () => {
    const runner = ds.createQueryRunner();
    await new AddStatusMediaPathIndex1791800000000().up(runner);

    expect(await indexNames()).toContain('IDX_status_updates_mediaPath');
    // Partial: the column is NULL for every story without stored media, which a full index would carry for nothing.
    const [created] = await ds.query<{ sql: string }[]>(
      `SELECT indexdef AS sql FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'IDX_status_updates_mediaPath'`,
    );
    expect(created.sql).toMatch(/WHERE \("?mediaPath"? IS NOT NULL\)/);
  });

  it('is idempotent (re-running up is a no-op) and down() drops the index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddStatusMediaPathIndex1791800000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain('IDX_status_updates_mediaPath');

    await migration.down(runner);
    expect(await indexNames()).not.toContain('IDX_status_updates_mediaPath');
  });

  it('the orphan sweep mediaPath IN (...) predicate is served by the index, not a table scan', async () => {
    const runner = ds.createQueryRunner();
    await new AddStatusMediaPathIndex1791800000000().up(runner);

    const detail = await explain(
      `SELECT "mediaPath" FROM "status_updates" WHERE "mediaPath" IN ('statuses/s1/0.jpg', 'statuses/s1/20.jpg')`,
    );
    expect(detail).toContain('IDX_status_updates_mediaPath');
    expect(detail).not.toContain('Seq Scan');
  });
});
