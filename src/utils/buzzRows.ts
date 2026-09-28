/**
 * Buzz grid helpers (Phase 6C). Pure, so ordering is unit-tested.
 *
 * packRows: half-width cards pair up side by side, but ONLY with the card
 * right after them. A half card is never held back while a later full card
 * goes first (that was the 6B bug: a newer text post appeared below an older
 * photo post). A half card with no partner gets a full-width row of its own.
 *
 * pinFresh: For You only. Your own posts from the last 30 minutes lead, newest
 * first (server timestamps once saved; the phone's clock only for items that
 * exist on this phone alone, i.e. Demo), then the ranked feed without them.
 */
export interface RowItem {
  id: string;
  layout?: 'half' | 'full';
}

export interface Row<T> {
  key: string;
  items: T[];
}

export function packRows<T extends RowItem>(list: T[]): Row<T>[] {
  const rows: Row<T>[] = [];
  let pending: T | null = null;
  for (const it of list) {
    if (it.layout !== 'full' && pending) {
      rows.push({ key: `${pending.id}+${it.id}`, items: [pending, it] });
      pending = null;
      continue;
    }
    if (pending) {
      rows.push({ key: pending.id, items: [pending] });
      pending = null;
    }
    if (it.layout === 'full') rows.push({ key: it.id, items: [it] });
    else pending = it;
  }
  if (pending) rows.push({ key: pending.id, items: [pending] });
  return rows;
}

export const FRESH_WINDOW_MS = 30 * 60_000;

export function pinFresh<T extends { id: string; authorId?: string; createdAtMs?: number }>(ranked: T[], isMe: (id?: string) => boolean, now: number): T[] {
  const fresh = ranked.filter((b) => isMe(b.authorId) && b.createdAtMs !== undefined && now - b.createdAtMs < FRESH_WINDOW_MS).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  if (!fresh.length) return ranked;
  const ids = new Set(fresh.map((b) => b.id));
  return [...fresh, ...ranked.filter((b) => !ids.has(b.id))];
}
