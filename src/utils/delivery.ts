/**
 * Phase 9: which message a push lets this phone acknowledge as Delivered.
 * Pure (unit-tested); the background task lives in services/deliveryAck.ts.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeliveryTarget {
  conversationId: string;
  messageId: string | null;
}

/**
 * Which message to acknowledge for a push (pure, unit-tested). Only normal
 * Messages pushes (1:1 and groups), only for the account signed in here,
 * only well-formed ids. Everything else: null (do nothing).
 */
export function deliveryTarget(data: Record<string, unknown> | null | undefined, signedIn: string | null | undefined): DeliveryTarget | null {
  if (!data || typeof data !== 'object' || !signedIn) return null;
  if (data.type !== 'message' && data.type !== 'group_message') return null; // never After Dark / activity
  if (typeof data.for === 'string' && data.for !== signedIn) return null; // meant for another account
  const cid = typeof data.conversation_id === 'string' && UUID.test(data.conversation_id) ? data.conversation_id : null;
  if (!cid) return null;
  const mid = typeof data.message_id === 'string' && UUID.test(data.message_id) ? data.message_id : null;
  return { conversationId: cid, messageId: mid };
}

/** Our push data from what iOS / Expo hands a background task (pure, unit-tested). */
export function pushDataOf(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { data?: Record<string, unknown>; request?: { content?: { data?: Record<string, unknown> } } };
  // A tapped notification (NotificationResponse) carries it on the request.
  if (p.request?.content?.data) return p.request.content.data;
  const d = p.data;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.dataString === 'string') {
    try {
      const parsed = JSON.parse(d.dataString) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  if (d.body && typeof d.body === 'object') return d.body as Record<string, unknown>;
  return d;
}

