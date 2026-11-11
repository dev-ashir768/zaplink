import 'reflect-metadata';
import { DataSource, Logger } from 'typeorm';
import { MessageService } from './message.service';
import { Message, MessageDirection } from './entities/message.entity';
import type { EngineRegistry } from '../../engine/engine-registry.service';
import type { MessageProjector } from '../session/message-projector.service';
import type { HookManager } from '../../core/hooks';
import type { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';
import type { SendPacingService } from './send-pacing.service';
import type { MessageSendService } from './message-send.service';
import { pgTestOptions } from '../../test-utils/pg-test-db';

/** The shape of the statements getMessages issues for a page, against the entity schema. */
describe('message list statements', () => {
  let ds: DataSource;
  let service: MessageService;
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const logger: Logger = {
    logQuery: (sql, params) => {
      queries.push({ sql, params: params as unknown[] | undefined });
    },
    logQueryError: () => undefined,
    logQuerySlow: () => undefined,
    logSchemaBuild: () => undefined,
    logMigration: () => undefined,
    log: () => undefined,
  };

  beforeEach(async () => {
    ds = new DataSource({
      ...pgTestOptions(),
      entities: [Message],
      synchronize: true,
      logging: ['query'],
      logger,
    });
    await ds.initialize();
    service = new MessageService(
      ds.getRepository(Message),
      {} as EngineRegistry,
      {} as MessageProjector,
      {} as HookManager,
      {
        findLidsForPhone: () => Promise.resolve([]),
        findPhoneForLid: () => Promise.resolve(null),
      } as unknown as LidMappingStoreService,
      {} as SendPacingService,
      {} as MessageSendService,
    );
    queries.length = 0;
  });

  afterEach(async () => {
    await ds.destroy();
  });

  /** The ordered, limited statement that picks the page. */
  const pageQuery = (): { sql: string; params?: unknown[] } => {
    const page = queries.find(q => q.sql.includes('ORDER BY') && q.sql.includes('LIMIT'));
    expect(page).toBeDefined();
    return page!;
  };

  /**
   * A sort evaluates its result columns for every matching row before the limit applies, so a size
   * computed in the ordered statement read the stored payload of every row in the chat. The size is
   * read by id for the page rows only, and as a byte count, which neither dialect has to load the
   * payload for.
   */
  it('reads metadata sizes for the page rows only, outside the ordered statement', async () => {
    const repo = ds.getRepository(Message);
    await repo.save(
      ['a', 'b', 'c'].map(n =>
        repo.create({ sessionId: 's1', chatId: '628123@c.us', waMessageId: n, from: 'x', to: 'y', body: n }),
      ),
    );
    queries.length = 0;

    const { messages } = await service.getMessages('s1', { chatId: '628123@c.us', limit: 2 });

    expect(messages).toHaveLength(2);
    expect(pageQuery().sql).not.toMatch(/metadata/i);
    const sizes = queries.filter(q => /LENGTH\(/i.test(q.sql));
    expect(sizes).toHaveLength(1);
    expect(sizes[0].sql).toMatch(/OCTET_LENGTH\(/);
    expect(sizes[0].sql).not.toMatch(/(^|[^_])LENGTH\(/);
    expect(sizes[0].sql).not.toContain('ORDER BY');
  });
  /** The page rows are read by id, whatever the list is filtered by. */
  describe('the reads of a page by id', () => {
    const seedChat = async (): Promise<void> => {
      const repo = ds.getRepository(Message);
      await repo.save(
        Array.from({ length: 120 }, (_, i) =>
          repo.create({
            sessionId: 's1',
            chatId: '628123@c.us',
            waMessageId: `w${i}`,
            from: '628123@c.us',
            to: 'y',
            body: 'b',
            type: 'text',
            direction: MessageDirection.INCOMING,
            timestamp: 1000 + i,
          }),
        ),
      );
      queries.length = 0;
    };
    const readsById = (): Array<{ sql: string; params?: unknown[] }> =>
      queries.filter(q => /"message"\."id" IN/.test(q.sql) && !/^\s*SELECT\s+COUNT/i.test(q.sql));

    it.each([
      ['an unfiltered list', {}],
      ['one chat', { chatId: '628123@c.us' }],
      [
        'every filter',
        {
          chatId: '628123@c.us',
          from: '628123@c.us',
          direction: MessageDirection.INCOMING,
          type: 'text',
          since: 1000000,
          until: 1200000,
          orderBy: 'timestamp' as const,
        },
      ],
    ])('reads the rows of %s by id', async (_label, options) => {
      await seedChat();

      const { messages } = await service.getMessages('s1', { ...options, limit: 100, inlineMedia: false });

      expect(messages).toHaveLength(100);
      expect(readsById()).toHaveLength(2);
    });

    it('reads a page chunk without the list order', async () => {
      await seedChat();

      await service.getMessages('s1', { limit: 100, inlineMedia: false });

      const chunk = queries.find(q => /"message"\."id" IN/.test(q.sql) && !/OCTET_LENGTH/.test(q.sql));
      expect(chunk).toBeDefined();
      expect(chunk!.sql).not.toContain('ORDER BY');
    });
  });
});
