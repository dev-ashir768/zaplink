import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddIntegrationFabric1781900000000 } from '../1781900000000-AddIntegrationFabric';
import { AddIntegrationDeliveryFailureDeliveryIndex1791100000000 } from '../1791100000000-AddIntegrationDeliveryFailureDeliveryIndex';

const INDEX = 'IDX_integration_delivery_failures_instance_delivery';

describe('AddIntegrationDeliveryFailureDeliveryIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    const runner = ds.createQueryRunner();
    await new AddIntegrationFabric1781900000000().up(runner);
    await runner.release();
    // One instance holding many dead letters, which is the shape that made the guards scan.
    const rows: string[] = [];
    for (let i = 0; i < 200; i++) {
      rows.push(`('id${i}', 'inbound', 'plug', 'inst', 'd${i}', 1, 'sandbox 5xx', false)`);
    }
    await ds.query(
      `INSERT INTO "integration_delivery_failures" ("id","direction","pluginId","instanceId","deliveryId","attempts","lastError","redriven") VALUES ${rows.join(',')}`,
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
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'integration_delivery_failures'`,
    );
    return rows.map(r => r.name).sort();
  };

  it('creates the per-delivery index next to the instance index', async () => {
    const runner = ds.createQueryRunner();
    await new AddIntegrationDeliveryFailureDeliveryIndex1791100000000().up(runner);

    expect(await indexNames()).toEqual(expect.arrayContaining([INDEX, 'IDX_integration_delivery_failures_instance']));
  });

  it('is idempotent (re-running up is a no-op) and down() drops only its own index', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddIntegrationDeliveryFailureDeliveryIndex1791100000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain(INDEX);

    await migration.down(runner);
    const after = await indexNames();
    expect(after).not.toContain(INDEX);
    expect(after).toContain('IDX_integration_delivery_failures_instance');
  });

  it('the open dead-letter guard is served by the per-delivery index', async () => {
    const runner = ds.createQueryRunner();
    const guard =
      `SELECT COUNT(*) FROM "integration_delivery_failures" ` +
      `WHERE "direction" = 'inbound' AND "pluginId" = 'plug' AND "instanceId" = 'inst' AND "deliveryId" = 'd7' AND "redriven" = false`;

    // Baseline first: the instance index narrows to the whole instance and the rest is filtered row by
    // row, so the assertion below measures the new index and not a plan that already used deliveryId.
    const before = await explain(guard);
    expect(before).toContain('IDX_integration_delivery_failures_instance');
    expect(before).not.toMatch(/Index Cond:[^|]*"deliveryId"/);

    await new AddIntegrationDeliveryFailureDeliveryIndex1791100000000().up(runner);

    const after = await explain(guard);
    expect(after).toContain(INDEX);
    expect(after).toMatch(/Index Cond:[^|]*"deliveryId"/);
  });
});
