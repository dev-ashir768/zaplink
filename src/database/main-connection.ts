import { join } from 'path';
import type { ConfigService } from '@nestjs/config';
import { DataSource, MigrationExecutor, type DataSourceOptions } from 'typeorm';
import { postgresUtcExtra } from './postgres-utc';

/**
 * Raised when the auth/audit tables do not match this release: the main migration ledger records a
 * migration this release does not ship (a newer release has upgraded it), or a column the entities need
 * is missing after every shipped migration ran. Booting on would either misread the newer schema or read
 * the missing column as NULL, so boot stops instead.
 */
export class MainSchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MainSchemaMismatchError';
  }
}

/** Retrying cannot fix a schema mismatch, so it fails the boot at once instead of nine times. */
export const retryMainConnection = (err: unknown): boolean => !(err instanceof MainSchemaMismatchError);

/** Ledger table of the main (auth/audit) migration chain, kept apart from the data chain's `migrations`. */
export const MAIN_MIGRATIONS_TABLE = 'main_migrations';

/**
 * TypeORM options for the main (auth/audit) connection. It uses the same Postgres database and schema
 * as the data connection, with its own entities, migrations and migration ledger.
 */
export function mainConnectionOptions(
  configService: ConfigService,
): DataSourceOptions & { name: string; toRetry: (err: unknown) => boolean } {
  const schema = configService.get<string>('dataDatabase.schema', 'public');
  return {
    // Nest's TypeOrmCoreModule resolves the DataSource to close at shutdown from these options.
    name: 'main',
    type: 'postgres',
    host: configService.get<string>('dataDatabase.host'),
    port: configService.get<number>('dataDatabase.port'),
    username: configService.get<string>('dataDatabase.username'),
    password: configService.get<string>('dataDatabase.password'),
    database: configService.get<string>('dataDatabase.name', 'zaplink'),
    schema,
    ssl: configService.get<boolean>('dataDatabase.ssl', false)
      ? { rejectUnauthorized: configService.get<boolean>('dataDatabase.sslRejectUnauthorized', true) }
      : false,
    // The same UTC pin (and non-public search_path) as the data connection.
    extra: postgresUtcExtra(undefined, schema && schema !== 'public' ? { searchPath: `${schema},public` } : {}),
    entities: [
      join(__dirname, '..', 'modules/auth/**/*.entity{.ts,.js}'),
      join(__dirname, '..', 'modules/audit/**/*.entity{.ts,.js}'),
    ],
    // Dedicated migrations and ledger for the main connection only (must NOT run the data migrations).
    migrations: [join(__dirname, 'migrations-main/*{.ts,.js}')],
    migrationsTableName: MAIN_MIGRATIONS_TABLE,
    // Read by createMainDataSource, which owns the schema steps (initialize() never runs them).
    synchronize: configService.get<boolean>('database.synchronize', false),
    logging: configService.get<boolean>('database.logging', false),
    toRetry: retryMainConnection,
  };
}

/**
 * dataSourceFactory for the main connection. Order: refuse a ledger from a newer release, run the
 * migration chain, refuse a missing entity column, then synchronize if MAIN_DATABASE_SYNCHRONIZE=true.
 * Never delete or rename a migrations-main file: a ledger row this release no longer ships reads as a
 * newer release's.
 */
export async function createMainDataSource(options?: DataSourceOptions): Promise<DataSource> {
  // useFactory always resolves a full options object; the optional parameter is the library's typing.
  const opts = options as DataSourceOptions;
  const ds = new DataSource({ ...opts, synchronize: false, migrationsRun: false });
  await ds.initialize();
  try {
    const shipped = new Set(ds.migrations.map(m => m.name));
    const unknown = (await new MigrationExecutor(ds).getExecutedMigrations())
      .map(m => m.name)
      .filter(name => !shipped.has(name));
    if (unknown.length) {
      throw new MainSchemaMismatchError(
        `The main migration ledger records migration(s) this release does not ship (${unknown.join(', ')}): ` +
          'a newer ZapLink release has upgraded the database. Run that release, or restore the backup taken ' +
          'before the upgrade.',
      );
    }

    await ds.runMigrations({ transaction: 'all' });

    const [{ schema }] = await ds.query<Array<{ schema: string }>>('SELECT current_schema() AS schema');
    const missing: string[] = [];
    for (const metadata of ds.entityMetadatas) {
      const rows = await ds.query<Array<{ column_name: string }>>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        [schema, metadata.tableName],
      );
      const present = new Set(rows.map(r => r.column_name));
      for (const column of metadata.columns) {
        if (!present.has(column.databaseName)) missing.push(`${metadata.tableName}.${column.databaseName}`);
      }
    }
    if (missing.length) {
      throw new MainSchemaMismatchError(
        `The main tables lack ${missing.join(', ')} after every shipped migrations-main migration ran. Either ` +
          'an older ZapLink release has rebuilt the table (restore the backup taken before the downgrade), or ' +
          'an entity declares a column that no migrations-main migration creates yet (add one: ' +
          'MAIN_DATABASE_SYNCHRONIZE=true does not add columns the chain lacks).',
      );
    }

    if (opts.synchronize) await ds.synchronize();
    return ds;
  } catch (err) {
    await ds.destroy().catch(() => undefined);
    throw err;
  }
}
