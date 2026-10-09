/**
 * The REAL account's in-memory world: backend rows mapped to app models,
 * turned into the active Dataset. Optimistic additions (your new Buzz,
 * Drift, Story or World) appear immediately and are replaced on the next
 * full load. Nothing here ever includes a seeded person.
 */
import { WORLD_CATALOG, catalogCover, catalogHero } from '@/data/worldCatalog';
import { getBoardTheme } from '@/theme/boardThemes';
import type { Board, BuzzItem, BuzzReply, DriftItem, ID, Story, User } from '@/types/models';
import { type DatasetParts, makeDataset, setDataset } from '../dataset';
import { inferInterestsFromText } from '@/utils/inferInterests';
import { type ProfileRow, type StoryRow, toStories, toUser } from './mappers';

interface RealState {
  uid: string;
  profile: ProfileRow | null;
  parts: Omit<DatasetParts, 'me'>;
  followerCount: number;
  storyRows: StoryRow[];
  storyMedia: Record<string, string>;
  /** Content has arrived (from the network or this account's cache). */
  loaded: boolean;
}

let st: RealState | null = null;

/** Chimp's public catalog as Boards: used before the first load and if the backend is unreachable. */
export function catalogBoards(): Board[] {
  return WORLD_CATALOG.map((w) => ({
    id: w.id,
    slug: w.id,
    title: w.title,
    tagline: w.tagline,
    type: 'canonical' as const,
    visibility: 'public' as const,
    category: w.category,
    interests: w.interests,
    cover: catalogCover(w),
    hero: catalogHero(w),
    memberCount: 0,
    ideaCount: 0,
    activityVerb: w.verb,
    ownerId: '',
    createdAt: '2026-01-01',
    memberPreview: [],
    themeId: w.themeId,
    theme: getBoardTheme(w.themeId),
    template: 'standard' as const,
    relatedBoardIds: [],
    pulseShape: 'card' as const,
    editorial: 60,
    identityModes: ['public' as const],
  }));
}

export const real = {
  active: () => !!st,
  uid: () => st?.uid ?? null,
  profile: () => st?.profile ?? null,
};

function publish() {
  if (!st) return;
  const p = st.profile;
  // Phase 7B: people fetched on demand (a profile opened by id, a new request) stay
  // known across full reloads, until the reload itself brings them.
  const loadedPeople = st.parts.people ?? [];
  const have = new Set(loadedPeople.map((u) => u.id));
  const extra = [...extraPeople.values()].filter((u) => !have.has(u.id));
  const me = p
    ? toUser(p, { followers: st.followerCount })
    : toUser({ id: st.uid, username: null, display_name: null, avatar_media_id: null, avatar_url: null, avatar_focus_y: 0.3, city: null, bio: null, profile_phrase: null, profile_emoji: null, open_to: [], interests: [], onboarded_at: null });
  setDataset(makeDataset('real', { ...st.parts, people: extra.length ? [...loadedPeople, ...extra] : st.parts.people, me, followerCount: st.followerCount, contentReady: st.loaded }));
}

/** Phase 7B: people loaded on demand, by id (REAL). */
const extraPeople = new Map<string, User>();
export function addPeople(users: User[]) {
  if (!st || !users.length) return;
  let changed = false;
  for (const u of users) {
    if (u.id === st.uid) continue;
    const before = extraPeople.get(u.id) ?? (st.parts.people ?? []).find((x) => x.id === u.id);
    if (before && before.displayName === u.displayName && before.avatar === u.avatar && before.city === u.city && before.bio === u.bio) continue;
    extraPeople.set(u.id, u);
    // A newer copy of someone already loaded replaces the old one.
    if ((st.parts.people ?? []).some((x) => x.id === u.id)) st.parts = { ...st.parts, people: (st.parts.people ?? []).map((x) => (x.id === u.id ? { ...x, ...u } : x)) };
    changed = true;
  }
  if (changed) publish();
}

/** Start (or restart) the REAL world for a signed-in account. */
export function startReal(uid: string, profile: ProfileRow | null) {
  extraPeople.clear();
  st = { uid, profile, parts: { boards: catalogBoards() }, followerCount: 0, storyRows: [], storyMedia: {}, loaded: false };
  publish();
}

/** Phase 6C: a load failed (offline): stop showing "loading" placeholders; show what we have. */
export function markLoaded() {
  if (!st || st.loaded) return;
  st.loaded = true;
  publish();
}

export function stopReal() {
  st = null;
  extraPeople.clear();
}

export function applyLoaded(profile: ProfileRow | null, parts: Omit<DatasetParts, 'me'>, followerCount: number) {
  if (!st) return;
  st.profile = profile ?? st.profile;
  // Chimp's catalog Worlds are always present, even if the seed rows weren't
  // loaded (or a query failed); rows from the database win.
  const loaded = parts.boards ?? [];
  const have = new Set(loaded.map((b) => b.id));
  st.parts = { ...parts, boards: [...catalogBoards().filter((b) => !have.has(b.id)), ...loaded] };
  st.followerCount = followerCount;
  st.storyRows = [];
  st.loaded = true;
  publish();
}

/**
 * Phase 6C: fresh real like totals (everyone's). Stored as "everyone else's"
 * (the UI adds yours), so a like you just tapped is never counted twice.
 */
export function applyLikeTotals(totals: Record<string, number>, mine: (kind: 'buzz' | 'drift', id: string) => boolean) {
  if (!st) return;
  let changed = false;
  const buzz = (st.parts.buzz ?? []).map((b) => {
    const n = Math.max(0, (totals[`buzz:${b.id}`] ?? 0) - (mine('buzz', b.id) ? 1 : 0));
    if (n === b.likeCount) return b;
    changed = true;
    return { ...b, likeCount: n };
  });
  const drift = (st.parts.drift ?? []).map((d) => {
    const n = Math.max(0, (totals[`drift:${d.id}`] ?? 0) - (mine('drift', d.id) ? 1 : 0));
    if (n === d.likeCount) return d;
    changed = true;
    return { ...d, likeCount: n };
  });
  if (!changed) return;
  st.parts = { ...st.parts, buzz, drift };
  publish();
}

/** Phase 6C: change a World in place (e.g. a new cover) — every surface sees it at once. */
export function updateBoard(id: string, patch: Partial<Board>) {
  if (!st) return;
  st.parts = { ...st.parts, boards: (st.parts.boards ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) };
  publish();
}

export function setProfile(profile: ProfileRow) {
  if (!st) return;
  st.profile = profile;
  publish();
}

export function addBuzz(item: BuzzItem) {
  if (!st) return;
  st.parts = { ...st.parts, buzz: [item, ...(st.parts.buzz ?? []).filter((b) => b.id !== item.id)] };
  publish();
}

export function addDrift(item: DriftItem) {
  if (!st) return;
  st.parts = { ...st.parts, drift: [item, ...(st.parts.drift ?? [])] };
  publish();
}

export function addBoard(board: Board) {
  if (!st) return;
  const boards = [...(st.parts.boards ?? []).filter((b) => b.id !== board.id), board];
  // Keep the Board graph: link to the catalog World of its first interest.
  const parent = boards.find((b) => WORLD_CATALOG.some((w) => w.id === b.id && w.interests[0] === board.interests[0]));
  if (parent && !board.relatedBoardIds.includes(parent.id)) {
    board.relatedBoardIds = [...board.relatedBoardIds, parent.id];
    parent.relatedBoardIds = [...parent.relatedBoardIds, board.id];
  }
  st.parts = { ...st.parts, boards };
  publish();
}

export function addStoryRow(row: StoryRow, url: string) {
  if (!st) return;
  st.storyRows = [...st.storyRows, row];
  st.storyMedia = { ...st.storyMedia, [row.media_id]: url };
  const title = (id: string) => (st!.parts.boards ?? []).find((b) => b.id === id)?.title;
  const name = (id: string) => (id === st!.uid ? st!.profile?.display_name ?? 'You' : (st!.parts.people ?? []).find((u) => u.id === id)?.displayName ?? 'Someone');
  const fresh = toStories(st.storyRows, st.storyMedia, title, name);
  const keep = (st.parts.stories ?? []).filter((s) => !fresh.some((f) => f.id === s.id));
  // Merge frames into existing stories with the same owner.
  const merged: Story[] = fresh.map((f) => {
    const old = (st!.parts.stories ?? []).find((s) => s.id === f.id);
    return old ? { ...f, items: [...old.items, ...f.items.filter((i) => !old.items.some((o) => o.id === i.id))] } : f;
  });
  st.parts = { ...st.parts, stories: [...merged, ...keep] };
  publish();
}

/** Phase 9.2: a Story frame you deleted leaves every Story it was in (yours and the World's copy). */
export function removeStoryFrame(frameId: string) {
  if (!st) return;
  st.storyRows = st.storyRows.filter((r) => r.id !== frameId);
  const keep = (itemId: string) => itemId !== frameId && itemId !== `${frameId}_w`;
  st.parts = {
    ...st.parts,
    stories: (st.parts.stories ?? [])
      .map((s) => {
        const items = s.items.filter((i) => keep(i.id));
        return items.length === s.items.length ? s : { ...s, items, cover: items[items.length - 1]?.image ?? s.cover };
      })
      .filter((s) => s.items.length),
  };
  publish();
}

export function addReply(r: BuzzReply) {
  if (!st) return;
  st.parts = {
    ...st.parts,
    buzzReplies: [...(st.parts.buzzReplies ?? []), r],
    buzz: (st.parts.buzz ?? []).map((b) => (b.id === r.buzzId ? { ...b, replyCount: b.replyCount + 1 } : b)),
  };
  publish();
}

/**
 * Phase 6B optimistic replies: swap the temporary reply for the confirmed row
 * (`next`), or remove it (`null`, rollback after a failed send).
 */
export function updateReply(tempId: string, next: BuzzReply | null) {
  if (!st) return;
  const cur = (st.parts.buzzReplies ?? []).find((r) => r.id === tempId);
  if (!cur) return;
  st.parts = {
    ...st.parts,
    buzzReplies: next ? (st.parts.buzzReplies ?? []).map((r) => (r.id === tempId ? next : r)) : (st.parts.buzzReplies ?? []).filter((r) => r.id !== tempId),
    buzz: next ? st.parts.buzz : (st.parts.buzz ?? []).map((b) => (b.id === cur.buzzId ? { ...b, replyCount: Math.max(0, b.replyCount - 1) } : b)),
  };
  publish();
}

// ─── Phase 6D: your edits and deletions, applied everywhere at once ─────────
// The dataset is the one source every surface reads (Buzz tabs, Worlds,
// profiles, Following, Trending, detail), so changing it here changes them all.

export function patchBuzz(id: ID, patch: Partial<BuzzItem>) {
  if (!st) return;
  st.parts = { ...st.parts, buzz: (st.parts.buzz ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) };
  publish();
}

/** A deleted post disappears with its replies (no orphaned cards or counts). */
export function removeBuzz(id: ID) {
  if (!st) return;
  st.parts = {
    ...st.parts,
    buzz: (st.parts.buzz ?? []).filter((b) => b.id !== id),
    buzzReplies: (st.parts.buzzReplies ?? []).filter((r) => r.buzzId !== id),
  };
  publish();
}

export function patchReply(id: ID, patch: Partial<BuzzReply>) {
  if (!st) return;
  st.parts = { ...st.parts, buzzReplies: (st.parts.buzzReplies ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) };
  publish();
}

export function removeReply(id: ID) {
  if (!st) return;
  const cur = (st.parts.buzzReplies ?? []).find((r) => r.id === id);
  if (!cur) return;
  st.parts = {
    ...st.parts,
    buzzReplies: (st.parts.buzzReplies ?? []).filter((r) => r.id !== id),
    buzz: (st.parts.buzz ?? []).map((b) => (b.id === cur.buzzId ? { ...b, replyCount: Math.max(0, b.replyCount - 1) } : b)),
  };
  publish();
}

/**
 * Phase 6D (final): a World was deleted. It leaves every surface at once:
 * Boards, profiles, pickers, the Happening graph (related links), its Drift
 * and Stories. Buzz follows the server rule: posts in a Public World stay as
 * their authors' Just Buzz; posts in a Connections/Private World are gone.
 */
export function removeBoard(id: ID) {
  if (!st) return;
  const b = (st.parts.boards ?? []).find((x) => x.id === id);
  const keepBuzz = b?.visibility === 'public';
  const goneBuzz = new Set(keepBuzz ? [] : (st.parts.buzz ?? []).filter((x) => x.boardId === id).map((x) => x.id));
  st.parts = {
    ...st.parts,
    boards: (st.parts.boards ?? []).filter((x) => x.id !== id).map((x) => (x.relatedBoardIds.includes(id) ? { ...x, relatedBoardIds: x.relatedBoardIds.filter((r) => r !== id) } : x)),
    buzz: (st.parts.buzz ?? [])
      .filter((x) => !goneBuzz.has(x.id))
      .map((x) => (x.boardId === id ? { ...x, boardId: '', interests: inferInterestsFromText([x.title, x.body, x.memeText, x.poll?.question].filter(Boolean).join(' ')) } : x)),
    buzzReplies: (st.parts.buzzReplies ?? []).filter((r) => !goneBuzz.has(r.buzzId)),
    drift: (st.parts.drift ?? []).filter((d) => d.boardId !== id),
    stories: (st.parts.stories ?? [])
      .map((s) => ({ ...s, items: s.items.filter((i) => i.boardId !== id) }))
      .filter((s) => s.items.length > 0 && !(s.owner.kind === 'board' && s.owner.id === id)),
    memberJoins: (st.parts.memberJoins ?? []).filter((m) => m.boardId !== id),
  };
  publish();
}

export function setSparks(ids: ID[]) {
  if (!st) return;
  st.parts = { ...st.parts, sparkCandidates: ids };
  publish();
}
