/**
 * Relevance — deterministic, explainable scoring over the local graph.
 *
 *   relevance = interest affinity + board relationship + open-loop relevance
 *             + people you know + freshness + editorial  (+ id tiebreak)
 *
 * Every score comes with reasons generated from the same parts that
 * produced it, so "why this is for you" is never hand-written and always
 * reflects current state. Weights live in ./config.
 */
import { POLL_NAMES } from '@/data/editions';
import { interestById } from '@/data/interests';
import { LOCATION_BY_ID, locationForCity, locationLineage } from '@/data/locations';
import { OPEN_TO_LABEL } from '@/data/users';
import { ds } from '@/services/dataset';
import { repo } from '@/services/repository';
import type {
  Board,
  EntityRef,
  MatchExplanation,
  MatchReason,
  Move,
  OpenLoop,
  Opener,
  OpenTo,
  Post,
  Reason,
  RelationshipState,
  Scored,
  Story,
  User,
} from '@/types/models';

import { AFFINITY, MATCH, RELEVANCE } from './config';
import { buildGraph, Graph, GraphState, ME_NODE, node } from './graph';
import { freshCount } from './touch';

// ─── Context (memoised per state) ───────────────────────────────────────────

export interface GraphContext {
  s: GraphState;
  g: Graph;
  /** Match explanation for a person (cached). */
  match: (personId: string) => MatchExplanation;
  activeLoops: OpenLoop[];
}

const STATE_KEYS: (keyof GraphState)[] = [
  'affinity', 'joined', 'savedBoards', 'savedPosts', 'likedPosts', 'pollVotes', 'moveState',
  'following', 'connections', 'blocked', 'openLoops', 'changes', 'activity', 'chats', 'comments', 'openTo',
  'buzzLikes', 'buzzDislikes', 'buzzSaves', 'buzzReposts', 'driftLikes', 'driftSaves', 'crushes',
  'buzzVotes', 'driftViews', 'boardVisits', 'exploredNodes', 'happeningFocus',
];

let lastState: GraphState | null = null;
let lastCtx: GraphContext | null = null;
let lastVersion = -1;

/**
 * One context per distinct store state. Components pass their own selector
 * objects, so we compare field references (the store's), not the wrapper.
 */
export function getContext(s: GraphState): GraphContext {
  // Also keyed on the active dataset (DEMO ↔ REAL, new content).
  if (lastState && lastCtx && lastVersion === ds().version && STATE_KEYS.every((k) => lastState![k] === s[k])) return lastCtx;
  const g = buildGraph(s);
  const cache = new Map<string, MatchExplanation>();
  const ctx: GraphContext = {
    s,
    g,
    activeLoops: s.openLoops.filter(isActiveLoop),
    match: (id) => {
      let m = cache.get(id);
      if (!m) {
        m = explainPerson(ctx, id);
        cache.set(id, m);
      }
      return m;
    },
  };
  lastState = s;
  lastCtx = ctx;
  lastVersion = ds().version;
  return ctx;
}

export const isActiveLoop = (l: OpenLoop) => l.status === 'active' || l.status === 'progress';

// ─── Small helpers ──────────────────────────────────────────────────────────

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const first = (id: string) => repo.user(id)?.displayName.split(' ')[0] ?? 'Someone';
const label = (i: string) => interestById[i]?.label ?? i;
const W = RELEVANCE.weights;

/** Deterministic, random-free tiebreak in [0, RELEVANCE.tiebreak). */
export function tiebreak(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000 * RELEVANCE.tiebreak;
}

export function postTitle(p: Post | undefined): string {
  if (!p) return 'a post';
  return p.title ?? p.route?.title ?? p.place?.name ?? p.poll?.question ?? 'a post';
}

export function listNames(ids: string[]): string {
  const names = ids.map(first);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function sortReasons(list: Reason[], limit = 5): Reason[] {
  const seen = new Set<string>();
  return list
    .filter((r) => r.strength > 0.05)
    .sort((a, b) => b.strength - a.strength)
    .filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)))
    .slice(0, limit);
}

// ─── Interest affinity part ─────────────────────────────────────────────────

/** Weighted mean of WollyMc's affinity over an object's interests (0..1). */
export function interestPart(s: GraphState, interests: string[]): number {
  if (!interests.length) return 0;
  let sum = 0;
  let wsum = 0;
  interests.forEach((i, idx) => {
    const w = idx < AFFINITY.primaryInterests ? 1 : AFFINITY.secondaryFactor;
    sum += w * (s.affinity[i] ?? 0);
    wsum += w;
  });
  return clamp01(sum / wsum);
}

export function interestReason(s: GraphState, interests: string[], part: number): Reason[] {
  const top = interests
    .map((i) => ({ i, a: s.affinity[i] ?? 0 }))
    .filter((x) => x.a >= AFFINITY.meaningful)
    .sort((a, b) => b.a - a.a);
  if (!top.length) return [];
  const high = top.filter((x) => x.a >= AFFINITY.high).slice(0, 2);
  const strength = W.interest * part;
  if (high.length) {
    const names = high.map((x) => label(x.i)).join(' + ');
    return [{ kind: 'interest', text: `You’ve been into ${names} lately`, short: `For your ${label(high[0].i)}`, strength, ref: { kind: 'interest', id: high[0].i } }];
  }
  return [{ kind: 'interest', text: `Matches your interest in ${label(top[0].i)}`, short: `For your ${label(top[0].i)}`, strength: strength * 0.8, ref: { kind: 'interest', id: top[0].i } }];
}

// ─── Relationship to a Board (joined, saved, touched posts, views) ──────────

interface Evidence {
  value: number;
  kind: Reason['kind'];
  /** "You joined Japan Trip" */
  text: string;
  /** "you joined Japan Trip" (for "…, where you …" clauses) */
  clause: string;
  short: string;
  ref?: EntityRef;
  /** Done in-app (has an activity timestamp) rather than seeded history. */
  recent?: boolean;
}

const R = RELEVANCE.relationship;
/** Reasons favour what you did recently over old history (display only, not score). */
const RECENT_BOOST = 1.3;
const OLD_DAMP = 0.7;

/** Everything WollyMc has done with a Board, strongest first. */
export function boardEvidence(ctx: GraphContext, boardId: string): Evidence[] {
  const { g } = ctx;
  const b = repo.board(boardId);
  if (!b) return [];
  const bn = node('board', boardId);
  const out: Evidence[] = [];
  if (b.ownerId === ds().me.id) out.push({ value: R.owned, kind: 'board', text: `Your Board ${b.title}`, clause: `you run ${b.title}`, short: 'Your Board', ref: { kind: 'board', id: b.id } });
  if (g.has(ME_NODE, 'JOINED', bn)) out.push({ value: R.joined, kind: 'board', text: `You joined ${b.title}`, clause: `you joined ${b.title}`, short: `From ${b.title}`, ref: { kind: 'board', id: b.id } });
  if (g.has(ME_NODE, 'SAVED', bn)) out.push({ value: R.saved, kind: 'saved', text: `You saved ${b.title}`, clause: `you saved ${b.title}`, short: `Saved ${b.title}`, ref: { kind: 'board', id: b.id } });

  // Posts inside the Board that you saved, voted on, liked or commented on.
  for (const pid of g.sources(bn, 'RELATED_TO', 'post')) {
    const pn = node('post', pid);
    const p = repo.post(pid);
    const t = postTitle(p);
    if (g.has(ME_NODE, 'SAVED', pn)) out.push({ value: R.touched, kind: 'saved', text: `You saved ${t}`, clause: `you saved ${t}`, short: `You saved ${t}`, ref: { kind: 'post', id: pid } });
    else if (g.has(ME_NODE, 'VOTED', pn)) out.push({ value: R.touched * 0.9, kind: 'saved', text: `You voted in the ${b.title} poll`, clause: `you voted in the ${b.title} poll`, short: 'You voted here', ref: { kind: 'post', id: pid } });
    else if (g.has(ME_NODE, 'RELATED_TO', pn)) out.push({ value: R.touched * 0.85, kind: 'saved', text: `You commented on ${t}`, clause: `you commented on ${t}`, short: 'You commented', ref: { kind: 'post', id: pid } });
    else if (g.has(ME_NODE, 'LIKED', pn)) out.push({ value: R.touched * 0.8, kind: 'saved', text: `You liked ${t}`, clause: `you liked ${t}`, short: `You liked ${t}`, ref: { kind: 'post', id: pid } });
  }
  // Buzz and Drift in this World that you liked, saved or reposted.
  const surface: [('buzz' | 'drift'), string][] = [
    ...g.sources(bn, 'RELATED_TO', 'buzz').map((id) => ['buzz', id] as ['buzz', string]),
    ...g.sources(bn, 'RELATED_TO', 'drift').map((id) => ['drift', id] as ['drift', string]),
  ];
  for (const [kind, id] of surface) {
    const n = node(kind, id);
    const where = kind === 'buzz' ? 'Buzz' : 'Drift';
    if (g.has(ME_NODE, 'SAVED', n) || g.has(ME_NODE, 'REPOSTED', n)) {
      out.push({ value: R.touched * 0.9, kind: 'saved', text: `You saved a ${b.title} ${where} post`, clause: `you saved a ${b.title} post`, short: `Saved in ${where}`, ref: { kind, id } });
    } else if (g.has(ME_NODE, 'LIKED', n)) {
      out.push({ value: R.touched * 0.75, kind: 'saved', text: `You liked a ${b.title} ${where === 'Drift' ? 'Drift' : 'post'}`, clause: `you liked a ${b.title} post`, short: `Liked in ${where}`, ref: { kind, id } });
    } else if (kind === 'drift' && ctx.s.driftViews?.[id]) {
      // Phase 5: watching counts, a little less than a like.
      out.push({ value: R.touched * 0.6, kind: 'saved', text: `You watched ${b.title} in Drift`, clause: `you watched ${b.title} in Drift`, short: 'Watched in Drift', ref: { kind, id } });
    }
  }
  for (const e of out) {
    const target = e.ref ? node(e.ref.kind === 'post' || e.ref.kind === 'buzz' || e.ref.kind === 'drift' ? e.ref.kind : 'board', e.ref.id) : bn;
    e.recent = g.from(ME_NODE).some((x) => x.toId === target && x.createdAt > 0 && x.type !== 'VIEWED');
  }
  const view = g.edge(ME_NODE, 'VIEWED', bn);
  if (view && !out.length) out.push({ value: R.viewed * view.weight * 2, kind: 'board', text: `You’ve been looking at ${b.title}`, clause: `you’ve been looking at ${b.title}`, short: `Viewed ${b.title}`, ref: { kind: 'board', id: b.id } });
  return out.sort((a, c) => c.value - a.value);
}

export function evidenceToReasons(ev: Evidence[], factor: number, limit: number, rewrite?: (e: Evidence) => Pick<Reason, 'text' | 'short'>): Reason[] {
  return ev.slice(0, limit).map((e, i) => ({
    kind: e.kind,
    text: rewrite ? rewrite(e).text : e.text,
    short: rewrite ? rewrite(e).short : e.short,
    ref: e.ref,
    strength: W.relationship * e.value * factor * (i === 0 ? 1 : 0.9) * (e.recent ? RECENT_BOOST : OLD_DAMP),
  }));
}

/** Engagement flowing in from RELATED_TO Boards (the Board graph). */
export function relatedEvidence(ctx: GraphContext, boardId: string): { board: Board; ev: Evidence[] }[] {
  const b = repo.board(boardId);
  if (!b) return [];
  return b.relatedBoardIds
    .flatMap((id) => {
      const board = repo.board(id);
      return board ? [{ board, ev: boardEvidence(ctx, id) }] : [];
    })
    .filter((x) => x.ev.length)
    .sort((a, c) => c.ev[0].value - a.ev[0].value);
}

// ─── Open Loop part ─────────────────────────────────────────────────────────

const LP = RELEVANCE.loop;

export function loopMatches(ctx: GraphContext, ref: EntityRef, interests: string[], boardId?: string): { loop: OpenLoop; value: number }[] {
  const primary = interests.slice(0, AFFINITY.primaryInterests);
  const out: { loop: OpenLoop; value: number }[] = [];
  for (const l of ctx.activeLoops) {
    let v = 0;
    if (l.related.some((r) => r.kind === ref.kind && r.id === ref.id)) v = LP.direct;
    else if (boardId && l.related.some((r) => r.kind === 'board' && r.id === boardId)) v = LP.viaBoard;
    else if (l.interests[0] && primary.includes(l.interests[0])) v = LP.primaryInterest;
    else if (l.interests.some((i) => interests.includes(i))) v = LP.anyInterest;
    if (v > 0) out.push({ loop: l, value: v });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function loopPart(matches: { value: number }[]): number {
  if (!matches.length) return 0;
  return clamp01(matches[0].value + LP.extraLoop * (matches.length - 1));
}

export function loopReasons(matches: { loop: OpenLoop; value: number }[]): Reason[] {
  // A loop that only shares a side interest nudges the score but isn't a reason.
  return matches.filter((m) => m.value >= LP.primaryInterest).slice(0, 2).map((m, i) => {
    const strong = m.value >= LP.viaBoard;
    return {
      kind: 'loop',
      text: strong ? `Could help your Open Loop “${m.loop.title}”` : `Fits your Open Loop “${m.loop.title}”`,
      // Cards name the loop so a row of Moves doesn't all read the same.
      short: strong ? (m.loop.short ? m.loop.short.charAt(0).toUpperCase() + m.loop.short.slice(1) : 'Your Open Loop') : 'Near an Open Loop',
      strength: W.loop * m.value * (i === 0 ? 1 : 0.8),
      ref: { kind: 'loop', id: m.loop.id },
    };
  });
}

// ─── Social part (people you know, strong matches) ──────────────────────────

const SO = RELEVANCE.social;

export function socialPart(ctx: GraphContext, people: string[]): { part: number; known: string[]; matches: string[] } {
  const { s } = ctx;
  const known: string[] = [];
  const matches: string[] = [];
  let sum = 0;
  for (const id of new Set(people)) {
    if (id === ds().me.id || s.blocked[id]) continue;
    if (s.connections[id]) {
      sum += SO.connection;
      known.push(id);
    } else if (s.following[id]) {
      sum += SO.following;
      known.push(id);
    } else if (ctx.match(id).matchScore >= MATCH.strongAt) {
      sum += SO.strongMatch;
      matches.push(id);
    }
  }
  // Connections before follows in every sentence.
  known.sort((a, b) => Number(!!s.connections[b]) - Number(!!s.connections[a]));
  matches.sort((a, b) => ctx.match(b).matchScore - ctx.match(a).matchScore);
  return { part: clamp01(sum / SO.full), known, matches };
}

// ─── Scores ─────────────────────────────────────────────────────────────────

function finish<T>(item: T, id: string, parts: Record<string, number>, reasons: Reason[], fallback: Reason): Scored<T> {
  const score =
    W.interest * parts.interest +
    W.relationship * parts.relationship +
    W.loop * parts.loop +
    W.social * parts.social +
    W.freshness * parts.freshness +
    W.editorial * parts.editorial +
    tiebreak(id);
  const r = sortReasons(reasons);
  return { item, score: Math.round(score * 100) / 100, parts, reasons: r.length ? r : [fallback] };
}

export function scoreBoard(ctx: GraphContext, b: Board): Scored<Board> {
  // Phase 6B hardening: a World that vanished (account switch, deletion) scores
  // nothing instead of taking the whole screen down. Callers skip score ≤ 0 items.
  if (!b?.id) {
    if (__DEV__) console.warn('[chimp:graph] scoreBoard called without a World; skipped');
    return { item: b, score: 0, reasons: [], parts: {} };
  }
  const { s, g } = ctx;
  const ref: EntityRef = { kind: 'board', id: b.id };
  const own = boardEvidence(ctx, b.id);
  const related = relatedEvidence(ctx, b.id);
  const relatedValue = related.length ? related[0].ev[0].value * R.relatedFactor : 0;
  const relationship = Math.max(own[0]?.value ?? 0, relatedValue);

  const lm = loopMatches(ctx, ref, b.interests);
  const members = g.sources(node('board', b.id), 'MEMBER_OF', 'person');
  const social = socialPart(ctx, members);
  const fresh = freshCount(s.changes, ref);

  const parts = {
    interest: interestPart(s, b.interests),
    relationship,
    loop: loopPart(lm),
    social: social.part,
    freshness: clamp01(fresh * RELEVANCE.freshPerChange),
    editorial: b.editorial / 100,
  };

  const reasons: Reason[] = [
    ...evidenceToReasons(own, 1, 1, (e) => ({ text: e.text, short: e.ref?.kind === 'board' && e.ref.id === b.id ? (e.kind === 'saved' ? 'You saved this' : 'You’re a member') : e.short })),
    ...related.slice(0, 1).flatMap(({ board: rb, ev }) =>
      evidenceToReasons(ev, R.relatedFactor, 1, (e) => ({
        text: e.kind === 'board' && e.clause.startsWith('you joined') ? `Related to ${rb.title}, which you joined` : `Related to ${rb.title}, where ${e.clause}`,
        short: `Near ${rb.title}`,
      })),
    ),
    ...loopReasons(lm),
    ...interestReason(s, b.interests, parts.interest),
  ];
  if (social.known.length) {
    const n = social.known.length;
    reasons.push({
      kind: 'people',
      text: `${listNames(social.known)} ${n > 1 ? 'are' : 'is'} here`,
      short: n > 1 ? `${n} people you know` : `${first(social.known[0])} is here`,
      strength: W.social * social.part,
      ref: { kind: 'person', id: social.known[0] },
    });
  } else if (social.matches.length) {
    reasons.push({ kind: 'match', text: `${first(social.matches[0])}, a strong match, is a member`, short: `${first(social.matches[0])} is here`, strength: W.social * social.part, ref: { kind: 'person', id: social.matches[0] } });
  }
  if (fresh) reasons.push({ kind: 'fresh', text: `${fresh} new since your last visit`, short: 'New for you', strength: W.freshness * parts.freshness });

  return finish(b, b.id, parts, reasons, { kind: 'editorial', text: 'Popular on Chimp right now', short: 'Popular', strength: 0 });
}

const SECTION_EDITORIAL: Record<Move['section'], number> = { featured: 0.9, week: 0.8, more: 0.7 };

/** Relationship evidence for a Move: your own state, its Board, and that Board's neighbours. */
function moveEvidence(ctx: GraphContext, m: Move): Reason[] & { value?: number } {
  const st = ctx.s.moveState[m.id] ?? {};
  const own: Evidence[] = [];
  if (st.rsvp) own.push({ value: R.rsvp, kind: 'plan', text: 'You’re going', clause: 'you’re going', short: 'You’re going' });
  else if (st.interested) own.push({ value: R.interested, kind: 'plan', text: 'You marked it Interested', clause: 'you’re interested', short: 'You’re interested' });
  if (st.saved) own.push({ value: R.saved, kind: 'saved', text: 'You saved this Move', clause: 'you saved it', short: 'Saved' });
  const boardEv = m.boardId ? boardEvidence(ctx, m.boardId) : [];
  const related = m.boardId ? relatedEvidence(ctx, m.boardId) : [];
  const value = Math.max(
    own[0]?.value ?? 0,
    (boardEv[0]?.value ?? 0) * R.moveBoardFactor,
    (related[0]?.ev[0]?.value ?? 0) * R.relatedFactor,
  );
  // Your own Interested/Going state counts in the score but isn't shown as a
  // reason: the buttons already say it, and reasons should explain the graph.
  void own;
  const reasons = [
    ...evidenceToReasons(boardEv, R.moveBoardFactor, 2),
    // Graph hop: Tokyo Food Tour → Tokyo ↔ Japan Trip ← you joined / saved.
    ...related.slice(0, 2).flatMap(({ board: rb, ev }) =>
      evidenceToReasons(ev, R.relatedFactor, 2, (e) => ({ text: e.text, short: e.kind === 'board' ? `Via ${rb.title}` : e.short })),
    ),
  ] as Reason[] & { value?: number };
  reasons.value = value;
  return reasons;
}

export function scoreMove(ctx: GraphContext, m: Move): Scored<Move> {
  const { s, g } = ctx;
  const ref: EntityRef = { kind: 'move', id: m.id };
  const rel = moveEvidence(ctx, m);
  const lm = loopMatches(ctx, ref, m.interests, m.boardId);
  const attendees = g.sources(node('move', m.id), 'INTERESTED_IN', 'person');
  const social = socialPart(ctx, attendees);
  const fresh = freshCount(s.changes, ref);

  const parts = {
    interest: interestPart(s, m.interests),
    relationship: rel.value ?? 0,
    loop: loopPart(lm),
    social: social.part,
    freshness: clamp01(fresh * RELEVANCE.freshPerChange),
    editorial: SECTION_EDITORIAL[m.section],
  };

  const reasons: Reason[] = [...rel, ...loopReasons(lm), ...interestReason(s, m.interests, parts.interest)];
  if (social.known.length) {
    const n = social.known.length;
    reasons.push({
      kind: 'people',
      text: `${listNames(social.known)} ${n > 1 ? 'are' : 'is'} going`,
      short: n > 1 ? `${n} you know going` : `${first(social.known[0])} is going`,
      strength: W.social * Math.max(social.part, 0.5),
      ref: { kind: 'person', id: social.known[0] },
    });
  }
  for (const id of social.matches.slice(0, social.known.length ? 1 : 2)) {
    reasons.push({ kind: 'match', text: `${first(id)} is interested`, short: `${first(id)} is interested`, strength: W.social * SO.strongMatch, ref: { kind: 'person', id } });
  }
  if (fresh) reasons.push({ kind: 'fresh', text: 'New since your last visit', short: 'New for you', strength: W.freshness * parts.freshness });

  return finish(m, m.id, parts, reasons, { kind: 'editorial', text: 'New in your graph', short: 'New for you', strength: 0 });
}

export function scoreStory(ctx: GraphContext, st: Story): Scored<Story> {
  const { s, g } = ctx;
  const ref: EntityRef = { kind: 'story', id: st.id };
  const owner = st.owner;
  let interests: string[] = [];
  let relationship = 0;
  let relReasons: Reason[] = [];
  let boardId: string | undefined;
  let editorial = 0.75;

  if (owner.kind === 'board') {
    const b = repo.board(owner.id);
    interests = b?.interests ?? [];
    boardId = owner.id;
    editorial = (b?.editorial ?? 75) / 100;
    const own = boardEvidence(ctx, owner.id);
    const related = relatedEvidence(ctx, owner.id);
    relationship = Math.max(own[0]?.value ?? 0, (related[0]?.ev[0]?.value ?? 0) * R.relatedFactor);
    relReasons = [...evidenceToReasons(own, 1, 1), ...related.slice(0, 1).flatMap(({ ev }) => evidenceToReasons(ev, R.relatedFactor, 1))];
  } else if (owner.kind === 'move') {
    const m = repo.move(owner.id);
    if (m) {
      interests = m.interests;
      boardId = m.boardId;
      const ev = moveEvidence(ctx, m);
      relationship = ev.value ?? 0;
      relReasons = [...ev];
    }
  } else if (owner.kind === 'person') {
    const u = repo.user(owner.id);
    interests = u?.interests ?? [];
    boardId = st.items[0]?.boardId;
    if (boardId) {
      const ev = boardEvidence(ctx, boardId);
      relationship = (ev[0]?.value ?? 0) * R.relatedFactor;
      relReasons = evidenceToReasons(ev, R.relatedFactor, 1);
    }
  }

  const people = [...g.targets(node('story', st.id), 'CREATED_BY', 'person'), ...(owner.kind === 'person' ? [owner.id] : [])];
  const social = socialPart(ctx, people);
  const lm = loopMatches(ctx, owner, interests, boardId);
  const unseen = ctx.s.activity.some((a) => a.type === 'storyView' && a.ref.id === st.id) ? 0 : 1;
  const fresh = freshCount(s.changes, ref) + freshCount(s.changes, owner);

  const parts = {
    interest: interestPart(s, interests),
    relationship,
    loop: loopPart(lm),
    social: social.part,
    freshness: clamp01(fresh * RELEVANCE.freshPerChange + unseen * 0.2),
    editorial,
  };
  const reasons: Reason[] = [...relReasons, ...loopReasons(lm), ...interestReason(s, interests, parts.interest)];
  if (social.known.length) {
    reasons.push({ kind: 'people', text: `From ${listNames(social.known)}`, short: `From ${first(social.known[0])}`, strength: W.social * social.part, ref: { kind: 'person', id: social.known[0] } });
  }
  return finish(st, st.id, parts, reasons, { kind: 'editorial', text: 'Moving across Chimp', short: 'Trending', strength: 0 });
}

// ─── People ─────────────────────────────────────────────────────────────────

const OPEN_TO_SHORT: Record<OpenTo, string> = {
  friends: 'friends',
  dating: 'dating',
  casual: 'something casual',
  networking: 'networking',
  collaboration: 'collaboration',
  not_looking: 'nothing new',
  travel: 'travel',
  events: 'events',
};

export function relationshipWith(ctx: GraphContext, personId: string, score?: number): RelationshipState {
  const { s, g } = ctx;
  if (s.blocked[personId]) return 'blocked';
  if (s.connections[personId]) return 'connection';
  const followsMe = g.has(node('person', personId), 'FOLLOWS', ME_NODE);
  if (s.following[personId] && followsMe) return 'mutual-follow';
  if (s.following[personId]) return 'following';
  if (followsMe) return 'follower';
  if ((score ?? 0) >= MATCH.strongAt) return 'match';
  return 'none';
}

export const RELATIONSHIP_LABEL: Record<RelationshipState, string> = {
  none: '',
  following: 'Following',
  follower: 'Follows you',
  'mutual-follow': 'You follow each other',
  connection: 'Connected',
  match: 'Suggested match',
  blocked: 'Blocked',
};

/** Boards the person belongs to (owner or member). */
function boardsOf(ctx: GraphContext, personId: string): string[] {
  const owned = ctx.g.sources(node('person', personId), 'CREATED_BY', 'board');
  return [...new Set([...ctx.g.targets(node('person', personId), 'MEMBER_OF', 'board'), ...owned])];
}

/** Is WollyMc "headed" to a location (affinity for its interest, or a loop on it)? */
function planningPlace(ctx: GraphContext, locId: string | undefined): boolean {
  for (const id of locationLineage(locId)) {
    const i = LOCATION_BY_ID[id]?.interestId;
    if (!i) continue;
    if ((ctx.s.affinity[i] ?? 0) >= AFFINITY.high) return true;
    if (ctx.activeLoops.some((l) => l.interests[0] === i)) return true;
  }
  return false;
}

/**
 * Why WollyMc and a person might meet, with a live 0..100 score. Every
 * component is recomputed from the graph, so following, joining or opening
 * a loop visibly moves it.
 */
export function explainPerson(ctx: GraphContext, personId: string): MatchExplanation {
  const { s, g } = ctx;
  const person = repo.user(personId);
  const empty: MatchExplanation = {
    personId, matchScore: 0, matchReasons: [], mutualConnections: [], sharedBoards: [], sharedInterests: [], sharedMoves: [],
    sharedOpenTo: [], relevantOpenLoops: [], possibleMoves: [], relationship: 'none', parts: {}, crush: false, spark: false, starters: [], openers: [],
  };
  if (!person || personId === ds().me.id) return empty;
  const pn = node('person', personId);

  // Interests, weighted by how much WollyMc cares about each right now.
  const sharedInterests = person.interests
    .filter((i) => (s.affinity[i] ?? 0) >= 0.15 || ds().me.interests.includes(i))
    .sort((a, b) => (s.affinity[b] ?? 0) - (s.affinity[a] ?? 0));
  const interests = clamp01(person.interests.reduce((sum, i) => sum + (s.affinity[i] ?? 0), 0) / Math.max(3, person.interests.length));

  // Boards you both belong to (joined or owned).
  const theirs = boardsOf(ctx, personId);
  const sharedBoards = theirs
    // Only Worlds that exist in the active dataset (an id can outlive its World between ranking and rendering).
    .filter((b) => !!repo.board(b) && (s.joined[b] || repo.board(b)?.ownerId === ds().me.id))
    .sort((a, b) => interestPart(s, repo.board(b)?.interests ?? []) - interestPart(s, repo.board(a)?.interests ?? []));

  // Moves: they're going and you've engaged → shared; otherwise possible.
  const theirMoves = g.targets(pn, 'INTERESTED_IN', 'move');
  const engaged = (id: string) => !!(s.moveState[id]?.interested || s.moveState[id]?.rsvp || s.moveState[id]?.saved);
  const liveMoves = theirMoves.filter((m) => !!repo.move(m));
  const sharedMoves = liveMoves.filter(engaged);
  const possibleMoves = liveMoves.filter((m) => !engaged(m));

  // Open loops they could help with: linked directly, or on their core interest.
  const direct = ctx.activeLoops.filter((l) => l.related.some((r) => r.kind === 'person' && r.id === personId));
  const byInterest = ctx.activeLoops.filter(
    (l) => !direct.includes(l) && l.interests[0] && person.interests.slice(0, AFFINITY.primaryInterests).includes(l.interests[0]),
  );
  const relevantOpenLoops = [...direct, ...byInterest].map((l) => l.id);
  const loops = clamp01(direct.length * 0.6 + byInterest.length * 0.1);

  // Mutual connections, plus people you follow who are connected to them.
  const theirConnections = g.targets(pn, 'CONNECTED_TO', 'person');
  const mutualConnections = theirConnections.filter((id) => s.connections[id]);
  const followOverlap = theirConnections.filter((id) => !s.connections[id] && s.following[id]);
  const mutuals = clamp01((mutualConnections.length + followOverlap.length * MATCH.followOverlap) / MATCH.mutualsFull);

  const sharedOpenTo = (person.openTo ?? []).filter((o) => s.openTo.includes(o));
  const openTo = clamp01(sharedOpenTo.length / MATCH.openToFull);

  const myLoc = locationForCity(ds().me.city);
  const theirLoc = locationForCity(person.city);
  const sameCity = !!myLoc && myLoc === theirLoc;
  const headed = !sameCity && planningPlace(ctx, theirLoc);
  const place = sameCity ? 1 : headed ? 0.6 : 0;

  const parts = {
    interests,
    boards: clamp01(sharedBoards.length / MATCH.boardsFull),
    moves: clamp01(sharedMoves.length / MATCH.movesFull),
    loops,
    mutuals,
    openTo,
    place,
  };
  const Wm = MATCH.weights;
  const sum =
    Wm.interests * parts.interests + Wm.boards * parts.boards + Wm.moves * parts.moves + Wm.loops * parts.loops +
    Wm.mutuals * parts.mutuals + Wm.openTo * parts.openTo + Wm.place * parts.place;
  const matchScore = Math.min(99, Math.round(MATCH.base + MATCH.span * sum));

  // Reasons, strongest contribution first.
  const reasons: (MatchReason & { strength: number })[] = [];
  const topShared = sharedInterests.filter((i) => (s.affinity[i] ?? 0) >= AFFINITY.meaningful).slice(0, 2);
  if (topShared.length) {
    const names = topShared.map(label);
    const exploring = (s.affinity[topShared[0]] ?? 0) >= AFFINITY.high;
    reasons.push({
      kind: 'sharedInterests',
      label: exploring ? `Both exploring ${names.join(' + ')}` : `You share ${names.join(' + ')}`,
      clause: exploring ? `you’re both exploring ${names.join(' and ')}` : `you’re both into ${names.join(' and ')}`,
      strength: Wm.interests * parts.interests,
    });
  }
  if (sharedBoards.length) {
    const b = repo.board(sharedBoards[0])!;
    reasons.push({
      kind: 'sharedBoard',
      label: sharedBoards.length === 1 ? `You’re both in ${b.title}` : `${sharedBoards.length} shared Boards, including ${b.title}`,
      clause: sharedBoards.length === 1 ? `you’re both in ${b.title}` : `you share ${sharedBoards.length} Boards`,
      ref: { kind: 'board', id: b.id },
      strength: Wm.boards * parts.boards + 0.01,
    });
  }
  if (sharedMoves.length) {
    const m = repo.move(sharedMoves[0])!;
    reasons.push({ kind: 'sameMove', label: `Both interested in ${m.title}`, clause: `you’re both into ${m.title}`, ref: { kind: 'move', id: m.id }, strength: Wm.moves * parts.moves + 0.01 });
  }
  if (relevantOpenLoops.length) {
    const l = [...direct, ...byInterest][0];
    reasons.push({
      kind: 'sharedGoal',
      label: `Relevant to your Open Loop “${l.title}”`,
      clause: `${first(personId)} fits your ${l.short ?? 'Open Loop'}`,
      ref: { kind: 'loop', id: l.id },
      strength: Wm.loops * parts.loops,
    });
  }
  if (mutualConnections.length || followOverlap.length) {
    const lbl = mutualConnections.length
      ? `${mutualConnections.length} mutual connection${mutualConnections.length > 1 ? 's' : ''}`
      : `Connected to ${first(followOverlap[0])}, who you follow`;
    reasons.push({ kind: 'mutual', label: lbl, clause: mutualConnections.length ? `you have ${lbl}` : `${first(followOverlap[0])} knows ${first(personId)}`, strength: Wm.mutuals * parts.mutuals });
  }
  if (sharedOpenTo.length) {
    reasons.push({ kind: 'openTo', label: `Both open to ${sharedOpenTo.map((o) => OPEN_TO_SHORT[o]).slice(0, 2).join(' + ')}`, clause: `you’re both open to ${OPEN_TO_LABEL[sharedOpenTo[0]].toLowerCase()}`, strength: Wm.openTo * parts.openTo });
  }
  if (place > 0) {
    const city = person.city.split(',')[0];
    reasons.push({
      kind: 'samePlace',
      label: sameCity ? `Also in ${city}` : `Lives in ${city}, where you’re headed`,
      clause: sameCity ? `you’re both in ${city}` : `${first(personId)} lives in ${city}`,
      strength: Wm.place * parts.place,
    });
  }
  reasons.sort((a, b) => b.strength - a.strength);

  const metThrough: EntityRef | undefined = sharedBoards[0]
    ? { kind: 'board', id: sharedBoards[0] }
    : sharedMoves[0]
      ? { kind: 'move', id: sharedMoves[0] }
      : theirs.find((b) => repo.board(b)?.relatedBoardIds.some((r) => s.joined[r]))
        ? { kind: 'board', id: theirs.find((b) => repo.board(b)?.relatedBoardIds.some((r) => s.joined[r]))! }
        : undefined;

  const crush = !!s.crushes[personId];
  // Spark = both sides chose each other AND both are still eligible (open to
  // dating/casual, nobody blocked). Order is never recorded or exposed.
  // DEMO: seeded Crushes on you. REAL: my_sparks() from the backend (mutual only).
  const spark = crush && crushEligible(ctx, personId) && ds().sparkCandidates.includes(personId);
  const openers = conversationOpeners(ctx, personId, sharedBoards, sharedMoves, possibleMoves, sharedInterests);

  return {
    personId,
    crush,
    spark,
    starters: openers.map((o) => o.draft),
    openers,
    matchScore,
    matchReasons: reasons.map(({ strength, ...r }) => (void strength, r)),
    mutualConnections,
    sharedBoards,
    sharedInterests,
    sharedMoves,
    sharedOpenTo,
    relevantOpenLoops,
    possibleMoves,
    relationship: relationshipWith(ctx, personId, matchScore),
    metThrough,
    parts,
  };
}

export interface CrushEligibility {
  eligible: boolean;
  /** Why not (Graph Debug and diagnostics only; never shown to the other person). */
  reason?: 'self' | 'unknown' | 'blocked' | 'you_not_open' | 'they_not_open';
  mine: OpenTo[];
  theirs: OpenTo[];
}

const romantic = (o: OpenTo[] | undefined) => (o ?? []).some((x) => x === 'dating' || x === 'casual');

/** The Crush rule, with the reason when it fails. The rule never changes; only its explanation. */
export function crushEligibility(ctx: GraphContext, personId: string): CrushEligibility {
  const them = repo.user(personId);
  const mine = ctx.s.openTo ?? [];
  const theirs = them?.openTo ?? [];
  if (personId === ds().me.id) return { eligible: false, reason: 'self', mine, theirs };
  if (!them) return { eligible: false, reason: 'unknown', mine, theirs };
  if (ctx.s.blocked[personId]) return { eligible: false, reason: 'blocked', mine, theirs };
  if (!romantic(mine)) return { eligible: false, reason: 'you_not_open', mine, theirs };
  if (!romantic(theirs)) return { eligible: false, reason: 'they_not_open', mine, theirs };
  return { eligible: true, mine, theirs };
}

/** Crush is only offered when you're both open to dating or casual and nobody is blocked. */
export function crushEligible(ctx: GraphContext, personId: string): boolean {
  return crushEligibility(ctx, personId).eligible;
}

/**
 * Openers built from shared context: a poll you both answered, a Move you
 * both want, a World you're both in, something they posted. Each carries
 * the context it comes from. Plain questions, never pickup lines.
 */
export function conversationOpeners(
  ctx: GraphContext,
  personId: string,
  sharedBoards: string[],
  sharedMoves: string[],
  possibleMoves: string[],
  sharedInterests: string[],
): Opener[] {
  const { s } = ctx;
  const out: Opener[] = [];
  const name = first(personId);
  const poss = (authorId: string | undefined) => (authorId === personId ? `${name}’s` : authorId ? `${first(authorId)}’s` : 'the');

  // Polls you both answered (Buzz polls and Board polls).
  const mine: [string, string, 'buzz' | 'post'][] = [
    ...Object.entries(s.buzzVotes ?? {}).map(([id, o]) => [id, o, 'buzz'] as [string, string, 'buzz']),
    ...Object.entries(s.pollVotes).map(([id, o]) => [id, o, 'post'] as [string, string, 'post']),
  ];
  for (const [id, myOpt, kind] of mine) {
    const theirOpt = ds().otherVotes[id]?.[personId];
    if (!theirOpt) continue;
    const item = kind === 'buzz' ? repo.buzzItem(id) : repo.post(id);
    const poll = item?.poll;
    if (!item || !poll || isNightBoard(item.boardId)) continue;
    const label = (o: string) => poll.options.find((x) => x.id === o)?.label ?? o;
    const pollName = POLL_NAMES[id] ?? 'poll';
    if (theirOpt === myOpt) {
      out.push({ context: `You both picked ${label(myOpt)} in ${poss(item.authorId)} ${pollName}`, draft: `${label(myOpt)} too? What made you pick it?` });
    } else {
      out.push({
        context: `You disagreed on ${poss(item.authorId)} ${pollName}`,
        draft: item.authorId === personId ? `I went ${label(myOpt)} on your ${pollName}. Convince me ${label(theirOpt)} is better.` : `I went ${label(myOpt)} on that ${pollName}. Why ${label(theirOpt)}?`,
      });
    }
  }
  const m = repo.move(sharedMoves[0] ?? '');
  if (m && !isNightBoard(m.boardId ?? '')) out.push({ context: `You’re both into ${m.title}`, draft: `Are you going to ${m.title} on ${m.dateLabel}? I’m thinking about it too.` });
  const b = repo.board(sharedBoards.find((id) => !isNightBoard(id)) ?? '');
  if (b) out.push({ context: `You’re both in ${b.title}`, draft: `What’s your best tip from ${b.title} so far?` });
  const post = repo.buzz().find((x) => x.authorId === personId && x.body && x.kind !== 'poll' && !isNightBoard(x.boardId));
  if (post?.body) {
    const snip = post.body.split(/[.!?]/)[0].slice(0, 70);
    out.push({ context: `${name} posted in ${repo.board(post.boardId)?.title}`, draft: `Saw your post in ${repo.board(post.boardId)?.title}: “${snip}”. How did that come about?` });
  }
  const pm = repo.move(possibleMoves.find((id) => !isNightBoard(repo.move(id)?.boardId ?? '')) ?? '');
  if (!m && pm) out.push({ context: `${name} might be at ${pm.title}`, draft: `Is ${pm.title} worth it? I’ve been looking at it.` });
  const i = sharedInterests.find((x) => (s.affinity[x] ?? 0) >= AFFINITY.meaningful && interestById[x]?.category !== 'afterDark');
  if (out.length < 3 && i) {
    // Places keep their capital ("Japan"); topics read naturally in lower case.
    const noun = interestById[i]?.category === 'travel' && i !== 'i_travel' && i !== 'i_solo' ? label(i) : label(i).toLowerCase();
    out.push({ context: `You’re both into ${noun}`, draft: `What got you into ${noun}?` });
  }
  return out.slice(0, 3);
}

/** Starters shouldn't point anywhere near After Dark or nightlife Worlds. */
function isNightBoard(boardId: string): boolean {
  const b = repo.board(boardId);
  return !!b && (!!b.ageGated || b.template === 'nightlife' || b.category === 'afterDark');
}

// ─── Rankings ───────────────────────────────────────────────────────────────

const byScore = <T>(a: Scored<T>, b: Scored<T>) => b.score - a.score;

export function rankBoards(ctx: GraphContext, filter: (b: Board) => boolean = () => true): Scored<Board>[] {
  return repo.boards().filter((b) => !!b?.id && filter(b)).map((b) => scoreBoard(ctx, b)).sort(byScore);
}

export function rankMoves(ctx: GraphContext, filter: (m: Move) => boolean = () => true): Scored<Move>[] {
  return repo.moves().filter(filter).map((m) => scoreMove(ctx, m)).sort(byScore);
}

export function rankStories(ctx: GraphContext, filter: (st: Story) => boolean = () => true): Scored<Story>[] {
  return repo.stories().filter(filter).map((st) => scoreStory(ctx, st)).sort(byScore);
}

export interface RankedPerson {
  person: User;
  match: MatchExplanation;
  score: number;
}

/** Everyone except you and people you blocked, best match first. */
export function rankPeopleCtx(ctx: GraphContext, opts?: { excludeConnected?: boolean }): RankedPerson[] {
  return repo
    .people()
    .filter((p) => p.id !== ds().me.id && !ctx.s.blocked[p.id])
    .filter((p) => (opts?.excludeConnected ? !ctx.s.connections[p.id] : true))
    .map((person) => {
      const match = ctx.match(person.id);
      return { person, match, score: match.matchScore + tiebreak(person.id) };
    })
    .sort((a, b) => b.score - a.score);
}
