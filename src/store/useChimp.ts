/**
 * Chimp local state — the user's private graph on device.
 *
 * Persisted with AsyncStorage. Every mutating action:
 *   1. updates the relationship flags the screens read,
 *   2. nudges interest affinity (0..1, rules in graph/config.ts) and logs an
 *      ActivityEvent with the exact change,
 *   3. diffs the graph before/after and queues World Delta reactions that
 *      are released the next time the user comes back.
 * The graph itself (graph/graph.ts) is derived from this state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { SEED_JOINED, SEED_SAVED_BOARDS } from '@/data/boards';
import { seedChanges } from '@/data/changes';
import { SEED_OPEN_LOOPS, SUGGESTED_LOOPS } from '@/data/graph';
import { ME } from '@/data/users';
import { WORLD_CATALOG } from '@/data/worldCatalog';
import { type Baseline, takeBaseline } from '@/graph/agent';
import { detectReactions, mergeQueue, releaseChanges } from '@/graph/changes';
import { AFFINITY, RELEASE } from '@/graph/config';
import type { GraphState } from '@/graph/graph';
import { inferInterests } from '@/graph/loops';
import { getContext } from '@/graph/relevance';
import { freshCount, freshFor, touches, unseenChanges } from '@/graph/touch';
import { repo } from '@/services/repository';
import { type DemoCreations, isRealMode } from '@/services/dataset';
import { sync } from '@/services/backend/content';
import { toReply } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import type {
  ActivityEvent,
  Board,
  BuzzReply,
  ActivityType,
  ChangeEvent,
  ChatMessage,
  Comment,
  Connection,
  EntityRef,
  IdentityMode,
  MoveState,
  OpenLoop,
  OpenTo,
} from '@/types/models';

type Flags = Record<string, true>;

/** Phase 3 demo start: Maya and Kenji are not followed yet (see README "Demo path"). */
export const SEED_FOLLOWING = ['u_alex', 'u_priya', 'u_sofia', 'u_lena', 'u_nia', 'u_hana'];
export const SEED_CONNECTIONS = ['u_alex', 'u_priya', 'u_sofia'];
/** Connections that exist but are not modelled individually in the prototype. */
export const CONNECTIONS_BASE = 134;

/** How long you need to be away before the world visibly moves on. */
export const AWAY_THRESHOLD_MS = RELEASE.awayThresholdMs;

const toFlags = (ids: string[]): Flags => Object.fromEntries(ids.map((id) => [id, true as const]));
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface ProfileEdits {
  /** A photo picked on device (DEMO) or your uploaded avatar URL (REAL). */
  avatarUri?: string;
  bio: string;
  city: string;
  openTo: OpenTo[];
  // Phase 6A (REAL accounts mirror their backend profile here)
  displayName?: string;
  username?: string;
  phrase?: string;
  emoji?: string;
  /** 0 = top … 1 = bottom focal point for the hero photo. */
  focusY?: number;
}

export interface ChimpState extends Omit<GraphState, 'openTo'> {
  hydrated: boolean;
  profile: ProfileEdits;

  seenStoryItems: Flags;

  /** Queued reactions to your actions, released when you come back. */
  pendingChanges: ChangeEvent[];
  /** Keys of changes already released (never repeat one). */
  firedKeys: Flags;
  lastVisitAt: number;
  /** Snapshot at the start of a session, for "what changed". */
  baseline?: Baseline;

  /** Identity mode per context (board id or 'default'). */
  identity: Record<string, IdentityMode>;
  afterDark: { ageConfirmed: boolean; browseAnonymously: boolean };

  /** Buzz poll votes and your replies. */
  buzzVotes: Record<string, string>;
  buzzReplies: Record<string, BuzzReply[]>;

  /** DEMO only: things you created while testing (kept local, never uploaded). */
  created: DemoCreations;
  /** REAL: connection requests you've sent (they become connections when accepted, 6B). */
  connectRequests: Flags;
  /** Phase 6B (REAL): people who asked to connect with you ("Accept" on their profile). */
  incomingConnects: Flags;
  /** Phase 6D: Worlds you follow (see their activity; not membership). */
  followedBoards: Flags;
  /** Phase 6D (REAL): Worlds you asked to join, waiting for the owner. */
  joinRequested: Flags;

  // ── actions ──
  track: (type: ActivityType, ref: EntityRef) => void;
  /**
   * Join / leave. Phase 6D (REAL): Chimp's open Worlds are joined at once; a
   * person's World is a request its owner approves (tap again to cancel);
   * the owner can't leave their own World.
   */
  toggleJoin: (boardId: string) => void;
  /** Phase 6D: follow a World without joining it. */
  toggleFollowBoard: (boardId: string) => void;
  toggleSaveBoard: (boardId: string) => void;
  toggleLike: (postId: string) => void;
  toggleSavePost: (postId: string) => void;
  vote: (postId: string, optionId: string) => void;
  toggleMove: (moveId: string, key: keyof MoveState) => void;
  toggleFollow: (userId: string) => void;
  toggleConnect: (userId: string) => void;
  toggleBlock: (userId: string) => void;
  markStoryItemSeen: (itemId: string, storyId: string) => void;
  markSeen: (ref: EntityRef) => void;
  markChangeSeen: (changeId: string) => void;
  markAllChangesSeen: () => void;
  /** On resume. `awayOverrideMs` lets Graph Debug simulate time away. */
  advanceWorld: (now: number, awayOverrideMs?: number) => void;
  noteLeaving: (now: number) => void;
  markBaseline: () => void;
  openLoop: (loopId: string) => void;
  addLoop: (title: string) => void;
  resolveLoop: (loopId: string) => void;
  reopenLoop: (loopId: string) => void;
  dismissLoop: (loopId: string) => void;
  /** Back-compat: resolved ↔ active. */
  toggleLoop: (loopId: string) => void;
  setIdentity: (context: string, mode: IdentityMode) => void;
  confirmAge: () => void;
  setBrowseAnonymously: (value: boolean) => void;
  /** Phase 6B: resolves with the confirmed comment (REAL: the Supabase row); rejects with a readable error. */
  addComment: (postId: string, body: string, mode: IdentityMode) => Promise<Comment | null>;
  sendMessage: (threadId: string, body: string) => void;
  receiveMessage: (threadId: string, body: string) => void;
  updateProfile: (edits: Partial<ProfileEdits>) => void;
  toggleOpenTo: (value: OpenTo) => void;
  // Phase 4 surfaces
  toggleBuzzLike: (id: string) => void;
  /** "Show me less like this". Private, never counted publicly. */
  toggleBuzzDislike: (id: string) => void;
  toggleBuzzSave: (id: string) => void;
  toggleBuzzRepost: (id: string) => void;
  voteBuzz: (id: string, optionId: string) => void;
  /**
   * Phase 6B: optimistic. The reply shows (and counts) immediately; REAL then
   * confirms it with Supabase. On failure it's rolled back and this rejects
   * with a readable error (the caller restores the text).
   */
  addBuzzReply: (id: string, body: string) => Promise<void>;
  toggleDriftLike: (id: string) => void;
  toggleDriftSave: (id: string) => void;
  toggleDriftDislike: (id: string) => void;
  /** Private Crush. Never sends anything; mutual → Spark. */
  toggleCrush: (userId: string) => void;
  /** DEMO: keep something you created locally. */
  addCreated: <K extends keyof DemoCreations>(kind: K, item: DemoCreations[K][number]) => void;
  /** Phase 6C (Demo): change a World you created (e.g. its cover). */
  updateCreatedBoard: (id: string, patch: Partial<Board>) => void;
  // Phase 5
  /** Watching a Drift item (viewer). Nudges affinity once per item. */
  watchDrift: (id: string) => void;
  /** Opening a World. Nudges affinity once per World. */
  visitBoard: (boardId: string) => void;
  /** Open a Happening branch (deterministic expansion). */
  exploreBranch: (nodeId: string, ref: EntityRef) => void;
  collapseBranch: () => void;
  resetDemo: () => void;
}

function initialData(now = Date.now()) {
  return {
    profile: { avatarUri: undefined, bio: ME.bio, city: ME.city, openTo: ME.openTo ?? [] } as ProfileEdits,
    joined: toFlags(SEED_JOINED),
    savedBoards: toFlags(SEED_SAVED_BOARDS),
    likedPosts: {} as Flags,
    savedPosts: {} as Flags,
    pollVotes: {} as Record<string, string>,
    moveState: { mv_boston_meetup: { interested: true } } as Record<string, MoveState>,
    following: toFlags(SEED_FOLLOWING),
    connections: Object.fromEntries(
      SEED_CONNECTIONS.map((id) => [id, { userId: id, status: 'connected', since: '2025-11-01' } as Connection]),
    ) as Record<string, Connection>,
    blocked: {} as Flags,
    seenStoryItems: {} as Flags,
    changes: seedChanges(now),
    pendingChanges: [] as ChangeEvent[],
    firedKeys: {} as Flags,
    // The seed changes ARE "since you left"; nothing extra releases on first launch.
    lastVisitAt: now,
    baseline: undefined as Baseline | undefined,
    openLoops: SEED_OPEN_LOOPS,
    affinity: { ...AFFINITY.seed } as Record<string, number>,
    activity: [] as ActivityEvent[],
    identity: { default: 'public', 'after-dark': 'pseudonymous' } as Record<string, IdentityMode>,
    afterDark: { ageConfirmed: false, browseAnonymously: false },
    comments: {} as Record<string, Comment[]>,
    chats: {} as Record<string, ChatMessage[]>,
    ...surfaceData(),
    ...livingData(),
    created: emptyCreations(),
    connectRequests: {} as Flags,
    incomingConnects: {} as Flags,
    followedBoards: {} as Flags,
    joinRequested: {} as Flags,
  };
}

export const emptyCreations = (): DemoCreations => ({ boards: [], buzz: [], drift: [], stories: [] });

/**
 * A REAL account's honest starting point: nothing joined, followed or
 * connected; no seeded loops, Moves or World Delta; affinity only from the
 * interests YOU chose in onboarding (never WollyMc's).
 */
export function realInitialData(profile: Partial<ProfileEdits> & { interests?: string[] }, now = Date.now()) {
  const affinity: Record<string, number> = {};
  for (const i of profile.interests ?? []) {
    affinity[i] = Math.max(affinity[i] ?? 0, AFFINITY.onboarding);
    for (const j of WORLD_CATALOG.find((w) => w.interests[0] === i)?.interests.slice(1) ?? []) affinity[j] = Math.max(affinity[j] ?? 0, AFFINITY.onboardingSecondary);
  }
  return {
    ...initialData(now),
    profile: { avatarUri: profile.avatarUri, bio: profile.bio ?? '', city: profile.city ?? '', openTo: profile.openTo ?? [], displayName: profile.displayName, username: profile.username, phrase: profile.phrase, emoji: profile.emoji, focusY: profile.focusY },
    joined: {} as Flags,
    savedBoards: {} as Flags,
    moveState: {} as Record<string, MoveState>,
    following: {} as Flags,
    connections: {} as Record<string, Connection>,
    changes: [] as ChangeEvent[],
    openLoops: [] as OpenLoop[],
    affinity,
    identity: { default: 'public' } as Record<string, IdentityMode>,
  };
}

/** Fire-and-forget backend write for REAL accounts (the UI is already optimistic). */
/** Comment keys: a board post id, or `drift:<id>` for a Drift item. */
export function commentTarget(key: string): { kind: 'post' | 'drift'; id: string } {
  return key.startsWith('drift:') ? { kind: 'drift', id: key.slice(6) } : { kind: 'post', id: key };
}

function backend(label: string, run: (uid: string) => Promise<unknown>) {
  if (!isRealMode()) return;
  const uid = realData.real.uid();
  if (!uid) return;
  run(uid).catch((e: unknown) => console.warn(`[chimp] ${label} didn’t sync:`, e instanceof Error ? e.message : e));
}

/** Phase 4 state, also used by the v4 migration. */
function surfaceData() {
  return {
    buzzLikes: {} as Flags,
    buzzDislikes: {} as Flags,
    buzzSaves: {} as Flags,
    buzzReposts: {} as Flags,
    buzzVotes: {} as Record<string, string>,
    buzzReplies: {} as Record<string, BuzzReply[]>,
    driftLikes: {} as Flags,
    driftSaves: {} as Flags,
    driftDislikes: {} as Flags,
    crushes: {} as Flags,
  };
}

/** Phase 5 state, also used by the v5 migration. */
function livingData() {
  return {
    driftViews: {} as Flags,
    boardVisits: {} as Flags,
    exploredNodes: {} as Flags,
    happeningFocus: null as string | null,
  };
}

/** Phase 4 Open To vocabulary: old values map to the new ones. */
const OPEN_TO_MIGRATION: Record<string, OpenTo> = { collaborators: 'collaboration', professional: 'networking' };
function migrateOpenTo(list: string[] | undefined): OpenTo[] {
  return Array.from(new Set((list ?? []).map((o) => (OPEN_TO_MIGRATION[o] ?? o) as OpenTo)));
}

const toggleFlag = (flags: Flags, id: string): [Flags, boolean] => {
  const next = { ...flags };
  if (next[id]) {
    delete next[id];
    return [next, false];
  }
  next[id] = true;
  return [next, true];
};

/** The graph's view of the store (same field references, so contexts memoise). */
export function graphStateOf(s: ChimpState): GraphState {
  return {
    affinity: s.affinity,
    joined: s.joined,
    savedBoards: s.savedBoards,
    savedPosts: s.savedPosts,
    likedPosts: s.likedPosts,
    pollVotes: s.pollVotes,
    moveState: s.moveState,
    following: s.following,
    connections: s.connections,
    blocked: s.blocked,
    openLoops: s.openLoops,
    changes: s.changes,
    activity: s.activity,
    chats: s.chats,
    comments: s.comments,
    openTo: s.profile.openTo,
    buzzLikes: s.buzzLikes,
    buzzDislikes: s.buzzDislikes,
    buzzSaves: s.buzzSaves,
    buzzReposts: s.buzzReposts,
    driftLikes: s.driftLikes,
    driftSaves: s.driftSaves,
    driftDislikes: s.driftDislikes,
    crushes: s.crushes,
    buzzVotes: s.buzzVotes,
    driftViews: s.driftViews,
    boardVisits: s.boardVisits,
    exploredNodes: s.exploredNodes,
    happeningFocus: s.happeningFocus,
  };
}

function interestsOf(ref: EntityRef, loops: OpenLoop[]): string[] {
  switch (ref.kind) {
    case 'board':
      return repo.board(ref.id)?.interests ?? [];
    case 'move':
      return repo.move(ref.id)?.interests ?? [];
    case 'person':
      return repo.user(ref.id)?.interests ?? [];
    case 'post': {
      const p = repo.post(ref.id);
      return p ? repo.board(p.boardId)?.interests ?? [] : [];
    }
    case 'story': {
      const s = repo.story(ref.id);
      return s ? interestsOf(s.owner, loops) : [];
    }
    case 'loop':
      return (loops.find((l) => l.id === ref.id) ?? SUGGESTED_LOOPS.find((l) => l.id === ref.id))?.interests ?? [];
    case 'interest':
      return [ref.id];
    case 'buzz': {
      const b = repo.buzzItem(ref.id);
      return b ? [...new Set([...(repo.board(b.boardId)?.interests ?? []), ...(b.interests ?? [])])] : [];
    }
    case 'drift': {
      const d = repo.driftItem(ref.id);
      return d ? [...new Set([...(d.interests ?? []), ...(repo.board(d.boardId)?.interests ?? [])])] : [];
    }
    default:
      return [];
  }
}

export const useChimp = create<ChimpState>()(
  persist(
    (set, get) => {
      /**
       * Wraps a mutation: diff the graph before/after and queue reactions.
       * Contexts are memoised, so this is two cheap graph builds per action.
       */
      const act = (mutate: () => void) => {
        const before = getContext(graphStateOf(get()));
        mutate();
        const after = getContext(graphStateOf(get()));
        const st = get();
        const reactions = detectReactions(before, after, Date.now(), st.firedKeys, st.pendingChanges, st.baseline?.matches ?? {});
        if (reactions.length) set({ pendingChanges: mergeQueue(st.pendingChanges, reactions) });
      };

      return {
        hydrated: false,
        ...initialData(),

        track: (type, ref) => {
          const w = AFFINITY.rules[type] ?? 0;
          const affinity = { ...get().affinity };
          const delta: Record<string, number> = {};
          if (w !== 0) {
            interestsOf(ref, get().openLoops).forEach((i, idx) => {
              const factor = idx < AFFINITY.primaryInterests ? 1 : AFFINITY.secondaryFactor;
              const prev = affinity[i] ?? 0;
              const next = Math.round(Math.max(AFFINITY.min, Math.min(AFFINITY.max, prev + w * factor)) * 1000) / 1000;
              if (next !== prev) {
                affinity[i] = next;
                delta[i] = Math.round((next - prev) * 1000) / 1000;
              }
            });
          }
          const event: ActivityEvent = { id: uid(), type, ref, at: Date.now(), ...(Object.keys(delta).length ? { affinity: delta } : {}) };
          set({ affinity, activity: [event, ...get().activity].slice(0, 300) });
        },

        toggleJoin: (boardId) =>
          act(() => {
            const board = repo.board(boardId);
            if (isRealMode() && board) {
              if (repo.isMe(board.ownerId)) return; // your own World: you're its owner
              const was = { joined: get().joined, joinRequested: get().joinRequested };
              const rollback = (e: unknown) => {
                set(was);
                console.warn('[chimp] Join didn’t sync:', e instanceof Error ? e.message : e);
              };
              if (was.joined[boardId]) {
                set({ joined: toggleFlag(was.joined, boardId)[0] });
                get().track('leave', { kind: 'board', id: boardId });
                void sync.leaveBoard(boardId).catch(rollback);
              } else if (was.joinRequested[boardId]) {
                set({ joinRequested: toggleFlag(was.joinRequested, boardId)[0] });
                const u = realData.real.uid();
                if (u) void sync.cancelJoinRequest(u, boardId).catch(rollback);
              } else if (!board.ownerId) {
                set({ joined: { ...was.joined, [boardId]: true } });
                get().track('join', { kind: 'board', id: boardId });
                void sync.requestToJoin(boardId).catch(rollback);
              } else {
                set({ joinRequested: { ...was.joinRequested, [boardId]: true } });
                void sync
                  .requestToJoin(boardId)
                  .then((r) => {
                    if (r === 'member' || r === 'joined') set({ joined: { ...get().joined, [boardId]: true }, joinRequested: toggleFlag(get().joinRequested, boardId)[0] });
                  })
                  .catch(rollback);
              }
              return;
            }
            const [joined, on] = toggleFlag(get().joined, boardId);
            set({ joined });
            get().track(on ? 'join' : 'leave', { kind: 'board', id: boardId });
            // Only real Worlds have membership rows (After Dark's shell isn't one yet).
            if (repo.board(boardId)) backend('Join', (u) => sync.membership(u, boardId, on));
          }),

        toggleFollowBoard: (boardId) =>
          act(() => {
            const [followedBoards, on] = toggleFlag(get().followedBoards ?? {}, boardId);
            set({ followedBoards });
            get().track(on ? 'follow' : 'unfollow', { kind: 'board', id: boardId });
            backend('Follow World', (u) => sync.boardFollow(u, boardId, on));
          }),

        toggleSaveBoard: (boardId) =>
          act(() => {
            const [savedBoards, on] = toggleFlag(get().savedBoards, boardId);
            set({ savedBoards });
            get().track(on ? 'save' : 'unsave', { kind: 'board', id: boardId });
            backend('Save World', (u) => sync.boardSave(u, boardId, on));
          }),

        toggleLike: (postId) =>
          act(() => {
            const [likedPosts, on] = toggleFlag(get().likedPosts, postId);
            set({ likedPosts });
            get().track(on ? 'like' : 'unlike', { kind: 'post', id: postId });
          }),

        toggleSavePost: (postId) =>
          act(() => {
            const [savedPosts, on] = toggleFlag(get().savedPosts, postId);
            set({ savedPosts });
            get().track(on ? 'save' : 'unsave', { kind: 'post', id: postId });
          }),

        vote: (postId, optionId) =>
          act(() => {
            const prev = get().pollVotes[postId];
            const pollVotes = { ...get().pollVotes };
            if (prev === optionId) delete pollVotes[postId];
            else pollVotes[postId] = optionId;
            set({ pollVotes });
            if (!prev) get().track('vote', { kind: 'post', id: postId });
          }),

        toggleMove: (moveId, key) =>
          act(() => {
            const cur = get().moveState[moveId] ?? {};
            const nextVal = !cur[key];
            const next: MoveState = { ...cur, [key]: nextVal };
            // RSVP implies interest.
            if (key === 'rsvp' && nextVal) next.interested = true;
            set({ moveState: { ...get().moveState, [moveId]: next } });
            const type: ActivityType =
              key === 'rsvp'
                ? nextVal
                  ? 'rsvp'
                  : 'unrsvp'
                : key === 'saved'
                  ? nextVal
                    ? 'save'
                    : 'unsave'
                  : nextVal
                    ? 'interested'
                    : 'uninterested';
            get().track(type, { kind: 'move', id: moveId });
          }),

        toggleFollow: (userId) =>
          act(() => {
            // Phase 6D: you can't follow yourself (the database refuses it too).
            if (repo.isMe(userId)) return;
            const [following, on] = toggleFlag(get().following, userId);
            set({ following });
            get().track(on ? 'follow' : 'unfollow', { kind: 'person', id: userId });
            backend('Follow', (u) => sync.follow(u, userId, on));
          }),

        toggleConnect: (userId) =>
          act(() => {
            if (isRealMode()) {
              // REAL (Phase 6B): connecting is mutual. Tapping Connect requests it — or
              // accepts it when they already asked. Tapping again cancels / disconnects.
              const s0 = get();
              const wasConnected = !!s0.connections[userId];
              const on = !wasConnected && !s0.connectRequests?.[userId];
              const incoming = !!s0.incomingConnects?.[userId];
              const connectRequests = { ...(s0.connectRequests ?? {}) };
              const incomingConnects = { ...(s0.incomingConnects ?? {}) };
              const connections = { ...s0.connections };
              // Optimistic
              if (on && incoming) {
                connections[userId] = { userId, status: 'connected', since: new Date().toISOString() };
                delete incomingConnects[userId];
              } else if (on) connectRequests[userId] = true;
              else {
                delete connectRequests[userId];
                delete connections[userId];
              }
              set({ connectRequests, incomingConnects, connections });
              if (on && incoming) get().track('connect', { kind: 'person', id: userId });
              backend('Connect', async (u) => {
                const status = await sync.connectRequest(u, userId, on);
                // Reconcile with what the server decided (e.g. they had asked meanwhile).
                const st = get();
                const cr = { ...(st.connectRequests ?? {}) };
                const ic = { ...(st.incomingConnects ?? {}) };
                const cx = { ...st.connections };
                delete cr[userId];
                delete ic[userId];
                delete cx[userId];
                if (status === 'connected') cx[userId] = { userId, status: 'connected', since: new Date().toISOString() };
                else if (status === 'requested') cr[userId] = true;
                set({ connectRequests: cr, incomingConnects: ic, connections: cx });
              });
              return;
            }
            const connections = { ...get().connections };
            const on = !connections[userId];
            if (on) connections[userId] = { userId, status: 'connected', since: new Date().toISOString() };
            else delete connections[userId];
            set({ connections });
            get().track(on ? 'connect' : 'disconnect', { kind: 'person', id: userId });
          }),

        toggleBlock: (userId) =>
          act(() => {
            const [blocked, on] = toggleFlag(get().blocked, userId);
            if (on) {
              // Blocking ends following and connection, and hides them everywhere.
              const following = { ...get().following };
              const connections = { ...get().connections };
              delete following[userId];
              delete connections[userId];
              const changes = get().changes.map((c) => (touches(c, { kind: 'person', id: userId }) ? { ...c, seen: true } : c));
              set({ blocked, following, connections, changes });
              get().track('block', { kind: 'person', id: userId });
            } else {
              set({ blocked });
            }
            // REAL (Phase 6B): the block is stored server-side, so it also stops messages both ways.
            backend('Block', async (u) => {
              await sync.block(u, userId, on);
              if (on) {
                await sync.follow(u, userId, false).catch(() => {});
                await sync.connectRequest(u, userId, false).catch(() => {});
              }
            });
          }),

        markStoryItemSeen: (itemId, storyId) => {
          if (get().seenStoryItems[itemId]) return;
          act(() => {
            // Watching a Story clears changes about that Story (its blue dot).
            const changes = get().changes.some((c) => !c.seen && c.ref.kind === 'story' && c.ref.id === storyId)
              ? get().changes.map((c) => (!c.seen && c.ref.kind === 'story' && c.ref.id === storyId ? { ...c, seen: true } : c))
              : get().changes;
            set({ seenStoryItems: { ...get().seenStoryItems, [itemId]: true }, changes });
            get().track('storyView', { kind: 'story', id: storyId });
          });
        },

        markSeen: (ref) =>
          act(() => {
            let changed = false;
            const changes = get().changes.map((c) => {
              if (!c.seen && touches(c, ref)) {
                changed = true;
                return { ...c, seen: true };
              }
              return c;
            });
            if (changed) set({ changes });
            get().track('open', ref);
          }),

        markChangeSeen: (changeId) => set({ changes: get().changes.map((c) => (c.id === changeId ? { ...c, seen: true } : c)) }),

        markAllChangesSeen: () => set({ changes: get().changes.map((c) => (c.seen ? c : { ...c, seen: true })) }),

        advanceWorld: (now, awayOverrideMs) => {
          const st = get();
          const away = awayOverrideMs ?? now - st.lastVisitAt;
          const ctx = getContext(graphStateOf(st));
          if (away < RELEASE.awayThresholdMs) {
            if (!st.baseline) set({ baseline: takeBaseline(ctx, now) });
            return;
          }
          const r = releaseChanges(ctx, st.pendingChanges, st.firedKeys, now, away);
          set({
            changes: [...r.released, ...st.changes].slice(0, RELEASE.maxStored),
            pendingChanges: r.pending,
            firedKeys: r.fired,
            lastVisitAt: now,
          });
          // A new session starts: "what changed" is measured from here.
          set({ baseline: takeBaseline(getContext(graphStateOf(get())), now) });
        },

        noteLeaving: (now) => set({ lastVisitAt: now }),

        markBaseline: () => set({ baseline: takeBaseline(getContext(graphStateOf(get())), Date.now()) }),

        openLoop: (loopId) => {
          const tpl = SUGGESTED_LOOPS.find((l) => l.id === loopId);
          const existing = get().openLoops.find((l) => l.id === loopId);
          if (existing) {
            if (existing.status !== 'active' && existing.status !== 'progress') get().reopenLoop(loopId);
            return;
          }
          if (!tpl) return;
          act(() => {
            const loop: OpenLoop = { ...tpl, status: 'active', createdAt: new Date().toISOString() };
            set({ openLoops: [loop, ...get().openLoops] });
            get().track('openLoop', { kind: 'loop', id: loopId });
          });
        },

        addLoop: (title) =>
          act(() => {
            const loop: OpenLoop = {
              id: `lp_${uid()}`,
              title: title.trim(),
              icon: 'sparkles',
              status: 'active',
              origin: 'user',
              interests: inferInterests(title),
              createdAt: new Date().toISOString(),
              related: [],
            };
            set({ openLoops: [loop, ...get().openLoops] });
            get().track('openLoop', { kind: 'loop', id: loop.id });
          }),

        resolveLoop: (loopId) =>
          act(() => {
            set({ openLoops: get().openLoops.map((l) => (l.id === loopId ? { ...l, status: 'resolved' } : l)) });
            get().track('resolveLoop', { kind: 'loop', id: loopId });
          }),

        reopenLoop: (loopId) =>
          act(() => {
            set({ openLoops: get().openLoops.map((l) => (l.id === loopId ? { ...l, status: 'active' } : l)) });
          }),

        dismissLoop: (loopId) =>
          act(() => {
            set({ openLoops: get().openLoops.map((l) => (l.id === loopId ? { ...l, status: 'dismissed' } : l)) });
            get().track('dismissLoop', { kind: 'loop', id: loopId });
          }),

        toggleLoop: (loopId) => {
          const l = get().openLoops.find((x) => x.id === loopId);
          if (!l) return;
          if (l.status === 'resolved' || l.status === 'dismissed') get().reopenLoop(loopId);
          else get().resolveLoop(loopId);
        },

        setIdentity: (context, mode) => set({ identity: { ...get().identity, [context]: mode } }),

        confirmAge: () => set({ afterDark: { ...get().afterDark, ageConfirmed: true } }),

        setBrowseAnonymously: (value) => {
          set({
            afterDark: { ...get().afterDark, browseAnonymously: value },
            identity: { ...get().identity, 'after-dark': value ? 'anonymous' : 'pseudonymous' },
          });
        },

        addComment: async (postId, body, mode) => {
          // Keys: a board post id, or `drift:<id>` for a Drift item.
          const target = commentTarget(postId);
          const text = body.trim();
          if (!text) return null;
          const c: Comment = { id: `cm_${uid()}`, postId, authorId: repo.meId(), authorMode: mode, body: text, createdAt: new Date().toISOString() };
          get().track('comment', target.kind === 'drift' ? { kind: 'drift', id: target.id } : { kind: 'post', id: target.id });
          if (!isRealMode()) {
            set({ comments: { ...get().comments, [postId]: [...(get().comments[postId] ?? []), c] } });
            return c;
          }
          // REAL: Supabase is the source of truth; the sheet shows `c` optimistically until this resolves.
          const u = realData.real.uid();
          try {
            if (!u) throw new Error('You’re signed out.');
            const row = await sync.comment(u, target.kind, target.id, text);
            return { ...c, id: row.id, createdAt: row.created_at };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Your comment didn’t send. ${msg.replace(/^Posting reply: /, '')}`);
          }
        },

        sendMessage: (threadId, body) =>
          act(() => {
            const first = !(get().chats[threadId] ?? []).some((m) => m.fromMe);
            const m: ChatMessage = { id: `m_${uid()}`, threadId, fromMe: true, body: body.trim(), at: Date.now() };
            set({ chats: { ...get().chats, [threadId]: [...(get().chats[threadId] ?? []), m] } });
            // Starting a conversation is a signal; every later message isn't.
            if (first && repo.user(threadId)) get().track('chat', { kind: 'person', id: threadId });
          }),

        receiveMessage: (threadId, body) => {
          const m: ChatMessage = { id: `m_${uid()}`, threadId, fromMe: false, body, at: Date.now() };
          set({ chats: { ...get().chats, [threadId]: [...(get().chats[threadId] ?? []), m] } });
        },

        updateProfile: (edits) => set({ profile: { ...get().profile, ...edits } }),

        toggleOpenTo: (value) =>
          act(() => {
            const cur = get().profile.openTo ?? [];
            let openTo = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
            // "Not looking" and dating/casual can't both be on.
            if (value === 'not_looking' && openTo.includes('not_looking')) openTo = openTo.filter((v) => v !== 'dating' && v !== 'casual');
            if ((value === 'dating' || value === 'casual') && openTo.includes(value)) openTo = openTo.filter((v) => v !== 'not_looking');
            set({ profile: { ...get().profile, openTo } });
          }),

        toggleBuzzLike: (id) =>
          act(() => {
            const [buzzLikes, on] = toggleFlag(get().buzzLikes, id);
            const buzzDislikes = { ...get().buzzDislikes };
            const hadDislike = on && !!buzzDislikes[id];
            if (on) delete buzzDislikes[id];
            set({ buzzLikes, buzzDislikes });
            if (hadDislike) get().track('undislike', { kind: 'buzz', id });
            get().track(on ? 'like' : 'unlike', { kind: 'buzz', id });
            backend('Like', async (u) => {
              if (hadDislike) await sync.reaction(u, 'buzz', id, 'dislike', false);
              await sync.reaction(u, 'buzz', id, 'like', on);
            });
          }),

        toggleBuzzDislike: (id) =>
          act(() => {
            const [buzzDislikes, on] = toggleFlag(get().buzzDislikes, id);
            const buzzLikes = { ...get().buzzLikes };
            const hadLike = on && !!buzzLikes[id];
            if (on) delete buzzLikes[id];
            set({ buzzDislikes, buzzLikes });
            if (hadLike) get().track('unlike', { kind: 'buzz', id });
            get().track(on ? 'dislike' : 'undislike', { kind: 'buzz', id });
            backend('Dislike', async (u) => {
              if (hadLike) await sync.reaction(u, 'buzz', id, 'like', false);
              await sync.reaction(u, 'buzz', id, 'dislike', on);
            });
          }),

        toggleBuzzSave: (id) =>
          act(() => {
            const [buzzSaves, on] = toggleFlag(get().buzzSaves, id);
            set({ buzzSaves });
            get().track(on ? 'save' : 'unsave', { kind: 'buzz', id });
            backend('Save', (u) => sync.reaction(u, 'buzz', id, 'save', on));
          }),

        toggleBuzzRepost: (id) =>
          act(() => {
            const [buzzReposts, on] = toggleFlag(get().buzzReposts, id);
            set({ buzzReposts });
            if (on) get().track('repost', { kind: 'buzz', id });
            backend('Repost', (u) => sync.reaction(u, 'buzz', id, 'repost', on));
          }),

        voteBuzz: (id, optionId) =>
          act(() => {
            const prev = get().buzzVotes[id];
            const buzzVotes = { ...get().buzzVotes };
            if (prev === optionId) delete buzzVotes[id];
            else buzzVotes[id] = optionId;
            set({ buzzVotes });
            if (!prev) get().track('vote', { kind: 'buzz', id });
            backend('Vote', (u) => sync.vote(u, id, buzzVotes[id] ?? null));
          }),

        addBuzzReply: async (id, body) => {
          const text = body.trim();
          if (!text) return;
          const now = Date.now();
          const r: BuzzReply = { id: `br_${uid()}`, buzzId: id, authorId: repo.meId(), body: text, createdAt: new Date(now).toISOString(), createdAtMs: now };
          if (!isRealMode()) {
            act(() => {
              set({ buzzReplies: { ...get().buzzReplies, [id]: [...(get().buzzReplies[id] ?? []), r] } });
              get().track('reply', { kind: 'buzz', id });
            });
            return;
          }
          // REAL: show it now (sending), then confirm or roll back.
          realData.addReply({ ...r, status: 'sending' });
          get().track('reply', { kind: 'buzz', id });
          const u = realData.real.uid();
          try {
            if (!u) throw new Error('You’re signed out.');
            const row = await sync.comment(u, 'buzz', id, text);
            realData.updateReply(r.id, toReply(row));
          } catch (e) {
            realData.updateReply(r.id, null);
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Your reply didn’t send. ${msg.replace(/^Posting reply: /, '')}`);
          }
        },

        toggleDriftLike: (id) =>
          act(() => {
            const [driftLikes, on] = toggleFlag(get().driftLikes, id);
            set({ driftLikes });
            get().track(on ? 'like' : 'unlike', { kind: 'drift', id });
            backend('Like', (u) => sync.reaction(u, 'drift', id, 'like', on));
          }),

        toggleDriftSave: (id) =>
          act(() => {
            const [driftSaves, on] = toggleFlag(get().driftSaves, id);
            set({ driftSaves });
            get().track(on ? 'save' : 'unsave', { kind: 'drift', id });
            backend('Save', (u) => sync.reaction(u, 'drift', id, 'save', on));
          }),

        // Phase 6C: private, like Buzz dislike (never shown to anyone; removes a like).
        toggleDriftDislike: (id) =>
          act(() => {
            const [driftDislikes, on] = toggleFlag(get().driftDislikes ?? {}, id);
            const driftLikes = { ...get().driftLikes };
            const hadLike = on && !!driftLikes[id];
            if (on) delete driftLikes[id];
            set({ driftDislikes, driftLikes });
            if (hadLike) get().track('unlike', { kind: 'drift', id });
            get().track(on ? 'dislike' : 'undislike', { kind: 'drift', id });
            backend('Dislike', async (u) => {
              if (hadLike) await sync.reaction(u, 'drift', id, 'like', false);
              await sync.reaction(u, 'drift', id, 'dislike', on);
            });
          }),

        // Private: no activity event that could surface elsewhere, no affinity change.
        toggleCrush: (userId) => {
          const [crushes, on] = toggleFlag(get().crushes, userId);
          set({ crushes });
          // REAL: the backend decides Sparks (my_sparks() only reveals mutual ones).
          backend('Crush', async (u) => realData.setSparks(await sync.crush(u, userId, on)));
        },

        addCreated: (kind, item) => {
          const created = get().created ?? emptyCreations();
          set({ created: { ...created, [kind]: [item, ...(created[kind] as unknown[])] } as DemoCreations });
        },

        updateCreatedBoard: (id, patch) => {
          const created = get().created ?? emptyCreations();
          set({ created: { ...created, boards: created.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) } });
        },

        watchDrift: (id) => {
          if (get().driftViews[id]) return;
          act(() => {
            set({ driftViews: { ...get().driftViews, [id]: true } });
            get().track('watch', { kind: 'drift', id });
          });
        },

        visitBoard: (boardId) => {
          if (get().boardVisits[boardId]) return;
          act(() => {
            set({ boardVisits: { ...get().boardVisits, [boardId]: true } });
            get().track('open', { kind: 'board', id: boardId });
          });
        },

        exploreBranch: (nodeId, ref) =>
          act(() => {
            const first = !get().exploredNodes[nodeId];
            set({ happeningFocus: nodeId, exploredNodes: first ? { ...get().exploredNodes, [nodeId]: true } : get().exploredNodes });
            if (first) get().track('explore', ref);
          }),

        collapseBranch: () => set({ happeningFocus: null }),

        resetDemo: () => {
          const { profile, identity, afterDark } = get();
          set({ ...initialData(), profile: { ...initialData().profile, avatarUri: profile.avatarUri }, identity, afterDark });
          set({ baseline: takeBaseline(getContext(graphStateOf(get())), Date.now()) });
        },
      };
    },
    {
      name: 'chimp-store',
      version: 6,
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * v3 (Phase 3): the relationship graph resets to the demo seed so the
       * behaviour layer starts from a known state. Profile edits, identity,
       * After Dark settings, comments and chats are kept.
       */
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Partial<ChimpState> & { profile?: Partial<ProfileEdits> };
        let state: ChimpState;
        if (version < 3) {
          // v3 (Phase 3): relationship graph resets to the demo seed; profile,
          // identity, After Dark settings, comments and chats are kept.
          const fresh = initialData();
          state = {
            ...fresh,
            profile: { ...fresh.profile, ...(old.profile ?? {}) },
            identity: old.identity ?? fresh.identity,
            afterDark: old.afterDark ?? fresh.afterDark,
            comments: old.comments ?? fresh.comments,
            chats: old.chats ?? fresh.chats,
          } as unknown as ChimpState;
        } else {
          state = old as ChimpState;
        }
        // v4 (Phase 4): nothing is reset. Adds Buzz/Drift/Crush state and maps
        // the Open To vocabulary (collaborators → collaboration, professional → networking).
        // v5 (Phase 5): nothing is reset. Adds Living-World / Happening state
        // and seeds affinity for interests that didn't exist before (Films,
        // Science) without touching anything you've already shaped.
        const affinity = { ...(state.affinity ?? {}) };
        for (const [i, v] of Object.entries(AFFINITY.seed)) if (affinity[i] === undefined) affinity[i] = v;
        // v6 (Phase 6A): this bucket is the DEMO account. Adds local creations.
        return {
          ...surfaceData(),
          ...livingData(),
          ...state,
          created: state.created ?? emptyCreations(),
          connectRequests: state.connectRequests ?? {},
          incomingConnects: state.incomingConnects ?? {},
          affinity,
          profile: { ...state.profile, openTo: migrateOpenTo(state.profile?.openTo as string[] | undefined) },
        } as ChimpState;
      },
      partialize: ({ hydrated, ...rest }) => {
        // Functions are dropped by JSON; strip the transient flag explicitly.
        void hydrated;
        return rest;
      },
      onRehydrateStorage: () => () => {
        useChimp.setState({ hydrated: true });
      },
    },
  ),
);

// ─── Derived selectors ──────────────────────────────────────────────────────

export { freshCount, freshFor, touches, unseenChanges };

export function followerCountFor(userId: string, following: Flags): number {
  const u = repo.user(userId);
  if (!u) return 0;
  const seeded = SEED_FOLLOWING.includes(userId);
  return u.followers + (following[userId] ? 1 : 0) - (seeded ? 1 : 0);
}
