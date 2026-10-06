/**
 * Row ⇄ app-model mapping for the REAL backend. The UI and graph keep using
 * the same Board / BuzzItem / DriftItem / Story / User shapes in both modes.
 */
import { CATALOG_BY_ID, WORLD_CATALOG, catalogCover, catalogHero } from '@/data/worldCatalog';
import { getBoardTheme } from '@/theme/boardThemes';
import { inferInterestsFromText } from '@/utils/inferInterests';
import type { Board, BuzzItem, BuzzReply, CategoryId, DriftItem, ID, OpenTo, Story, StoryItem, User } from '@/types/models';

// ─── Rows (as returned by PostgREST) ────────────────────────────────────────

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_media_id: string | null;
  avatar_url: string | null;
  avatar_focus_y: number | null;
  city: string | null;
  bio: string | null;
  profile_phrase: string | null;
  profile_emoji: string | null;
  open_to: string[] | null;
  interests: string[] | null;
  onboarded_at: string | null;
  created_at?: string;
}

export interface BoardRow {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  category: string;
  interests: string[];
  cover_url: string | null;
  hero_url: string | null;
  theme_id: string;
  verb: string;
  visibility: 'public' | 'connections' | 'private';
  type: Board['type'];
  owner_id: string | null;
  created_at: string;
  /** Phase 6D (0004): provenance. */
  creator_id?: string | null;
  creator_name?: string | null;
}

export interface MediaRow {
  id: string;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
}

export interface BuzzRow {
  id: string;
  author_id: string;
  board_id: string | null;
  kind: 'post' | 'note' | 'photo' | 'meme' | 'poll' | 'video';
  title: string | null;
  body: string | null;
  media_ids: string[];
  meme_text: string | null;
  poll: { question: string; options: { id: string; label: string }[] } | null;
  created_at: string;
  /** Phase 6D (0004). */
  edited_at?: string | null;
}

export interface DriftRow {
  id: string;
  author_id: string;
  board_id: string;
  kind: 'photo' | 'carousel' | 'video';
  caption: string | null;
  media_ids: string[];
  created_at: string;
}

export interface StoryRow {
  id: string;
  author_id: string;
  board_id: string | null;
  media_id: string;
  caption: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  author_id: string;
  target_kind: 'buzz' | 'drift' | 'post' | 'story';
  target_id: string;
  body: string;
  created_at: string;
  /** Phase 6D (0004). */
  edited_at?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const ageHours = (iso: string, now = Date.now()) => Math.max(0, (now - Date.parse(iso)) / 3_600_000);

/** "now", "12m", "3h", "2d", "5w". */
export function ageLabel(iso: string, now = Date.now()): string {
  const m = (now - Date.parse(iso)) / 60_000;
  if (m < 1) return 'now';
  if (m < 60) return `${Math.floor(m)}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  if (m < 60 * 24 * 7) return `${Math.floor(m / 1440)}d`;
  return `${Math.floor(m / 10080)}w`;
}

const CATEGORIES: CategoryId[] = ['travel', 'culture', 'style', 'founders', 'afterDark'];
const asCategory = (c: string): CategoryId => (CATEGORIES.includes(c as CategoryId) && c !== 'afterDark' ? (c as CategoryId) : 'culture');

// ─── Mappers ────────────────────────────────────────────────────────────────

/** Moments for the You hero: the Worlds of your strongest interests (never fake photos). */
function momentsFor(interests: ID[]) {
  return interests
    .map((i) => WORLD_CATALOG.find((w) => w.interests[0] === i))
    .filter((w): w is (typeof WORLD_CATALOG)[number] => !!w)
    .map((w) => ({ id: `m_${w.id}`, label: w.title, image: catalogCover(w), ref: { kind: 'board' as const, id: w.id } }));
}

export function toUser(p: ProfileRow, extra?: { followers?: number; following?: number; interests?: ID[] }): User {
  return {
    id: p.id,
    username: p.username ?? 'new',
    displayName: p.display_name ?? p.username ?? 'New to Chimp',
    avatar: p.avatar_url ?? undefined,
    heroImage: p.avatar_url ?? undefined,
    heroCutout: false,
    city: p.city ?? '',
    bio: p.bio ?? '',
    interests: extra?.interests ?? p.interests ?? [],
    followers: extra?.followers ?? 0,
    following: extra?.following ?? 0,
    knownFor: [],
    openTo: (p.open_to ?? []) as OpenTo[],
    moments: momentsFor(extra?.interests ?? p.interests ?? []),
    profilePhrase: p.profile_phrase ?? undefined,
    profileEmoji: p.profile_emoji ?? undefined,
    avatarFocusY: p.avatar_focus_y ?? 0.3,
    real: true,
  };
}

export function toBoard(r: BoardRow, members: ID[], memberCount: number): Board {
  const cat = CATALOG_BY_ID[r.id];
  const cover = r.cover_url ?? (cat ? catalogCover(cat) : '');
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    tagline: r.tagline ?? '',
    type: r.type,
    visibility: r.visibility === 'private' || r.visibility === 'connections' ? r.visibility : 'public',
    category: asCategory(r.category),
    interests: r.interests,
    cover,
    hero: r.hero_url ?? (cat ? catalogHero(cat) : cover),
    // Honest numbers: real members only.
    memberCount,
    ideaCount: 0,
    activityVerb: r.verb,
    ownerId: r.owner_id ?? '',
    createdAt: r.created_at,
    creatorId: r.creator_id ?? undefined,
    creatorName: r.creator_name ?? undefined,
    memberPreview: members.slice(0, 5),
    themeId: r.theme_id,
    theme: getBoardTheme(r.theme_id),
    template: 'standard',
    relatedBoardIds: [],
    pulseShape: 'card',
    editorial: cat ? 60 : 50,
    identityModes: ['public'],
  };
}

/** Media id → width/height, when the media row has dimensions. */
export type MediaAspects = Record<string, number>;
/** Phase 6C: video media by id (poster URL, duration). */
export type MediaVideos = Record<string, { poster?: string; durationMs?: number }>;

export function toBuzz(r: BuzzRow, media: Record<string, string>, aspects: MediaAspects = {}, videos: MediaVideos = {}): BuzzItem {
  const ids = r.media_ids.filter((id) => media[id]);
  const urls = ids.map((id) => media[id]);
  // Phase 6C: a video Buzz carries its clip; `image` becomes the poster frame.
  const vid = ids.find((id) => videos[id]);
  const video = vid ? { url: media[vid], poster: videos[vid].poster, durationMs: videos[vid].durationMs, aspect: aspects[vid], mediaId: vid } : undefined;
  const text = [r.title, r.body, r.meme_text, r.poll?.question].filter(Boolean).join(' ');
  return {
    id: r.id,
    kind: video ? 'video' : r.kind,
    // Phase 6B: '' = "Just Buzz" (no World). Its interests come from its words.
    boardId: r.board_id ?? '',
    interests: r.board_id ? undefined : inferInterestsFromText(text),
    imageAspects: video ? (video.aspect ? [video.aspect] : undefined) : ids.length && ids.every((id) => aspects[id]) ? ids.map((id) => aspects[id]) : undefined,
    video,
    authorId: r.author_id,
    title: r.title ?? undefined,
    body: r.body ?? undefined,
    image: video ? video.poster : urls[0],
    images: !video && urls.length > 1 ? urls : undefined,
    memeText: r.meme_text ?? undefined,
    poll: r.poll ? { question: r.poll.question, options: r.poll.options.map((o) => ({ ...o, votes: 0 })) } : undefined,
    createdAt: ageLabel(r.created_at),
    ageHours: ageHours(r.created_at),
    createdAtMs: Date.parse(r.created_at),
    editedAtMs: r.edited_at ? Date.parse(r.edited_at) : undefined,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    layout: video || r.kind === 'note' || r.kind === 'photo' || r.kind === 'poll' ? 'full' : 'half',
  };
}

export function toDrift(r: DriftRow, media: Record<string, string>): DriftItem {
  const urls = r.media_ids.map((id) => media[id]).filter(Boolean);
  return {
    id: r.id,
    kind: urls.length > 1 ? 'carousel' : r.kind === 'video' ? 'video' : 'photo',
    boardId: r.board_id,
    authorId: r.author_id,
    image: urls[0] ?? '',
    images: urls.length > 1 ? urls : undefined,
    caption: r.caption ?? '',
    likeCount: 0,
    createdAt: ageLabel(r.created_at),
    ageHours: ageHours(r.created_at),
    createdAtMs: Date.parse(r.created_at),
  };
}

/**
 * Story frames → Stories. Your own frames and each person's become one
 * "person" story; frames shared into a World also form that World's story.
 * Ownership is always real (never seeded).
 */
export function toStories(rows: StoryRow[], media: Record<string, string>, boardTitle: (id: string) => string | undefined, userName: (id: string) => string): Story[] {
  const byOwner = new Map<string, { owner: Story['owner']; items: StoryItem[]; lane: Story['lane'] }>();
  const push = (key: string, owner: Story['owner'], lane: Story['lane'], item: StoryItem) => {
    const cur = byOwner.get(key) ?? { owner, items: [], lane };
    cur.items.push(item);
    byOwner.set(key, cur);
  };
  for (const r of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const image = media[r.media_id];
    if (!image) continue;
    const base = { authorId: r.author_id, image, caption: r.caption ?? '', createdAt: ageLabel(r.created_at), createdAtMs: Date.parse(r.created_at), durationMs: 5000, boardId: r.board_id ?? undefined };
    push(`p:${r.author_id}`, { kind: 'person', id: r.author_id }, 'friend', { ...base, id: `${r.id}`, storyId: `st_p_${r.author_id}` });
    if (r.board_id) push(`b:${r.board_id}`, { kind: 'board', id: r.board_id }, 'trending', { ...base, id: `${r.id}_w`, storyId: `st_b_${r.board_id}` });
  }
  return [...byOwner.entries()].map(([key, v]) => {
    const id = key.startsWith('p:') ? `st_p_${v.owner.id}` : `st_b_${v.owner.id}`;
    return {
      id,
      owner: v.owner,
      title: v.owner.kind === 'board' ? boardTitle(v.owner.id) ?? 'World' : userName(v.owner.id),
      cover: v.items[v.items.length - 1].image,
      lane: v.lane,
      items: v.items.map((i) => ({ ...i, storyId: id })),
    };
  });
}

/** A `comments` row on a Buzz → a reply (exact time kept for "Just now" / "5m" / "Yesterday"). */
export function toReply(c: CommentRow): BuzzReply {
  return { id: c.id, buzzId: c.target_id, authorId: c.author_id, body: c.body, createdAt: c.created_at, createdAtMs: Date.parse(c.created_at), editedAtMs: c.edited_at ? Date.parse(c.edited_at) : undefined };
}
