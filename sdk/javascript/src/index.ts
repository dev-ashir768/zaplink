/**
 * ZapLink JavaScript/TypeScript SDK.
 *
 * Official client library for the ZapLink WhatsApp API Gateway.
 *
 * @example
 * ```typescript
 * import { ZapLinkClient, ZapLinkApiError } from '@dev-ashir768/zaplink';
 *
 * const client = new ZapLinkClient({
 *   baseUrl: 'http://localhost:2785',
 *   apiKey: 'owa_k1_…',
 * });
 *
 * // Sessions are addressed by the UUID that create() returns, not by name.
 * const session = await client.sessions.create({ name: 'my-session' });
 * await client.sessions.start(session.id);
 * // Link the account before sending: scan sessions.getQrCode (or use sessions.requestPairingCode for a number with no linked session),
 * // then wait for status 'ready'. An unlinked session answers the send with 409.
 * const result = await client.messages.sendText(session.id, {
 *   chatId: '628123456789@c.us',
 *   text: 'Hello from the ZapLink SDK!',
 * });
 * console.log(result.messageId);
 * ```
 *
 * @packageDocumentation
 */

export { ZapLinkClient } from './client.js';
export { default } from './client.js';
export type { ZapLinkClientOptions } from './client.js';
export * from './errors.js';
export type * from './types.js';
export type { BinaryResponse, ClientConfig, FetchLike, HttpMethod, RequestOptions } from './http.js';
export { buildUrl, encodeSegment, warnIfInsecureHttpUrl } from './http.js';
export type { ListChatsQuery } from './resources/chats.js';
export type { ListContactsQuery } from './resources/contacts.js';
export type { ListGroupsQuery } from './resources/groups.js';
export type { ListSessionsQuery } from './resources/sessions.js';
export type { DeliveryFailureQuery, WebhookListQuery } from './resources/webhooks.js';
export { verifyWebhookSignature } from './webhook.js';
