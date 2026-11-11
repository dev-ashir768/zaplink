import { DataSource, type DataSourceOptions } from 'typeorm';
import { join } from 'path';
import {
  createMainDataSource,
  MAIN_MIGRATIONS_TABLE,
  MainSchemaMismatchError,
  mainConnectionOptions,
} from './main-connection';
import { pgTestOptions } from '../test-utils/pg-test-db';
import type { ConfigService } from '@nestjs/config';

// The main (auth/audit) connection on the test database: its own schema per test, its own migration chain.
function mainOptions(): DataSourceOptions {
  return {
    ...pgTestOptions(),
    entities: [
      join(__dirname, '..', 'modules/auth/**/*.entity.ts'),
      join(__dirname, '..', 'modules/audit/**/*.entity.ts'),
    ],
    migrations: [join(__dirname, 'migrations-main/*.ts')],
    migrationsTableName: MAIN_MIGRATIONS_TABLE,
  };
}

describe('main connection', () => {
  const opened: DataSource[] = [];
  afterEach(async () => {
    for (const ds of opened.splice(0)) {
      if (ds.isInitialized) {
        const [{ schema }] = await ds.query<Array<{ schema: string }>>('SELECT current_schema() AS schema');
        await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await ds.destroy();
      }
    }
  });

  it('builds options for the same Postgres database, with its own ledger', () => {
    const values: Record<string, unknown> = {
      'dataDatabase.host': 'db',
      'dataDatabase.port': 5432,
      'dataDatabase.username': 'u',
      'dataDatabase.password': 'p',
      'dataDatabase.name': 'zaplink',
      'dataDatabase.schema': 'public',
    };
    const config = { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
    const options = mainConnectionOptions(config) as DataSourceOptions & { host?: string; database?: string };
    expect(options.type).toBe('postgres');
    expect((options as { name?: string }).name).toBe('main');
    expect(options.host).toBe('db');
    expect(options.database).toBe('zaplink');
    expect(options.migrationsTableName).toBe(MAIN_MIGRATIONS_TABLE);
  });

  it('creates the api_keys and audit_logs tables on an empty schema', async () => {
    const ds = await createMainDataSource(mainOptions());
    opened.push(ds);
    const tables = await ds.query<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`,
    );
    expect(tables.map(t => t.table_name)).toEqual(
      expect.arrayContaining(['api_keys', 'audit_logs', MAIN_MIGRATIONS_TABLE]),
    );
  });

  it('is idempotent across boots', async () => {
    const options = mainOptions();
    const first = await createMainDataSource(options);
    await first.destroy();
    const second = await createMainDataSource(options);
    opened.push(second);
    expect(second.isInitialized).toBe(true);
  });

  it('refuses a ledger that records a migration this release does not ship', async () => {
    const options = mainOptions();
    const ds = await createMainDataSource(options);
    await ds.query(
      `INSERT INTO "${MAIN_MIGRATIONS_TABLE}" ("timestamp", "name") VALUES (9999999999999, 'FromTheFuture9999999999999')`,
    );
    await ds.destroy();
    await expect(createMainDataSource(options)).rejects.toBeInstanceOf(MainSchemaMismatchError);
    const cleanup = new DataSource(options);
    await cleanup.initialize();
    opened.push(cleanup);
  });

  it('refuses a table that lacks a column the entities need', async () => {
    const options = mainOptions();
    const ds = await createMainDataSource(options);
    await ds.query(`ALTER TABLE "api_keys" DROP COLUMN "allowedChats"`);
    await ds.destroy();
    await expect(createMainDataSource(options)).rejects.toThrow(/api_keys\.allowedChats/);
    const cleanup = new DataSource(options);
    await cleanup.initialize();
    opened.push(cleanup);
  });
});
