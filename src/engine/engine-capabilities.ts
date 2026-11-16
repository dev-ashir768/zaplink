/**
 * Runtime view of the engine capability matrix.
 *
 * `engine-capability-matrix.ts` is the single source of truth for which `IWhatsAppEngine` method works
 * on which engine. Its full derivation reads the interface SOURCE from disk (a spec/docs concern), but
 * every row that is not "supported on both" lives in `CURATED_CAPABILITY_EXCEPTIONS`, so the runtime
 * only needs that table: a method missing from it is supported on both engines by construction. This
 * keeps the runtime working from a dist-only image.
 *
 * Consumers:
 *  - `@RequiresEngineCapability()` + `EngineCapabilityInterceptor`: answer 501 before touching the
 *    engine when the active engine cannot serve a route, and tag the OpenAPI operation with `x-engines`.
 *  - `GET /api/infra/capabilities` and `GET /api/infra/engines/current`: let the dashboard hide or
 *    disable controls the active engine cannot serve.
 */
import { CURATED_CAPABILITY_EXCEPTIONS, type RootCause } from './engine-capability-matrix';

export const ENGINE_IDS = ['baileys', 'whatsapp-web.js'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Used when ENGINE_TYPE is set nowhere (process env, .env, data/.env.generated). */
export const DEFAULT_ENGINE: EngineId = 'baileys';

export const ENGINE_LABELS: Record<EngineId, string> = {
  baileys: 'Baileys',
  'whatsapp-web.js': 'whatsapp-web.js',
};

/** Narrow a config value to a known engine id; anything else falls back to the default. */
export function resolveEngineId(value: unknown): EngineId {
  return (ENGINE_IDS as readonly string[]).includes(value as string) ? (value as EngineId) : DEFAULT_ENGINE;
}

/** The engines that support a capability (an `IWhatsAppEngine` method name). */
export function supportedEngines(capability: string): EngineId[] {
  const row = CURATED_CAPABILITY_EXCEPTIONS[capability];
  if (!row) return [...ENGINE_IDS];
  const out: EngineId[] = [];
  if (row.baileys.status === 'supported') out.push('baileys');
  if (row.wwjs.status === 'supported') out.push('whatsapp-web.js');
  return out;
}

export function isCapabilitySupported(capability: string, engine: EngineId): boolean {
  return supportedEngines(capability).includes(engine);
}

export interface EngineSpecificCapability {
  capability: string;
  supportedBy: EngineId[];
  rootCause?: Partial<Record<EngineId, RootCause>>;
}

/**
 * Every capability that is NOT available on both engines, sorted by name. Rows supported on both are
 * omitted on purpose: that is the default, and the list stays short enough to show in a UI.
 */
export function engineSpecificCapabilities(): EngineSpecificCapability[] {
  return Object.entries(CURATED_CAPABILITY_EXCEPTIONS)
    .filter(([, row]) => row.wwjs.status !== 'supported' || row.baileys.status !== 'supported')
    .map(([capability, row]) => {
      const rootCause: Partial<Record<EngineId, RootCause>> = {};
      if (row.baileys.rootCause) rootCause.baileys = row.baileys.rootCause;
      if (row.wwjs.rootCause) rootCause['whatsapp-web.js'] = row.wwjs.rootCause;
      return { capability, supportedBy: supportedEngines(capability), rootCause };
    })
    .sort((a, b) => a.capability.localeCompare(b.capability));
}

/** The capability report for one engine: what it can and cannot do among the engine-specific rows. */
export function capabilityReport(engine: EngineId): {
  engine: EngineId;
  supported: string[];
  unsupported: Array<{ capability: string; supportedBy: EngineId[] }>;
} {
  const rows = engineSpecificCapabilities();
  return {
    engine,
    supported: rows.filter(r => r.supportedBy.includes(engine)).map(r => r.capability),
    unsupported: rows
      .filter(r => !r.supportedBy.includes(engine))
      .map(r => ({ capability: r.capability, supportedBy: r.supportedBy })),
  };
}

export interface EngineProfile {
  id: EngineId;
  name: string;
  summary: string;
  ramPerNumber: string;
  recommendedFor: string;
}

/** Static descriptions the dashboard shows on the engine cards. */
export const ENGINE_PROFILES: Record<EngineId, EngineProfile> = {
  baileys: {
    id: 'baileys',
    name: 'Baileys',
    summary: 'Talks to WhatsApp over a WebSocket. No browser.',
    ramPerNumber: '~20-50 MB',
    recommendedFor: 'Many numbers on one server (100+). Default.',
  },
  'whatsapp-web.js': {
    id: 'whatsapp-web.js',
    name: 'whatsapp-web.js',
    summary: 'Drives WhatsApp Web in a headless Chromium per number.',
    ramPerNumber: '~300-500 MB',
    recommendedFor: 'A few numbers that need labels reads, chat history, receipts or reactions.',
  },
};

/** Human-readable name of each engine-specific capability (README table, dashboard comparison). */
export const CAPABILITY_LABELS: Record<string, string> = {
  clickButton: 'Tap business buttons / list replies',
  createGroup: 'Create groups',
  deleteLabel: 'Delete labels',
  demoteChannelAdmin: 'Demote channel admins',
  getCatalog: 'Read the business catalog',
  getChannelMessages: 'Read channel posts',
  getChatHistory: 'Live per-chat history read',
  getChatLabels: 'Read a chat’s labels',
  getChatsByLabel: 'List chats by label',
  getContactStatus: 'Live contact status read (engine)',
  getContactStatuses: 'Live status feed read (engine)',
  getLabelById: 'Read one label',
  getLabels: 'List labels',
  getMessageReactions: 'Read message reactions',
  getMessageReceipts: 'Read delivery/read receipts',
  getProduct: 'Read one product',
  getProducts: 'List products',
  getSubscribedChannels: 'List followed channels',
  rejectCall: 'Reject incoming calls',
  sendProduct: 'Send a product',
  setGroupEphemeral: 'Disappearing messages in groups',
  setGroupMemberLabel: 'Group member labels',
  subscribeToChannel: 'Follow a channel by invite',
  subscribeToPresence: 'Subscribe to presence',
  transferChannelOwnership: 'Transfer channel ownership',
  upsertLabel: 'Create / edit labels',
  votePoll: 'Vote in polls',
};

export const README_MATRIX_START =
  '<!-- engine-matrix:start (generated from src/engine/engine-capability-matrix.ts) -->';
export const README_MATRIX_END = '<!-- engine-matrix:end -->';

/**
 * The README "Engines" feature table, rendered from the matrix. engine-capabilities.spec.ts fails when
 * the README block differs; regenerate it with `npm run docs:engine-matrix`.
 */
export function renderEngineMatrixMarkdown(): string {
  const rows = engineSpecificCapabilities().map(({ capability, supportedBy }) => {
    const mark = (e: EngineId) => (supportedBy.includes(e) ? 'yes' : '—');
    return `| ${CAPABILITY_LABELS[capability] ?? capability} | \`${capability}\` | ${mark('baileys')} | ${mark('whatsapp-web.js')} |`;
  });
  return [
    '| Feature | Capability | Baileys | whatsapp-web.js |',
    '| ------- | ---------- | ------- | --------------- |',
    ...rows,
  ].join('\n');
}
