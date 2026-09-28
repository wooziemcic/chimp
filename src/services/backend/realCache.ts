/**
 * Phase 6C: the last full load of a REAL account, kept on this phone so the
 * next launch shows Buzz immediately (then refreshes from Supabase).
 *
 * Isolation: one key per account id, only ever read for that same account
 * (the id is checked again inside), never in Demo, and removed when that
 * account signs out. Content only (rows you could already see); no tokens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RealRaw } from './content';

const key = (uid: string) => `chimp-real-cache:${uid}`;

export async function readRealCache(uid: string): Promise<RealRaw | null> {
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RealRaw;
    return parsed && parsed.v === 2 && parsed.uid === uid ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeRealCache(raw: RealRaw): Promise<void> {
  try {
    await AsyncStorage.setItem(key(raw.uid), JSON.stringify(raw));
  } catch {
    // A full disk just means no instant launch next time.
  }
}

export async function clearRealCache(uid: string): Promise<void> {
  await AsyncStorage.removeItem(key(uid)).catch(() => undefined);
}
