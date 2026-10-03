/**
 * Build 5 patch 2: in-app social notifications ("Aayush followed you",
 * "… wants to connect", "… accepted your connection").
 *
 * No new table: these are the account's own `user_events` rows (0008 / 0010),
 * the same events that drive the phone push. Loaded on start and on every
 * foreground / reconnect reconcile, and added live from the existing
 * user_events Realtime channel (services/live.ts). Rows are keyed by id, so an
 * event seen by both Realtime and a refresh appears once.
 *
 * Only these three kinds are shown here: After Dark events keep their own,
 * generic surfaces, and a one-way Crush never produces an event at all.
 */
import { create } from 'zustand';

import { fetchSocialEvents, markEventsSeen, type SocialEventRow } from '@/services/backend/people';

export const SOCIAL_KINDS = ['follow', 'connection_request', 'connection_accepted'] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export const isSocialKind = (k: string): k is SocialKind => (SOCIAL_KINDS as readonly string[]).includes(k);

interface SocialInbox {
  uid: string | null;
  items: SocialEventRow[];
  load: (uid: string) => Promise<void>;
  /** A row from Realtime (ignored if not social, not ours, or already here). */
  add: (row: SocialEventRow) => void;
  markSeen: () => void;
  reset: () => void;
}

const MAX = 50;
const merge = (a: SocialEventRow[], b: SocialEventRow[]) => {
  const byId = new Map<string, SocialEventRow>();
  for (const r of [...a, ...b]) {
    const prev = byId.get(r.id);
    // A row marked seen anywhere stays seen.
    byId.set(r.id, prev ? { ...r, seen_at: prev.seen_at ?? r.seen_at } : r);
  }
  return [...byId.values()].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, MAX);
};

export const useSocialInbox = create<SocialInbox>((set, get) => ({
  uid: null,
  items: [],
  load: async (uid) => {
    if (get().uid !== uid) set({ uid, items: [] });
    const rows = await fetchSocialEvents([...SOCIAL_KINDS], MAX).catch(() => null);
    if (!rows || get().uid !== uid) return;
    set({ items: merge(get().items, rows.filter((r) => isSocialKind(r.kind))) });
  },
  add: (row) => {
    const { uid, items } = get();
    if (!uid || row.user_id !== uid || !isSocialKind(row.kind)) return;
    set({ items: merge(items, [{ ...row, seen_at: row.seen_at ?? null }]) });
  },
  markSeen: () => {
    const { uid, items } = get();
    if (!uid || !items.some((i) => !i.seen_at)) return;
    const now = new Date().toISOString();
    set({ items: items.map((i) => (i.seen_at ? i : { ...i, seen_at: now })) });
    void markEventsSeen().catch(() => {});
  },
  reset: () => set({ uid: null, items: [] }),
}));

export const selectUnseenSocial = (s: SocialInbox) => s.items.filter((i) => !i.seen_at).length;

/** "Aayush followed you" etc. (first name only; the name comes from the profile). */
export function socialLine(kind: string, name: string): string {
  if (kind === 'follow') return `${name} followed you`;
  if (kind === 'connection_request') return `${name} wants to connect`;
  if (kind === 'connection_accepted') return `${name} accepted your connection`;
  return name;
}
