/**
 * Happening → "Live across your graph" (Phase 6C).
 *
 * Happening is situational awareness, not a feed: instead of showing the
 * media itself (that's Buzz → Drift), it says what is MOVING around you, each
 * line from real data only:
 *
 *   - "Niagara Falls Trip is active · 4 new posts"      your Worlds, last 48 h
 *   - "3 friends joined Niagara Falls Trip"              real joins (REAL), last 7 days
 *   - "Priya joined Boston Founders"                     people you know, any World you can see
 *   - "Maya added a Story"                               friends & connections
 *   - "Food is moving · 5 new posts"                     a World tied to your interests
 *   - "Travel is becoming more relevant to you"          your own graph leaning somewhere
 *
 * Never After Dark, never blocked people, never invented counts.
 */
import { interestById } from '@/data/interests';
import { repo } from '@/services/repository';
import { ds } from '@/services/dataset';
import type { EntityRef, ImageSrc } from '@/types/models';
import { AFFINITY } from './config';
import type { GraphContext } from './relevance';
import { createdMs, isAfterDarkBoard, isAfterDarkRef } from './surfaces';

export type LiveKind = 'world' | 'joins' | 'person' | 'story' | 'nearby' | 'interest';

export interface LiveItem {
  id: string;
  kind: LiveKind;
  title: string;
  body?: string;
  image?: ImageSrc;
  /** Round (person) or rounded-square (World) thumbnail. */
  round?: boolean;
  ref: EntityRef;
  /** Newest underlying event (ms), for ordering. */
  at: number;
  people?: string[];
}

const HOUR = 3_600_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildLiveActivity(ctx: GraphContext, seen: Record<string, true | boolean>, now = Date.now(), limit = 6): LiveItem[] {
  const { s } = ctx;
  const data = ds();
  const mineWorld = (id: string) => !!s.joined[id] || !!s.savedBoards[id] || repo.isMe(repo.board(id)?.ownerId);
  const known = (id: string) => !!s.following[id] || !!s.connections[id];
  const ok = (id?: string) => !id || !s.blocked[id];

  // Posts per World in the last 48 hours (Buzz + World media), newest time too.
  const recent = new Map<string, { n: number; at: number; others: number }>();
  const add = (boardId: string, authorId: string | undefined, at: number) => {
    if (!boardId || now - at > 48 * HOUR || !ok(authorId)) return;
    const r = recent.get(boardId) ?? { n: 0, at: 0, others: 0 };
    r.n += 1;
    r.at = Math.max(r.at, at);
    if (!repo.isMe(authorId)) r.others += 1;
    recent.set(boardId, r);
  };
  for (const b of data.buzz) if (b.kind !== 'news') add(b.boardId, b.authorId, createdMs(b, now));
  for (const d of data.drift) add(d.boardId, d.authorId, createdMs(d, now));

  const out: LiveItem[] = [];

  // Your Worlds that are active.
  for (const [boardId, r] of recent) {
    const b = repo.board(boardId);
    if (!b || isAfterDarkBoard(b) || !mineWorld(boardId)) continue;
    out.push({ id: `world:${boardId}`, kind: 'world', title: `${b.title} is active`, body: `${plural(r.n, 'new post')}${r.others ? '' : ' · all yours so far'}`, image: b.cover, ref: { kind: 'board', id: boardId }, at: r.at });
  }

  // Real joins (REAL only: Demo has no join timestamps). Grouped per World.
  const joins = new Map<string, { people: string[]; at: number }>();
  for (const j of data.memberJoins) {
    if (repo.isMe(j.userId) || !ok(j.userId) || now - j.at > 7 * 24 * HOUR) continue;
    const b = repo.board(j.boardId);
    if (!b || isAfterDarkBoard(b)) continue;
    // Anyone joining your Worlds; people you know joining any World you can see.
    if (!mineWorld(j.boardId) && !known(j.userId)) continue;
    if (!repo.user(j.userId)) continue;
    const g = joins.get(j.boardId) ?? { people: [], at: 0 };
    g.people.push(j.userId);
    g.at = Math.max(g.at, j.at);
    joins.set(j.boardId, g);
  }
  for (const [boardId, g] of joins) {
    const b = repo.board(boardId)!;
    const friends = g.people.filter(known);
    const who =
      g.people.length === 1
        ? repo.user(g.people[0])!.displayName.split(' ')[0]
        : friends.length === g.people.length
          ? plural(g.people.length, 'friend')
          : plural(g.people.length, 'person', 'people');
    out.push({
      id: `joins:${boardId}`,
      kind: g.people.length === 1 && known(g.people[0]) && !mineWorld(boardId) ? 'person' : 'joins',
      title: `${who} joined ${b.title}`,
      body: mineWorld(boardId) ? 'A World you’re in' : 'Someone you know is there',
      image: b.cover,
      ref: { kind: 'board', id: boardId },
      at: g.at,
      people: g.people,
    });
  }

  // Friends' and connections' Stories.
  for (const st of data.stories) {
    if (st.owner.kind !== 'person' || !known(st.owner.id) || !ok(st.owner.id) || isAfterDarkRef({ kind: 'story', id: st.id })) continue;
    const u = repo.user(st.owner.id);
    if (!u || !st.items.length) continue;
    const at = Math.max(...st.items.map((i) => Date.parse(i.createdAt) || 0));
    const unseen = st.items.filter((i) => !seen[i.id]).length;
    out.push({ id: `story:${st.id}`, kind: 'story', title: `${u.displayName.split(' ')[0]} added a Story`, body: unseen ? plural(unseen, 'new moment') : 'Seen', image: u.avatar, round: true, ref: { kind: 'story', id: st.id }, at: at || now - 12 * HOUR, people: [u.id] });
  }

  // A World tied to your interests that's moving (one you're not in yet).
  const top = Object.keys(s.affinity)
    .filter((i) => s.affinity[i] >= AFFINITY.meaningful && interestById[i]?.category !== 'afterDark')
    .sort((a, b) => s.affinity[b] - s.affinity[a])
    .slice(0, 6);
  const nearby = [...recent.entries()]
    .map(([boardId, r]) => ({ b: repo.board(boardId), r }))
    .filter(({ b, r }) => b && !isAfterDarkBoard(b) && !mineWorld(b.id) && r.others > 0 && b.interests.some((i) => top.includes(i)))
    .sort((a, b) => b.r.n - a.r.n)
    .slice(0, 2);
  for (const { b, r } of nearby) {
    const why = interestById[b!.interests.find((i) => top.includes(i))!]?.label;
    out.push({ id: `nearby:${b!.id}`, kind: 'nearby', title: `${b!.title} is moving`, body: `${plural(r.n, 'new post')}${why ? ` · because you’re into ${why}` : ''}`, image: b!.cover, ref: { kind: 'board', id: b!.id }, at: r.at });
  }

  // Your own graph leaning somewhere (above where it started).
  const base = (i: string) => (data.mode === 'real' ? AFFINITY.onboarding : (AFFINITY.seed as Record<string, number>)[i] ?? 0);
  const rising = Object.keys(s.affinity)
    .filter((i) => s.affinity[i] >= AFFINITY.high && s.affinity[i] - base(i) >= 0.08 && interestById[i] && interestById[i].category !== 'afterDark')
    .sort((a, b) => s.affinity[b] - base(b) - (s.affinity[a] - base(a)))
    .slice(0, 1);
  for (const i of rising) {
    const world = repo.boards().find((b) => b.interests[0] === i && !isAfterDarkBoard(b));
    if (!world) continue;
    out.push({ id: `interest:${i}`, kind: 'interest', title: `${interestById[i].label} is becoming more relevant to you`, body: 'From what you’ve been joining, liking and posting', image: world.cover, ref: { kind: 'board', id: world.id }, at: now - 24 * HOUR });
  }

  // People-first, then Worlds, newest first within each; a little of everything.
  const order: Record<LiveKind, number> = { joins: 0, person: 1, world: 2, story: 3, nearby: 4, interest: 5 };
  const sorted = out.sort((a, b) => order[a.kind] - order[b.kind] || b.at - a.at);
  const perKind: Partial<Record<LiveKind, number>> = {};
  return sorted.filter((it) => (perKind[it.kind] = (perKind[it.kind] ?? 0) + 1) <= 2).slice(0, limit);
}
