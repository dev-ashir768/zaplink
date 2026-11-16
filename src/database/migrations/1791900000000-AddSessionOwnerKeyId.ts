import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Session ownership: `sessions.ownerKeyId` names the API key (api_keys.id) that created the session, or
 * NULL for an admin/system-owned one. api_keys lives on the main connection, so there is no foreign key;
 * deleting or revoking a key clears its rows back to NULL in AuthService. Every existing session predates
 * ownership and stays NULL (admin-owned). Idempotent via IF NOT EXISTS.
 */
export class AddSessionOwnerKeyId1791900000000 implements MigrationInterface {
  name = 'AddSessionOwnerKeyId1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ownerKeyId" varchar(36) NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessions_ownerKeyId" ON "sessions" ("ownerKeyId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_ownerKeyId"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN IF EXISTS "ownerKeyId"`);
  }
}
