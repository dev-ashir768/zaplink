import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddBaileysStoredMessagesSessionCreatedIdIndex1786800000000 } from '../1786800000000-AddBaileysStoredMessagesSessionCreatedIdIndex';

describe('AddBaileysStoredMessagesSessionCreatedIdIndex migration', () => {
  let ds: DataSource;
  const OLD = 'IDX_baileys_stored_messages_session_created';
  const NEW = 'IDX_baileys_stored_messages_session_created_id';

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // The table and indexes as AddBaileysStoredMessages created them.
    await ds.query(
      `CREATE TABLE "baileys_stored_messages" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
        `"waMessageId" varchar NOT NULL, "serializedMessage" text NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now())`,
    );
    await ds.query(
      `CREATE UNIQUE INDEX "UQ_baileys_stored_messages_session_wamsg" ON "baileys_stored_messages" ("sessionId", "waMessageId")`,
    );
    await ds.query(`CREATE INDEX "${OLD}" ON "baileys_stored_messages" ("sessionId", "createdAt")`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const indexNames = async (): Promise<string[]> => {
    const rows = await ds.query<{ name: string }[]>(
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'baileys_stored_messages'`,
    );
    return rows.map(r => r.name);
  };

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
  const plan = (sql: string): Promise<string> => explain(sql);

  // The cap trim's cutoff lookup (BaileysMessageStoreService.enforceLimit).
  const cutoffQuery =
    `SELECT "id", "createdAt" FROM "baileys_stored_messages" WHERE "sessionId" = 's1' ` +
    `ORDER BY "createdAt" DESC, "id" DESC LIMIT 1 OFFSET 5000`;

  it('replaces the (sessionId, createdAt) index with (sessionId, createdAt, id)', async () => {
    await new AddBaileysStoredMessagesSessionCreatedIdIndex1786800000000().up(ds.createQueryRunner());

    const names = await indexNames();
    expect(names).toContain(NEW);
    expect(names).not.toContain(OLD);
    const columns = await ds.query<{ name: string }[]>(
      `SELECT a.attname AS name FROM pg_index i ` +
        `JOIN pg_class c ON c.oid = i.indexrelid ` +
        `JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ` +
        `WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace ` +
        `ORDER BY array_position(i.indkey::int2[], a.attnum)`,
      [NEW],
    );
    expect(columns.map(c => c.name)).toEqual(['sessionId', 'createdAt', 'id']);
  });

  it('drops the redundant unnamed (sessionId, createdAt) index a synchronized table carries', async () => {
    await ds.query(
      `CREATE INDEX "IDX_ae44b476c522450bd395615a7c" ON "baileys_stored_messages" ("sessionId", "createdAt")`,
    );

    await new AddBaileysStoredMessagesSessionCreatedIdIndex1786800000000().up(ds.createQueryRunner());

    expect(await indexNames()).not.toContain('IDX_ae44b476c522450bd395615a7c');
  });

  it('is idempotent, and down() restores the old index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddBaileysStoredMessagesSessionCreatedIdIndex1786800000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();

    await migration.down(runner);
    await expect(migration.down(runner)).resolves.toBeUndefined();
    const names = await indexNames();
    expect(names).toContain(OLD);
    expect(names).not.toContain(NEW);
  });

  it('serves the cap cutoff from the index without a sort', async () => {
    // Baseline: the old index leaves the id tiebreak to a sort step.
    expect(await plan(cutoffQuery)).toContain('Sort');

    await new AddBaileysStoredMessagesSessionCreatedIdIndex1786800000000().up(ds.createQueryRunner());

    const after = await plan(cutoffQuery);
    expect(after).toContain(NEW);
    expect(after).not.toContain('Sort');
  });
});
