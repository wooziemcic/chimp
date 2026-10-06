/**
 * Phase 9 — Happening: "What changed that matters?"
 *
 * The user-facing Happening is no longer the node canvas. It is five simple,
 * deterministic sections built ONLY from real events already on the phone
 * (the dataset the account may see, and its own user_events):
 *
 *   Stories                 your Story first, then people you know (unseen
 *                           first), then Worlds' Stories. Expired items never.
 *   Pinned Worlds           your pins, your own Worlds' pins first.
 *   Happening Now           3–5 cards: a World picking up, people joining, a
 *                           friend posting in a World you follow, people you
 *                           know active around the same World.
 *   People you may know     mutual connections / shared Worlds (server
 *                           counts, 0012) + shared interests + recent overlap.
 *   Changed since you were here
 *                           a short chronological list of what happened to
 *                           you and around you.
 *
 * Nothing is invented: every number is a count of real rows, every name a
 * real person. With a small network the sections simply get shorter.
 * Never After Dark, never anyone you blocked, never a World you can't see
 * (the dataset only holds Worlds you may see; pins of others are filtered by
 * the server).
 *
 * Ranking (Happening Now) — transparent and deterministic:
 *   +50 your own World · +40 pinned · +30 a World you follow · +20 one you joined
 *   +15 per person you know involved (max +30)
 *   +4 per interaction in the window (max +20)
 *   +20 × 0.5^(hours since the newest event / 12)        (recency)
 *   +6  the World matches one of your top interests
 *   ties → newest event, then id.
 * A card needs a real reason to exist (one of: yours / pinned / followed /
 * joined / someone you know / your interests); otherwise it isn't shown.
 */
import { interestById } from '@/data/interests';
import { ds } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { Board, EntityRef, ImageSrc, Story, StoryItem } from '@/types/models';
import { AFFINITY } from './config';
import type { GraphContext } from './relevance';
import { canViewBoard, createdMs, isAfterDarkBoard, isAfterDarkRef } from './surfaces';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STORY_LIFE = DAY;

export const NOW_WEIGHTS = {
  own: 50,
  pinned: 40,
  followed: 30,
  joined: 20,
  perKnownPerson: 15,
  knownMax: 30,
  perInteraction: 4,
  interactionsMax: 20,
  recency: 20,
  recencyHalfLifeHours: 12,
  interest: 6,
} as const;

export const NOW_MAX = 5;
/** Posts count as "now" for this long; joins for a week. */
export const POSTS_WINDOW = 48 * HOUR;
export const JOINS_WINDOW = 7 * DAY;

export interface HappeningInput {
  pins: Record<string, number>;
  followedBoards: Record<string, true | boolean>;
  now: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (id: string) => repo.user(id)?.displayName.split(' ')[0] ?? 'Someone';

/**
 * Is this World one you may see on Happening at all? It must be on this phone
 * (the server only sends Worlds you may see), not After Dark, AND pass the
 * same access rule as every other surface (canViewBoard) — a pin, a
 * suggestion or an event never grants access by itself.
 */
function visibleBoard(ctx: GraphContext, id: string | null | undefined): Board | undefined {
  if (!id) return undefined;
  const b = repo.board(id);
  return b && !isAfterDarkBoard(b) && canViewBoard(ctx, b.id) ? b : undefined;
}

// ─── Stories ────────────────────────────────────────────────────────────────

/** When a Story item was posted (ms), or NaN for Demo fixtures that only have a label ("2h"). */
export const storyItemMs = (i: Pick<StoryItem, 'createdAt' | 'createdAtMs'>): number => i.createdAtMs ?? Date.parse(i.createdAt);

/** A Story with only its live items (an item lives 24 h from when it was posted). */
export function liveStory(st: Story, now: number): Story | null {
  const items = st.items.filter((i) => {
    const at = storyItemMs(i);
    return !Number.isFinite(at) || now - at < STORY_LIFE; // Demo fixtures with labels ("2h") stay
  });
  return items.length ? (items.length === st.items.length ? st : { ...st, items }) : null;
}

export interface StoriesRow {
  mine: Story | null;
  others: Story[];
}

/** Your Story first, then people you know (unseen first), then Worlds' Stories. */
export function storiesRow(ctx: GraphContext, seen: Record<string, boolean | true>, now: number): StoriesRow {
  const { s } = ctx;
  const meId = repo.meId();
  const known = (id: string) => !!s.following[id] || !!s.connections[id];
  const unseen = (st: Story) => st.items.some((i) => !seen[i.id]);
  let mine: Story | null = null;
  const people: Story[] = [];
  const worlds: Story[] = [];
  for (const raw of ds().stories) {
    if (isAfterDarkRef({ kind: 'story', id: raw.id })) continue;
    const st = liveStory(raw, now);
    if (!st) continue;
    if (st.owner.kind === 'person') {
      if (st.owner.id === meId) mine = st;
      else if (known(st.owner.id) && !s.blocked[st.owner.id]) people.push(st);
    } else if (st.owner.kind === 'board' && visibleBoard(ctx, st.owner.id)) {
      if (!st.items.every((i) => s.blocked[i.authorId])) worlds.push(st);
    }
  }
  const newest = (st: Story) => Math.max(...st.items.map((i) => storyItemMs(i) || 0));
  const order = (a: Story, b: Story) => Number(unseen(b)) - Number(unseen(a)) || newest(b) - newest(a) || (a.id < b.id ? -1 : 1);
  return { mine, others: [...people.sort(order), ...worlds.sort(order)] };
}

// ─── Pinned Worlds ──────────────────────────────────────────────────────────

/** Your pinned Worlds you can still see: your own Worlds first, then most recently pinned. */
export function pinnedWorlds(ctx: GraphContext, pins: Record<string, number>): Board[] {
  return Object.keys(pins)
    .map((id) => visibleBoard(ctx, id))
    .filter((b): b is Board => !!b)
    .sort((a, b) => Number(repo.isMe(b.ownerId)) - Number(repo.isMe(a.ownerId)) || pins[b.id] - pins[a.id] || (a.id < b.id ? -1 : 1));
}

// ─── Happening Now ──────────────────────────────────────────────────────────

export type NowKind = 'picking_up' | 'new_posts' | 'friend_posted' | 'joins' | 'together';

export interface NowCard {
  id: string;
  kind: NowKind;
  title: string;
  /** Why it's here, in plain words. */
  why: string;
  image?: ImageSrc;
  ref: EntityRef;
  /** People involved you know (avatars). */
  people: string[];
  at: number;
  score: number;
}

interface WorldActivity {
  board: Board;
  posts: number;
  authors: Set<string>;
  joiners: Set<string>;
  postAt: number;
  joinAt: number;
}

export function happeningNow(ctx: GraphContext, input: HappeningInput): NowCard[] {
  const { s } = ctx;
  const { now, pins, followedBoards } = input;
  const data = ds();
  const ok = (id?: string) => !id || !s.blocked[id];
  const known = (id: string) => !repo.isMe(id) && (!!s.following[id] || !!s.connections[id]);
  const topInterests = Object.keys(s.affinity)
    .filter((i) => s.affinity[i] >= AFFINITY.meaningful && interestById[i]?.category !== 'afterDark')
    .sort((a, b) => s.affinity[b] - s.affinity[a])
    .slice(0, 5);

  const by = new Map<string, WorldActivity>();
  const get = (b: Board) => {
    let w = by.get(b.id);
    if (!w) {
      w = { board: b, posts: 0, authors: new Set(), joiners: new Set(), postAt: 0, joinAt: 0 };
      by.set(b.id, w);
    }
    return w;
  };
  const addPost = (boardId: string, authorId: string | undefined, at: number) => {
    // Your own posts aren't news to you.
    if (!authorId || repo.isMe(authorId) || !ok(authorId) || now - at > POSTS_WINDOW || at > now + HOUR) return;
    const b = visibleBoard(ctx, boardId);
    if (!b) return;
    const w = get(b);
    w.posts += 1;
    w.authors.add(authorId);
    w.postAt = Math.max(w.postAt, at);
  };
  for (const x of data.buzz) if (x.kind !== 'news') addPost(x.boardId, x.authorId, createdMs(x, now));
  for (const x of data.drift) addPost(x.boardId, x.authorId, createdMs(x, now));
  for (const j of data.memberJoins) {
    if (repo.isMe(j.userId) || !ok(j.userId) || now - j.at > JOINS_WINDOW) continue;
    const b = visibleBoard(ctx, j.boardId);
    if (!b || !repo.user(j.userId)) continue;
    const w = get(b);
    w.joiners.add(j.userId);
    w.joinAt = Math.max(w.joinAt, j.at);
  }

  const cards: NowCard[] = [];
  for (const w of by.values()) {
    const b = w.board;
    const own = repo.isMe(b.ownerId);
    const pinned = !!pins[b.id];
    const followed = !!followedBoards[b.id];
    const joined = !!s.joined[b.id];
    const knownPeople = [...new Set([...w.authors, ...w.joiners])].filter(known);
    const interest = b.interests.some((i) => topInterests.includes(i));
    // A card needs a real reason to be shown to you.
    if (!own && !pinned && !followed && !joined && !knownPeople.length && !interest) continue;
    const at = Math.max(w.postAt, w.joinAt);
    const interactions = w.posts + w.joiners.size;
    const score =
      (own ? NOW_WEIGHTS.own : 0) +
      (pinned ? NOW_WEIGHTS.pinned : 0) +
      (followed ? NOW_WEIGHTS.followed : 0) +
      (joined && !own ? NOW_WEIGHTS.joined : 0) +
      Math.min(NOW_WEIGHTS.knownMax, knownPeople.length * NOW_WEIGHTS.perKnownPerson) +
      Math.min(NOW_WEIGHTS.interactionsMax, interactions * NOW_WEIGHTS.perInteraction) +
      NOW_WEIGHTS.recency * Math.pow(0.5, Math.max(0, now - at) / HOUR / NOW_WEIGHTS.recencyHalfLifeHours) +
      (interest ? NOW_WEIGHTS.interest : 0);
    const why = own
      ? 'Your World'
      : pinned
        ? 'A World you pinned'
        : followed
          ? 'A World you follow'
          : joined
            ? 'A World you’re in'
            : knownPeople.length
              ? `${firstName(knownPeople[0])}${knownPeople.length > 1 ? ` and ${knownPeople.length - 1} more you know` : ''} ${knownPeople.length > 1 ? 'are' : 'is'} there`
              : `Because you’re into ${interestById[b.interests.find((i) => topInterests.includes(i))!]?.label ?? 'this'}`;
    const knownAuthors = [...w.authors].filter(known);
    let kind: NowKind;
    let title: string;
    if (knownPeople.length >= 2 && !own) {
      kind = 'together';
      title = `${firstName(knownPeople[0])} and ${knownPeople.length === 2 ? firstName(knownPeople[1]) : `${knownPeople.length - 1} others you know`} are active in ${b.title}`;
    } else if (w.posts >= 3) {
      kind = 'picking_up';
      title = `${b.title} is picking up`;
    } else if (w.joiners.size >= 2 || (w.joiners.size === 1 && w.posts === 0)) {
      kind = 'joins';
      title = w.joiners.size === 1 ? `${firstName([...w.joiners][0])} joined ${b.title}` : `${plural(w.joiners.size, 'person', 'people')} joined ${b.title}`;
    } else if (knownAuthors.length === 1 && w.posts <= 2) {
      kind = 'friend_posted';
      title = `${firstName(knownAuthors[0])} posted in ${followed ? 'a World you follow' : b.title}`;
    } else if (w.posts > 0) {
      kind = 'new_posts';
      title = `${plural(w.posts, 'new post')} in ${b.title}`;
    } else continue;
    const detail = [w.posts && kind !== 'new_posts' ? plural(w.posts, 'new post') : '', w.joiners.size && kind !== 'joins' ? plural(w.joiners.size, 'new member') : '']
      .filter(Boolean)
      .join(' · ');
    cards.push({
      id: `now:${b.id}`,
      kind,
      title,
      why: detail ? `${why} · ${detail}` : why,
      image: b.cover,
      ref: { kind: 'board', id: b.id },
      people: knownPeople.slice(0, 4),
      at,
      score: Math.round(score * 100) / 100,
    });
  }
  return cards.sort((a, b) => b.score - a.score || b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, NOW_MAX);
}

// ─── People you may want to know ────────────────────────────────────────────

export interface SuggestionRow {
  user_id: string;
  mutual_connections: number;
  shared_worlds: number;
}

export interface PersonSuggestion {
  personId: string;
  mutual: number;
  sharedWorlds: number;
  sharedInterests: number;
  /** "3 shared Worlds · 4 mutual connections" — only what's true. */
  line: string;
  score: number;
}

/**
 * Deterministic: server counts (mutual connections, shared Worlds — 0012's
 * suggest_people) plus what this phone knows (shared interests; people
 * active in your Worlds this week). Never you, anyone you blocked, or anyone
 * you already follow or are connected with.
 * score = 10·mutual + 8·sharedWorlds + 3·sharedInterests (max 4) + 4·active in your Worlds
 */
export function peopleToKnow(ctx: GraphContext, server: SuggestionRow[] | null, now: number, limit = 6, keep?: ReadonlySet<string>): PersonSuggestion[] {
  const { s } = ctx;
  const me = ds().me;
  const myInterests = new Set(me.interests ?? []);
  const myWorlds = new Set(repo.boards().filter((b) => !isAfterDarkBoard(b) && (s.joined[b.id] || repo.isMe(b.ownerId))).map((b) => b.id));
  // `keep`: people you just followed from this list stay (showing "Following") until you leave.
  const skip = (id: string) => repo.isMe(id) || !!s.blocked[id] || (!keep?.has(id) && (!!s.following[id] || !!s.connections[id]));
  const activeHere = new Set<string>();
  for (const x of ds().buzz) if (x.authorId && myWorlds.has(x.boardId) && now - createdMs(x, now) < 7 * DAY) activeHere.add(x.authorId);
  for (const j of ds().memberJoins) if (myWorlds.has(j.boardId) && now - j.at < 7 * DAY) activeHere.add(j.userId);

  const rows = new Map<string, { mutual: number; shared: number }>();
  for (const r of server ?? []) rows.set(r.user_id, { mutual: r.mutual_connections, shared: r.shared_worlds });
  // Client-side candidates (works without 0012, and for people the server didn't rank).
  for (const u of repo.people()) if (!rows.has(u.id)) rows.set(u.id, { mutual: 0, shared: 0 });

  const out: PersonSuggestion[] = [];
  for (const [id, r] of rows) {
    if (skip(id)) continue;
    const u = repo.user(id);
    if (!u) continue;
    const sharedInterests = (u.interests ?? []).filter((i) => myInterests.has(i) && interestById[i]?.category !== 'afterDark').length;
    const active = activeHere.has(id);
    if (!r.mutual && !r.shared && !sharedInterests && !active) continue;
    const parts = [
      r.shared ? plural(r.shared, 'shared World') : '',
      r.mutual ? plural(r.mutual, 'mutual connection') : '',
      !r.shared && !r.mutual && active ? 'Active in your Worlds' : '',
      !r.shared && !r.mutual && !active && sharedInterests ? plural(sharedInterests, 'shared interest') : '',
    ].filter(Boolean);
    const score = 10 * r.mutual + 8 * r.shared + 3 * Math.min(4, sharedInterests) + (active ? 4 : 0);
    out.push({ personId: id, mutual: r.mutual, sharedWorlds: r.shared, sharedInterests, line: parts.join(' · '), score });
  }
  return out.sort((a, b) => b.score - a.score || (a.personId < b.personId ? -1 : 1)).slice(0, limit);
}

// ─── Changed since you were here ────────────────────────────────────────────

export interface ActivityEventRow {
  id: string;
  kind: string;
  actor_id: string | null;
  ref_id: string | null;
  ref_kind?: string | null;
  board_id?: string | null;
  created_at: string;
  seen_at?: string | null;
}

export interface ChangeLine {
  id: string;
  text: string;
  at: number;
  /** Newer than your last visit to Happening. */
  fresh: boolean;
  person?: string;
  image?: ImageSrc;
  round?: boolean;
  ref: EntityRef;
}

const POST_REF = (kind: string | null | undefined, id: string): EntityRef => (kind === 'drift' ? { kind: 'drift', id } : { kind: 'buzz', id });

/**
 * What changed for you and around you (newest first, max `limit`): your own
 * events (likes, replies, follows, connections, posts in Worlds you follow,
 * joins) grouped per post / World, plus Stories added by people you know.
 * Every line is one real thing; groups say how many.
 */
export function changedSince(
  ctx: GraphContext,
  events: ActivityEventRow[],
  lastVisit: number,
  now: number,
  limit = 10,
  opts: { stories?: boolean; fresh?: (group: ActivityEventRow[]) => boolean } = {},
): ChangeLine[] {
  const { s } = ctx;
  const ok = (id?: string | null) => !id || !s.blocked[id];
  const out: ChangeLine[] = [];
  const groups = new Map<string, ActivityEventRow[]>();
  for (const e of events) {
    if (!ok(e.actor_id)) continue;
    if (now - Date.parse(e.created_at) > 7 * DAY) continue;
    const key =
      e.kind === 'content_like' || e.kind === 'content_comment' || e.kind === 'thread_reply'
        ? `${e.kind}:${e.ref_id}`
        : e.kind === 'world_post' || e.kind === 'world_join'
          ? `${e.kind}:${e.board_id}`
          : `${e.kind}:${e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const [key, list] of groups) {
    const e = list.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const actors = [...new Set(list.map((x) => x.actor_id).filter((x): x is string => !!x))];
    const who = actors.length ? firstName(actors[0]) : 'Someone';
    const others = actors.length - 1;
    const many = others > 0 ? `${who} and ${plural(others, 'other')}` : who;
    const at = Date.parse(e.created_at);
    const board = e.board_id ? visibleBoard(ctx, e.board_id) : undefined;
    let text: string | null = null;
    let ref: EntityRef | null = null;
    switch (e.kind) {
      case 'follow':
        text = `${who} followed you`;
        ref = { kind: 'person', id: e.actor_id ?? '' };
        break;
      case 'connection_request':
        text = `${who} wants to connect`;
        ref = { kind: 'person', id: e.actor_id ?? '' };
        break;
      case 'connection_accepted':
        text = `${who} accepted your connection`;
        ref = { kind: 'person', id: e.actor_id ?? '' };
        break;
      case 'content_like':
        if (!e.ref_id) break;
        text = `${many} liked your ${e.ref_kind === 'drift' ? 'photo' : 'Buzz'}`;
        ref = POST_REF(e.ref_kind, e.ref_id);
        break;
      case 'content_comment':
        if (!e.ref_id) break;
        text = list.length > 1 ? `${plural(list.length, 'new reply', 'new replies')} on your ${e.ref_kind === 'drift' ? 'photo' : 'Buzz'}` : `${who} commented on your ${e.ref_kind === 'drift' ? 'photo' : 'Buzz'}`;
        ref = POST_REF(e.ref_kind, e.ref_id);
        break;
      case 'thread_reply':
        if (!e.ref_id) break;
        text = `${many} also replied to a post you replied to`;
        ref = POST_REF(e.ref_kind, e.ref_id);
        break;
      case 'world_post':
        if (!board) break;
        text = list.length > 1 ? `${board.title} got ${plural(list.length, 'new post')}` : `${who} posted in ${board.title}`;
        ref = { kind: 'board', id: board.id };
        break;
      case 'world_join':
        if (!board) break;
        text = actors.length > 1 ? `${plural(actors.length, 'person', 'people')} joined ${board.title}` : `${who} joined ${board.title}`;
        ref = { kind: 'board', id: board.id };
        break;
      default:
        break;
    }
    if (!text || !ref || !ref.id) continue;
    out.push({ id: key, text, at, fresh: opts.fresh ? opts.fresh(list) : at > lastVisit, person: actors[0], image: board?.cover ?? (actors[0] ? repo.user(actors[0])?.avatar : undefined), round: !board, ref });
  }
  // Stories added by people you know (in the last day).
  if (opts.stories === false) return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, limit);
  const known = (id: string) => !!s.following[id] || !!s.connections[id];
  for (const st of ds().stories) {
    if (st.owner.kind !== 'person' || !known(st.owner.id) || !ok(st.owner.id) || isAfterDarkRef({ kind: 'story', id: st.id })) continue;
    const live = liveStory(st, now);
    if (!live) continue;
    const at = Math.max(...live.items.map((i) => storyItemMs(i) || 0));
    if (!at) continue;
    const u = repo.user(st.owner.id);
    out.push({ id: `story:${st.id}`, text: `${u?.displayName.split(' ')[0] ?? 'Someone'} added a Story`, at, fresh: at > lastVisit, person: st.owner.id, image: u?.avatar, round: true, ref: { kind: 'story', id: st.id } });
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, limit);
}
