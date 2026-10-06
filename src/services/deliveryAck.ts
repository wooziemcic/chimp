/**
 * Phase 9 — "Delivered" without opening Chimp.
 *
 * Before: Delivered was only acknowledged by the app's own sync (inbox load,
 * a Realtime message, coming back to the foreground). iOS suspends a
 * backgrounded app within seconds, its Realtime socket closes, and a push
 * arriving then ran no code — so a message stayed "Sent" until the
 * recipient opened Chimp, then jumped Sent → Delivered → Seen.
 *
 * Now, on the RECIPIENT's phone:
 *   - foreground: a message push (or the Realtime message) acknowledges at once
 *   - background: message pushes carry `content-available`, so iOS wakes the
 *     app briefly in the background and this task acknowledges the message
 *     (mark_delivered_upto, 0012 — the cursor moves only to that message's
 *     server time; fallback: mark_delivered, 0011)
 *   - coming back / reconnecting: the existing reconcile acknowledges anything
 *     still missing (useChat.ackDelivered)
 *
 * Never Seen from a push (only opening the chat in the foreground does that),
 * never from the sender's side, never for After Dark (Vibes have no
 * receipts), never for another account than the one signed in on this phone.
 *
 * iOS limits (unavoidable): no background wake when the app was force-quit
 * (swiped away), when Background App Refresh or Low Power Mode blocks it, or
 * when iOS throttles background work; then Delivered appears as soon as the
 * app next opens or reconnects.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { isBackendConfigured, supabase } from '@/lib/supabase';
import { deliveryTarget, pushDataOf } from '@/utils/delivery';

export const DELIVERY_TASK = 'chimp-delivery-ack';

export { deliveryTarget, pushDataOf, type DeliveryTarget } from '@/utils/delivery';

/** Remember what was acknowledged (one write per message, even if iOS delivers twice). */
const acked = new Set<string>();

/** Acknowledge one message as Delivered, as the signed-in account. Never throws. */
export async function ackDelivery(data: Record<string, unknown> | null, signedIn?: string | null): Promise<'acked' | 'skipped' | 'failed'> {
  if (!isBackendConfigured) return 'skipped';
  try {
    const uid = signedIn ?? (await supabase().auth.getSession()).data.session?.user.id ?? null;
    const t = deliveryTarget(data, uid);
    if (!t) return 'skipped';
    // Only a specific message is remembered (a push without an id always re-checks; it's idempotent server-side).
    const key = t.messageId ? `${uid}:${t.conversationId}:${t.messageId}` : null;
    if (key && acked.has(key)) return 'skipped';
    if (t.messageId) {
      const r = await supabase().rpc('mark_delivered_upto', { p_cid: t.conversationId, p_message_id: t.messageId });
      if (!r.error) {
        if (key) acked.add(key);
        return 'acked';
      }
      if (r.error.code !== 'PGRST202') return 'failed';
    }
    // 0011 without 0012: acknowledge what this phone has received in that chat.
    const r2 = await supabase().rpc('mark_delivered', { p_cid: t.conversationId });
    if (r2.error) return 'failed';
    if (key) acked.add(key);
    return 'acked';
  } catch {
    return 'failed';
  }
}

// Module scope (required early by the app): the background task iOS runs when
// a message push arrives while Chimp is in the background.
if ((Platform.OS === 'ios' || Platform.OS === 'android') && !TaskManager.isTaskDefined(DELIVERY_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(DELIVERY_TASK, async ({ data }) => {
    const r = await ackDelivery(pushDataOf(data));
    return r === 'acked' ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
  });
}

let registered = false;
/** Register the background task (REAL accounts on a device; once per launch). */
export function registerDeliveryTask(): void {
  if (registered || !(Platform.OS === 'ios' || Platform.OS === 'android') || !isBackendConfigured) return;
  registered = true;
  void Notifications.registerTaskAsync(DELIVERY_TASK).catch(() => {
    registered = false; // an older binary without the module: foreground + reconcile still work
  });
}
