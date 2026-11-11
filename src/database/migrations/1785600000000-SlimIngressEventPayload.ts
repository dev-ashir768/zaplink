import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slims the ingress_events dedup row: `payload` becomes nullable (retired to NULL once the dispatch
 * outcome is recorded — the dispatch tier owns it from there) and a permanent `payloadHash` column
 * keeps the content fingerprint.
 *
 * The same pass also RETIRES the payloads of every existing non-'pending' row (NULL/'dispatched'/
 * 'failed' dispatchState): those rows are never replayed — NULL-state rows are unwatched history,
 * 'dispatched' rows are the dispatch tier's concern, 'failed' rows live on through their DLQ row —
 * so their stored payload is dead weight (up to 2x maxBodyBytes per row) and is dropped here rather
 * than left for retention to drain. 'pending' rows keep their payload: the reconciler replays from
 * it. payloadHash is NOT backfilled; legacy rows keep it NULL.
 *
 * Idempotent: alters the column in place. A synchronize-bootstrapped DB already
 * has the new shape, so the payloadHash probe skips the whole migration.
 */
export class SlimIngressEventPayload1785600000000 implements MigrationInterface {
  name = 'SlimIngressEventPayload1785600000000';

  private async hasColumn(queryRunner: QueryRunner, name: string): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'ingress_events' AND column_name = '${name}'`,
    )) as unknown[];
    return rows.length > 0;
  }

  private async isPayloadNullable(queryRunner: QueryRunner): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'ingress_events' AND column_name = 'payload'`,
    )) as Array<{ is_nullable: string }>;
    return rows[0]?.is_nullable === 'YES';
  }

  // Retire the payload of every row the reconciler can never replay. Idempotent by nature.
  private async retireNonPendingPayloads(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ingress_events" SET "payload" = NULL WHERE "dispatchState" IS NULL OR "dispatchState" <> 'pending'`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasColumn(queryRunner, 'payloadHash')) return; // already applied (or sync-built)

    await queryRunner.query(`ALTER TABLE "ingress_events" ADD COLUMN "payloadHash" varchar NULL`);
    if (!(await this.isPayloadNullable(queryRunner))) {
      await queryRunner.query(`ALTER TABLE "ingress_events" ALTER COLUMN "payload" DROP NOT NULL`);
    }
    await this.retireNonPendingPayloads(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'payloadHash'))) return; // nothing to reverse

    // Rows whose payload was retired get an empty-payload tombstone so NOT NULL can be restored.
    const tombstone = '{"headers":{},"query":{},"body":"","rawBody":""}';
    await queryRunner.query(`UPDATE "ingress_events" SET "payload" = '${tombstone}' WHERE "payload" IS NULL`);
    await queryRunner.query(`ALTER TABLE "ingress_events" ALTER COLUMN "payload" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ingress_events" DROP COLUMN "payloadHash"`);
  }
}
