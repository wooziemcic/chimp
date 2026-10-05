/**
 * Feed ordering rules (pre-TestFlight content-ordering update). Pure, so every
 * rule is unit-tested and the same rule is used by every surface.
 *
 *   Newest first          Buzz → For You, Following, Drift, Board Explore,
 *                         profile Recent Posts. created_at descending.
 *   Today first           Board Today: posts created today (the phone's local
 *                         calendar day) first, newest first; older posts follow
 *                         underneath, also newest first.
 *   Engagement            Buzz → Trending, Board Buzzing. See `engagementScore`.
 *
 * Every comparator ends in a stable tie-break (newest, then id), so the order is
 * a total order: sorting the whole list and then showing it page by page gives
 * the same order on every page, and a reload with the same data gives the same
 * order.
 */

export interface Timed {
  id: string;
  /** created_at in ms (server time for real rows). */
  createdMs: number;
}

export interface Engaged extends Timed {
  likes: number;
  comments: number;
}

/**
 * Trending / Buzzing ranking.
 *
 *   engagement     = likes × 1 + comments × 1.5
 *   aged           = engagement × 0.5^(ageDays / 7)
 *   recency boost  = 6 × 0.5^(ageHours / 24)
 *   score          = aged + recency boost
 *
 * - Engagement drives the order. Comments count a little more than likes
 *   (writing a reply is a stronger signal than a tap).
 * - The recency boost is small: worth 6 likes for a brand-new post, 3 after a
 *   day, 1.5 after two days, about 0 after a week. It lets a new post with a
 *   few likes compete with an older one that has slightly more.
 * - Engagement fades gently: 0.9 of its weight after a day, half after a week,
 *   a quarter after two weeks. A purely additive boost can't do this on its
 *   own: an old viral post's lead would never shrink, so it would stay on top
 *   forever. Between posts a day or two apart, engagement still decides.
 */
export const ENGAGEMENT = {
  likeWeight: 1,
  commentWeight: 1.5,
  /** Engagement's weight halves every this many days. */
  halfLifeDays: 7,
  /** The recency boost for a post created just now. */
  recencyBoost: 6,
  /** The boost halves every this many hours. */
  recencyHalfLifeHours: 24,
} as const;

const HOUR = 3_600_000;

export function ageHoursAt(createdMs: number, now: number): number {
  return Math.max(0, now - createdMs) / HOUR;
}

/** The small recency term on its own (0..ENGAGEMENT.recencyBoost). */
export function recencyBoost(ageHours: number): number {
  return ENGAGEMENT.recencyBoost * Math.pow(0.5, Math.max(0, ageHours) / ENGAGEMENT.recencyHalfLifeHours);
}

export function engagementScore(likes: number, comments: number, ageHours: number): number {
  const engagement = Math.max(0, likes) * ENGAGEMENT.likeWeight + Math.max(0, comments) * ENGAGEMENT.commentWeight;
  const aged = engagement * Math.pow(0.5, Math.max(0, ageHours) / 24 / ENGAGEMENT.halfLifeDays);
  return aged + recencyBoost(ageHours);
}

/** Newest first; equal times by id (stable across pages and reloads). */
export function byNewest(a: Timed, b: Timed): number {
  return b.createdMs - a.createdMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function newestFirst<T extends Timed>(list: readonly T[]): T[] {
  return [...list].sort(byNewest);
}

/** Highest engagement score first; ties newest first, then id. `now` is fixed for the whole sort. */
export function byEngagement(now: number) {
  return (a: Engaged, b: Engaged) => engagementScore(b.likes, b.comments, ageHoursAt(b.createdMs, now)) - engagementScore(a.likes, a.comments, ageHoursAt(a.createdMs, now)) || byNewest(a, b);
}

export function mostEngaged<T extends Engaged>(list: readonly T[], now: number): T[] {
  // Score once per item (not once per comparison).
  const scored = list.map((x) => ({ x, s: engagementScore(x.likes, x.comments, ageHoursAt(x.createdMs, now)) }));
  return scored.sort((a, b) => b.s - a.s || byNewest(a.x, b.x)).map(({ x }) => x);
}

/** Midnight (local time) of the day `now` falls in. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Created on the phone's current local calendar day. */
export function isToday(createdMs: number, now: number): boolean {
  const start = startOfLocalDay(now);
  const d = new Date(start);
  d.setDate(d.getDate() + 1); // next local midnight (DST-safe: not start + 24 h)
  return createdMs >= start && createdMs < d.getTime();
}

/**
 * Board Today: today's posts first (newest first), then older posts (newest
 * first). Returns both parts so the screen can head them "New today" / "Earlier".
 */
export function todayFirst<T extends Timed>(list: readonly T[], now: number): { today: T[]; earlier: T[] } {
  const sorted = newestFirst(list);
  return { today: sorted.filter((x) => isToday(x.createdMs, now)), earlier: sorted.filter((x) => !isToday(x.createdMs, now)) };
}
