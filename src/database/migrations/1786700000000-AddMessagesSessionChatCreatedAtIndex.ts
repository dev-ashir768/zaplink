import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite index on `messages (sessionId, chatId, createdAt)`, backing one chat's thread: the
 * paged message list with a chatId filter and its total, and the send-pacing history probes that
 * filter on the same prefix. Without it Postgres walked every row of the session through the
 * (sessionId, createdAt) or unique (sessionId, waMessageId) index and filtered chatId row by row.
 *
 * Same reasoning as AddMessageMediaPathIndex: hand-authored because `synchronize` is off for the
 * data connection. The explicit name matches the entity's
 * @Index, so the synchronize and migration schema paths converge on one index. Idempotent via
 * IF NOT EXISTS.
 *
 * Not CONCURRENTLY: the migration runs inside a transaction. On PostgreSQL the build holds a SHARE
 * lock on messages, so inserts and ack updates wait until it finishes (reads do not), for as long as the build over the existing rows.
 */
export class AddMessagesSessionChatCreatedAtIndex1786700000000 implements MigrationInterface {
  name = 'AddMessagesSessionChatCreatedAtIndex1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Boot and CLI migrations run on a pool without the runtime statement_timeout (pg-boot-migrations.ts);
    // this guards against a role- or database-level default cancelling a long build. Lifted for this
    // transaction only, like AddMessageMediaPathIndex.
    await queryRunner.query('SET LOCAL statement_timeout = 0');
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_sessionId_chatId_createdAt" ON "messages" ("sessionId", "chatId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_sessionId_chatId_createdAt"`);
  }
}
