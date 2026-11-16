import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `chat_states`, the persisted per-session mute/archive/pin table on the `data` connection.
 * Baileys cannot re-deliver these on a reconnect, so they are persisted and rehydrated on boot. Hand
 * authored because `synchronize` is off for `data`; the `hasTable` guard
 * keeps it idempotent on a DB where synchronize already created it.
 */
export class AddChatStates1786400000000 implements MigrationInterface {
  name = 'AddChatStates1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('chat_states')) return;
    // The DDL matches what TypeORM synchronize would generate from the ChatState entity byte for byte,
    // so the migration-drift gate sees no difference (bare inline PRIMARY KEY, boolean columns, the
    // DEFAULT forms Postgres emits).
    await queryRunner.query(
      `CREATE TABLE "chat_states" ("sessionId" varchar NOT NULL, "chatId" varchar NOT NULL, "muteEndTime" bigint, "archived" boolean NOT NULL DEFAULT false, "pinned" boolean NOT NULL DEFAULT false, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), PRIMARY KEY ("sessionId", "chatId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_states"`);
  }
}
