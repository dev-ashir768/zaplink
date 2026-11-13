/**
 * Mirror of the server's engine capability matrix (src/engine/engine-capability-matrix.ts): every
 * capability available on only ONE engine, with the engines that support it. A capability not listed
 * works on both. The server answers 501 `ENGINE_NOT_SUPPORTED` for a route whose capability the active
 * engine lacks, so the dashboard hides or disables those controls up front.
 *
 * Kept in sync by src/engine/engine-capabilities.spec.ts on the server side, which fails when this
 * table and the server matrix disagree. Do not edit one without the other.
 */
export type EngineId = 'baileys' | 'whatsapp-web.js';

export const DEFAULT_ENGINE: EngineId = 'baileys';

export const ENGINE_LABELS: Record<EngineId, string> = {
  baileys: 'Baileys',
  'whatsapp-web.js': 'whatsapp-web.js',
};

export const ENGINE_SPECIFIC_CAPABILITIES: Record<string, readonly EngineId[]> = {
  clickButton: ['baileys'],
  createGroup: ['baileys'],
  deleteLabel: ['baileys'],
  demoteChannelAdmin: ['baileys'],
  getCatalog: ['baileys'],
  getChannelMessages: ['whatsapp-web.js'],
  getChatHistory: ['whatsapp-web.js'],
  getChatLabels: ['whatsapp-web.js'],
  getChatsByLabel: ['whatsapp-web.js'],
  getContactStatus: ['whatsapp-web.js'],
  getContactStatuses: ['whatsapp-web.js'],
  getLabelById: ['whatsapp-web.js'],
  getLabels: ['whatsapp-web.js'],
  getMessageReactions: ['whatsapp-web.js'],
  getMessageReceipts: ['whatsapp-web.js'],
  getProduct: ['baileys'],
  getProducts: ['baileys'],
  getSubscribedChannels: ['whatsapp-web.js'],
  rejectCall: ['baileys'],
  sendProduct: ['baileys'],
  setGroupEphemeral: ['baileys'],
  setGroupMemberLabel: ['baileys'],
  subscribeToChannel: ['baileys'],
  subscribeToPresence: ['baileys'],
  transferChannelOwnership: ['baileys'],
  upsertLabel: ['baileys'],
  votePoll: ['whatsapp-web.js'],
};

/** Human-readable name for each engine-specific capability (the comparison table on Infrastructure). */
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

export const isEngineId = (value: unknown): value is EngineId => value === 'baileys' || value === 'whatsapp-web.js';

/** Engines that support a capability; every engine when the capability is not engine-specific. */
export const supportedEnginesFor = (capability: string): readonly EngineId[] =>
  ENGINE_SPECIFIC_CAPABILITIES[capability] ?? ['baileys', 'whatsapp-web.js'];

/**
 * Whether the active engine supports a capability. An unknown engine (still loading, or a third-party
 * plugin) answers true, so the control stays usable and the server's 501 remains the backstop.
 */
export const engineSupports = (engineType: string | null | undefined, capability: string): boolean =>
  !isEngineId(engineType) || supportedEnginesFor(capability).includes(engineType);

/** Tooltip for a control the active engine cannot serve, e.g. "Needs whatsapp-web.js". */
export const needsEngineText = (capability: string): string =>
  `Needs ${supportedEnginesFor(capability)
    .map(e => ENGINE_LABELS[e])
    .join(' or ')}`;

/** Static engine facts for the Infrastructure engine cards (text lives in i18n). */
export const ENGINE_PROFILES: Record<EngineId, { id: EngineId; ramPerNumber: string }> = {
  baileys: { id: 'baileys', ramPerNumber: '~20-50 MB' },
  'whatsapp-web.js': { id: 'whatsapp-web.js', ramPerNumber: '~300-500 MB' },
};
