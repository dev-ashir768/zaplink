import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddMessagesFts1782400000000 } from '../1782400000000-AddMessagesFts';

/**
 * Coverage for the AddMessagesFts migration:
 *  - the STORED generated `body_ts` tsvector + GIN index are created and stay in sync on insert/update
 *    (incl. the revoke path: clearing `body` drops the row from the matches);
 *  - re-running up() is a no-op (IF NOT EXISTS);
 *  - down() removes both objects, and down() then up() round-trips cleanly.
 */
describe('AddMessagesFts migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    await ds.query(
      `CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, "body" text)`,
    );
  });
  afterEach(async () => {
    await ds.destroy();
  });

  const hasColumn = async (): Promise<boolean> => {
    const rows = await ds.query<unknown[]>(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() ` +
        `AND table_name = 'messages' AND column_name = 'body_ts'`,
    );
    return rows.length === 1;
  };
  const hasIndex = async (): Promise<boolean> => {
    const rows = await ds.query<unknown[]>(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_messages_body_ts'`,
    );
    return rows.length === 1;
  };
  const matches = async (term: string): Promise<string[]> => {
    const rows = await ds.query<Array<{ id: string }>>(
      `SELECT "id" FROM "messages" WHERE "body_ts" @@ plainto_tsquery('simple', $1) ORDER BY "id"`,
      [term],
    );
    return rows.map(r => r.id);
  };

  it('creates body_ts + GIN index, keeps them in sync on insert, and drops rows on body clear', async () => {
    const runner = ds.createQueryRunner();
    await new AddMessagesFts1782400000000().up(runner);
    await runner.release();

    await ds.query(
      `INSERT INTO "messages" ("id","sessionId","body") VALUES ('m1','s1','hello world'), ('m2','s1','banana')`,
    );
    expect(await matches('hello')).toEqual(['m1']);

    // revoke path: clearing body drops it from the matches (the generated column is recomputed)
    await ds.query(`UPDATE "messages" SET "body" = '' WHERE "id" = 'm1'`);
    expect(await matches('hello')).toEqual([]);
  });

  it('is idempotent: re-running up() is a no-op', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessagesFts1782400000000();
    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    await runner.release();

    expect(await hasColumn()).toBe(true);
    expect(await hasIndex()).toBe(true);
  });

  it('down() drops the column and index, and up() re-creates them', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessagesFts1782400000000();
    await migration.up(runner);
    await migration.down(runner);
    expect(await hasColumn()).toBe(false);
    expect(await hasIndex()).toBe(false);

    await migration.up(runner);
    await runner.release();
    expect(await hasColumn()).toBe(true);
    expect(await hasIndex()).toBe(true);
  });
});
