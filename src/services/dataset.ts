/**
 * Datasets (Phase 6A): the hard boundary between DEMO and REAL.
 *
 *   DEMO  the seeded WollyMc world (all fixtures, dummy people, Moves,
 *         loops, World Delta). Used for development, Graph Debug and the
 *         deterministic demos. Anything you create in Demo stays local.
 *   REAL  an authenticated account. ONLY real rows from the backend plus
 *         Chimp's public World catalog (places, never people). No dummy
 *         users, no seeded follows/matches/Crushes/Sparks, no fake counts.
 *
 * The repository, the graph engine and every screen read the *active*
 * dataset, so the Opportunity Graph works identically in both modes.
 */
import { create } from 'zustand';

import { ALBUMS, POSTS, SEED_COMMENTS, TIPS } from '@/data/content';
import { BOARD_LIST } from '@/data/boards';
import { BUZZ, SEED_BUZZ_REPLIES } from '@/data/buzz';
import { DRIFT } from '@/data/drift';
import { OTHER_VOTES } from '@/data/editions';
import { PERSON_RECS } from '@/data/graph';
import { MOVE_LIST } from '@/data/moves';
import { STORIES } from '@/data/stories';
import { CRUSHES_ON_ME, FOLLOWS_ME, ME, PEOPLE, PEOPLE_CONNECTIONS } from '@/data/users';
import type {
  AccountMode,
  Board,
  BuzzItem,
  BuzzReply,
  Comment,
  DriftItem,
  ID,
  Move,
  PersonRecommendation,
  Post,
  Story,
  Tip,
  User,
} from '@/types/models';

export interface Dataset {
  mode: AccountMode;
  /** Bumped on every change; graph caches key on it. */
  version: number;
  me: User;
  people: User[];
  users: Record<ID, User>;
  boards: Board[];
  boardMap: Record<ID, Board>;
  posts: Post[];
  tips: Tip[];
  albums: Record<ID, { id: string; title: string; images: string[] }[]>;
  seedComments: Comment[];
  buzz: BuzzItem[];
  buzzMap: Record<ID, BuzzItem>;
  buzzReplies: BuzzReply[];
  drift: DriftItem[];
  driftMap: Record<ID, DriftItem>;
  moves: Move[];
  moveMap: Record<ID, Move>;
  stories: Story[];
  storyMap: Record<ID, Story>;
  personRecs: PersonRecommendation[];
  /** Relationship edges between OTHER people (DEMO fixtures; REAL: from backend later). */
  followsMe: ID[];
  peopleConnections: Record<ID, ID[]>;
  /** DEMO: seeded Crushes on you. REAL: people with a mutual Crush (from my_sparks()). */
  sparkCandidates: ID[];
  /** Other people's poll votes (for shared-context openers). */
  otherVotes: Record<ID, Record<ID, ID>>;
  /** REAL: follower count from the backend (never faked). */
  followerCount?: number;
  /** Phase 6C: who joined which World, and when (REAL; for live activity in Happening). */
  memberJoins: MemberJoin[];
  /** Phase 6C: false only while a REAL account's content hasn't arrived yet (first launch, no cache): show placeholders, not "empty". */
  contentReady: boolean;
}

export interface MemberJoin {
  boardId: ID;
  userId: ID;
  at: number;
}

export interface DatasetParts {
  me: User;
  people?: User[];
  boards?: Board[];
  posts?: Post[];
  tips?: Tip[];
  albums?: Dataset['albums'];
  seedComments?: Comment[];
  buzz?: BuzzItem[];
  buzzReplies?: BuzzReply[];
  drift?: DriftItem[];
  moves?: Move[];
  stories?: Story[];
  personRecs?: PersonRecommendation[];
  followsMe?: ID[];
  peopleConnections?: Record<ID, ID[]>;
  sparkCandidates?: ID[];
  otherVotes?: Dataset['otherVotes'];
  followerCount?: number;
  memberJoins?: MemberJoin[];
  contentReady?: boolean;
}

const byId = <T extends { id: ID }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x])) as Record<ID, T>;

let version = 0;

export function makeDataset(mode: AccountMode, p: DatasetParts): Dataset {
  const people = (p.people ?? []).filter((u) => u.id !== p.me.id);
  const boards = p.boards ?? [];
  const buzz = p.buzz ?? [];
  const drift = p.drift ?? [];
  const moves = p.moves ?? [];
  const stories = p.stories ?? [];
  version += 1;
  return {
    mode,
    version,
    me: p.me,
    people,
    users: byId([p.me, ...people]),
    boards,
    boardMap: byId(boards),
    posts: p.posts ?? [],
    tips: p.tips ?? [],
    albums: p.albums ?? {},
    seedComments: p.seedComments ?? [],
    buzz,
    buzzMap: byId(buzz),
    buzzReplies: p.buzzReplies ?? [],
    drift,
    driftMap: byId(drift),
    moves,
    moveMap: byId(moves),
    stories,
    storyMap: byId(stories),
    personRecs: p.personRecs ?? [],
    followsMe: p.followsMe ?? [],
    peopleConnections: p.peopleConnections ?? {},
    sparkCandidates: p.sparkCandidates ?? [],
    otherVotes: p.otherVotes ?? {},
    followerCount: p.followerCount,
    memberJoins: p.memberJoins ?? [],
    contentReady: p.contentReady ?? true,
  };
}

/** Things created while in Demo mode (kept locally, never uploaded). */
export interface DemoCreations {
  boards: Board[];
  buzz: BuzzItem[];
  drift: DriftItem[];
  stories: Story[];
}

export function demoDataset(created?: DemoCreations, meOverride?: Partial<User>): Dataset {
  return makeDataset('demo', {
    me: { ...ME, ...Object.fromEntries(Object.entries(meOverride ?? {}).filter(([, v]) => v !== undefined)) },
    people: PEOPLE,
    boards: [...BOARD_LIST, ...(created?.boards ?? [])],
    posts: POSTS,
    tips: TIPS,
    albums: ALBUMS,
    seedComments: SEED_COMMENTS,
    buzz: [...(created?.buzz ?? []), ...BUZZ],
    buzzReplies: SEED_BUZZ_REPLIES,
    drift: [...(created?.drift ?? []), ...DRIFT],
    moves: MOVE_LIST,
    stories: [...(created?.stories ?? []), ...STORIES],
    personRecs: PERSON_RECS,
    followsMe: FOLLOWS_ME,
    peopleConnections: PEOPLE_CONNECTIONS,
    sparkCandidates: CRUSHES_ON_ME,
    otherVotes: OTHER_VOTES,
  });
}

/**
 * Phase 6B: the neutral dataset used only while an account change is in
 * progress (no screens are mounted then). Nobody, nothing: no DEMO id can
 * leak into REAL or the other way round.
 */
export function emptyDataset(): Dataset {
  const nobody: User = { ...ME, id: 'user:none', username: '', displayName: '', avatar: undefined, heroImage: undefined, heroCutout: false, city: '', bio: '', interests: [], followers: 0, following: 0, knownFor: [], openTo: [], moments: [], profilePhrase: undefined, profileEmoji: undefined };
  return makeDataset('demo', { me: nobody });
}

let active: Dataset = demoDataset();

/** The dataset every read goes through. */
export const ds = (): Dataset => active;

/** Subscribable version so React re-renders when the dataset changes. */
export const useDatasetVersion = create<{ version: number; mode: AccountMode; data: Dataset }>(() => ({ version: active.version, mode: active.mode, data: active }));

/**
 * The active dataset as React state. Prefer this over `repo.*` inside hooks
 * and memos: the value changes identity whenever the dataset changes, so
 * memoised reads stay correct and lint can see the dependency.
 */
export const useDataset = () => useDatasetVersion((d) => d.data);

export function setDataset(next: Dataset) {
  if (__DEV__) console.log(`[chimp:dataset] ${next.mode} v${next.version} · me=${next.me.id} · ${next.boards.length} boards · ${next.people.length} people`);
  active = next;
  useDatasetVersion.setState({ version: next.version, mode: next.mode, data: next });
}

export const isRealMode = () => active.mode === 'real';
