import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { pgTestOptions } from '../../../test-utils/pg-test-db';

/**
 * Entity metadata builds a PostgreSQL schema (synchronize gate).
 *
 * Raw SQL that TypeORM passes through VERBATIM is not checked by any other suite. A partial index
 * predicate is the case that bit: `@Index(name, { where: 'mediaPath IS NOT NULL' })` reaches the
 * server unquoted, PostgreSQL folds the bare identifier to lower case, and CREATE INDEX fails with
 * `column "mediapath" does not exist`. Quoting the column in the predicate is the fix.
 *
 * Nothing caught it. The drift gate (migration-drift.spec.ts) cannot see it either, in any
 * dialect: TypeORM's schema differ does not compare predicate TEXT, so an unquoted `where` reports
 * zero drift against a chain-built schema that carries the quoted one. Verified against postgres:16,
 * both forms report the same (empty) mediaPath drift.
 *
 * This suite closes that gap the only way that actually fails: it runs synchronize itself. The
 * entity set is the whole `data` connection rather than Message alone, so any future entity that
 * embeds an unquoted identifier in raw SQL fails here too, not just the one that prompted it.
 *
 * Deployments never take this path. app.module.ts leaves the data connection on migrations, and
 * env.validation.ts rejects DATABASE_SYNCHRONIZE=true outright. What breaks is any DataSource built
 * on these entities with synchronize enabled, which is the natural shape for a Postgres harness
 * written against the real entities.
 *
 * Runs in a schema of its own (pgTestOptions). During jest runs the varchar-uuid-ids setup file
 * synchronizes uuid primary keys as `varchar DEFAULT gen_random_uuid()::varchar`, as the migrations do.
 */
const repoRoot = join(__dirname, '../../../..');

/** The `data` connection's entity set, mirroring app.module.ts and data-source.ts. */
const dataEntities = [
  join(repoRoot, 'src/modules/session/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/webhook/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/message/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/template/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/engine/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/integration/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/status-store/**/*.entity{.ts,.js}'),
  join(repoRoot, 'src/modules/automation/**/*.entity{.ts,.js}'),
];

describe('data entities synchronize onto PostgreSQL', () => {
  let scratch: DataSource | undefined;

  afterAll(async () => {
    await scratch?.destroy().catch(() => undefined);
  });

  it('builds the whole schema, quoting the mediaPath partial index predicate', async () => {
    scratch = new DataSource({ ...pgTestOptions(), entities: dataEntities, synchronize: true });

    // The assertion IS initialize(): an unquoted identifier in any entity's raw SQL rejects here
    // with `column "<folded name>" does not exist` before a single expect() runs.
    await scratch.initialize();

    const indexes = await scratch.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'IDX_messages_mediaPath'`,
    );

    // Read back from the catalog, not from the entity: this is what the server actually stored, and
    // it is the form the migration that owns the same index name produces.
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('WHERE ("mediaPath" IS NOT NULL)');
  }, 120_000);
});
