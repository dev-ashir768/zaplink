import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { HookManager } from '../../../core/hooks';
import { LidMapping } from '../../../engine/identity/lid-mapping.entity';
import { LidMappingStoreService } from '../../../engine/identity/lid-mapping-store.service';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDeliveryFailure } from '../entities/webhook-delivery-failure.entity';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookOutboxService } from '../webhook-outbox.service';
import { WebhookFilters } from './filter-types';
import { pgTestOptions } from '../../../test-utils/pg-test-db';

const LID = '484848@lid';
const P = '628111@c.us';
const Q = '628222@c.us';
const filtersFor = (jid: string, field = 'sender', operator: 'is' | 'isNot' = 'is'): WebhookFilters => ({
  conditions: [{ field, operator, value: [jid] }],
});
const message = { from: LID, to: '620000@c.us', chatId: LID, mentionedIds: [LID], body: 'hello', type: 'text' };

describe('Identity readers after a peer changes a mapping', () => {
  let db: DataSource;
  let reader: LidMappingStoreService;
  let peer: LidMappingStoreService;

  beforeEach(async () => {
    db = await new DataSource({
      ...pgTestOptions(),
      entities: [LidMapping],
      synchronize: true,
    }).initialize();
    const repo = db.getRepository(LidMapping);
    reader = new LidMappingStoreService(repo);
    peer = new LidMappingStoreService(repo);
    await reader.remember('484848', '628111', 'reader');
    await peer.reload();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function webhookMatches(jid: string, field = 'sender', operator: 'is' | 'isNot' = 'is'): Promise<Webhook[]> {
    const delivery = new WebhookDeliveryService(
      {} as Repository<Webhook>,
      {} as Repository<WebhookDeliveryFailure>,
      { get: (_key: string, value: unknown) => value } as ConfigService,
      new HookManager(),
      {} as WebhookOutboxService,
      reader,
    );
    return (
      delivery as unknown as {
        filterMatchingWebhooks: (rows: Webhook[], event: string, data: Record<string, unknown>) => Promise<Webhook[]>;
      }
    ).filterMatchingWebhooks(
      [{ id: 'w', events: ['message.received'], filters: filtersFor(jid, field, operator) } as Webhook],
      'message.received',
      message,
    );
  }

  it('does not deliver a phone-filtered webhook after a peer revokes the alias', async () => {
    await peer.rememberIfUnknown('484848', '628222', 'peer');
    expect(reader.getCached('484848')).toBe('628111');
    expect(await webhookMatches(P)).toHaveLength(0);
    expect(await webhookMatches(LID)).toHaveLength(1);
  });

  it('uses the peer reported phone without reloading the resident mirror', async () => {
    await peer.remember('484848', '628222', 'peer');
    expect(reader.getCached('484848')).toBe('628111');
    expect(await webhookMatches(P)).toHaveLength(0);
    expect(await webhookMatches(Q)).toHaveLength(1);
  });

  it('preserves matching reported aliases and exact phone inputs', async () => {
    expect(await webhookMatches(P)).toHaveLength(1);
  });

  it.each([
    ['sender', 'is'],
    ['sender', 'isNot'],
    ['mentions', 'is'],
    ['mentions', 'isNot'],
  ] as const)('keeps distinct reported LIDs separate for %s %s rules', async (field, operator) => {
    const other = '595959@lid';
    await peer.remember('595959', '628111', 'peer');
    const matches = operator === 'is' ? 0 : 1;
    expect(await webhookMatches(other, field, operator)).toHaveLength(matches);
    expect(await webhookMatches(P, field)).toHaveLength(1);
    expect(await webhookMatches(LID, field)).toHaveLength(1);
  });
});
