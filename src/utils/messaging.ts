/**
 * Final messaging patch: the deterministic parts of Mutual Ping and Group
 * Chemistry (no AI anywhere). Pure functions, shared by REAL and Demo.
 *
 * The server (0006_messaging_chemistry.sql, pings_compatible / send_ping) is
 * the authority for matching; `pingsCompatible` mirrors it for the Demo.
 */
import type { LoopRow, MemberRow, PingKind, PingMatchRow, ReactionRow, SameBrainRow } from '@/services/backend/chat';

export const PING_TYPES: { kind: PingKind; label: string; emoji: string }[] = [
  { kind: 'free_tonight', label: 'Free tonight', emoji: '🌙' },
  { kind: 'food', label: 'Food?', emoji: '🍜' },
  { kind: 'hang_out', label: 'Hang out', emoji: '🙌' },
  { kind: 'call', label: 'Call?', emoji: '📞' },
  { kind: 'need_advice', label: 'Need advice', emoji: '🧭' },
  { kind: 'thinking_of_you', label: 'Thinking about you', emoji: '💭' },
  { kind: 'custom', label: 'Custom', emoji: '✏️' },
];
export const pingLabel = (k: PingKind) => PING_TYPES.find((p) => p.kind === k)?.label ?? k;
export const pingEmoji = (k: PingKind) => PING_TYPES.find((p) => p.kind === k)?.emoji ?? '✨';

const PAIRS = new Set(['food|free_tonight', 'free_tonight|hang_out', 'food|hang_out', 'call|need_advice', 'call|thinking_of_you']);
const norm = (t?: string | null) => (t ?? '').trim().toLowerCase();

/** Same kind always; custom only with the same words; plus the explicit pairs. */
export function pingsCompatible(a: PingKind, aText: string | null | undefined, b: PingKind, bText: string | null | undefined): boolean {
  if (a === 'custom' || b === 'custom') return a === b && norm(aText) !== '' && norm(aText) === norm(bText);
  if (a === b) return true;
  return PAIRS.has([a, b].sort().join('|'));
}

const PLAN: PingKind[] = ['free_tonight', 'food', 'hang_out'];

/** The reveal copy for a match (only ever shown once the server made one). */
export function matchCopy(m: Pick<PingMatchRow, 'kinds' | 'participants' | 'custom_text'>, group: boolean): { title: string; sub: string } {
  const n = m.participants.length;
  if (m.kinds.includes('custom')) {
    return group ? { title: `${n} of you said “${m.custom_text ?? ''}”`, sub: 'Something could happen.' } : { title: `You both said “${m.custom_text ?? ''}”`, sub: 'Looks like you two are on the same page.' };
  }
  const plan = m.kinds.every((k) => PLAN.includes(k));
  if (group) return plan ? { title: 'Something could happen tonight.', sub: `${n} people are interested.` } : { title: 'A few of you want to talk.', sub: `${n} people are up for it.` };
  return plan ? { title: 'Looks like you two might want to do something tonight.', sub: 'You both said so, privately.' } : { title: 'Looks like you two want to talk.', sub: 'You both said so, privately.' };
}

// ─── Group Chemistry ─────────────────────────────────────────────────────────

export interface ChemistryInput {
  now: number;
  members: Pick<MemberRow, 'user_id' | 'status'>[];
  messages: { senderId: string; createdAt: string; id: string }[];
  reactions: Pick<ReactionRow, 'message_id' | 'user_id' | 'emoji' | 'created_at'>[];
  sameBrain: Pick<SameBrainRow, 'message_id' | 'emoji' | 'created_at'>[];
  loops: Pick<LoopRow, 'title' | 'status'>[];
  matches: Pick<PingMatchRow, 'kinds' | 'participants' | 'created_at'>[];
  /** Worlds in which at least two current members are members. */
  sharedWorlds: { title: string; members: number }[];
}

export interface ChemistryLine {
  key: 'active' | 'consensus' | 'same_brain' | 'loops' | 'pings' | 'worlds';
  icon: string;
  text: string;
}

const DAY = 24 * 3600 * 1000;

/**
 * Deterministic facts only, from rows every member can already read. Hidden
 * Pings are never an input (the app can't even read them); only revealed
 * matches count.
 */
export function computeChemistry(c: ChemistryInput): { lines: ChemistryLine[]; strip: string } {
  const lines: ChemistryLine[] = [];
  const current = new Set(c.members.filter((m) => m.status !== 'left').map((m) => m.user_id));
  const recent = (iso: string, span: number) => c.now - Date.parse(iso) <= span;

  const active = new Set(c.messages.filter((m) => current.has(m.senderId) && recent(m.createdAt, DAY)).map((m) => m.senderId));
  if (active.size) lines.push({ key: 'active', icon: '💬', text: `${active.size} of ${current.size} active today` });

  // Reaction consensus: a recent message where 2+ people chose the same emoji
  // (and it hasn't already turned into a Same Brain).
  const brains = new Set(c.sameBrain.map((e) => `${e.message_id}|${e.emoji}`));
  const tally = new Map<string, Set<string>>();
  for (const r of c.reactions) {
    if (!recent(r.created_at, DAY) || !current.has(r.user_id)) continue;
    const k = `${r.message_id}|${r.emoji}`;
    if (!tally.has(k)) tally.set(k, new Set());
    tally.get(k)!.add(r.user_id);
  }
  const best = [...tally.entries()].filter(([k, who]) => who.size >= 2 && !brains.has(k)).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
  if (best) lines.push({ key: 'consensus', icon: '🤝', text: `${best[0].split('|')[1]} consensus forming (${best[1].size})` });

  const week = c.sameBrain.filter((e) => recent(e.created_at, 7 * DAY));
  if (week.length) lines.push({ key: 'same_brain', icon: '⚡', text: week.length === 1 ? 'Same Brain this week' : `Same Brain ×${week.length} this week` });

  const open = c.loops.filter((l) => l.status === 'open');
  if (open.length) lines.push({ key: 'loops', icon: '🔁', text: open.length === 1 ? `${open[0].title} still open` : `${open[0].title} still open · ${open.length - 1} more` });

  const fresh = c.matches.filter((m) => recent(m.created_at, DAY));
  if (fresh.length) {
    const m = fresh[0];
    const plan = m.kinds.every((k) => PLAN.includes(k));
    lines.push({ key: 'pings', icon: '✨', text: plan ? `${m.participants.length} up for tonight` : `${m.participants.length} want to talk` });
  }

  const world = [...c.sharedWorlds].sort((a, b) => b.members - a.members || a.title.localeCompare(b.title))[0];
  if (world) lines.push({ key: 'worlds', icon: '🌍', text: `${world.title} · ${world.members} of you are in it` });

  const strip = lines.length >= 3 ? 'Chemistry ↑' : lines.length ? 'Chemistry' : 'Chemistry · quiet';
  return { lines, strip };
}

// ─── Reactions (display) ─────────────────────────────────────────────────────

export interface ReactionChip {
  emoji: string;
  count: number;
  mine: boolean;
  /** This message + emoji turned into a Same Brain. */
  sameBrain: boolean;
}

const ORDER = ['❤️', '😂', '🔥', '👍', '😮', '😭'];

/** Real counts per emoji for one message (distinct people), most-chosen first. */
export function summarizeReactions(reactions: Pick<ReactionRow, 'message_id' | 'user_id' | 'emoji'>[], sameBrain: Pick<SameBrainRow, 'message_id' | 'emoji'>[], messageId: string, me: string | undefined): ReactionChip[] {
  const by = new Map<string, Set<string>>();
  for (const r of reactions) {
    if (r.message_id !== messageId) continue;
    if (!by.has(r.emoji)) by.set(r.emoji, new Set());
    by.get(r.emoji)!.add(r.user_id);
  }
  const brains = new Set(sameBrain.filter((e) => e.message_id === messageId).map((e) => e.emoji));
  return [...by.entries()]
    .map(([emoji, who]) => ({ emoji, count: who.size, mine: !!me && who.has(me), sameBrain: brains.has(emoji) }))
    .sort((a, b) => b.count - a.count || ORDER.indexOf(a.emoji) - ORDER.indexOf(b.emoji));
}

/** A starting title for an Open Loop made from a message. */
export function loopTitleFrom(body: string | undefined): string {
  const t = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Photo from the chat';
  return t.length <= 60 ? t : `${t.slice(0, 57).trimEnd()}…`;
}

/** A loop title for a revealed match. */
export function loopTitleForMatch(m: Pick<PingMatchRow, 'kinds' | 'custom_text'>): string {
  if (m.kinds.includes('custom')) return (m.custom_text ?? 'Plan').slice(0, 60);
  if (m.kinds.includes('food')) return 'Food tonight';
  if (m.kinds.every((k) => PLAN.includes(k))) return 'Tonight';
  return 'Catch up call';
}

/** Local calendar date → 'YYYY-MM-DD'. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' → "Today" / "Tomorrow" / "Sat, Oct 3". */
export function dayText(iso: string | null | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const day = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
