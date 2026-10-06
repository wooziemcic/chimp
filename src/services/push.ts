/**
 * Phase 7C: push notifications on the phone.
 *
 * The phone only (1) asks iOS for permission, (2) registers its Expo push
 * token with the server (register_push_token, 0009) and removes it on
 * sign-out, (3) decides what a tap opens. It never SENDS a push and holds no
 * privileged key: the database queues notifications and the `push` Edge
 * Function delivers them (Expo → APNs).
 *
 * REAL accounts on a real iPhone / Android device only. The Demo, the App
 * Review Demo, the web build and simulators never register anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { isBackendConfigured, supabase } from '@/lib/supabase';

import { logEvent } from './analytics';
import { ackDelivery, registerDeliveryTask } from './deliveryAck';
import { conversationOf, routeForPush, type PushData, type PushTarget } from './pushRoutes';

const TOKEN_KEY = 'chimp.pushToken';
const INSTALL_KEY = 'chimp.installId';
const ASKED_KEY = 'chimp.pushAsked';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export const pushSupported = () => (Platform.OS === 'ios' || Platform.OS === 'android') && Device.isDevice && isBackendConfigured;

async function installId(): Promise<string> {
  let v = await AsyncStorage.getItem(INSTALL_KEY);
  if (!v) {
    v = `i_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    await AsyncStorage.setItem(INSTALL_KEY, v);
  }
  return v;
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    return p.canAskAgain === false || p.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

/**
 * Make sure this phone gets this account's notifications. `ask`: show the iOS
 * prompt if it was never shown (once per install unless the person asks from
 * Settings). Returns the permission afterwards. Never throws.
 */
export async function ensurePushRegistered(opts: { ask: 'never' | 'once' | 'now' }): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  try {
    let perm = await pushPermission();
    if (perm === 'undetermined' && opts.ask !== 'never') {
      const asked = opts.ask === 'once' ? await AsyncStorage.getItem(ASKED_KEY) : null;
      if (!asked) {
        await AsyncStorage.setItem(ASKED_KEY, '1');
        const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
        perm = r.granted ? 'granted' : 'denied';
        logEvent(r.granted ? 'push_enabled' : 'push_disabled');
      }
    }
    if (perm !== 'granted') return perm;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerToken(token);
    // Phase 9: let iOS wake Chimp briefly for a message push → "Delivered".
    registerDeliveryTask();
    void turnOnActivityOnce();
    return 'granted';
  } catch (e) {
    // Never block the app on push; never log the token itself.
    console.warn('[chimp] push registration skipped:', e instanceof Error ? e.message.slice(0, 80) : 'error');
    return 'undetermined';
  }
}

async function registerToken(token: string): Promise<void> {
  const { error } = await supabase().rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_device_id: await installId(),
    p_app_version: Constants.expoConfig?.version ?? null,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? 'push not set up on this project (0009)' : 'register failed');
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

/** Sign-out (while the session is still valid): this phone stops getting that account's pushes. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  if (!isBackendConfigured) return;
  await supabase()
    .rpc('unregister_push_token', { p_token: token })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** iOS Settings → Chimp (when notifications were turned off there). */
export const openSystemSettings = () => Linking.openSettings();

// ─── Preferences (Messages · Connections · After Dark) ──────────────────────

export interface NotificationPrefs {
  messages: boolean;
  connections: boolean;
  after_dark: boolean;
  /** Phase 9 (0012): likes, replies, Worlds you follow. */
  activity: boolean;
}
export const DEFAULT_PREFS: NotificationPrefs = { messages: true, connections: true, after_dark: true, activity: true };

export async function fetchNotificationPrefs(): Promise<NotificationPrefs | null> {
  if (!isBackendConfigured) return null;
  let res = await supabase().from('notification_prefs').select('messages, connections, after_dark, activity').maybeSingle();
  // Before 0012 there's no "activity" column: read the rest.
  if (res.error && /activity|column/i.test(res.error.message)) res = await supabase().from('notification_prefs').select('messages, connections, after_dark').maybeSingle();
  if (res.error) return null; // 0009 not applied yet
  const row = (res.data as { messages?: boolean; connections?: boolean; after_dark?: boolean; activity?: boolean | null } | null) ?? {};
  // activity null = not turned on yet by this (Phase 9) app — it is, on push registration (on by default).
  return { ...DEFAULT_PREFS, ...row, activity: row.activity ?? true };
}

/**
 * Phase 9 (0012): activity pushes (likes, replies, Worlds) start OFF on the
 * server so older TestFlight builds — which can't turn them off or open them —
 * never get them. This app turns them on once per account (default on); after
 * that only the person's own switch decides. Quiet on servers without 0012.
 */
async function turnOnActivityOnce(): Promise<void> {
  try {
    const sb = supabase();
    const r = await sb.from('notification_prefs').select('activity').maybeSingle();
    if (r.error) return; // before 0012 (no column) or offline: try again next launch
    const v = (r.data as { activity?: boolean | null } | null)?.activity;
    if (v === true || v === false) return; // already decided
    await sb.rpc('set_notification_prefs', { p_activity: true });
  } catch {
    /* next launch */
  }
}

export async function saveNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const args: Record<string, boolean | null> = {
    p_messages: patch.messages ?? null,
    p_connections: patch.connections ?? null,
    p_after_dark: patch.after_dark ?? null,
  };
  // Only send the 4th argument when it's being changed (older servers don't have it).
  if (patch.activity !== undefined) args.p_activity = patch.activity;
  const { data, error } = await supabase().rpc('set_notification_prefs', args);
  if (error) throw new Error(patch.activity !== undefined && error.code === 'PGRST202' ? 'Activity notifications aren’t available on this server yet.' : 'Couldn’t save. Check your connection and try again.');
  const r = data as Partial<Omit<NotificationPrefs, 'activity'>> & { activity?: boolean | null };
  // activity null = not turned on yet by this app (it will be, on push registration): show it as on.
  return { ...DEFAULT_PREFS, ...r, activity: r.activity ?? true } as NotificationPrefs;
}

// ─── Taps → screens (held until the account and its data are ready) ─────────

interface Pending {
  target: PushTarget;
  for: string | null;
  key: string;
  /** Phase 8: when it was tapped (ms) — a tap left waiting too long is dropped (see pushGate). */
  at: number;
}
let pending: Pending | null = null;
const handled = new Set<string>();
const listeners = new Set<() => void>();

export const pendingPush = () => pending;
export function takePendingPush(): Pending | null {
  const p = pending;
  pending = null;
  return p;
}
export function onPendingPush(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function accept(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const key = response.notification.request.identifier;
  if (handled.has(key)) return; // cold start + listener can both report the same tap
  handled.add(key);
  const data = response.notification.request.content.data as PushData;
  const target = routeForPush(data);
  if (!target) return;
  // When it was TAPPED (now) — not notification.date, whose unit differs by
  // platform (seconds on iOS, ms on Android). The cold-start response is
  // cleared after reading, so an old tap can't come back on a later launch.
  pending = { target, for: typeof data?.for === 'string' ? data.for : null, key, at: Date.now() };
  logEvent('push_opened', { targetType: 'notification', context: { kind: typeof data?.kind === 'string' ? data.kind : 'unknown' } });
  listeners.forEach((l) => l());
}

let installed = false;
/**
 * Once per app launch: foreground presentation, taps (including the tap that
 * launched the app) and token refreshes. `activeConversation` keeps a push
 * for the chat you're already reading from popping up.
 */
export function installPushHandling(activeConversation: () => string | undefined, currentUser: () => string | undefined, onTokenRefresh: () => void): () => void {
  if (installed || !(Platform.OS === 'ios' || Platform.OS === 'android')) return () => {};
  installed = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = n.request.content.data as PushData;
      const here = conversationOf(data);
      // Not for whoever is signed in now (signed out, another account): don't show it.
      const elsewhere = typeof data?.for === 'string' && data.for !== currentUser();
      const quiet = elsewhere || (!!here && here === activeConversation());
      // Phase 9: a message push reached this phone while Chimp is open →
      // Delivered (never Seen: only reading the chat does that). Checks the
      // account itself (deliveryTarget); fire-and-forget.
      const me = currentUser();
      if (!elsewhere && me) void ackDelivery(data ?? null, me);
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
  // The tap that opened the app from a cold start.
  try {
    accept(Notifications.getLastNotificationResponse());
    // Phase 8: consume it, so the NEXT cold launch (without a tap) doesn't reopen that old chat.
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  } catch {
    // older binaries: the listener below still catches warm taps
  }
  const tapSub = Notifications.addNotificationResponseReceivedListener((r) => {
    accept(r);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  });
  const tokenSub = Notifications.addPushTokenListener(() => onTokenRefresh());
  return () => {
    tapSub.remove();
    tokenSub.remove();
    installed = false;
  };
}
