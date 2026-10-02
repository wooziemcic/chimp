/**
 * REAL content (Phase 6A): load what a signed-in account can see, create
 * new content, and mirror graph actions (join, save, reactions, votes,
 * replies, Crushes, follows) to Postgres. Every record is generic and
 * shared-ready for Phase 6B (other real people see public content now).
 */
import { mediaUrl, supabase } from '@/lib/supabase';
import { backendError } from './errors';
import { WORLD_CATALOG } from '@/data/worldCatalog';
import type { BoardTheme, BuzzItem, CategoryId, DriftItem, ID, OpenTo } from '@/types/models';
import {
  type BoardRow,
  type BuzzRow,
  type MediaAspects,
  type MediaVideos,
  toReply,
  type CommentRow,
  type DriftRow,
  type ProfileRow,
  type StoryRow,
  toBoard,
  toBuzz,
  toDrift,
  toStories,
  toUser,
} from './mappers';
import type { DatasetParts } from '../dataset';
import type { UploadedMedia, UploadedVideo } from './media';

const sb = () => supabase();

/** PostgREST: the function isn't on this project (migration not applied yet). */
export const missingFunction = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '');

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw backendError(res.error, what);
  return res.data as T;
}

const chunk = <T>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ─── Profiles ───────────────────────────────────────────────────────────────

export async function fetchMyProfile(uid: string): Promise<ProfileRow | null> {
  const res = await sb().from('profiles').select('*').eq('id', uid).maybeSingle();
  return must(res, 'Loading your profile') as ProfileRow | null;
}

export interface ProfilePatch {
  username?: string;
  display_name?: string;
  avatar_media_id?: string | null;
  avatar_url?: string | null;
  avatar_focus_y?: number;
  city?: string;
  bio?: string;
  profile_phrase?: string;
  profile_emoji?: string;
  open_to?: OpenTo[];
  interests?: string[];
  onboarded_at?: string;
}

export async function saveProfile(uid: string, patch: ProfilePatch): Promise<ProfileRow> {
  const res = await sb()
    .from('profiles')
    .upsert({ id: uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select('*')
    .single();
  if (res.error?.code === '23505') throw new Error('That username is taken. Try another.');
  return must(res, 'Saving your profile') as ProfileRow;
}

export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export async function usernameAvailable(name: string, uid: string): Promise<boolean> {
  const res = await sb().from('profiles').select('id').eq('username', name.toLowerCase()).limit(1);
  const rows = must(res, 'Checking username') as { id: string }[];
  return rows.length === 0 || rows[0].id === uid;
}

// ─── Load everything this account can see ───────────────────────────────────

export interface MyState {
  joined: ID[];
  saved: ID[];
  reactions: { kind: 'like' | 'dislike' | 'save' | 'repost'; target_kind: string; target_id: string }[];
  votes: Record<ID, ID>;
  crushes: ID[];
  sparks: ID[];
  following: ID[];
  /** Phase 6B: real, mutual connections and pending requests either way. */
  connected: ID[];
  requestedByMe: ID[];
  requestedOfMe: ID[];
  /** People I blocked (stored server-side so blocks also stop messages). */
  blocked: ID[];
  /** Phase 6D: Worlds I follow (not membership) and Worlds I asked to join. */
  followedBoards: ID[];
  requestedBoards: ID[];
}

export interface RealWorld {
  profile: ProfileRow | null;
  parts: Omit<DatasetParts, 'me'>;
  mine: MyState;
  followerCount: number;
  replies: CommentRow[];
}

/**
 * Phase 6C: everything the account can see, as plain rows (JSON-safe, so the
 * last load can be cached per account and shown instantly at the next launch).
 */
export interface RealRaw {
  v: 2;
  uid: string;
  at: number;
  profile: ProfileRow | null;
  boards: BoardRow[];
  members: { board_id: string; user_id: string; joined_at?: string; role?: 'owner' | 'admin' | 'member' }[];
  saves: { board_id: string }[];
  buzz: BuzzRow[];
  drift: DriftRow[];
  stories: StoryRow[];
  reactions: MyState['reactions'];
  myVotes: { buzz_id: string; option_id: string }[];
  crushes: { to_id: string }[];
  sparks: string[];
  follows: { followee_id: string }[];
  followerCount: number;
  conns: { user_a: string; user_b: string; requested_by: string; status: 'requested' | 'connected' }[];
  blocks: { blocked_id: string }[];
  media: MediaRow[];
  people: ProfileRow[];
  votes: { buzz_id: string; option_id: string; user_id: string }[];
  replies: CommentRow[];
  /** Real LIKE totals (everyone's, incl. mine) keyed "buzz:id" / "drift:id". */
  likes: Record<string, number>;
  /** Phase 6D (0004; empty before it's run): Worlds I follow, join requests I can see, follower totals. */
  boardFollows?: { board_id: string }[];
  joinRequests?: { board_id: string; user_id: string }[];
  boardFollowers?: Record<string, number>;
}

interface MediaRow {
  id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  kind?: 'image' | 'video';
  poster_path?: string | null;
  duration_ms?: number | null;
}

/** Aggregate like totals (0003_phase6c.sql). Without that migration: none, never a guess. */
async function likeCounts(kind: 'buzz' | 'drift', ids: string[]): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const res = await sb().rpc('reaction_counts', { p_target_kind: kind, p_ids: ids });
  if (res.error) {
    if (__DEV__) console.warn('[chimp:load] like counts unavailable (run 0003_phase6c.sql?):', res.error.message);
    return null;
  }
  for (const r of (res.data ?? []) as { target_id: string; likes: number }[]) out[`${kind}:${r.target_id}`] = Number(r.likes) || 0;
  return out;
}

/** Phase 6D tables are optional until 0004 is run: an error means "none yet", never a failed load. */
function optional<T>(res: { data: T | null; error: { message: string } | null }, what: string): T | [] {
  if (res.error) {
    if (__DEV__) console.warn(`[chimp:load] ${what} unavailable (run 0004_phase6d.sql?):`, res.error.message);
    return [];
  }
  return (res.data ?? []) as T;
}

async function followerTotals(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const rows = optional(await sb().rpc('board_counts', { ids }), 'World follower counts') as { board_id: string; followers: number }[];
  for (const r of rows) out[r.board_id] = Number(r.followers) || 0;
  return out;
}

/**
 * Fetch in two parallel waves (Phase 6C; was ~6 sequential round trips):
 *   1. every table the account can see
 *   2. what those rows reference: media, people, poll votes, replies, like totals
 */
export async function fetchRealRaw(uid: string): Promise<RealRaw> {
  const [profile, boards, members, saves, buzz, drift, stories, reactions, myVotes, crushes, sparks, follows, followers, conns, blocks, boardFollows, joinRequests] = await Promise.all([
    fetchMyProfile(uid),
    sb().from('boards').select('*').order('created_at', { ascending: true }).limit(1000),
    sb().from('board_memberships').select('board_id,user_id,joined_at,role').limit(5000),
    sb().from('board_saves').select('board_id').eq('user_id', uid),
    sb().from('buzz_items').select('*').order('created_at', { ascending: false }).limit(300),
    sb().from('drift_items').select('*').order('created_at', { ascending: false }).limit(300),
    sb().from('story_items').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(300),
    sb().from('reactions').select('kind,target_kind,target_id').eq('user_id', uid),
    sb().from('poll_votes').select('buzz_id,option_id').eq('user_id', uid),
    sb().from('crushes').select('to_id').eq('from_id', uid),
    sb().rpc('my_sparks'),
    sb().from('follows').select('followee_id').eq('follower_id', uid),
    sb().from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', uid),
    // Phase 6B: my connections (either side of the pair) and my blocks.
    sb().from('connections').select('user_a,user_b,requested_by,status'),
    sb().from('blocks').select('blocked_id').eq('blocker_id', uid),
    // Phase 6D: Worlds I follow; join requests (mine, and to Worlds I run).
    sb().from('board_follows').select('board_id').eq('user_id', uid),
    sb().from('board_join_requests').select('board_id,user_id').limit(2000),
  ]);
  const requestRows = optional(joinRequests, 'Join requests') as { board_id: string; user_id: string }[];
  const boardRows = must(boards, 'Loading Worlds') as BoardRow[];
  const connRows = must(conns, 'Loading connections') as RealRaw['conns'];
  const other = (c: { user_a: string; user_b: string }) => (c.user_a === uid ? c.user_b : c.user_a);
  const memberRows = must(members, 'Loading members') as RealRaw['members'];
  const buzzRows = must(buzz, 'Loading Buzz') as BuzzRow[];
  const driftRows = must(drift, 'Loading Drift') as DriftRow[];
  const storyRows = must(stories, 'Loading Stories') as StoryRow[];

  const mediaIds = [...new Set([...buzzRows.flatMap((b) => b.media_ids), ...driftRows.flatMap((d) => d.media_ids), ...storyRows.map((st) => st.media_id)])];
  // Real people who appear in what you can see (never seeded ones).
  const authorIds = [...new Set([...buzzRows.map((b) => b.author_id), ...driftRows.map((d) => d.author_id), ...storyRows.map((st) => st.author_id), ...memberRows.map((m) => m.user_id), ...connRows.map(other), ...requestRows.map((r) => r.user_id)])].filter((id) => id !== uid);
  const buzzIds = buzzRows.map((b) => b.id);

  const [mediaChunks, peopleChunks, voteChunks, replyChunks, buzzLikes, driftLikes, boardFollowers] = await Promise.all([
    Promise.all(chunk(mediaIds).map(async (ids) => must(await sb().from('media').select('*').in('id', ids), 'Loading media') as MediaRow[])),
    Promise.all(chunk(authorIds).map(async (ids) => must(await sb().from('profiles').select('*').in('id', ids), 'Loading people') as ProfileRow[])),
    Promise.all(chunk(buzzIds).map(async (ids) => must(await sb().from('poll_votes').select('buzz_id,option_id,user_id').in('buzz_id', ids), 'Loading votes') as RealRaw['votes'])),
    Promise.all(chunk(buzzIds).map(async (ids) => must(await sb().from('comments').select('*').eq('target_kind', 'buzz').in('target_id', ids).order('created_at'), 'Loading replies') as CommentRow[])),
    likeCounts('buzz', buzzIds),
    likeCounts('drift', driftRows.map((d) => d.id)),
    followerTotals(boardRows.map((b) => b.id)),
  ]);

  return {
    v: 2,
    uid,
    at: Date.now(),
    profile,
    boards: boardRows,
    members: memberRows,
    saves: must(saves, 'Loading saves') as { board_id: string }[],
    buzz: buzzRows,
    drift: driftRows,
    stories: storyRows,
    reactions: must(reactions, 'Loading reactions') as MyState['reactions'],
    myVotes: must(myVotes, 'Loading votes') as RealRaw['myVotes'],
    crushes: must(crushes, 'Loading Crushes') as { to_id: string }[],
    sparks: (must(sparks, 'Loading Sparks') as string[] | null) ?? [],
    follows: must(follows, 'Loading follows') as { followee_id: string }[],
    followerCount: followers.count ?? 0,
    conns: connRows,
    blocks: must(blocks, 'Loading blocks') as { blocked_id: string }[],
    media: mediaChunks.flat(),
    people: peopleChunks.flat(),
    votes: voteChunks.flat(),
    replies: replyChunks.flat(),
    likes: { ...(buzzLikes ?? {}), ...(driftLikes ?? {}) },
    boardFollows: optional(boardFollows, 'World follows') as { board_id: string }[],
    joinRequests: requestRows,
    boardFollowers,
  };
}

/** Rows → the app's types. Pure (used for both a fresh load and the cached one). */
export function mapRealWorld(raw: RealRaw): RealWorld {
  const { uid, profile } = raw;
  const other = (c: { user_a: string; user_b: string }) => (c.user_a === uid ? c.user_b : c.user_a);
  const media: Record<string, string> = {};
  const aspects: MediaAspects = {};
  const videos: MediaVideos = {};
  for (const r of raw.media) {
    media[r.id] = mediaUrl(r.storage_path);
    if (r.width && r.height) aspects[r.id] = r.width / r.height;
    if (r.kind === 'video') videos[r.id] = { poster: r.poster_path ? mediaUrl(r.poster_path) : undefined, durationMs: r.duration_ms ?? undefined };
  }
  const membersBy = new Map<string, string[]>();
  for (const m of raw.members) membersBy.set(m.board_id, [...(membersBy.get(m.board_id) ?? []), m.user_id]);
  const boardsMapped = raw.boards.map((r) => {
    const b = toBoard(r, membersBy.get(r.id) ?? [], (membersBy.get(r.id) ?? []).length);
    // Phase 6D: roles, followers (not members), and requests for Worlds you run.
    b.roles = Object.fromEntries(raw.members.filter((m) => m.board_id === r.id && m.role).map((m) => [m.user_id, m.role!]));
    b.followerCount = raw.boardFollowers?.[r.id] ?? 0;
    b.requests = (raw.joinRequests ?? []).filter((q) => q.board_id === r.id && q.user_id !== uid).map((q) => q.user_id);
    return b;
  });
  // Your Worlds sit next to the catalog World of their first interest (the Board graph).
  for (const b of boardsMapped) {
    if (WORLD_CATALOG.some((w) => w.id === b.id)) continue;
    const parent = WORLD_CATALOG.find((w) => w.interests[0] === b.interests[0]);
    if (parent) {
      b.relatedBoardIds = [parent.id];
      boardsMapped.find((x) => x.id === parent.id)?.relatedBoardIds.push(b.id);
    }
  }

  // likeCount = everyone else's likes; the card and ranking add your own (s.buzzLikes) on top.
  const mine = (kind: string, target: string) => new Set(raw.reactions.filter((x) => x.kind === kind && x.target_kind === target).map((x) => x.target_id));
  const myBuzzLikes = mine('like', 'buzz');
  const myDriftLikes = mine('like', 'drift');
  const repliesBy = new Map<string, number>();
  for (const c of raw.replies) repliesBy.set(c.target_id, (repliesBy.get(c.target_id) ?? 0) + 1);
  const buzzMapped = raw.buzz.map((r) => {
    const item = toBuzz(r, media, aspects, videos);
    if (item.poll) item.poll.options = item.poll.options.map((o) => ({ ...o, votes: raw.votes.filter((v) => v.buzz_id === r.id && v.option_id === o.id).length }));
    item.replyCount = repliesBy.get(r.id) ?? 0;
    item.likeCount = Math.max(0, (raw.likes[`buzz:${r.id}`] ?? 0) - (myBuzzLikes.has(r.id) ? 1 : 0));
    return item;
  });
  const driftMapped = raw.drift.map((r) => {
    const d = toDrift(r, media);
    d.likeCount = Math.max(0, (raw.likes[`drift:${r.id}`] ?? 0) - (myDriftLikes.has(r.id) ? 1 : 0));
    return d;
  });
  const otherVotes: Record<ID, Record<ID, ID>> = {};
  for (const v of raw.votes) if (v.user_id !== uid) (otherVotes[v.buzz_id] ??= {})[v.user_id] = v.option_id;

  const users = raw.people.map((p) => toUser(p));
  const boardTitle = (id: string) => boardsMapped.find((b) => b.id === id)?.title;
  const userName = (id: string) => (id === uid ? profile?.display_name ?? 'You' : users.find((u) => u.id === id)?.displayName ?? 'Someone');

  return {
    profile,
    followerCount: raw.followerCount,
    replies: raw.replies,
    parts: {
      people: users,
      boards: boardsMapped,
      buzz: buzzMapped,
      buzzReplies: raw.replies.map((c) => toReply(c)),
      drift: driftMapped,
      stories: toStories(raw.stories, media, boardTitle, userName),
      sparkCandidates: raw.sparks,
      otherVotes,
      memberJoins: raw.members.filter((m) => m.joined_at).map((m) => ({ boardId: m.board_id, userId: m.user_id, at: Date.parse(m.joined_at!) })),
    },
    mine: {
      joined: raw.members.filter((m) => m.user_id === uid).map((m) => m.board_id),
      saved: raw.saves.map((x) => x.board_id),
      reactions: raw.reactions,
      votes: Object.fromEntries(raw.myVotes.map((v) => [v.buzz_id, v.option_id])),
      crushes: raw.crushes.map((c) => c.to_id),
      sparks: raw.sparks,
      following: raw.follows.map((f) => f.followee_id),
      connected: raw.conns.filter((c) => c.status === 'connected').map(other),
      requestedByMe: raw.conns.filter((c) => c.status === 'requested' && c.requested_by === uid).map(other),
      requestedOfMe: raw.conns.filter((c) => c.status === 'requested' && c.requested_by !== uid).map(other),
      blocked: raw.blocks.map((b) => b.blocked_id),
      followedBoards: (raw.boardFollows ?? []).map((f) => f.board_id),
      requestedBoards: (raw.joinRequests ?? []).filter((q) => q.user_id === uid).map((q) => q.board_id),
    },
  };
}

export async function loadRealWorld(uid: string): Promise<RealWorld & { raw: RealRaw }> {
  const raw = await fetchRealRaw(uid);
  return { ...mapRealWorld(raw), raw };
}

/** Phase 6C: refresh only the real like totals (Trending stays honest without a full reload). */
export async function fetchLikeTotals(buzzIds: string[], driftIds: string[]): Promise<Record<string, number> | null> {
  const [a, b] = await Promise.all([likeCounts('buzz', buzzIds), likeCounts('drift', driftIds)]);
  if (!a || !b) return null;
  return { ...a, ...b };
}

// ─── Creation ───────────────────────────────────────────────────────────────

export interface NewBuzz {
  kind: BuzzItem['kind'];
  /** Phase 6B: optional. null/'' = "Just Buzz" (no World). */
  boardId?: string | null;
  body?: string;
  title?: string;
  memeText?: string;
  poll?: { question: string; options: string[] };
  /** Phase 6C: a UUID chosen on the phone, so retrying a post never duplicates it. */
  clientId?: string;
}

export async function createBuzz(uid: string, input: NewBuzz, media: (UploadedMedia | UploadedVideo)[]): Promise<BuzzItem> {
  const poll = input.poll ? { question: input.poll.question.trim(), options: input.poll.options.map((label, i) => ({ id: `o${i + 1}`, label: label.trim() })) } : null;
  const insert = sb()
    .from('buzz_items')
    .insert({
      // Phase 6C: a client-chosen id makes a retried post idempotent (a lost response can't post twice).
      ...(input.clientId ? { id: input.clientId } : {}),
      author_id: uid,
      board_id: input.boardId || null,
      kind: input.kind,
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
      meme_text: input.memeText?.trim() || null,
      poll,
      media_ids: media.map((m) => m.id),
    })
    .select('*')
    .single();
  let res = await insert;
  if (res.error?.code === '23505' && input.clientId) res = await sb().from('buzz_items').select('*').eq('id', input.clientId).single();
  const row = must(res, 'Posting to Buzz') as BuzzRow;
  const videos = Object.fromEntries(media.filter((m): m is UploadedVideo => 'bytes' in m && m.mimeType.startsWith('video/')).map((m) => [m.id, { poster: m.posterUrl, durationMs: m.durationMs }]));
  return toBuzz(row, Object.fromEntries(media.map((m) => [m.id, m.url])), Object.fromEntries(media.filter((m) => m.width && m.height).map((m) => [m.id, m.width / m.height])), videos);
}

export async function createDrift(uid: string, boardId: string, caption: string, media: UploadedMedia[]): Promise<DriftItem> {
  const row = must(
    await sb()
      .from('drift_items')
      .insert({ author_id: uid, board_id: boardId, kind: media.length > 1 ? 'carousel' : 'photo', caption: caption.trim() || null, media_ids: media.map((m) => m.id) })
      .select('*')
      .single(),
    'Posting to Drift',
  ) as DriftRow;
  return toDrift(row, Object.fromEntries(media.map((m) => [m.id, m.url])));
}

export async function createStoryItem(uid: string, boardId: string | null, caption: string, media: UploadedMedia): Promise<StoryRow> {
  return must(
    await sb().from('story_items').insert({ author_id: uid, board_id: boardId, media_id: media.id, caption: caption.trim() || null }).select('*').single(),
    'Posting your Story',
  ) as StoryRow;
}

export interface NewWorld {
  title: string;
  tagline: string;
  category: CategoryId;
  interests: string[];
  themeId: BoardTheme['id'] | string;
  visibility: 'public' | 'connections' | 'private';
}

const slugify = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'world';

/**
 * Creates the World. Phase 6D: the server sets the owner and creator from
 * your session (owner_id = auth.uid(), whatever is sent) and adds your owner
 * membership itself. Cover is uploaded after (it lives under boards/{id}/).
 */
export async function createWorld(uid: string, input: NewWorld): Promise<BoardRow> {
  const id = `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const row = must(
    await sb()
      .from('boards')
      .insert({
        id,
        slug: `${slugify(input.title)}-${id.slice(-4)}`,
        title: input.title.trim(),
        tagline: input.tagline.trim() || null,
        category: input.category,
        interests: input.interests,
        theme_id: input.themeId,
        verb: 'planning',
        visibility: input.visibility,
        type: input.visibility === 'private' ? 'private' : 'user_created',
        owner_id: uid,
      })
      .select('*')
      .single(),
    'Creating your World',
  ) as BoardRow;
  return row;
}

/**
 * One canonical cover per World: cover_url (cards, pickers, graph) and hero_url
 * (the World's hero) always point at the same uploaded image. Owner-only
 * (RLS "boards update"); returns false when nothing was updated.
 */
export async function setWorldCover(boardId: string, media: UploadedMedia): Promise<boolean> {
  const res = await sb().from('boards').update({ cover_url: media.url, hero_url: media.url, cover_media_id: media.id }).eq('id', boardId).select('id');
  return (must(res, 'Saving the cover') as { id: string }[]).length > 0;
}

/** Best-effort removal of a World's previous cover file (only files inside boards/{boardId}/). */
export async function removeOldCover(boardId: string, oldUrl: string | undefined): Promise<void> {
  const marker = `/object/public/media/boards/${boardId}/`;
  if (!oldUrl || !oldUrl.includes(marker)) return;
  const path = `boards/${boardId}/${oldUrl.split(marker)[1].split('?')[0]}`;
  await sb().storage.from('media').remove([path]).catch(() => undefined);
  await sb().from('media').delete().eq('storage_path', path).then(
    () => undefined,
    () => undefined,
  );
}

// ─── Graph actions mirrored to Postgres (optimistic in the app) ─────────────

export const sync = {
  async membership(uid: string, boardId: string, on: boolean) {
    if (on) must(await sb().from('board_memberships').upsert({ board_id: boardId, user_id: uid, role: 'member' }, { onConflict: 'board_id,user_id', ignoreDuplicates: true }), 'Joining');
    else must(await sb().from('board_memberships').delete().eq('board_id', boardId).eq('user_id', uid).neq('role', 'owner'), 'Leaving');
  },
  /** Phase 6D: 'member' (already in) · 'joined' (open catalog World) · 'requested' (waits for the owner). */
  async requestToJoin(boardId: string): Promise<'member' | 'joined' | 'requested'> {
    return must(await sb().rpc('request_to_join', { bid: boardId }), 'Joining') as 'member' | 'joined' | 'requested';
  },
  async cancelJoinRequest(uid: string, boardId: string) {
    must(await sb().from('board_join_requests').delete().match({ board_id: boardId, user_id: uid }), 'Cancelling request');
  },
  async leaveBoard(boardId: string) {
    must(await sb().rpc('leave_board', { bid: boardId }), 'Leaving');
  },
  async boardFollow(uid: string, boardId: string, on: boolean) {
    if (on) must(await sb().from('board_follows').upsert({ board_id: boardId, user_id: uid }, { onConflict: 'board_id,user_id', ignoreDuplicates: true }), 'Following World');
    else must(await sb().from('board_follows').delete().match({ board_id: boardId, user_id: uid }), 'Unfollowing World');
  },
  /** Owner/admin: approve or decline a request; add a connection; remove; change a role. */
  async respondJoin(boardId: string, who: string, accept: boolean) {
    must(await sb().rpc('respond_join_request', { bid: boardId, requester: who, accept }), accept ? 'Approving' : 'Declining');
  },
  async addMember(boardId: string, who: string) {
    must(await sb().rpc('add_board_member', { bid: boardId, who }), 'Adding');
  },
  async removeMember(boardId: string, who: string) {
    must(await sb().rpc('remove_board_member', { bid: boardId, who }), 'Removing');
  },
  async setRole(boardId: string, who: string, role: 'admin' | 'member') {
    must(await sb().rpc('set_board_role', { bid: boardId, who, new_role: role }), 'Changing role');
  },
  async boardSave(uid: string, boardId: string, on: boolean) {
    if (on) must(await sb().from('board_saves').upsert({ board_id: boardId, user_id: uid }, { onConflict: 'board_id,user_id', ignoreDuplicates: true }), 'Saving');
    else must(await sb().from('board_saves').delete().eq('board_id', boardId).eq('user_id', uid), 'Unsaving');
  },
  async reaction(uid: string, targetKind: 'buzz' | 'drift' | 'post' | 'story', targetId: string, kind: 'like' | 'dislike' | 'save' | 'repost', on: boolean) {
    if (on) must(await sb().from('reactions').upsert({ user_id: uid, target_kind: targetKind, target_id: targetId, kind }, { onConflict: 'user_id,target_kind,target_id,kind', ignoreDuplicates: true }), 'Saving reaction');
    else must(await sb().from('reactions').delete().match({ user_id: uid, target_kind: targetKind, target_id: targetId, kind }), 'Removing reaction');
  },
  async vote(uid: string, buzzId: string, optionId: string | null) {
    if (optionId) must(await sb().from('poll_votes').upsert({ buzz_id: buzzId, user_id: uid, option_id: optionId }, { onConflict: 'buzz_id,user_id' }), 'Voting');
    else must(await sb().from('poll_votes').delete().match({ buzz_id: buzzId, user_id: uid }), 'Removing vote');
  },
  async comment(uid: string, targetKind: 'buzz' | 'drift' | 'post' | 'story', targetId: string, body: string): Promise<CommentRow> {
    return must(await sb().from('comments').insert({ author_id: uid, target_kind: targetKind, target_id: targetId, body: body.trim() }).select('*').single(), 'Posting reply') as CommentRow;
  },
  /**
   * Phase 7C: an explicit, idempotent intent (set_crush, 0009): a repeat tap
   * changes nothing and the answer is the server's state. Falls back to the
   * pre-0009 table write when the function isn't on the project yet.
   */
  async crush(uid: string, toId: string, on: boolean): Promise<string[]> {
    const r = await sb().rpc('set_crush', { p_other: toId, p_on: on });
    if (r.error && missingFunction(r.error)) {
      if (on) must(await sb().from('crushes').upsert({ from_id: uid, to_id: toId }, { onConflict: 'from_id,to_id', ignoreDuplicates: true }), 'Saving Crush');
      else must(await sb().from('crushes').delete().match({ from_id: uid, to_id: toId }), 'Removing Crush');
    } else must(r, on ? 'Saving Crush' : 'Removing Crush');
    return ((must(await sb().rpc('my_sparks'), 'Checking Sparks') as string[] | null) ?? []);
  },
  /**
   * Phase 6B: connect is mutual for real. `on` = request, or accept if they
   * already asked (→ 'connected'); `off` = cancel / decline / disconnect.
   */
  async connectRequest(_uid: string, personId: string, on: boolean): Promise<'none' | 'requested' | 'connected'> {
    return must(await sb().rpc('request_connection', { other: personId, on_: on }), on ? 'Connecting' : 'Updating connection') as 'none' | 'requested' | 'connected';
  },
  async block(uid: string, personId: string, on: boolean) {
    if (on) must(await sb().from('blocks').upsert({ blocker_id: uid, blocked_id: personId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }), 'Blocking');
    else must(await sb().from('blocks').delete().match({ blocker_id: uid, blocked_id: personId }), 'Unblocking');
  },
  /** Phase 7C: set_follow (0009) — idempotent; returns whether you follow them now. */
  async follow(uid: string, personId: string, on: boolean): Promise<boolean> {
    const r = await sb().rpc('set_follow', { p_other: personId, p_on: on });
    if (!r.error) return !!r.data;
    if (!missingFunction(r.error)) must(r, on ? 'Following' : 'Unfollowing');
    if (on) must(await sb().from('follows').upsert({ follower_id: uid, followee_id: personId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }), 'Following');
    else must(await sb().from('follows').delete().match({ follower_id: uid, followee_id: personId }), 'Unfollowing');
    return on;
  },
};

export type CommentTarget = 'buzz' | 'drift' | 'post' | 'story';

export async function fetchComments(targetKind: CommentTarget, targetId: string): Promise<CommentRow[]> {
  return must(await sb().from('comments').select('*').eq('target_kind', targetKind).eq('target_id', targetId).order('created_at'), 'Loading comments') as CommentRow[];
}

/** Names + avatars for people who aren't in the loaded world yet (e.g. commenters). */
export async function fetchPeople(ids: string[]): Promise<ProfileRow[]> {
  const out: ProfileRow[] = [];
  for (const part of chunk([...new Set(ids)])) out.push(...(must(await sb().from('profiles').select('*').in('id', part), 'Loading people') as ProfileRow[]));
  return out;
}

// ─── Phase 6D: edit & delete your own words (server-enforced) ───────────────
//
// Postgres decides: only the author, edits only within 1 hour of the server's
// created_at, deletes any time. The app just asks. The server's refusals are
// written for people ("Posts can be edited for 1 hour…"), so they're shown as-is.

function said<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw backendError(res.error, what);
  return res.data as T;
}

export async function editBuzz(id: string, body: string, boardId: string): Promise<BuzzRow> {
  return said(await sb().rpc('edit_buzz', { p_id: id, p_body: body, p_board_id: boardId }), 'Saving your edit') as BuzzRow;
}

/**
 * Delete one of your Buzz posts everywhere (its replies, likes and saves go
 * with it). The server returns the Storage files no other post uses; they
 * are removed here, with your own session (Storage only lets owners delete).
 */
export async function deleteBuzz(id: string): Promise<void> {
  const paths = (said(await sb().rpc('delete_buzz', { p_id: id }), 'Deleting post') as string[] | null) ?? [];
  if (paths.length) await sb().storage.from('media').remove(paths).catch(() => undefined);
}

export async function editComment(id: string, body: string): Promise<CommentRow> {
  return said(await sb().rpc('edit_comment', { p_id: id, p_body: body }), 'Saving your edit') as CommentRow;
}

export async function deleteComment(id: string): Promise<void> {
  said(await sb().rpc('delete_comment', { p_id: id }), 'Deleting reply');
}

// ─── Phase 6D (final): delete a World you own ───────────────────────────────

/**
 * Delete one of your Worlds. The delete-world Edge Function runs
 * delete_world() AS YOU (the database refuses anyone but the owner), then
 * removes the World's files from Storage. Throws, changing nothing, if the
 * server didn't delete it.
 */
export async function deleteWorld(boardId: string): Promise<void> {
  const { data, error } = await sb().functions.invoke('delete-world', { body: { boardId } });
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') detail = ((await ctx.json()) as { error?: string }).error ?? detail;
    } catch {
      /* keep the generic message */
    }
    if (/not found|404|failed to send/i.test(detail)) detail = 'Deleting Worlds isn’t set up on the server yet (the delete-world function). Nothing was deleted.';
    throw new Error(detail);
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  if (!r.ok) throw new Error(r.error ?? 'The World wasn’t deleted. Try again.');
}

/**
 * Is this World still there for you? false only when the server positively
 * says no (deleted, or you lost access); a network problem counts as "yes",
 * so an offline phone never hides a World by mistake.
 */
export async function worldStillExists(boardId: string): Promise<boolean> {
  const res = await sb().from('boards').select('id').eq('id', boardId).maybeSingle();
  if (res.error) return true;
  return !!res.data;
}
