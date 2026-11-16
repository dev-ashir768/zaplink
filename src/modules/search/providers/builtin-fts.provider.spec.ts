import 'reflect-metadata';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';
import { Message, MessageDirection } from '../../../modules/message/entities/message.entity';
import { Session } from '../../../modules/session/entities/session.entity';
import { BuiltInFtsProvider } from './builtin-fts.provider';
import type { SearchQuery } from '../search.types';
import { AddMessagesFts1782400000000 } from '../../../database/migrations/1782400000000-AddMessagesFts';
import { pgTestOptions } from '../../../test-utils/pg-test-db';

describe('BuiltInFtsProvider', () => {
  let ds: DataSource;
  let provider: BuiltInFtsProvider;

  beforeEach(async () => {
    ds = new DataSource({
      ...pgTestOptions(),
      entities: [Session, Message],
      synchronize: true,
    });
    await ds.initialize();
    await new AddMessagesFts1782400000000().up(ds.createQueryRunner());
    provider = new BuiltInFtsProvider(ds);
    const repo = ds.getRepository(Message);
    await repo.insert([
      {
        sessionId: 's1',
        chatId: 'c1',
        from: 'a@c.us',
        to: 'dest@c.us',
        body: 'hello world',
        type: 'text',
        direction: MessageDirection.OUTGOING,
        timestamp: 1,
      },
      {
        sessionId: 's1',
        chatId: 'c1',
        from: 'a@c.us',
        to: 'dest@c.us',
        body: 'goodbye world',
        type: 'text',
        direction: MessageDirection.OUTGOING,
        timestamp: 2,
      },
      {
        sessionId: 's2',
        chatId: 'c2',
        from: 'b@c.us',
        to: 'dest@c.us',
        body: 'hello again',
        type: 'text',
        direction: MessageDirection.INCOMING,
        timestamp: 3,
      },
    ]);
  });
  afterEach(() => ds.destroy());

  it('matches by keyword with a highlighted snippet', async () => {
    const res = await provider.search({ q: 'hello', limit: 10 });
    expect(res.provider).toBe('builtin-fts');
    expect(res.hits.length).toBe(2);
    expect(res.hits.every(h => /hello/i.test(h.snippet))).toBe(true);
    expect(res.total).toBe(2);
  });

  it('pages one hit at a time in rank, timestamp DESC, id DESC order with the full total', async () => {
    // Same length as the other two hello rows, so every hit ranks alike, and the same timestamp as
    // 'hello again', so only the id tiebreak orders that pair. limit 1 with offset > 0 makes the
    // provider count instead of taking rows.length as the total.
    await ds.getRepository(Message).insert({
      sessionId: 's2',
      chatId: 'c2',
      from: 'b@c.us',
      to: 'dest@c.us',
      body: 'hello there',
      type: 'text',
      direction: MessageDirection.INCOMING,
      timestamp: 3,
    });
    const all = await ds.getRepository(Message).find();
    const expected = all
      .filter(m => m.body?.startsWith('hello'))
      .sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1))
      .map(m => m.id);

    const paged: string[] = [];
    for (let offset = 0; offset < 3; offset++) {
      const res = await provider.search({ q: 'hello', limit: 1, offset });
      expect(res.total).toBe(3);
      paged.push(...res.hits.map(h => h.messageId));
    }
    expect(paged).toEqual(expected);
    expect((await provider.search({ q: 'hello', limit: 1, offset: 3 })).hits).toEqual([]);
  });

  it('applies the chatId, from, direction, type and dateTo filters', async () => {
    await ds.getRepository(Message).insert({
      sessionId: 's1',
      chatId: 'c1',
      from: 'a@c.us',
      to: 'dest@c.us',
      body: 'hello picture',
      type: 'image',
      direction: MessageDirection.OUTGOING,
      timestamp: 2,
    });
    const bodies = async (filter: Omit<SearchQuery, 'q'>): Promise<string[]> =>
      (await provider.search({ q: 'hello', ...filter })).hits.map(h => h.body).sort();

    expect(await bodies({ chatId: 'c2' })).toEqual(['hello again']);
    expect(await bodies({ from: 'a@c.us' })).toEqual(['hello picture', 'hello world']);
    expect(await bodies({ direction: MessageDirection.INCOMING })).toEqual(['hello again']);
    expect(await bodies({ type: 'image' })).toEqual(['hello picture']);
    expect(await bodies({ type: ['text', 'image'] })).toEqual(['hello again', 'hello picture', 'hello world']);
    expect(await bodies({ dateTo: 2000 })).toEqual(['hello picture', 'hello world']);
    // Epoch 0 is a bound like any other, not "no bound": nothing is that old.
    expect(await bodies({ dateTo: 0 })).toEqual([]);

    const combined = { chatId: 'c1', from: 'a@c.us', direction: MessageDirection.OUTGOING, type: 'text' as const };
    expect(await bodies({ ...combined, dateTo: 1000 })).toEqual(['hello world']);
    // Counted rather than taken from rows.length, with every filter bound in the count query too.
    const page = await provider.search({ q: 'hello', ...combined, dateTo: 3000, limit: 1, offset: 1 });
    expect(page.hits).toEqual([]);
    expect(page.total).toBe(1);
  });

  describe('chat and sender filters expanded by the host', () => {
    // One person, three stored forms: the same chat was first stored under a lid, later under each phone
    // dialect, and a group message keeps the group in `from` and the person in `author`.
    beforeEach(async () => {
      const insert = (row: QueryDeepPartialEntity<Message>): Promise<unknown> =>
        ds.getRepository(Message).insert({
          sessionId: 's1',
          to: 'me@c.us',
          type: 'text',
          direction: MessageDirection.INCOMING,
          timestamp: 10,
          ...row,
        });
      await insert({ chatId: '628123@c.us', from: '628123@c.us', body: 'invoice via phone' });
      await insert({
        chatId: '628123@s.whatsapp.net',
        from: '628123@s.whatsapp.net',
        body: 'invoice via other dialect',
      });
      await insert({ chatId: '999@lid', from: '999@lid', body: 'invoice via lid' });
      await insert({ chatId: '120363@g.us', from: '120363@g.us', author: '628123@c.us', body: 'invoice in a group' });
      await insert({ chatId: '628555@c.us', from: '628555@c.us', body: 'invoice from someone else' });
    });

    const bodies = async (filter: Omit<SearchQuery, 'q'>): Promise<string[]> =>
      (await provider.search({ q: 'invoice', ...filter })).hits.map(h => h.body).sort();

    it('finds a chat under every stored form of its id', async () => {
      const chatIdAliases = ['628123@c.us', '628123@s.whatsapp.net', '999@lid'];

      expect(await bodies({ chatId: '628123@c.us' })).toEqual(['invoice via phone']);
      expect(await bodies({ chatId: '628123@c.us', chatIdAliases })).toEqual([
        'invoice via lid',
        'invoice via other dialect',
        'invoice via phone',
      ]);
    });

    it('matches a sender by its from column or, in a group, by its author', async () => {
      const fromAliases = ['628123@c.us', '628123@s.whatsapp.net', '999@lid'];

      expect(await bodies({ from: '628123@c.us', fromAliases })).toEqual([
        'invoice in a group',
        'invoice via lid',
        'invoice via other dialect',
        'invoice via phone',
      ]);
    });

    it('still honours the key allowlist beside an expanded chat filter, in the page and in the total', async () => {
      const res = await provider.search({
        q: 'invoice',
        chatId: '628123@c.us',
        chatIdAliases: ['628123@c.us', '628123@s.whatsapp.net', '999@lid'],
        chatIds: ['628123@s.whatsapp.net'],
        limit: 1,
        offset: 0,
      });

      expect(res.hits.map(h => h.body)).toEqual(['invoice via other dialect']);
      expect(res.total).toBe(1);
    });

    it('counts the expanded filters too', async () => {
      const page = await provider.search({
        q: 'invoice',
        from: '628123@c.us',
        fromAliases: ['628123@c.us', '628123@s.whatsapp.net', '999@lid'],
        limit: 1,
        offset: 1,
      });

      expect(page.hits).toHaveLength(1);
      expect(page.total).toBe(4);
    });
  });

  it('scopes by sessionIds (auth) and by sessionId filter', async () => {
    const scoped = await provider.search({ q: 'hello', sessionIds: ['s1'] });
    expect(scoped.hits.every(h => h.sessionId === 's1')).toBe(true);
    const one = await provider.search({ q: 'hello', sessionId: 's2' });
    expect(one.hits.map(h => h.sessionId)).toEqual(['s2']);
  });

  it('scopes by chatIds (auth allowlist) before limit/offset/total', async () => {
    // The chat fence arrives as the stored-dialect forms of the key's allowlist (lid expansion is
    // ChatScopeService's job); hits in any other chat disappear from the page AND from the count,
    // so pagination windows stay honest.
    const scoped = await provider.search({ q: 'hello', chatIds: ['c2'] });
    expect(scoped.hits.map(h => h.chatId)).toEqual(['c2']);
    expect(scoped.total).toBe(1);
    const none = await provider.search({ q: 'hello', chatIds: ['cX'] });
    expect(none.hits).toEqual([]);
    expect(none.total).toBe(0);
    await ds.getRepository(Message).insert({
      sessionId: 's2',
      chatId: 'c2',
      from: 'b@c.us',
      to: 'dest@c.us',
      body: 'hello there',
      type: 'text',
      direction: MessageDirection.INCOMING,
      timestamp: 4,
    });
    const pages = await Promise.all(
      [0, 1, 2].map(offset => provider.search({ q: 'hello', chatIds: ['c2'], limit: 1, offset })),
    );
    expect(pages.map(page => page.total)).toEqual([2, 2, 2]);
    expect(pages.flatMap(page => page.hits).map(hit => hit.chatId)).toEqual(['c2', 'c2']);
    expect(new Set(pages.flatMap(page => page.hits).map(hit => hit.messageId)).size).toBe(2);
    expect((await provider.search({ q: 'hello', chatIds: ['c2'], chatId: 'c1' })).total).toBe(0);
    expect((await provider.search({ q: 'hello', chatIds: ['c2'], sessionIds: ['s1'] })).total).toBe(0);
  });

  // The match=word score is PostgreSQL's ts_rank: positive, higher for the more relevant hit, which comes first.
  it('reports the word score as the ts_rank: positive, highest for the most relevant hit', async () => {
    await ds.getRepository(Message).insert({
      sessionId: 's1',
      chatId: 'c1',
      from: 'a@c.us',
      to: 'dest@c.us',
      body: 'hello hello hello',
      type: 'text',
      direction: MessageDirection.OUTGOING,
      timestamp: 1,
    });

    const { hits } = await provider.search({ q: 'hello' });
    const scores = hits.map(hit => hit.score as number);
    expect(hits[0].body).toBe('hello hello hello');
    expect(scores.every(score => score > 0)).toBe(true);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it.each([0, 1])('returns no hits or count for an empty compiled chat scope at offset %s', async offset => {
    const result = await provider.search({ q: 'hello', chatIds: [], limit: 1, offset });
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns empty (not error) for no matches', async () => {
    const res = await provider.search({ q: 'zzzznomatch' });
    expect(res.hits).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('reports healthy', async () => {
    expect((await provider.health()).ok).toBe(true);
  });

  it('accepts query grammar characters instead of 400ing (chatIds, quotes, parens stay searchable)', async () => {
    // websearch_to_tsquery never raises on user input, so `"`, `(`, `*`, `@` cannot turn into a 400.
    for (const q of ['"unbalanced', '*foo', '(test', '262813461250071@lid', 'a@c.us']) {
      await expect(provider.search({ q })).resolves.toMatchObject({ provider: 'builtin-fts' });
    }
  });

  it('keeps multi-token AND semantics after quoting', async () => {
    // Both rows carry 'hello' AND 'world'... exactly one does ('goodbye world' lacks 'hello').
    const res = await provider.search({ q: 'hello world' });
    expect(res.hits.length).toBe(1);
    expect(res.hits[0].body).toBe('hello world');
  });

  it('treats dateFrom/dateTo as epoch-ms against a seconds timestamp column', async () => {
    // Contract (DTO + docs) is epoch-ms, but messages.timestamp stores epoch-seconds (WhatsApp
    // messageTimestamp). Seed a row at a known seconds value and assert: a dateFrom in ms that
    // covers it includes the hit, while a dateFrom one second later (also in ms) excludes it. This
    // pins the ms→seconds conversion at the bind boundary — without it `seconds >= ms` is false for
    // every modern row and dateFrom silently excludes all results.
    const repo = ds.getRepository(Message);
    const tsSeconds = 1_700_000_000;
    await repo.insert({
      sessionId: 's1',
      chatId: 'c1',
      from: 'a@c.us',
      to: 'dest@c.us',
      body: 'datefilter probe term',
      type: 'text',
      direction: MessageDirection.OUTGOING,
      timestamp: tsSeconds,
    });

    const included = await provider.search({ q: 'datefilter', dateFrom: tsSeconds * 1000 });
    expect(included.hits.map(h => h.body)).toContain('datefilter probe term');

    const excluded = await provider.search({ q: 'datefilter', dateFrom: (tsSeconds + 1) * 1000 });
    expect(excluded.hits).toEqual([]);
  });

  it('applies inclusive millisecond windows to rows and paginated totals', async () => {
    await ds.getRepository(Message).insert(
      [-2, -1, 0, 1, 2, 1_700_000_000, 1_700_000_001].map(timestamp => ({
        sessionId: 's1',
        chatId: 'c1',
        from: 'a@c.us',
        to: 'dest@c.us',
        body: 'boundarywindow',
        type: 'text',
        direction: MessageDirection.OUTGOING,
        timestamp,
      })),
    );
    const windows = [
      { dateFrom: 1000, dateTo: 2000, want: [2, 1] },
      { dateFrom: 1001, dateTo: 1999, want: [] },
      { dateFrom: 0, dateTo: 0, want: [0] },
      { dateFrom: -1999, dateTo: -1, want: [-1] },
      { dateFrom: -2000, dateTo: -1001, want: [-2] },
      { dateFrom: 0.5, dateTo: 1999.5, want: [1] },
      { dateFrom: 1000, dateTo: 1000, want: [1] },
      { dateFrom: 2000, dateTo: 1000, want: [] },
      { dateFrom: 1_700_000_000_001, dateTo: 1_700_000_001_000, want: [1_700_000_001] },
    ];
    for (const { want, ...bounds } of windows) {
      const result = await provider.search({ q: 'boundarywindow', ...bounds });
      expect(result.hits.map(hit => hit.timestamp)).toEqual(want);
      expect(result.total).toBe(want.length);
      const page = await provider.search({ q: 'boundarywindow', ...bounds, limit: 1, offset: 1 });
      expect(page.hits.map(hit => hit.timestamp)).toEqual(want.slice(1, 2));
      expect(page.total).toBe(want.length);
    }
  });

  it('re-indexes on a body UPDATE (revoke path: body changes, FTS reflects the new value)', async () => {
    // body_ts is a generated column, so a body UPDATE re-indexes. The revoke flow sets body to empty; assert the FTS index reflects the new body and no longer
    // matches the old term, while a new search for a freshly-written body still hits.
    const repo = ds.getRepository(Message);
    await repo.update({ body: 'hello world' }, { body: 'goodbye updated' });
    const oldTerm = await provider.search({ q: 'hello' });
    expect(oldTerm.hits.map(h => h.body)).not.toContain('hello world');
    const newTerm = await provider.search({ q: 'goodbye' });
    expect(newTerm.hits.map(h => h.body)).toContain('goodbye updated');
  });
});
