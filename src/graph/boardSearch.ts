/**
 * Phase 9.2: Boards search — Boards only (never people). Order:
 *   1. your Boards (you made it or you're a member) that match
 *   2. other Boards whose title is exactly what you typed
 *   3. looser matches among your Boards and the ones you saved
 *   4. Boards made by your connections
 *   5. every other Board you can see (public / discoverable)
 * Shown as "Your Boards" (1 + 3, and saved ones) then "Other Boards" (2, 4, 5).
 * Only Boards already in your world are searched, so a Board you may not see
 * never appears here.
 */
import type { Board } from '@/types/models';

export interface BoardSearchCtx {
  isMine: (b: Board) => boolean;
  saved: Record<string, boolean | undefined>;
  connected: Record<string, unknown>;
  interestLabel?: (id: string) => string | undefined;
}

export interface BoardSearchResult {
  yours: Board[];
  others: Board[];
}

const norm = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** 0 = no match; higher is closer. 4 exact title · 3 title starts with · 2 in the title · 1 in its words · 0.5 loose. */
export function boardMatch(b: Board, query: string, interestLabel?: (id: string) => string | undefined): number {
  const q = norm(query);
  if (!q) return 0;
  const title = norm(b.title);
  if (title === q) return 4;
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  const rest = norm([b.tagline, b.city, ...b.interests.map((i) => interestLabel?.(i) ?? '')].join(' '));
  if (rest.includes(q)) return 1;
  // Loose: every word you typed starts some word of the title or description ("nyc roof" → "NYC Rooftops").
  const words = `${title} ${rest}`.split(' ').filter(Boolean);
  const parts = q.split(' ').filter(Boolean);
  if (parts.length && parts.every((p) => words.some((w) => w.startsWith(p)))) return 0.5;
  return 0;
}

export function searchBoards(boards: Board[], query: string, ctx: BoardSearchCtx): BoardSearchResult {
  const hits = boards.map((b) => ({ b, m: boardMatch(b, query, ctx.interestLabel) })).filter((h) => h.m > 0);
  const tier = (b: Board, m: number): number => {
    const mine = ctx.isMine(b);
    if (mine && m >= 1) return 1;
    if (!mine && m === 4) return 2;
    if (mine || ctx.saved[b.id]) return 3;
    if (b.ownerId && ctx.connected[b.ownerId]) return 4;
    return 5;
  };
  const ranked = hits
    .map((h) => ({ ...h, t: tier(h.b, h.m) }))
    .sort((a, z) => a.t - z.t || z.m - a.m || (z.b.memberCount ?? 0) - (a.b.memberCount ?? 0) || a.b.title.localeCompare(z.b.title));
  const yoursSet = (b: Board) => ctx.isMine(b) || !!ctx.saved[b.id];
  return {
    yours: ranked.filter((h) => yoursSet(h.b)).map((h) => h.b),
    others: ranked.filter((h) => !yoursSet(h.b)).map((h) => h.b),
  };
}
