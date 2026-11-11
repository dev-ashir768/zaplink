import { DataSource } from 'typeorm';
import { pgTestOptions } from '../../../test-utils/pg-test-db';
import { AddTemplates1779840000000 } from '../1779840000000-AddTemplates';

describe('AddTemplates migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ ...pgTestOptions() });
    await ds.initialize();
    // up() declares a CASCADE FK to sessions; create a minimal stand-in (mirrors the sibling specs).
    await ds.query(`CREATE TABLE "sessions" ("id" varchar PRIMARY KEY NOT NULL)`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const tableExists = async (): Promise<boolean> => {
    const rows = await ds.query<unknown[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'templates'`,
    );
    return rows.length === 1;
  };

  it('creates the table and its index, is idempotent, and down() reverses it', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddTemplates1779840000000();

    await migration.up(runner);
    expect(await tableExists()).toBe(true);
    const index = (await runner.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'IDX_templates_sessionId'`,
    )) as unknown[];
    expect(index).toHaveLength(1);

    await expect(migration.up(runner)).resolves.toBeUndefined(); // re-run: hasTable early-return

    await migration.down(runner);
    expect(await tableExists()).toBe(false);
    await runner.release();
  });

  it('down() does not throw when the migration-only index was never created (synchronize-bootstrapped DB)', async () => {
    // Simulate a schema built by synchronize: the templates table exists with the ENTITY index, but the
    // migration-only IDX_templates_sessionId was never created and up() was never run.
    await ds.query(
      `CREATE TABLE "templates" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
        `"name" varchar(100) NOT NULL, "body" text NOT NULL, "header" text, "footer" text, ` +
        `"createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL)`,
    );
    await ds.query(`CREATE UNIQUE INDEX "IDX_templates_session_name" ON "templates" ("sessionId", "name")`);

    const runner = ds.createQueryRunner();
    await expect(new AddTemplates1779840000000().down(runner)).resolves.toBeUndefined();
    expect(await tableExists()).toBe(false);
    await runner.release();
  });
});
