// NOTE: kept OUT of src/database/migrations/ on purpose — the TypeORM migrations glob
// (`migrations/*{.ts,.js}`) would otherwise load this spec as a migration under ts-node
// (the CLI datasource / start:dev) and crash on `describe`.
import { AddWebhooksSessionIdIndex1782200000000 } from './migrations/1782200000000-AddWebhooksSessionIdIndex';

function makeQueryRunner(type: string, hasWebhooks = true) {
  const query = jest.fn(() => Promise.resolve(undefined));
  return {
    dataSource: { options: { type } },
    hasTable: jest.fn((t: string) => Promise.resolve(t === 'webhooks' && hasWebhooks)),
    query,
  };
}

const sqlOf = (qr: ReturnType<typeof makeQueryRunner>): string[] =>
  qr.query.mock.calls.map(call => String((call as unknown[])[0]));

describe('AddWebhooksSessionIdIndex migration', () => {
  const migration = new AddWebhooksSessionIdIndex1782200000000();

  it('creates an IF-NOT-EXISTS index on webhooks.sessionId', async () => {
    const qr = makeQueryRunner('postgres');
    await migration.up(qr as never);
    expect(sqlOf(qr).join('\n')).toMatch(
      /CREATE INDEX IF NOT EXISTS "IDX_webhooks_sessionId" ON "webhooks" \("sessionId"\)/,
    );
  });

  it('lifts the statement_timeout', async () => {
    const pg = makeQueryRunner('postgres');
    await migration.up(pg as never);
    expect(sqlOf(pg).some(s => /SET LOCAL statement_timeout = 0/.test(s))).toBe(true);
  });

  it('is a no-op when the webhooks table does not exist (fresh DB mid-bootstrap)', async () => {
    const qr = makeQueryRunner('postgres', /* hasWebhooks */ false);
    await migration.up(qr as never);
    expect(sqlOf(qr).some(s => /CREATE INDEX/.test(s))).toBe(false);
  });

  it('drops the index on down()', async () => {
    const qr = makeQueryRunner('postgres');
    await migration.down(qr as never);
    expect(sqlOf(qr).join('\n')).toMatch(/DROP INDEX IF EXISTS "IDX_webhooks_sessionId"/);
  });
});
