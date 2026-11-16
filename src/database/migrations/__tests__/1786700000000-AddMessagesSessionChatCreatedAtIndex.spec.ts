import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddMessagesSessionChatCreatedAtIndex1786700000000 } from '../1786700000000-AddMessagesSessionChatCreatedAtIndex';

describe('AddMessagesSessionChatCreatedAtIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // The messages columns this index touches, with the indexes the table already carries, so the
    // plan checks below choose among the real alternatives.
    await ds.query(
      `CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
        `"chatId" varchar NOT NULL, "waMessageId" varchar, "createdAt" timestamp NOT NULL DEFAULT now())`,
    );
    await ds.query(`CREATE INDEX "IDX_sess_created" ON "messages" ("sessionId", "createdAt")`);
    await ds.query(`CREATE INDEX "IDX_chat" ON "messages" ("chatId")`);
    await ds.query(`CREATE UNIQUE INDEX "UQ_sess_wa" ON "messages" ("sessionId", "waMessageId")`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const indexNames = async (): Promise<string[]> => {
    const rows = await ds.query<{ name: string }[]>(
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'messages'`,
    );
    return rows.map(r => r.name).sort();
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

  const plan = (sql: string): Promise<string> => explain(sql, ['s1', 'a@c.us', 'a@s.whatsapp.net']);

  it('creates the composite index', async () => {
    await new AddMessagesSessionChatCreatedAtIndex1786700000000().up(ds.createQueryRunner());

    expect(await indexNames()).toContain('IDX_messages_sessionId_chatId_createdAt');
  });

  it('is idempotent (re-running up is a no-op) and down() drops the index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessagesSessionChatCreatedAtIndex1786700000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain('IDX_messages_sessionId_chatId_createdAt');

    await migration.down(runner);
    expect(await indexNames()).not.toContain('IDX_messages_sessionId_chatId_createdAt');
  });

  it("serves a chat's total and its pacing-history probe from the index", async () => {
    // One busy session spread over many chats, so the planner prefers the chat-scoped index.
    await ds.query(
      `INSERT INTO "messages" ("id","sessionId","chatId","waMessageId") ` +
        `SELECT 'm' || g, 's1', 'c' || (g % 500) || '@c.us', 'wa' || g FROM generate_series(1, 5000) g`,
    );
    await new AddMessagesSessionChatCreatedAtIndex1786700000000().up(ds.createQueryRunner());
    await ds.query('ANALYZE "messages"');

    const total = await plan(`SELECT COUNT(1) FROM "messages" WHERE "sessionId" = $1 AND "chatId" IN ($2, $3)`);
    expect(total).toContain('IDX_messages_sessionId_chatId_createdAt');
    const probe = await plan(
      `SELECT 1 FROM "messages" WHERE "sessionId" = $1 AND "chatId" IN ($2, $3) AND "createdAt" < now() LIMIT 1`,
    );
    expect(probe).toContain('IDX_messages_sessionId_chatId_createdAt');
    // The createdAt bound is an index condition, not a filter applied after the fetch.
    expect(probe).toMatch(/Index Cond: .*"createdAt" < now\(\)/);
  });
});
