/**
 * Phase 9.2: the Boards "Timeline" layout — the very same Board objects as
 * Covers, grouped by when they matter:
 *
 *   Today      a plan (Move) in it today, or something posted in it today
 *   This Week  a plan in the next 7 days, or activity in the last 7 days
 *   Later      its next plan is more than a week away
 *   Memories   nothing coming up and nothing new for a week (or only past plans)
 *   Anytime    no useful date at all (e.g. a Chimp World nobody has posted in yet)
 *
 * Dates come from what the app already has: Moves linked to a Board
 * (startsAt), the newest Buzz / Drift posted in it, and — for Boards people
 * made — when it was made. Nothing is stored for this.
 */
import type { Board, BuzzItem, DriftItem, Move } from '@/types/models';

export type TimelineGroupId = 'today' | 'week' | 'later' | 'memories' | 'anytime';

export interface TimelineEntry {
  board: Board;
  group: TimelineGroupId;
  /** The moment it's grouped by (ms), if any. */
  at?: number;
  /** One short line: why it's here ("Plan · Fri, Apr 12", "Active 2h ago"). */
  why: string;
}

export interface TimelineGroup {
  id: TimelineGroupId;
  title: string;
  entries: TimelineEntry[];
}

export const TIMELINE_TITLES: Record<TimelineGroupId, string> = {
  today: 'Today',
  week: 'This Week',
  later: 'Later',
  memories: 'Memories',
  anytime: 'Anytime',
};
const ORDER: TimelineGroupId[] = ['today', 'week', 'later', 'memories', 'anytime'];
const DAY = 86_400_000;

const itemTime = (x: { createdAtMs?: number; ageHours?: number; createdAt?: string }, now: number): number | undefined => {
  if (x.createdAtMs && Number.isFinite(x.createdAtMs)) return x.createdAtMs;
  if (typeof x.ageHours === 'number' && Number.isFinite(x.ageHours)) return now - x.ageHours * 3_600_000;
  const t = x.createdAt ? Date.parse(x.createdAt) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/** Newest post time per Board (Buzz + Drift). */
export function lastActivity(buzz: BuzzItem[], drift: DriftItem[], now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of [...buzz, ...drift]) {
    if (!x.boardId) continue;
    const t = itemTime(x, now);
    if (t !== undefined && t <= now + 60_000 && (out[x.boardId] ?? 0) < t) out[x.boardId] = t;
  }
  return out;
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDate = (t: number, now: number) => new Date(t).toLocaleDateString('en-US', new Date(t).getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
function ago(t: number, now: number): string {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function timelineEntry(board: Board, moves: Move[], activity: Record<string, number>, now = Date.now()): TimelineEntry {
  const startOfToday = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const plans = moves
    .filter((m) => m.boardId === board.id)
    .map((m) => ({ m, t: Date.parse(m.startsAt) }))
    .filter((p) => Number.isFinite(p.t));
  const next = plans.filter((p) => p.t >= startOfToday).sort((a, b) => a.t - b.t)[0];
  if (next) {
    const group: TimelineGroupId = next.t < startOfToday + DAY ? 'today' : next.t < startOfToday + 7 * DAY ? 'week' : 'later';
    return { board, group, at: next.t, why: `Plan · ${next.m.title} · ${group === 'today' ? 'today' : fmtDay(next.t)}` };
  }
  const last = activity[board.id];
  if (last !== undefined) {
    if (last >= startOfToday) return { board, group: 'today', at: last, why: `Active ${ago(last, now)}` };
    if (last >= now - 7 * DAY) return { board, group: 'week', at: last, why: `Active ${ago(last, now)}` };
    return { board, group: 'memories', at: last, why: `Last active ${fmtDate(last, now)}` };
  }
  const past = plans.sort((a, b) => b.t - a.t)[0];
  if (past) return { board, group: 'memories', at: past.t, why: `Plan was ${fmtDate(past.t, now)}` };
  // Boards people made: when it was made. A Chimp World with nothing in it yet has no date that means anything.
  const made = board.ownerId ? Date.parse(board.createdAt) : NaN;
  if (Number.isFinite(made) && made <= now + 60_000) {
    if (made >= startOfToday) return { board, group: 'today', at: made, why: 'Started today' };
    if (made >= now - 7 * DAY) return { board, group: 'week', at: made, why: `Started ${ago(made, now)}` };
    return { board, group: 'memories', at: made, why: `Started ${fmtDate(made, now)}` };
  }
  return { board, group: 'anytime', why: board.memberCount ? `${board.memberCount} ${board.memberCount === 1 ? 'member' : 'members'}` : 'No dates yet' };
}

export function boardTimeline(boards: Board[], moves: Move[], activity: Record<string, number>, now = Date.now()): TimelineGroup[] {
  const entries = boards.map((b) => timelineEntry(b, moves, activity, now));
  const isPlan = (e: TimelineEntry) => e.why.startsWith('Plan ·');
  return ORDER.map((id) => {
    const list = entries.filter((e) => e.group === id);
    list.sort((a, b) => {
      if (id === 'later') return (a.at ?? 0) - (b.at ?? 0); // soonest first
      if (id === 'anytime') return a.board.title.localeCompare(b.board.title);
      if (id === 'memories') return (b.at ?? 0) - (a.at ?? 0); // most recent first
      // Today / This Week: plans first (soonest), then the most recently active.
      if (isPlan(a) !== isPlan(b)) return isPlan(a) ? -1 : 1;
      return isPlan(a) ? (a.at ?? 0) - (b.at ?? 0) : (b.at ?? 0) - (a.at ?? 0);
    });
    return { id, title: TIMELINE_TITLES[id], entries: list };
  }).filter((g) => g.entries.length);
}
