import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds DB-native full-text search to `messages`:
 * a STORED generated `tsvector` column (config 'simple') + a GIN index. The column is
 * auto-maintained on INSERT/UPDATE, so revoke/delete stay in sync with zero app code.
 *
 * Non-CONCURRENTLY (one-time blocking build). For very large `messages` tables, run the
 * upgrade during a maintenance window; set SEARCH_ENABLED=false to skip wiring (the migration still runs).
 */
export class AddMessagesFts1782400000000 implements MigrationInterface {
  name = 'AddMessagesFts1782400000000';

  async up(qr: QueryRunner): Promise<void> {
    // Boot and CLI migrations run on a pool without the runtime statement_timeout
    // (pg-boot-migrations.ts). SET LOCAL guards this transaction against a role- or database-level
    // default: the STORED generated column is a full-table rewrite, and the GIN index build that
    // follows is the heaviest boot migration. SET LOCAL is transaction-scoped (auto-reverts). Mirrors
    // 1781100000000 / 1781300000000 / 1782200000000.
    await qr.query('SET LOCAL statement_timeout = 0');
    await qr.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body_ts" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED`,
    );
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_messages_body_ts" ON "messages" USING GIN ("body_ts")`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS "idx_messages_body_ts"`);
    await qr.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "body_ts"`);
  }
}
