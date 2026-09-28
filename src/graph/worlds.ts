/**
 * Living Worlds (Phase 5): a Board as a digital magazine.
 *
 *   TODAY    a finite, personalised edition (lead + modules)
 *   EXPLORE  a long-running stream of everything that belongs to the World
 *
 * There is no separate recommender here. Items are scored with the same
 * functions as Buzz, Drift and Boards (`scoreBuzz`, `scoreDrift`,
 * `scorePost`, `scoreStory`, `explainPerson`), then nudged by the World's
 * topics (your affinity) and by what you've done inside this World. The
 * data is identical for everyone; only the order changes.
 */
import { ITEM_TOPICS, WORLD_TOPICS, type WorldTopic } from '@/data/editions';
import { repo } from '@/services/repository';
import type { Board, BuzzItem, DriftItem, EntityRef, Move, Post, Story, Tip } from '@/types/models';
import { EDITION } from './config';
import { type GraphContext, first, scoreBoard, scoreMove, scoreStory } from './relevance';
import { isNightRef, negativeFeedback, scoreBuzz, scoreDrift, scorePost, trendingScore } from './surfaces';
import { freshCount } from './touch';
import { pinFresh } from '@/utils/buzzRows';

// ─── Topics ─────────────────────────────────────────────────────────────────

export interface RankedTopic {
  topic: WorldTopic;
  /** 0..1, your affinity for the topic's interests (minus dislikes). */
  affinity: number;
}

function topicAffinity(ctx: GraphContext, t: WorldTopic, neg = negativeFeedback(ctx)): number {
  const vals = t.interests.map((i) => (ctx.s.affinity[i] ?? 0) - (neg.interests[i] ?? 0) * 0.05);
  if (!vals.length) return 0;
  // Strongest interest counts most; the rest refine.
  const sorted = vals.sort((a, b) => b - a);
  return Math.max(0, sorted[0] * 0.7 + (sorted.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, sorted.length - 1)) * 0.3);
}

/** A World's topics in *your* order (same topics for everyone). */
export function rankTopics(ctx: GraphContext, boardId: string): RankedTopic[] {
  const neg = negativeFeedback(ctx);
  return (WORLD_TOPICS[boardId] ?? [])
    .filter((t) => !t.ref || !isNightRef(t.ref))
    .map((topic) => ({ topic, affinity: Math.round(topicAffinity(ctx, topic, neg) * 1000) / 1000 }))
    .sort((a, b) => b.affinity - a.affinity);
}

/** Extra relevance an item gets from the World's topics it touches. */
function topicBonus(topics: Map<string, number>, id: string): number {
  const ids = ITEM_TOPICS[id] ?? [];
  if (!ids.length) return 0;
  return Math.max(...ids.map((t) => topics.get(t) ?? 0)) * EDITION.topicWeight;
}

// ─── Edition ────────────────────────────────────────────────────────────────

export type ModuleId = 'buzzing' | 'news' | 'top' | 'watch' | 'stories' | 'people' | 'trending';

export type LeadItem =
  | { kind: 'news'; item: BuzzItem; score: number; why: string }
  | { kind: 'drift'; item: DriftItem; score: number; why: string }
  | { kind: 'post'; item: Post; score: number; why: string };

export interface PeopleEntry {
  personId: string;
  /** What they're doing in this World. */
  line: string;
  ref?: EntityRef;
  relation: 'connection' | 'following' | 'match' | 'member';
}

export interface TrendingEntry {
  id: string;
  label: string;
  ref?: EntityRef;
  kind: 'topic' | 'world';
  score: number;
}

export type ModuleItems =
  | { id: 'buzzing'; items: BuzzItem[] }
  | { id: 'news'; items: BuzzItem[] }
  | { id: 'top'; items: Post[] }
  | { id: 'watch'; items: DriftItem[] }
  | { id: 'stories'; items: Story[] }
  | { id: 'people'; items: PeopleEntry[] }
  | { id: 'trending'; items: TrendingEntry[] };

export type EditionModule = ModuleItems & {
  title: string;
  score: number;
  /** Base editorial weight and your personal boost (Graph Debug shows both). */
  base: number;
  boost: number;
  /** Why it sits where it does; only set when your actions moved it. */
  why?: string;
};

export interface Edition {
  board: Board;
  lead?: LeadItem;
  modules: EditionModule[];
  topics: RankedTopic[];
  /** Everything counted in "N new today". */
  freshCount: number;
}

const MODULE_TITLE: Record<ModuleId, string> = {
  buzzing: 'Buzzing',
  news: 'News',
  top: 'Top post',
  watch: 'Watch',
  stories: 'Stories',
  people: 'From your people',
  trending: 'Trending',
};

let editionCache = new WeakMap<GraphContext, Map<string, Edition>>();

/** Today's edition of a World, personalised by the Opportunity Graph. */
export function buildEdition(ctx: GraphContext, boardId: string): Edition | undefined {
  const cached = editionCache.get(ctx)?.get(boardId);
  if (cached) return cached;
  const board = repo.board(boardId);
  if (!board || isNightRef({ kind: 'board', id: boardId })) return undefined;
  const { s } = ctx;
  const neg = negativeFeedback(ctx);
  const world = repo.world(boardId);
  const topics = rankTopics(ctx, boardId);
  const tmap = new Map(topics.map((t) => [t.topic.id, t.affinity]));
  const notBlocked = (id?: string) => !id || !s.blocked[id];

  // Score every item once with the shared scorers, plus the topic nudge.
  const buzz = world.buzz
    .filter((b) => notBlocked(b.authorId))
    .map((b) => {
      const sc = scoreBuzz(ctx, b, neg);
      return { item: b, score: sc.score + topicBonus(tmap, b.id), reasons: sc.reasons };
    });
  const news = world.news.map((b) => {
    const sc = scoreBuzz(ctx, b, neg);
    return { item: b, score: sc.score + topicBonus(tmap, b.id), reasons: sc.reasons };
  });
  const posts = world.posts
    .filter((p) => notBlocked(p.authorId))
    .map((p) => {
      const sc = scorePost(ctx, p, neg);
      return { item: p, score: sc.score + topicBonus(tmap, p.id), reasons: sc.reasons };
    });
  const drift = world.watch
    .filter((d) => notBlocked(d.authorId))
    .map((d) => {
      const sc = scoreDrift(ctx, d, neg);
      return { item: d, score: sc.score + topicBonus(tmap, d.id), reasons: sc.reasons };
    });
  const byScore = <T extends { score: number }>(a: T, b: T) => b.score - a.score;
  buzz.sort(byScore);
  news.sort(byScore);
  posts.sort(byScore);
  drift.sort(byScore);

  // ── Lead / cover: the single most relevant thing in the World right now.
  const leadCandidates: LeadItem[] = [];
  const leadPost = posts.find((p) => p.item.images?.length || p.item.place);
  if (news[0]) leadCandidates.push({ kind: 'news', item: news[0].item, score: news[0].score + EDITION.lead.news, why: news[0].reasons[0]?.text ?? '' });
  if (drift[0]) leadCandidates.push({ kind: 'drift', item: drift[0].item, score: drift[0].score + EDITION.lead.drift, why: drift[0].reasons[0]?.text ?? '' });
  if (leadPost) leadCandidates.push({ kind: 'post', item: leadPost.item, score: leadPost.score + EDITION.lead.post, why: leadPost.reasons[0]?.text ?? '' });
  const lead = leadCandidates.sort(byScore)[0];

  // ── Your evidence inside this World (drives module order).
  const inWorld = <T extends { boardId: string }>(ids: string[], get: (id: string) => T | undefined) =>
    ids.filter((id) => get(id)?.boardId === boardId).length;
  const ev = {
    watch:
      inWorld(Object.keys(s.driftViews), repo.driftItem) +
      inWorld(Object.keys(s.driftLikes), repo.driftItem) +
      inWorld(Object.keys(s.driftSaves), repo.driftItem),
    top: inWorld(Object.keys(s.likedPosts), repo.post) + inWorld(Object.keys(s.savedPosts), repo.post) * 1.5 + inWorld(Object.keys(s.pollVotes), repo.post),
    buzzing:
      inWorld(Object.keys(s.buzzLikes), repo.buzzItem) +
      inWorld(Object.keys(s.buzzSaves), repo.buzzItem) +
      inWorld(Object.keys(s.buzzReposts), repo.buzzItem) +
      inWorld(Object.keys(s.buzzVotes), repo.buzzItem),
  };

  // ── People: those you know (or strong matches) who are active here.
  const active = new Map<string, { line: string; ref?: EntityRef; recency: number }>();
  const note = (personId: string | undefined, line: string, ref: EntityRef | undefined, recency: number) => {
    if (!personId || repo.isMe(personId) || s.blocked[personId]) return;
    const prev = active.get(personId);
    if (!prev || recency < prev.recency) active.set(personId, { line, ref, recency });
  };
  for (const b of world.buzz) note(b.authorId, b.kind === 'poll' ? `asked: ${b.poll?.question ?? 'a poll'}` : `posted ${b.createdAt} ago`, { kind: 'buzz', id: b.id }, b.ageHours);
  for (const d of world.watch) note(d.authorId, `shared ${d.kind === 'video' ? 'a video' : 'a photo'} ${d.createdAt} ago`, { kind: 'drift', id: d.id }, d.ageHours);
  for (const p of world.posts) note(p.authorId, p.title ? `posted “${p.title}”` : 'posted here', { kind: 'post', id: p.id }, 24);
  for (const m of world.moves) for (const pid of m.attendeePreview) note(pid, `is going to ${m.title}`, { kind: 'move', id: m.id }, 30);
  for (const pid of world.people) note(pid, 'is a member', undefined, 999);
  const people: PeopleEntry[] = [...active.entries()]
    .map(([personId, a]) => {
      const relation: PeopleEntry['relation'] = s.connections[personId] ? 'connection' : s.following[personId] ? 'following' : ctx.match(personId).matchScore >= 70 ? 'match' : 'member';
      return { personId, line: `${first(personId)} ${a.line}`, ref: a.ref, relation, rank: { connection: 0, following: 1, match: 2, member: 3 }[relation] * 1000 + a.recency };
    })
    .filter((p) => p.relation !== 'member')
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map(({ rank: _rank, ...p }) => p);

  // ── Trending: topics in your order, then related sub-Worlds by relevance.
  const trending: TrendingEntry[] = [
    ...topics.slice(0, 4).map((t) => ({ id: t.topic.id, label: t.topic.label, ref: t.topic.ref, kind: 'topic' as const, score: t.affinity })),
    ...world.explore
      .filter((b) => !isNightRef({ kind: 'board', id: b.id }))
      // A sub-World already shown as a topic ("Tokyo") isn't repeated.
      .filter((b) => !topics.slice(0, 4).some((t) => t.topic.label === b.title || (t.topic.ref?.kind === 'board' && t.topic.ref.id === b.id)))
      .map((b) => ({ id: b.id, label: b.title, ref: { kind: 'board', id: b.id } as EntityRef, kind: 'world' as const, score: scoreBoard(ctx, b).score / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  ];

  const stories = world.stories
    .filter((st) => !isNightRef({ kind: 'story', id: st.id }))
    .map((st) => scoreStory(ctx, st))
    .sort(byScore)
    .map((x) => x.item);

  // Buzzing = what people are suddenly discussing: trending × relevance.
  const buzzing = [...buzz]
    .map((b) => ({ ...b, heat: b.score + Math.log10(trendingScore(b.item.likeCount, b.item.ageHours) + 1) * EDITION.heatWeight }))
    .sort((a, b) => b.heat - a.heat);

  const leadId = lead?.item.id;
  const topScore = (xs: { score: number }[]) => xs[0]?.score ?? 0;
  const W = EDITION.base;
  const B = EDITION.boost;
  const cap = (v: number) => Math.min(B.cap, v);
  const draft: EditionModule[] = [
    {
      // Phase 6C: what you just posted here leads (newest first, 30 minutes), like For You.
      id: 'buzzing', title: MODULE_TITLE.buzzing, items: pinFresh(buzzing.map((x) => x.item), (a) => repo.isMe(a), Date.now()).slice(0, 3),
      base: W.buzzing, boost: cap(ev.buzzing * B.buzzing) + topScore(buzzing) * B.relevance, score: 0,
      why: ev.buzzing ? 'You’ve been joining the conversation here' : undefined,
    },
    {
      id: 'news', title: MODULE_TITLE.news, items: news.map((x) => x.item).filter((n) => n.id !== leadId).slice(0, 5),
      base: W.news, boost: topScore(news) * B.relevance, score: 0,
    },
    {
      id: 'top', title: MODULE_TITLE.top, items: posts.filter((p) => p.item.id !== leadId).map((x) => x.item).slice(0, 1),
      base: W.top, boost: cap(ev.top * B.top) + topScore(posts) * B.relevance, score: 0,
      why: ev.top ? 'You save and vote on posts here' : undefined,
    },
    {
      id: 'watch', title: MODULE_TITLE.watch, items: drift.filter((d) => d.item.id !== leadId).map((x) => x.item).slice(0, 4),
      base: W.watch, boost: cap(ev.watch * B.watch) + topScore(drift) * B.relevance, score: 0,
      why: ev.watch ? `You’ve been watching ${board.title} in Drift` : undefined,
    },
    {
      id: 'stories', title: MODULE_TITLE.stories, items: stories.slice(0, 5),
      base: W.stories, boost: stories.some((st) => freshCount(s.changes, { kind: 'story', id: st.id }) > 0) ? B.fresh : 0, score: 0,
    },
    {
      id: 'people', title: MODULE_TITLE.people, items: people,
      base: W.people, boost: cap(people.filter((p) => p.relation !== 'match').length * B.people), score: 0,
      why: people.some((p) => p.relation !== 'match') ? `Because you follow ${people.filter((p) => p.relation !== 'match').map((p) => first(p.personId)).slice(0, 2).join(' and ')}` : undefined,
    },
    {
      id: 'trending', title: MODULE_TITLE.trending, items: trending,
      base: W.trending, boost: (topics[0]?.affinity ?? 0) * B.topic, score: 0,
    },
  ];
  const modules = draft
    .filter((m) => m.items.length > 0)
    .map((m) => ({ ...m, boost: Math.round(m.boost * 10) / 10, score: Math.round((m.base + m.boost) * 10) / 10 }))
    .sort((a, b) => b.score - a.score) as EditionModule[];

  const fresh = freshCount(s.changes, { kind: 'board', id: boardId });
  const edition: Edition = { board, lead, modules, topics, freshCount: fresh };
  if (!editionCache.has(ctx)) editionCache.set(ctx, new Map());
  editionCache.get(ctx)!.set(boardId, edition);
  return edition;
}

/** Graph Debug: forget cached editions (contexts are memoised). */
export function resetEditionCache() {
  editionCache = new WeakMap();
}

// ─── Explore: the rabbit hole ───────────────────────────────────────────────

export type ExploreEntry =
  | { key: string; type: 'post'; item: Post; boardId: string }
  | { key: string; type: 'buzz'; item: BuzzItem; boardId: string }
  | { key: string; type: 'drift'; item: DriftItem; boardId: string }
  | { key: string; type: 'tip'; item: Tip; boardId: string }
  | { key: string; type: 'story'; item: Story; boardId: string }
  | { key: string; type: 'move'; item: Move; boardId: string }
  | { key: string; type: 'photos'; images: string[]; title: string; boardId: string }
  | { key: string; type: 'section'; title: string; boardId: string };

/**
 * Everything in the World, ranked by the same scorers, interleaved so the
 * stream never clumps one format. Then it keeps going into related Worlds
 * (each with a section marker), so Explore is a long-running rabbit hole.
 */
export function buildExplore(ctx: GraphContext, boardId: string): ExploreEntry[] {
  const out: ExploreEntry[] = [];
  const worlds = [boardId, ...(repo.board(boardId)?.relatedBoardIds ?? []).filter((id) => !isNightRef({ kind: 'board', id }))];
  worlds.forEach((wid, wi) => {
    const part = worldStream(ctx, wid, wi === 0);
    if (!part.length) return;
    if (wi > 0) out.push({ key: `sec:${wid}`, type: 'section', title: `More from ${repo.board(wid)?.title ?? 'a related World'}`, boardId: wid });
    out.push(...part);
  });
  return out;
}

function worldStream(ctx: GraphContext, boardId: string, home: boolean): ExploreEntry[] {
  const { s } = ctx;
  const neg = negativeFeedback(ctx);
  const w = repo.world(boardId);
  const lanes: { score: number; e: ExploreEntry }[][] = [
    w.posts.filter((p) => !s.blocked[p.authorId]).map((p) => ({ score: scorePost(ctx, p, neg).score, e: { key: `p:${p.id}`, type: 'post' as const, item: p, boardId } })),
    [...w.buzz, ...w.news].filter((b) => !b.authorId || !s.blocked[b.authorId]).map((b) => ({ score: scoreBuzz(ctx, b, neg).score, e: { key: `b:${b.id}`, type: 'buzz' as const, item: b, boardId } })),
    w.watch.filter((d) => !s.blocked[d.authorId]).map((d) => ({ score: scoreDrift(ctx, d, neg).score, e: { key: `d:${d.id}`, type: 'drift' as const, item: d, boardId } })),
    home ? repo.tipsForBoard(boardId).map((t) => ({ score: 34 + Math.log10(t.helpful + 1) * 3, e: { key: `t:${t.id}`, type: 'tip' as const, item: t, boardId } })) : [],
    w.stories.filter((st) => !isNightRef({ kind: 'story', id: st.id })).map((st) => ({ score: scoreStory(ctx, st).score - 5, e: { key: `s:${st.id}`, type: 'story' as const, item: st, boardId } })),
    w.moves.filter((m) => !isNightRef({ kind: 'move', id: m.id })).map((m) => ({ score: scoreMove(ctx, m).score - 5, e: { key: `m:${m.id}`, type: 'move' as const, item: m, boardId } })),
  ].map((lane) => lane.sort((a, b) => b.score - a.score));

  const photos = [
    ...repo.albumsForBoard(boardId).flatMap((a) => a.images),
    ...w.posts.flatMap((p) => p.images ?? []),
  ];
  // Interleave: take the best head across lanes, but never the same type twice in a row.
  const merged: ExploreEntry[] = [];
  let lastType = '';
  while (lanes.some((l) => l.length)) {
    const candidates = lanes.filter((l) => l.length).sort((a, b) => b[0].score - a[0].score);
    const pick = candidates.find((l) => l[0].e.type !== lastType) ?? candidates[0];
    const next = pick.shift()!;
    merged.push(next.e);
    lastType = next.e.type;
    if (merged.length === 4 && photos.length >= 3) {
      merged.push({ key: `ph:${boardId}`, type: 'photos', images: photos.slice(0, 6), title: `Photos from ${repo.board(boardId)?.title}`, boardId });
      lastType = 'photos';
    }
  }
  return merged;
}
