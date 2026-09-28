/**
 * Repository: the only place the UI reads seed content from.
 *
 * Today it resolves synchronously from local mock data. When a backend
 * arrives (Supabase / Postgres / a graph store), swap these implementations
 * — screens and components call the same functions via hooks.
 */
import type { Board, BuzzItem, DriftItem, EntityRef, ImageSrc, Move, Post, Story, User } from '@/types/models';
import { BOARDS } from '@/data/boards';
import { NIGHT_THREADS } from '@/data/afterDark';
import { ds } from './dataset';

/**
 * Phase 6A: every read goes through the ACTIVE dataset (DEMO fixtures or the
 * REAL account's backend rows + Chimp's World catalog). Screens and the graph
 * engine never import seed data directly.
 */
/** Phase 6C: posts per World (Buzz + World media + Board posts), counted once per dataset. */
const postCounts = new WeakMap<object, Map<string, number>>();
function countPosts(): Map<string, number> {
  const d = ds();
  let m = postCounts.get(d);
  if (!m) {
    m = new Map();
    const bump = (id: string) => id && m!.set(id, (m!.get(id) ?? 0) + 1);
    for (const b of d.buzz) if (b.kind !== 'news') bump(b.boardId);
    for (const x of d.drift) bump(x.boardId);
    for (const p of d.posts) bump(p.boardId);
    postCounts.set(d, m);
  }
  return m;
}

export const repo = {
  mode: () => ds().mode,
  /** Phase 6C: real number of posts in a World (what "0 ideas" used to try to say). */
  boardPostCount: (id: string): number => countPosts().get(id) ?? 0,
  me: (): User => ds().me,
  meId: (): string => ds().me.id,
  isMe: (id: string | undefined) => !!id && id === ds().me.id,
  user: (id: string): User | undefined => ds().users[id],
  people: () => ds().people,

  boards: () => ds().boards,
  board: (id: string): Board | undefined => ds().boardMap[id],
  /**
   * After Dark's shell (theme + atmosphere). In REAL it isn't a backend World
   * yet, so the look comes from the static definition — never its content.
   */
  nightBoard: (id = 'after-dark'): Board => ds().boardMap[id] ?? BOARDS[id] ?? BOARDS['after-dark'],
  /** After Dark threads: the fixture conversations in DEMO, none in REAL (EMPTY IS BETTER THAN FAKE). */
  nightThreads: () => (ds().mode === 'demo' ? NIGHT_THREADS : []),

  postsForBoard: (boardId: string): Post[] => ds().posts.filter((p) => p.boardId === boardId),
  post: (id: string): Post | undefined => ds().posts.find((p) => p.id === id),
  tipsForBoard: (boardId: string) => ds().tips.filter((t) => t.boardId === boardId),
  albumsForBoard: (boardId: string) => ds().albums[boardId] ?? [],
  seedComments: (postId: string) => ds().seedComments.filter((c) => c.postId === postId),

  moves: () => ds().moves,
  move: (id: string): Move | undefined => ds().moveMap[id],
  movesForBoard: (boardId: string) => ds().moves.filter((m) => m.boardId === boardId),

  stories: () => ds().stories,
  story: (id: string): Story | undefined => ds().storyMap[id],
  storiesFor: (ref: EntityRef) => ds().stories.filter((s) => s.owner.kind === ref.kind && s.owner.id === ref.id),

  buzz: () => ds().buzz,
  buzzItem: (id: string): BuzzItem | undefined => ds().buzzMap[id],
  buzzReplies: (id: string) => ds().buzzReplies.filter((r) => r.buzzId === id),
  drift: () => ds().drift,
  driftItem: (id: string): DriftItem | undefined => ds().driftMap[id],

  /**
   * Everything that belongs to one World (Board), for the sections
   * Today / Top Posts / News / Buzz / Watch / Stories / People / Explore.
   */
  world(boardId: string) {
    const d = ds();
    const b = d.boardMap[boardId];
    return {
      board: b,
      posts: d.posts.filter((p) => p.boardId === boardId),
      buzz: d.buzz.filter((x) => x.boardId === boardId && x.kind !== 'news'),
      news: d.buzz.filter((x) => x.boardId === boardId && x.kind === 'news'),
      watch: d.drift.filter((x) => x.boardId === boardId),
      stories: d.stories.filter((s) => (s.owner.kind === 'board' && s.owner.id === boardId) || s.items.some((i) => i.boardId === boardId)),
      moves: d.moves.filter((m) => m.boardId === boardId),
      people: b ? Array.from(new Set([b.ownerId, ...b.memberPreview])).filter((id) => !!d.users[id]) : [],
      explore: b ? b.relatedBoardIds.map((id) => d.boardMap[id]).filter(Boolean) : [],
    };
  },

  personRecs: () => ds().personRecs,
  recFor: (personId: string) => ds().personRecs.find((r) => r.personId === personId),

  /** Human label for any graph node, used in deltas, search and chips. */
  labelFor(ref: EntityRef): string {
    switch (ref.kind) {
      case 'board':
        return ds().boardMap[ref.id]?.title ?? 'Board';
      case 'move':
        return ds().moveMap[ref.id]?.title ?? 'Move';
      case 'person':
        return ds().users[ref.id]?.displayName ?? 'Someone';
      case 'post':
        return ds().posts.find((p) => p.id === ref.id)?.title ?? 'Post';
      case 'story':
        return ds().storyMap[ref.id]?.title ?? 'Story';
      case 'buzz': {
        const b = ds().buzzMap[ref.id];
        return b?.news?.headline ?? b?.title ?? b?.body?.slice(0, 48) ?? 'Buzz';
      }
      case 'drift':
        return ds().driftMap[ref.id]?.caption ?? 'Drift';
      default:
        return '';
    }
  },

  imageFor(ref: EntityRef): ImageSrc | undefined {
    switch (ref.kind) {
      case 'board':
        return ds().boardMap[ref.id]?.cover;
      case 'move':
        return ds().moveMap[ref.id]?.image;
      case 'person':
        return ds().users[ref.id]?.avatar;
      case 'post': {
        const p = ds().posts.find((x) => x.id === ref.id);
        return p?.images?.[0] ?? p?.place?.image ?? (p ? ds().boardMap[p.boardId]?.cover : undefined);
      }
      case 'story':
        return ds().storyMap[ref.id]?.cover;
      case 'buzz': {
        const b = ds().buzzMap[ref.id];
        return b?.image ?? b?.images?.[0] ?? (b ? ds().boardMap[b.boardId]?.cover : undefined);
      }
      case 'drift':
        return ds().driftMap[ref.id]?.image;
      default:
        return undefined;
    }
  },
};
