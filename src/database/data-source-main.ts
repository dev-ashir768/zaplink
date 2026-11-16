import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadCliEnv } from './load-cli-env';
import { MAIN_MIGRATIONS_TABLE } from './main-connection';
import { postgresUtcExtra } from './postgres-utc';

loadCliEnv();

/**
 * CLI DataSource for the main (auth/audit) migrations. Mirrors the runtime main connection: the same
 * Postgres database as the data connection, auth/audit entities, migrations-main and its own ledger.
 *
 * Usage: `npm run migration:run:main` (dev) / `migration:run:main:prod` (compiled).
 */
const schema = process.env.POSTGRES_SCHEMA || 'public';
const mainDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME || 'zaplink',
  schema,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
  extra: postgresUtcExtra(undefined, schema !== 'public' ? { searchPath: `${schema},public` } : {}),
  entities: [__dirname + '/../modules/auth/**/*.entity{.ts,.js}', __dirname + '/../modules/audit/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations-main/*{.ts,.js}'],
  migrationsTableName: MAIN_MIGRATIONS_TABLE,
  synchronize: false,
  logging: process.env.DATABASE_LOGGING === 'true',
});

export default mainDataSource;
