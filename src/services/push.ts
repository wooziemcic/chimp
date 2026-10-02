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
}
export const DEFAULT_PREFS: NotificationPrefs = { messages: true, connections: true, after_dark: true };

export async function fetchNotificationPrefs(): Promise<NotificationPrefs | null> {
  if (!isBackendConfigured) return null;
  const { data, error } = await supabase().from('notification_prefs').select('messages, connections, after_dark').maybeSingle();
  if (error) return null; // 0009 not applied yet
  return (data as NotificationPrefs | null) ?? DEFAULT_PREFS;
}

export async function saveNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const { data, error } = await supabase().rpc('set_notification_prefs', {
    p_messages: patch.messages ?? null,
    p_connections: patch.connections ?? null,
    p_after_dark: patch.after_dark ?? null,
  });
  if (error) throw new Error('Couldn’t save. Check your connection and try again.');
  const r = data as NotificationPrefs;
  return { messages: r.messages, connections: r.connections, after_dark: r.after_dark };
}

// ─── Taps → screens (held until the account and its data are ready) ─────────

interface Pending {
  target: PushTarget;
  for: string | null;
  key: string;
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
  pending = { target, for: typeof data?.for === 'string' ? data.for : null, key };
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
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
  // The tap that opened the app from a cold start.
  try {
    accept(Notifications.getLastNotificationResponse());
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
