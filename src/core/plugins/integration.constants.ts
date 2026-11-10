export const INGRESS_DISPATCH_TIMEOUT_MS = 5000; // mirrors SANDBOX_HOOK_TIMEOUT_MS
export const INGRESS_SHUTDOWN_WAIT_MS = 5000;

export interface IngressJobData {
  pluginId: string;
  instanceId: string;
  route: string;
  // Optional for backward compatibility with jobs and DLQ rows persisted before method forwarding.
  method?: string;
  deliveryId: string;
  sessionId?: string;
  // Best-effort provider conversation id, extracted host-side from the manifest's conversationId
  providerConversationId?: string;
  payload: {
    headers: Record<string, string>;
    query: Record<string, string>;
    body: string;
    rawBody: string;
    // Original provider id when deliveryId is a body-specific storage key.
    providerDeliveryId?: string;
    // The host's verdict when it accepted the request; see IngressEvent.payload.
    admission?: { verified: boolean };
  };
}
