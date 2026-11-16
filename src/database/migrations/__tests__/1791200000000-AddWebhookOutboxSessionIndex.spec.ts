import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddWebhookOutboxEvents1786200000000 } from '../1786200000000-AddWebhookOutboxEvents';
import { AddWebhookOutboxSessionIndex1791200000000 } from '../1791200000000-AddWebhookOutboxSessionIndex';

const INDEX = 'IDX_webhook_outbox_events_sessionId';

describe('AddWebhookOutboxSessionIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    const runner = ds.createQueryRunner();
    await new AddWebhookOutboxEvents1786200000000().up(runner);
    await runner.release();
    // Many sessions' rows, as a long retention window of a busy event leaves behind.
    const rows: string[] = [];
    for (let i = 0; i < 300; i++) {
      rows.push(`('id${i}', 'wh${i % 7}', 'sess-${i % 3}', 'message.receipt', 'key${i}', 'd${i}', 0)`);
    }
    await ds.query(
      `INSERT INTO "webhook_outbox_events" ("id","webhookId","sessionId","event","idempotencyKey","deliveryId","attempts") VALUES ${rows.join(',')}`,
    );
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
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'webhook_outbox_events'`,
    );
    return rows.map(r => r.name).sort();
  };

  it('adds the session index next to the existing two', async () => {
    const runner = ds.createQueryRunner();
    await new AddWebhookOutboxSessionIndex1791200000000().up(runner);

    expect(await indexNames()).toEqual(
      expect.arrayContaining([
        INDEX,
        'IDX_webhook_outbox_events_state_createdAt',
        'UQ_webhook_outbox_events_webhook_key',
      ]),
    );
  });

  it('is idempotent (re-running up is a no-op) and down() drops only its own index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddWebhookOutboxSessionIndex1791200000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain(INDEX);

    await migration.down(runner);
    const after = await indexNames();
    expect(after).not.toContain(INDEX);
    expect(after).toContain('IDX_webhook_outbox_events_state_createdAt');
  });

  it('serves the per-session lookup of a session delete', async () => {
    const lookup = `SELECT "id" FROM "webhook_outbox_events" WHERE "sessionId" = 'sess-1' LIMIT 500`;

    // Baseline: with no index on sessionId the lookup reads the whole table.
    const before = await explain(lookup);
    expect(before).not.toContain(INDEX);

    await new AddWebhookOutboxSessionIndex1791200000000().up(ds.createQueryRunner());

    const after = await explain(lookup);
    expect(after).toContain(INDEX);
  });
});
