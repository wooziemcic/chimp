/**
 * Surfaces — the Opportunity Graph mapped onto Chimp's six tabs.
 *
 *   Boards     rankBoards (relevance.ts)            "What worlds do I care about?"
 *   Drift      rankDrift + driftStories             "Show me something interesting."
 *   Buzz       rankBuzz (For You / Following / Trending)  "What are people saying?"
 *   Happening  buildHappening + happeningNodes      "What matters specifically to me?"
 *   You        explainPerson, loops, agent          identity + graph
 *   After Dark isolated: nothing here ever returns After Dark content.
 *
 * Buzz and Drift reuse the same relevance parts as Boards and Moves
 * (interest, relationship, loop, social, freshness, editorial) with their
 * own weights, minus a capped penalty for things similar to what you disliked.
 */
import { interestById } from '@/data/interests';
import { ds } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { Board, BuzzItem, DriftItem, EntityRef, HappeningItem, Post, Reason, Scored, Story } from '@/types/models';

import { HAPPENING, NEGATIVE, SURFACE_WEIGHTS, TRENDING } from './config';
import { loopProgress } from './loops';
import {
  boardEvidence,
  clamp01,
  evidenceToReasons,
  first,
  type GraphContext,
  interestPart,
  interestReason,
  isActiveLoop,
  loopMatches,
  loopPart,
  loopReasons,
  rankMoves,
  rankPeopleCtx,
  relatedEvidence,
  scoreStory,
  socialPart,
  sortReasons,
  tiebreak,
} from './relevance';
import { freshCount, touches, unseenChanges } from './touch';

// ─── After Dark isolation ───────────────────────────────────────────────────

export function isAfterDarkBoard(b: Board | undefined): boolean {
  return !!b && (!!b.ageGated || b.template === 'nightlife');
}

/** Does this node belong to After Dark? (Resolves posts, Buzz, Drift, Stories, Moves to their Board.) */
export function isAfterDarkRef(ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'board':
      return isAfterDarkBoard(repo.board(ref.id));
    case 'buzz':
      return isAfterDarkBoard(repo.board(repo.buzzItem(ref.id)?.boardId ?? ''));
    case 'drift':
      return isAfterDarkBoard(repo.board(repo.driftItem(ref.id)?.boardId ?? ''));
    case 'post':
      return isAfterDarkBoard(repo.board(repo.post(ref.id)?.boardId ?? ''));
    case 'move':
      return isAfterDarkBoard(repo.board(repo.move(ref.id)?.boardId ?? ''));
    case 'story': {
      const st = repo.story(ref.id);
      if (!st) return false;
      if (st.owner.kind === 'board' && isAfterDarkRef(st.owner)) return true;
      return st.items.every((i) => i.boardId && isAfterDarkBoard(repo.board(i.boardId)));
    }
    default:
      return false;
  }
}

/**
 * Stricter test used by Happening. Besides the 18+ After Dark world it also
 * treats public nightlife (category 'afterDark', e.g. NYC Rooftops, Rooftop
 * Night) as After Dark, so none of it can surface in Happening.
 */
export function isNightRef(ref: EntityRef): boolean {
  if (isAfterDarkRef(ref)) return true;
  if (ref.kind === 'board') return repo.board(ref.id)?.category === 'afterDark';
  if (ref.kind === 'move') {
    const m = repo.move(ref.id);
    return !!m && (m.category === 'afterDark' || repo.board(m.boardId ?? '')?.category === 'afterDark');
  }
  if (ref.kind === 'story') {
    const st = repo.story(ref.id);
    if (!st) return false;
    if ((st.owner.kind === 'board' || st.owner.kind === 'move') && isNightRef(st.owner)) return true;
    return st.items.every((i) => !!i.boardId && isNightRef({ kind: 'board', id: i.boardId }));
  }
  return false;
}

let nightTitleCache: { version: number; titles: string[] } | undefined;
/** Titles of night Boards/Moves, to keep them out of Happening copy. */
function mentionsNight(text: string): boolean {
  if (!nightTitleCache || nightTitleCache.version !== ds().version) nightTitleCache = { version: ds().version, titles: [
    ...repo.boards().filter((b) => isNightRef({ kind: 'board', id: b.id })).map((b) => b.title),
    ...repo.moves().filter((m) => isNightRef({ kind: 'move', id: m.id })).map((m) => m.title),
  ] };
  return nightTitleCache.titles.some((t) => text.includes(t));
}
export const dayOnly = (lines: string[]) => lines.filter((t) => !mentionsNight(t));

// ─── Negative feedback (dislikes) ───────────────────────────────────────────

export interface NegativeFeedback {
  boards: Record<string, number>;
  interests: Record<string, number>;
  authors: Record<string, number>;
  count: number;
}

/** Derived from your dislikes, never stored twice. */
export function negativeFeedback(ctx: GraphContext): NegativeFeedback {
  const out: NegativeFeedback = { boards: {}, interests: {}, authors: {}, count: 0 };
  for (const id of Object.keys(ctx.s.buzzDislikes)) {
    const b = repo.buzzItem(id);
    if (!b) continue;
    out.count += 1;
    out.boards[b.boardId] = (out.boards[b.boardId] ?? 0) + 1;
    if (b.authorId) out.authors[b.authorId] = (out.authors[b.authorId] ?? 0) + 1;
    for (const i of itemInterests(b.boardId, b.interests)) out.interests[i] = (out.interests[i] ?? 0) + 1;
  }
  // Phase 6C: Drift dislikes teach the same way.
  for (const id of Object.keys(ctx.s.driftDislikes ?? {})) {
    const d = repo.driftItem(id);
    if (!d) continue;
    out.count += 1;
    out.boards[d.boardId] = (out.boards[d.boardId] ?? 0) + 1;
    out.authors[d.authorId] = (out.authors[d.authorId] ?? 0) + 1;
    for (const i of itemInterests(d.boardId, d.interests)) out.interests[i] = (out.interests[i] ?? 0) + 1;
  }
  return out;
}

function penalty(neg: NegativeFeedback, boardId: string, interests: string[], authorId?: string): number {
  if (!neg.count) return 0;
  let p = (neg.boards[boardId] ?? 0) * NEGATIVE.perSameBoard;
  for (const i of interests) p += (neg.interests[i] ?? 0) * NEGATIVE.perSharedInterest;
  if (authorId) p += (neg.authors[authorId] ?? 0) * NEGATIVE.perSameAuthor;
  return Math.min(NEGATIVE.maxPenalty, p);
}

function itemInterests(boardId: string, extra?: string[]): string[] {
  return [...new Set([...(extra ?? []), ...(repo.board(boardId)?.interests ?? [])])];
}

// ─── Shared scoring for World content (Buzz + Drift) ────────────────────────

interface ContentInput {
  id: string;
  ref: EntityRef;
  boardId: string;
  authorId?: string;
  interests: string[];
  ageHours: number;
  likeCount: number;
  /** Your own engagement with the item (0..1). */
  own: number;
}

function scoreContent<T>(ctx: GraphContext, item: T, c: ContentInput, weights: typeof SURFACE_WEIGHTS.buzz, neg: NegativeFeedback): Scored<T> {
  const { s } = ctx;
  const board = repo.board(c.boardId);
  const own = boardEvidence(ctx, c.boardId);
  const related = relatedEvidence(ctx, c.boardId);
  const relationship = Math.max(c.own, own[0]?.value ?? 0, (related[0]?.ev[0]?.value ?? 0) * 0.5);
  const lm = loopMatches(ctx, { kind: 'board', id: c.boardId }, c.interests, c.boardId);
  const social = socialPart(ctx, c.authorId ? [c.authorId] : []);
  const fresh = freshCount(s.changes, c.ref);

  const parts = {
    interest: interestPart(s, c.interests),
    relationship,
    loop: loopPart(lm),
    social: social.part === 0 ? 0 : Math.min(1, social.part * 2),
    freshness: clamp01(1 - c.ageHours / 36 + fresh * 0.3),
    editorial: clamp01(Math.log10(c.likeCount + 1) / 4),
  };
  const pen = penalty(neg, c.boardId, c.interests, c.authorId);
  const score =
    weights.interest * parts.interest +
    weights.relationship * parts.relationship +
    weights.loop * parts.loop +
    weights.social * parts.social +
    weights.freshness * parts.freshness +
    weights.editorial * parts.editorial -
    pen +
    tiebreak(c.id);

  const reasons: Reason[] = [
    ...evidenceToReasons(own, 1, 1),
    ...related.slice(0, 1).flatMap(({ board: rb, ev }) =>
      evidenceToReasons(ev, 0.5, 1, (e) => ({
        text: e.kind === 'board' && e.clause.startsWith('you joined') ? `Related to ${rb.title}, which you joined` : `Close to ${rb.title}, where ${e.clause}`,
        short: `Near ${rb.title}`,
      })),
    ),
    ...loopReasons(lm),
    ...interestReason(s, c.interests, parts.interest),
  ];
  if (c.authorId && social.known.includes(c.authorId)) {
    reasons.push({ kind: 'people', text: `From ${first(c.authorId)}, ${s.connections[c.authorId] ? 'a connection' : 'who you follow'}`, short: `From ${first(c.authorId)}`, strength: weights.social * parts.social, ref: { kind: 'person', id: c.authorId } });
  } else if (c.authorId && social.matches.includes(c.authorId)) {
    reasons.push({ kind: 'match', text: `From ${first(c.authorId)}, a strong match`, short: `${first(c.authorId)}, a match`, strength: weights.social * parts.social, ref: { kind: 'person', id: c.authorId } });
  }
  if (pen > 0) reasons.push({ kind: 'fresh', text: 'Shown less: similar to something you disliked', short: 'Shown less', strength: 0.06 });
  const r = sortReasons(reasons);
  return {
    item,
    score: Math.round(score * 100) / 100,
    parts: { ...parts, penalty: pen },
    reasons: r.length ? r : [{ kind: 'editorial', text: `Popular in ${board?.title ?? 'Chimp'}`, short: 'Popular', strength: 0 }],
  };
}

// ─── Buzz ───────────────────────────────────────────────────────────────────

export type BuzzTab = 'forYou' | 'following' | 'trending';

export function scoreBuzz(ctx: GraphContext, b: BuzzItem, neg = negativeFeedback(ctx)): Scored<BuzzItem> {
  const s = ctx.s;
  const own = s.buzzReposts[b.id] ? 0.8 : s.buzzSaves[b.id] ? 0.7 : s.buzzLikes[b.id] ? 0.6 : 0;
  return scoreContent(ctx, b, {
    id: b.id,
    ref: { kind: 'buzz', id: b.id },
    boardId: b.boardId,
    authorId: b.authorId,
    interests: itemInterests(b.boardId, b.interests),
    ageHours: b.ageHours,
    likeCount: b.likeCount,
    own,
  }, SURFACE_WEIGHTS.buzz, neg);
}

/** Not personalised: popularity decayed by age. Still excludes After Dark. */
export function trendingScore(likes: number, ageHours: number): number {
  return likes * Math.pow(0.5, ageHours / TRENDING.halfLifeHours);
}

/** When an item was created (ms): its real timestamp, or (Demo fixtures) derived from its age. */
export const createdMs = (item: { createdAtMs?: number; ageHours: number }, now = Date.now()) => item.createdAtMs ?? now - item.ageHours * 3_600_000;

/** A Buzz's like total: everyone else's (the backend's real count) plus yours. */
export const totalLikes = (ctx: GraphContext, b: BuzzItem) => b.likeCount + (ctx.s.buzzLikes[b.id] ? 1 : 0);

export function rankBuzz(ctx: GraphContext, tab: BuzzTab): Scored<BuzzItem>[] {
  const { s } = ctx;
  const neg = negativeFeedback(ctx);
  const visible = repo
    .buzz()
    .filter((b) => !isAfterDarkBoard(repo.board(b.boardId)))
    .filter((b) => !b.authorId || !s.blocked[b.authorId]);
  const scored = visible.map((b) => scoreBuzz(ctx, b, neg));
  const now = Date.now();
  // Phase 6C: each tab keeps its own, simple ordering rule.
  if (tab === 'following') {
    // Newest first: people you follow / are connected with, and Worlds you joined or own.
    // Phase 6D: never your own posts (they live on You and in For You).
    return scored
      .filter(({ item: b }) => !repo.isMe(b.authorId))
      .filter(({ item: b }) => (b.authorId && (s.following[b.authorId] || s.connections[b.authorId])) || (!!b.boardId && (s.joined[b.boardId] || repo.isMe(repo.board(b.boardId)?.ownerId))))
      .sort((a, b) => createdMs(b.item, now) - createdMs(a.item, now));
  }
  if (tab === 'trending') {
    // Deliberately simple for now: most likes first (real totals, incl. yours), then newest.
    return scored.sort((a, b) => totalLikes(ctx, b.item) - totalLikes(ctx, a.item) || createdMs(b.item, now) - createdMs(a.item, now));
  }
  // For You: the graph's ranking (with its freshness boost), never purely chronological.
  return scored.sort((a, b) => b.score - a.score);
}

// ─── Board posts (Phase 5: Living Worlds use the same scorer) ─────────────

/** "3h" / "2d" → hours. Seed dates only; anything else counts as a week. */
export function ageHoursOf(label: string): number {
  const m = /^(\d+)\s*([mhd])$/.exec(label.trim());
  if (!m) return 168;
  const n = Number(m[1]);
  return m[2] === 'm' ? n / 60 : m[2] === 'h' ? n : n * 24;
}

export function scorePost(ctx: GraphContext, p: Post, neg = negativeFeedback(ctx)): Scored<Post> {
  const s = ctx.s;
  const own = s.savedPosts[p.id] ? 0.7 : s.likedPosts[p.id] ? 0.6 : s.pollVotes[p.id] ? 0.4 : 0;
  return scoreContent(ctx, p, {
    id: p.id,
    ref: { kind: 'post', id: p.id },
    boardId: p.boardId,
    authorId: p.authorId,
    interests: itemInterests(p.boardId),
    ageHours: ageHoursOf(p.createdAt),
    likeCount: p.likeCount,
    own,
  }, SURFACE_WEIGHTS.buzz, neg);
}

// ─── Drift ──────────────────────────────────────────────────────────────────

export function scoreDrift(ctx: GraphContext, d: DriftItem, neg = negativeFeedback(ctx)): Scored<DriftItem> {
  const s = ctx.s;
  const own = s.driftSaves[d.id] ? 0.7 : s.driftLikes[d.id] ? 0.6 : s.driftViews[d.id] ? 0.3 : 0;
  return scoreContent(ctx, d, {
    id: d.id,
    ref: { kind: 'drift', id: d.id },
    boardId: d.boardId,
    authorId: d.authorId,
    interests: itemInterests(d.boardId, d.interests),
    ageHours: d.ageHours,
    likeCount: d.likeCount,
    own,
  }, SURFACE_WEIGHTS.drift, neg);
}

export function rankDrift(ctx: GraphContext): Scored<DriftItem>[] {
  const neg = negativeFeedback(ctx);
  return repo
    .drift()
    .filter((d) => !isAfterDarkBoard(repo.board(d.boardId)) && !ctx.s.blocked[d.authorId])
    .map((d) => scoreDrift(ctx, d, neg))
    .sort((a, b) => b.score - a.score);
}

// ─── Buzz → Drift (Phase 6C; was Happening's visual feed in 6B) ────────────

/** One item in Buzz → Drift: a World photo / carousel, or a photo / video Buzz (the same canonical item, never a copy). */
export interface FeedEntry {
  key: string;
  kind: 'drift' | 'buzz';
  id: string;
  images: string[];
  aspects?: number[];
  caption: string;
  authorId?: string;
  boardId: string;
  /** Why it's here, in plain words ("Priya posted", "Because you're into Films"). */
  reason: string;
  score: number;
  video?: boolean;
  durationSec?: number;
  /** Phase 6C: a real clip (url) or, for Demo fixtures, just a poster. */
  clip?: { url?: string; poster?: string; durationMs?: number; aspect?: number };
  likeCount: number;
}

/** The one reason a tile shows, phrased for a feed. Never empty. */
export function feedReason(ctx: GraphContext, r: Reason | undefined, boardId: string): string {
  const b = boardId ? repo.board(boardId) : undefined;
  if (!r) return b ? `Trending in ${b.title}` : 'New on Chimp';
  switch (r.kind) {
    case 'people':
      return r.ref ? `${first(r.ref.id)} posted` : r.short ?? r.text;
    case 'match':
      return r.short ?? r.text;
    case 'interest':
      return r.ref ? `Because you’re into ${interestById[r.ref.id]?.label ?? r.ref.id}` : r.text;
    case 'board': {
      if (b && repo.isMe(b.ownerId)) return `From your ${b.title}`;
      if (r.text.startsWith('Related to')) return r.text.replace(/, which you joined$/, '');
      return b ? `From ${b.title}, a World you joined` : 'From a World you joined';
    }
    case 'saved':
      return r.short ?? r.text;
    case 'loop':
      return r.short ?? r.text;
    case 'editorial':
      return b ? `Trending in ${b.title}` : 'Popular on Chimp';
    default:
      return r.short ?? r.text;
  }
}

/**
 * Happening's visual stream: Drift items and photo Buzz from across your
 * graph, ranked by the same scorers as everywhere else and interleaved so
 * neither type runs in long streaks. Every entry says why it's here. Never
 * After Dark (rankDrift / rankBuzz already exclude it).
 */
/**
 * Buzz → Drift: its own visual ranking (the graph's scores, interleaved so
 * neither Worlds' media nor Buzz media floods it). Text-only posts never
 * appear; neither does anything you disliked or After Dark.
 */
export function buildDriftFeed(ctx: GraphContext, limit = 60): FeedEntry[] {
  const drift: FeedEntry[] = rankDrift(ctx)
    .filter(({ item: d }) => !ctx.s.driftDislikes?.[d.id] && !!d.image)
    .map(({ item: d, score, reasons }) => ({
    key: `drift:${d.id}`,
    kind: 'drift',
    id: d.id,
    images: d.images?.length ? d.images : [d.image],
    caption: d.memeText ?? d.caption,
    authorId: d.authorId,
    boardId: d.boardId,
    reason: feedReason(ctx, reasons[0], d.boardId),
    score,
    video: d.kind === 'video',
    durationSec: d.durationSec,
    clip: d.kind === 'video' ? { poster: d.image, durationMs: d.durationSec ? d.durationSec * 1000 : undefined } : undefined,
    likeCount: d.likeCount + (ctx.s.driftLikes[d.id] ? 1 : 0),
  }));
  const photos: FeedEntry[] = rankBuzz(ctx, 'forYou')
    .filter(({ item: b }) => b.kind !== 'news' && !ctx.s.buzzDislikes[b.id] && (b.video || b.image || b.images?.length))
    .map(({ item: b, score, reasons }) => ({
      key: `buzz:${b.id}`,
      kind: 'buzz',
      id: b.id,
      images: b.images?.length ? b.images : b.image ? [b.image] : [],
      video: !!b.video,
      clip: b.video ? { url: b.video.url, poster: b.video.poster ?? b.image, durationMs: b.video.durationMs, aspect: b.video.aspect } : undefined,
      aspects: b.imageAspects,
      caption: b.memeText ?? b.body ?? b.title ?? '',
      authorId: b.authorId,
      boardId: b.boardId,
      reason: feedReason(ctx, reasons[0], b.boardId),
      score,
      likeCount: totalLikes(ctx, b),
    }));
  // Interleave by score, never more than two of one type in a row when the other has items left.
  const out: FeedEntry[] = [];
  let i = 0;
  let j = 0;
  let run: FeedEntry['kind'] | null = null;
  let runLen = 0;
  while (out.length < limit && (i < drift.length || j < photos.length)) {
    let pick: FeedEntry;
    const d = drift[i];
    const p = photos[j];
    if (!p || (d && d.score >= p.score)) pick = run === 'drift' && runLen >= 2 && p ? p : d;
    else pick = run === 'buzz' && runLen >= 2 && d ? d : p;
    if (pick === d) i++;
    else j++;
    runLen = run === pick.kind ? runLen + 1 : 1;
    run = pick.kind;
    out.push(pick);
  }
  return out;
}

/** Stories inside Drift: trending World stories first, then people you know. No After Dark. */
export function driftStories(ctx: GraphContext, seen: Record<string, true>): { trending: Story[]; friends: Story[] } {
  const { s } = ctx;
  const unseen = (st: Story) => st.items.some((i) => !seen[i.id]);
  const trending = repo
    .stories()
    .filter((st) => st.lane === 'trending' && !isAfterDarkRef({ kind: 'story', id: st.id }))
    .map((st) => ({ st, score: scoreStory(ctx, st).score + (unseen(st) ? 6 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.st);
  const friends = repo
    .stories()
    .filter((st) => st.lane === 'friend' && !s.blocked[st.owner.id] && (s.following[st.owner.id] || s.connections[st.owner.id]))
    .filter((st) => !isAfterDarkRef({ kind: 'story', id: st.id }))
    .sort((a, b) => Number(unseen(b)) - Number(unseen(a)) || Number(!!s.connections[b.owner.id]) - Number(!!s.connections[a.owner.id]));
  return { trending, friends };
}

// ─── Happening ──────────────────────────────────────────────────────────────

const moveEngaged = (ctx: GraphContext, id: string) => {
  const st = ctx.s.moveState[id];
  return !!(st?.interested || st?.rsvp || st?.saved);
};

/**
 * Only things with strong graph context, each with WHY THIS MATTERS TO YOU.
 * Never generic events or generic people, and never After Dark.
 */
export function buildHappening(ctx: GraphContext): HappeningItem[] {
  const { s } = ctx;
  const items: HappeningItem[] = [];

  // Moves: people you know or strong matches going, loops they serve, plans this week.
  for (const x of rankMoves(ctx)) {
    const m = x.item;
    if (isNightRef({ kind: 'move', id: m.id })) continue;
    const attendees = [...new Set([m.hostId, ...m.attendeePreview])].filter((id) => !s.blocked[id]);
    const relevant = attendees.filter((id) => s.following[id] || s.connections[id] || ctx.match(id).matchScore >= 70);
    const loopR = x.reasons.find((r) => r.kind === 'loop' && r.short !== 'Near an Open Loop');
    const loop = loopR?.ref ? s.openLoops.find((l) => l.id === loopR.ref!.id) : undefined;
    const why = dayOnly(x.reasons.filter((r) => r.kind !== 'editorial').map((r) => r.text)).slice(0, 3);
    if (relevant.length >= 2) {
      items.push({ id: `mv:${m.id}`, kind: 'move', title: `${relevant.length} relevant people are going to ${m.title}`, body: `${m.city} · ${m.dateLabel}`, why, ref: { kind: 'move', id: m.id }, image: m.image, people: relevant, score: x.score + 12 });
    } else if (loop) {
      items.push({ id: `mv:${m.id}`, kind: 'move', title: `${m.title} matches your ${loop.short ?? 'Open Loop'}`, body: `${m.city} · ${m.dateLabel}`, why, ref: { kind: 'move', id: m.id }, image: m.image, people: relevant, score: x.score + 10 });
    } else if (moveEngaged(ctx, m.id) && m.section === 'week') {
      items.push({ id: `mv:${m.id}`, kind: 'plan', title: `A Move you saved is happening this week: ${m.title}`, body: `${m.city} · ${m.dateLabel}`, why: why.length ? why : ['You marked it as a plan'], ref: { kind: 'move', id: m.id }, image: m.image, people: relevant, score: x.score + 8 });
    }
    // A single acquaintance going to an unrelated Move is not "strong context": skipped.
  }

  // People: overlaps with your loops, shared plans, new strong matches, Sparks.
  // Sparks always surface (they're mutual and rare); everything else only from the top 8.
  for (const [i, { person, match }] of rankPeopleCtx(ctx).entries()) {
    if (i >= 8 && !match.spark) continue;
    const name = first(person.id);
    const why = dayOnly(match.matchReasons.map((r) => r.label)).slice(0, 3);
    const ref: EntityRef = { kind: 'person', id: person.id };
    if (match.spark) {
      // Never who chose first; just that it's mutual, and what you share.
      const ctxLines = match.openers.filter((o) => !mentionsNight(o.context) && !mentionsNight(o.draft)).map((o) => o.context);
      items.push({ id: `sp:${person.id}`, kind: 'spark', title: `You and ${name} have a Spark`, body: 'Start from something you share.', why: [...ctxLines, ...why].slice(0, 3), ref, image: person.avatar, people: [person.id], score: 99 });
      continue;
    }
    if (s.connections[person.id]) continue;
    const loop = match.relevantOpenLoops.map((id) => s.openLoops.find((l) => l.id === id)).find((l) => l && l.related.some((r) => r.kind === 'person' && r.id === person.id)) ??
      match.relevantOpenLoops.map((id) => s.openLoops.find((l) => l.id === id)).find(Boolean);
    const sharedMove = repo.move(match.sharedMoves.find((id) => !isNightRef({ kind: 'move', id })) ?? '');
    if (sharedMove) {
      items.push({ id: `pp:${person.id}`, kind: 'people', title: `${name} is into the same ${sharedMove.city} plan: ${sharedMove.title}`, why, ref, image: person.avatar, people: [person.id], score: match.matchScore * 0.8 + 8 });
    } else if (loop && match.matchScore >= 60) {
      items.push({ id: `pp:${person.id}`, kind: 'people', title: `${name} now overlaps your ${loop.short ?? loop.title}`, why, ref, image: person.avatar, people: [person.id], score: match.matchScore * 0.8 + 4 });
    } else if (match.relationship === 'match') {
      items.push({ id: `pp:${person.id}`, kind: 'match', title: `${name} became a suggested match`, body: 'Someone relevant to your graph.', why, ref, image: person.avatar, people: [person.id], score: match.matchScore * 0.75 });
    }
  }

  // Open Loops that actually moved.
  for (const l of s.openLoops.filter(isActiveLoop)) {
    const p = loopProgress(ctx, l);
    if (p.progress <= 0) continue;
    const done = p.steps.filter((st) => st.done).map((st) => st.label);
    items.push({
      id: `lp:${l.id}`,
      kind: 'loop',
      title: `Your ${l.short ?? l.title} advanced to ${p.progress}%`,
      body: p.next ? `Next: ${p.next.label}` : 'Ready to mark resolved',
      why: done.length ? done.slice(0, 3) : ['You made progress on it'],
      ref: { kind: 'loop', id: l.id },
      people: p.next?.ref?.kind === 'person' ? [p.next.ref.id] : undefined,
      score: 52 + p.progress / 4,
    });
  }

  // Important World Delta changes (never After Dark).
  for (const c of unseenChanges(s.changes)) {
    if (c.importance < 2 || isNightRef(c.ref) || mentionsNight(c.message)) continue;
    items.push({ id: `ch:${c.id}`, kind: 'change', title: c.message, body: c.detail, why: [c.reason], ref: c.ref, image: repo.imageFor(c.ref), score: 50 + c.importance * 5 });
  }

  // One item per thing; strongest first.
  const byRef = new Map<string, HappeningItem>();
  for (const it of items) {
    const k = `${it.ref.kind}:${it.ref.id}`;
    const prev = byRef.get(k);
    if (!prev || it.score > prev.score) byRef.set(k, it);
  }
  return [...byRef.values()]
    .filter((it) => it.why.length > 0 && it.score >= HAPPENING.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, HAPPENING.maxItems);
}

export interface HappeningNode {
  ref: EntityRef;
  label: string;
  type: 'Board' | 'People' | 'Move' | 'Story';
  image?: string | number;
  count: number;
  score: number;
}

/**
 * The graph view at the top of Happening: the few nodes where most of what
 * matters to you is concentrated. Badge = relevant items + unseen changes.
 */
export function happeningNodes(ctx: GraphContext, items: HappeningItem[]): HappeningNode[] {
  const { s } = ctx;
  const agg = new Map<string, HappeningNode>();
  const add = (ref: EntityRef, score: number) => {
    if (isNightRef(ref)) return;
    const k = `${ref.kind}:${ref.id}`;
    const cur = agg.get(k);
    if (cur) {
      cur.count += 1;
      cur.score += score;
      return;
    }
    const type = ref.kind === 'board' ? 'Board' : ref.kind === 'person' ? 'People' : ref.kind === 'move' ? 'Move' : ref.kind === 'story' ? 'Story' : null;
    if (!type) return;
    agg.set(k, { ref, label: ref.kind === 'person' ? first(ref.id) : repo.labelFor(ref), type, image: repo.imageFor(ref), count: 1, score });
  };
  for (const it of items) {
    add(it.ref, it.score);
    if (it.ref.kind === 'move') {
      const m = repo.move(it.ref.id);
      if (m?.boardId) add({ kind: 'board', id: m.boardId }, it.score * 0.6);
    }
    for (const p of it.people ?? []) if (p !== it.ref.id) add({ kind: 'person', id: p }, it.score * 0.4);
  }
  // Worlds you're in with fresh activity, and the top World story.
  for (const id of Object.keys(s.joined)) add({ kind: 'board', id }, 20 + freshCount(s.changes, { kind: 'board', id }) * 10);
  const story = repo.stories().filter((st) => st.lane === 'trending' && !isNightRef({ kind: 'story', id: st.id }) && st.owner.kind !== 'move').map((st) => scoreStory(ctx, st)).sort((a, b) => b.score - a.score)[0];
  if (story) add({ kind: 'story', id: story.item.id }, story.score * 0.6);
  for (const n of agg.values()) n.count += freshCount(s.changes, n.ref);

  // Diversity: a few Worlds, a couple of people, a Move and a Story.
  const all = [...agg.values()].sort((a, b) => b.score - a.score);
  const pick = (type: HappeningNode['type'], n: number) => all.filter((x) => x.type === type).slice(0, n);
  const chosen = [...pick('Board', 3), ...pick('People', 2), ...pick('Move', 1), ...pick('Story', 1)];
  for (const x of all) {
    if (chosen.length >= HAPPENING.nodes) break;
    if (!chosen.includes(x)) chosen.push(x);
  }
  return chosen.slice(0, HAPPENING.nodes).sort((a, b) => b.score - a.score);
}

/** Changes that concern a World (for "N new" badges on Board cards). */
export function worldFreshCount(ctx: GraphContext, boardId: string): number {
  return ctx.s.changes.filter((c) => !c.seen && touches(c, { kind: 'board', id: boardId })).length;
}

