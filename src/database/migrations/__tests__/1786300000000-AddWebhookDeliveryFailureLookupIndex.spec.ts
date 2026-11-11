import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddWebhookDeliveryFailureLookupIndex1786300000000 } from '../1786300000000-AddWebhookDeliveryFailureLookupIndex';

describe('AddWebhookDeliveryFailureLookupIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // Post-AddWebhookDeliveryFailures shape, reduced to the columns this index covers.
    await ds.query(
      `CREATE TABLE "webhook_delivery_failures" ("id" varchar PRIMARY KEY NOT NULL, ` +
        `"webhookId" varchar NOT NULL, "sessionId" varchar NOT NULL, "idempotencyKey" varchar NULL)`,
    );
    // Enough rows that the planner has a reason to prefer the index over a scan.
    const rows: string[] = [];
    for (let i = 0; i < 200; i++) {
      rows.push(`('id${i}', 'wh-${i % 5}', 's1', 'key-${i}')`);
    }
    await ds.query(
      `INSERT INTO "webhook_delivery_failures" ("id","webhookId","sessionId","idempotencyKey") VALUES ${rows.join(',')}`,
    );
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
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'webhook_delivery_failures'`,
    );
    return rows.map(r => r.name).sort();
  };

  it('creates the delivery lookup index', async () => {
    const runner = ds.createQueryRunner();
    await new AddWebhookDeliveryFailureLookupIndex1786300000000().up(runner);

    expect(await indexNames()).toContain('IDX_webhook_delivery_failures_delivery');
  });

  it('is idempotent (re-running up is a no-op) and down() drops the index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddWebhookDeliveryFailureLookupIndex1786300000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain('IDX_webhook_delivery_failures_delivery');

    await migration.down(runner);
    expect(await indexNames()).not.toContain('IDX_webhook_delivery_failures_delivery');
  });

  it('the duplicate-record lookup is served by the index, not a table scan', async () => {
    const runner = ds.createQueryRunner();
    const countQuery =
      `SELECT COUNT(*) FROM "webhook_delivery_failures" ` + `WHERE "webhookId" = 'wh-1' AND "idempotencyKey" = 'key-6'`;

    // Baseline first: without the index this really is a scan, so the assertion below is measuring
    // the index rather than a plan that was already index-served for some other reason.
    const before = await explain(countQuery);
    expect(before).toContain('Seq Scan');

    await new AddWebhookDeliveryFailureLookupIndex1786300000000().up(runner);

    const after = await explain(countQuery);
    expect(after).toContain('IDX_webhook_delivery_failures_delivery');
    expect(after).not.toContain('Seq Scan');
  });
});
