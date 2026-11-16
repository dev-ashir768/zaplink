import { MigrationInterface, QueryRunner } from 'typeorm';

/** Baseline of the main (auth/audit) tables on Postgres. */
export class CreateAuthAuditTables1800000000000 implements MigrationInterface {
  name = 'CreateAuthAuditTables1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "api_keys" (` +
        `"id" uuid NOT NULL DEFAULT gen_random_uuid(), ` +
        `"name" character varying(100) NOT NULL, ` +
        `"keyHash" character varying(64) NOT NULL, ` +
        `"keyPrefix" character varying(12) NOT NULL, ` +
        `"role" character varying(20) NOT NULL DEFAULT 'operator', ` +
        `"allowedIps" text, "allowedSessions" text, "allowedChats" text, ` +
        `"isActive" boolean NOT NULL DEFAULT true, ` +
        `"expiresAt" TIMESTAMP, "lastUsedAt" TIMESTAMP, ` +
        `"usageCount" integer NOT NULL DEFAULT 0, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_api_keys" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_df3b25181df0b4b59bd93f16e1" ON "api_keys" ("keyHash")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "audit_logs" (` +
        `"id" uuid NOT NULL DEFAULT gen_random_uuid(), ` +
        `"action" character varying(50) NOT NULL, ` +
        `"severity" character varying(10) NOT NULL DEFAULT 'info', ` +
        `"apiKeyId" character varying(36), "apiKeyName" character varying(100), ` +
        `"sessionId" character varying(36), "sessionName" character varying(100), ` +
        `"ipAddress" character varying(45), "userAgent" character varying(500), ` +
        `"method" character varying(10), "path" character varying(500), ` +
        `"statusCode" integer, "metadata" text, "errorMessage" text, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_741fa976d1e04e695f3aa23cb8" ON "audit_logs" ("apiKeyId")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dd2b6e43c767b6b5b2bb227ace" ON "audit_logs" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c69efb19bf127c97e6740ad530" ON "audit_logs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_keys"`);
  }
}
