/**
 * Chimp domain model.
 *
 * These types are deliberately backend-agnostic: every entity has a stable
 * string ID and references other entities by ID (never by nesting), so the
 * same shapes map cleanly onto Postgres rows, Firestore docs or graph nodes.
 */

export type ID = string;
export type ISODate = string;

// ─── Taxonomy ────────────────────────────────────────────────────────────────

/** Top-level lenses shown as chips on Pulse. */
export type CategoryId = 'travel' | 'culture' | 'style' | 'founders' | 'afterDark';

export interface Interest {
  id: ID;
  label: string;
  category: CategoryId;
}

/** A pointer to any node in the graph. */
export type EntityKind = 'board' | 'move' | 'person' | 'story' | 'post' | 'loop' | 'interest' | 'location' | 'buzz' | 'drift';
export interface EntityRef {
  kind: EntityKind;
  id: ID;
}

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * Contextual identity (research §5.4). One verified account, many
 * presentation modes. The private graph is unified; the public self is not.
 */
export type IdentityMode = 'public' | 'pseudonymous' | 'anonymous' | 'private';

export interface Persona {
  id: ID;
  userId: ID;
  mode: IdentityMode;
  displayName: string;
  /** Contexts (Board IDs) where this persona is used. */
  contexts: ID[];
}

/**
 * An image reference: a remote URL today, or a bundled asset (`require(...)`
 * returns a number). Components render either through `Img`.
 */
export type ImageSrc = string | number;

/**
 * What someone is open to on Chimp. Broader than dating by design.
 * `not_looking` is exclusive of dating/casual. `travel` and `events` are
 * plan-type openness kept from Phase 2.
 */
export type OpenTo = 'friends' | 'dating' | 'casual' | 'networking' | 'collaboration' | 'not_looking' | 'travel' | 'events';

/** Short personality prompt ("I'll always say yes to…"). */
export interface ProfilePrompt {
  id: ID;
  question: string;
  answer: string;
}

/** A small identity signal image on a profile — not a feed grid. */
export interface ProfileMoment {
  id: ID;
  label: string;
  image: ImageSrc;
  /** Optional link into the graph (e.g. the Board the moment came from). */
  ref?: EntityRef;
}

export interface User {
  id: ID;
  username: string;
  displayName: string;
  /** Small circular image. */
  avatar?: ImageSrc;
  /** Large profile artwork / photo used in the hero. */
  heroImage?: ImageSrc;
  /** True when heroImage is a cut-out (transparent) illustration. */
  heroCutout?: boolean;
  cover?: string;
  city: string;
  bio: string;
  interests: ID[];
  verified?: boolean;
  followers: number;
  following: number;
  /** Contextual reputation, not a global popularity score (research §5.6). */
  knownFor?: string[];
  gallery?: string[];
  quote?: string;
  openTo?: OpenTo[];
  prompts?: ProfilePrompt[];
  moments?: ProfileMoment[];
  /** Phase 6A: short personal motto shown in the hero ("Here for the plot"). */
  profilePhrase?: string;
  profileEmoji?: string;
  /** Vertical focal point of the photo in the hero (0 = top, 1 = bottom). */
  avatarFocusY?: number;
  /** REAL accounts only: true for people created through sign-up. */
  real?: boolean;
}

/** DEMO = the seeded WollyMc world; REAL = an authenticated account. */
export type AccountMode = 'demo' | 'real';

/**
 * Everything a profile screen needs, assembled from User + relationship
 * state. This is the shape a future `GET /profile/:id` would return.
 */
export interface Profile extends User {
  location: string;
  followersCount: number;
  followingCount: number;
  connectionCount: number;
  matchCount: number;
  savedBoards: ID[];
  ownedBoards: ID[];
  openLoops: ID[];
}

// ─── Boards ──────────────────────────────────────────────────────────────────

/**
 * Board theme tokens. Every Board — Japan Trip, After Dark, a future
 * user-made "Kathmandu" — renders with the same components and differs only
 * in these tokens. Themes are built by `createBoardTheme` in
 * `theme/boardThemes.ts`: an AI (later) may choose the ingredients, but
 * Chimp's recipe derives and contrast-checks every token.
 */
export interface BoardTheme {
  id: string;
  mode: 'light' | 'dark';
  /** Page background behind content. */
  background: string;
  /** Cards and modules. */
  surface: string;
  /** Tinted module background (polls, banners). */
  surfaceAlt: string;
  /** The board's signature colour (buttons, active tabs, kickers). */
  primary: string;
  /** Soft tint of primary (chips, active tab pill). */
  primarySoft: string;
  /** Text/icon colour on top of primary. */
  onPrimary: string;
  secondary?: string;
  text: string;
  mutedText: string;
  line: string;
  /** Hero scrim / atmosphere gradient (top → bottom). */
  gradient: [string, string];
  /** Optional highlight for glows (e.g. neon). */
  accent?: string;
  /**
   * How accents are drawn. A closed set, so a generated theme can pick a
   * style but never invent a new treatment.
   */
  accentStyle: 'soft' | 'neon' | 'ink';
}

/**
 * The sections of a Board ("a World"). Phase 5 renders them inside the
 * Today edition (see graph/worlds.ts); Explore and People are tabs.
 */
export type BoardSectionId = 'today' | 'top' | 'news' | 'buzz' | 'watch' | 'stories' | 'people' | 'explore';

/** Layout recipe. Chimp controls the set; boards only pick one. */
export type BoardTemplate = 'standard' | 'nightlife';

/** Phase 5: a Board is a Living World — Today (finite edition), Explore (stream), People. */
export type BoardTab = 'today' | 'explore' | 'people';
/** Pre-Phase-5 tab names still accepted in links (?tab=posts → today). */
export type LegacyBoardTab = 'posts' | 'albums' | 'tips';

/** How a Board is drawn on Pulse's editorial canvas. */
export type PulseShape = 'card' | 'circle';

/**
 * canonical    – the one shared Board for a place/topic (e.g. "Kathmandu")
 * curated      – edited by Chimp or a trusted host (e.g. "Japan Trip")
 * user_created – made by a person, may hang off a canonical parent
 * private      – a personal planning Board (e.g. "Italy 2027")
 */
export type BoardType = 'canonical' | 'curated' | 'user_created' | 'private';
/** Phase 6D: 'connections' = only the owner's connections (and members) can see it. */
export type BoardVisibility = 'public' | 'members' | 'connections' | 'private';

/** Phase 6D: roles inside a World (a follower is not a member). */
export type BoardRole = 'owner' | 'admin' | 'member';

export interface Board {
  id: ID;
  /** URL-safe handle, unique across Boards (future: chimp.app/b/:slug). */
  slug: string;
  title: string;
  tagline: string;
  type: BoardType;
  visibility: BoardVisibility;
  category: CategoryId;
  interests: ID[];
  cover: string;
  hero: string;
  memberCount: number;
  ideaCount: number;
  /** Verb used for social proof on Pulse: "12K+ exploring". */
  activityVerb: string;
  /** Person who owns the Board (creator for user-made Boards, host otherwise). */
  ownerId: ID;
  createdAt: ISODate;
  memberPreview: ID[];
  /** Key into BOARD_THEMES; `theme` is the resolved token set. */
  themeId: string;
  theme: BoardTheme;
  template: BoardTemplate;
  /** Board graph: neighbouring Boards (RELATED_TO), symmetric. */
  relatedBoardIds: ID[];
  /** Location node this Board is about, if any (see data/locations). */
  location?: ID;
  /** A user-made Board that hangs off a canonical one ("Kathmandu Food Hunt" → "Kathmandu"). */
  canonicalParentId?: ID;
  /** Sections this World shows, in order (defaults to all with content). */
  sections?: BoardSectionId[];
  pulseShape: PulseShape;
  /** Deterministic editorial weight; the recommender adds personal signals. */
  editorial: number;
  /** Identity modes allowed when posting here. */
  identityModes: IdentityMode[];
  ageGated?: boolean;
  city?: string;
  /** Phase 6D provenance: who made it (kept even if ownership is handed on). */
  creatorId?: ID;
  creatorName?: string;
  /** Phase 6D: people following it (not members). REAL: a real count. */
  followerCount?: number;
  /** Phase 6D: member roles (REAL). */
  roles?: Record<ID, BoardRole>;
  /** Phase 6D: pending join requests (only loaded for its owner/admins). */
  requests?: ID[];
}

// ─── Content ─────────────────────────────────────────────────────────────────

export type PostKind = 'photo' | 'poll' | 'route' | 'place' | 'tip' | 'text';

export interface PollOption {
  id: ID;
  label: string;
  votes: number;
}

export interface Poll {
  question: string;
  options: PollOption[];
}

export interface RouteStop {
  id: ID;
  name: string;
  image: string;
  /** Normalised 0..1 position on the schematic map. */
  x: number;
  y: number;
  note?: string;
}

export interface SavedRoute {
  title: string;
  stops: RouteStop[];
  distanceKm: number;
  duration: string;
}

export interface PlaceRec {
  name: string;
  city: string;
  category: string;
  price?: string;
  image: string;
}

export interface Post {
  id: ID;
  boardId: ID;
  authorId: ID;
  /** Which identity the author used in this context. */
  authorMode: IdentityMode;
  kind: PostKind;
  createdAt: ISODate;
  title?: string;
  body?: string;
  images?: string[];
  likeCount: number;
  commentCount: number;
  poll?: Poll;
  route?: SavedRoute;
  place?: PlaceRec;
}

export interface Comment {
  id: ID;
  postId: ID;
  authorId: ID;
  authorMode: IdentityMode;
  body: string;
  createdAt: ISODate;
  /** Phase 6D: last edit (server time); shows "Edited". */
  editedAt?: ISODate;
  /** Phase 6B optimistic state: sending, or failed (with Retry). */
  status?: 'sending' | 'failed';
  /** Phase 9.2: the comment this one replies to (none = top-level). */
  parentId?: ID;
}

export interface Tip {
  id: ID;
  boardId: ID;
  authorId: ID;
  title: string;
  body: string;
  helpful: number;
}

// ─── Stories ─────────────────────────────────────────────────────────────────

/** Stories always belong to a persistent object (research §5.7). */
export interface Story {
  id: ID;
  owner: EntityRef;
  title: string;
  cover: ImageSrc;
  /** trending = graph-level canvas; friend = people you know. */
  lane: 'trending' | 'friend';
  items: StoryItem[];
}

export interface StoryItem {
  id: ID;
  storyId: ID;
  authorId: ID;
  image: string;
  caption: string;
  location?: string;
  createdAt: ISODate;
  /** Phase 9: exact server time (ms) — REAL items; `createdAt` is a display label there ("2h"). */
  createdAtMs?: number;
  durationMs: number;
  boardId?: ID;
  moveId?: ID;
}

// ─── Moves ───────────────────────────────────────────────────────────────────

export type MoveKind = 'experience' | 'event' | 'collab' | 'learning' | 'travel';
export type MoveSection = 'featured' | 'week' | 'more';

export interface Move {
  id: ID;
  title: string;
  subtitle: string;
  kind: MoveKind;
  section: MoveSection;
  city: string;
  dateLabel: string;
  startsAt: ISODate;
  image: string;
  attendeeCount: number;
  attendeePreview: ID[];
  hostId: ID;
  boardId?: ID;
  interests: ID[];
  category: CategoryId;
  description: string;
  capacity?: number;
  price?: string;
}

export interface MoveState {
  interested?: boolean;
  rsvp?: boolean;
  saved?: boolean;
}

// ─── People & relationships ─────────────────────────────────────────────────

export type MatchIntent = 'friend' | 'collaborator' | 'professional' | 'romantic';

export type MatchReasonKind =
  | 'sharedBoard'
  | 'sharedGoal'
  | 'sameMove'
  | 'sharedInterests'
  | 'samePlace'
  | 'mutual'
  | 'openTo';

/** Every recommendation carries an explicit, displayable reason. */
export interface MatchReason {
  kind: MatchReasonKind;
  label: string;
  /** Lower-case clause for sentences: "…because you're both in Japan Trip". */
  clause?: string;
  ref?: EntityRef;
}

export interface PersonRecommendation {
  id: ID;
  personId: ID;
  score: number; // 0..100
  intents: MatchIntent[];
  reasons: MatchReason[];
}

/**
 * Why two people might meet. Assembled deterministically from the graph
 * (shared boards, interests, Moves, mutual connections, Open To overlap).
 */
/** A conversation starter grounded in something you share. Never a pickup line. */
export interface Opener {
  /** Shown to you: "You disagreed on Maya’s Kyoto poll". */
  context: string;
  /** Pre-fills the chat; you edit and send it yourself. */
  draft: string;
}

export interface MatchExplanation {
  personId: ID;
  matchScore: number;
  matchReasons: MatchReason[];
  mutualConnections: ID[];
  sharedBoards: ID[];
  sharedInterests: ID[];
  sharedMoves: ID[];
  sharedOpenTo: OpenTo[];
  /** Active Open Loops this person could help with. */
  relevantOpenLoops: ID[];
  /** Moves they're going to that you haven't engaged with yet. */
  possibleMoves: ID[];
  relationship: RelationshipState;
  /** WollyMc has a private Crush on them (they can't see it). */
  crush: boolean;
  /** Mutual Crush. Only ever true when both sides chose it. */
  spark: boolean;
  /** Openers from shared context (Boards, Moves, posts, interests). Never pickup lines. */
  /** Drafts only (pre-fill chat, never auto-sent). */
  starters: string[];
  /** Starters with the shared context they come from ("You both joined Japan Trip"). */
  openers: Opener[];
  /** Where the relationship started, for chat context ("You met through Japan Trip"). */
  metThrough?: EntityRef;
  /** Score components (0..1), for Graph Debug only. */
  parts: Record<string, number>;
}

/**
 * Relationship between WollyMc and someone else. Following is one-way,
 * a connection is mutual and deliberate, a match is suggested by Chimp.
 */
export type RelationshipState =
  | 'none'
  | 'following'
  | 'follower'
  | 'mutual-follow'
  | 'connection'
  | 'match'
  | 'blocked';

/**
 * Private romantic layer, separate from the public relationship above.
 * crush = one-way and private; spark = mutual crush (revealed to both).
 */
export type RomanceState = 'none' | 'crush' | 'spark';

export type ConnectionStatus = 'connected' | 'pending';
export interface Connection {
  userId: ID;
  status: ConnectionStatus;
  since: ISODate;
}

// ─── Possibility space ──────────────────────────────────────────────────────

/**
 * active    – open, nothing done yet
 * progress  – open, some steps done (derived from the graph, never stored)
 * resolved  – the user marked it done
 * dismissed – the user no longer wants it
 */
export type LoopStatus = 'active' | 'progress' | 'resolved' | 'dismissed';

export interface OpenLoop {
  id: ID;
  title: string;
  /** Short form for sentences: "your Japan travel-buddy loop". */
  short?: string;
  icon: 'plane' | 'users' | 'coffee' | 'moon' | 'calendar' | 'camera' | 'map' | 'sparkles';
  /** Stored status: 'active' | 'resolved' | 'dismissed'. 'progress' is derived. */
  status: LoopStatus;
  interests: ID[];
  createdAt: ISODate;
  /** Graph nodes that could help close this loop (SUPPORTS edges). */
  related: EntityRef[];
  origin?: 'seed' | 'suggested' | 'user';
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export type GraphNodeKind =
  | 'user'
  | 'person'
  | 'board'
  | 'interest'
  | 'location'
  | 'move'
  | 'loop'
  | 'story'
  | 'post'
  | 'scene'
  | 'buzz'
  | 'drift';

export type EdgeType =
  | 'FOLLOWS'
  | 'JOINED'
  | 'SAVED'
  | 'INTERESTED_IN'
  | 'CONNECTED_TO'
  | 'MATCHED_WITH'
  | 'VIEWED'
  | 'LIKED'
  | 'VOTED'
  | 'RSVPED'
  | 'RELATED_TO'
  | 'LOCATED_IN'
  | 'MEMBER_OF'
  | 'RESOLVES'
  | 'SUPPORTS'
  | 'CREATED_BY'
  | 'DISLIKED'
  | 'REPOSTED'
  | 'CRUSH_ON';

/** Node ids are namespaced: "board:japan-trip", "person:u_zara", "interest:i_japan". */
export interface GraphEdge {
  id: ID;
  fromId: string;
  toId: string;
  type: EdgeType;
  weight: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface Location {
  id: ID;
  label: string;
  kind: 'city' | 'country' | 'region';
  parentId?: ID;
  /** Interest that planning this place maps to (Tokyo → Japan). */
  interestId?: ID;
}

// ─── Explainable relevance ──────────────────────────────────────────────────

export type ReasonKind = 'loop' | 'board' | 'saved' | 'people' | 'match' | 'interest' | 'place' | 'fresh' | 'editorial' | 'plan';

/** One human-readable reason, generated from graph state. */
export interface Reason {
  kind: ReasonKind;
  /** Full sentence for detail screens. */
  text: string;
  /** Very short form for cards (≈ 20 characters). */
  short: string;
  /** Contribution to the score; reasons are sorted by it. */
  strength: number;
  ref?: EntityRef;
}

export interface Scored<T> {
  item: T;
  /** 0..100. Only Graph Debug shows it. */
  score: number;
  reasons: Reason[];
  /** Score components (0..1) before weighting. */
  parts: Record<string, number>;
}

// ─── World Delta: change events ─────────────────────────────────────────────

export type ChangeType =
  | 'BOARD_ACTIVITY'
  | 'PERSON_BECAME_RELEVANT'
  | 'MOVE_OPENED'
  | 'MOVE_CLOSING'
  | 'NEW_MATCH'
  | 'OPEN_LOOP_PROGRESS'
  | 'STORY_UPDATE'
  | 'NEW_CONNECTION_ACTIVITY';

/** Serializable condition a change must meet to be released (no filler). */
export type ChangeCondition =
  | { joined: ID }
  | { following: ID }
  | { connected: ID }
  | { loopActive: ID }
  | { moveEngaged: ID }
  | { savedPost: ID }
  | { affinityAtLeast: [ID, number] }
  | { notBlocked: ID }
  | { notConnected: ID }
  | { any: ChangeCondition[] }
  | { all: ChangeCondition[] };

/**
 * A meaningful change in the user's world (research §5.1). Finite, ranked
 * by relevance, and cleared once the related object is opened.
 */
export interface ChangeEvent {
  id: ID;
  type: ChangeType;
  /** The entity this change is about (its `entityId` is `ref.id`). */
  ref: EntityRef;
  message: string;
  detail?: string;
  count?: number;
  /** 1 = nice to know, 2 = relevant, 3 = acts on an Open Loop. */
  importance: 1 | 2 | 3;
  createdAt: number; // epoch ms
  seen: boolean;
  /** Why this change is shown to you. */
  reason: string;
  /** seed = first launch, world = off-session pool, reaction = caused by your actions. */
  source: 'seed' | 'world' | 'reaction';
  /** Re-checked at release time; unmet → never shown. */
  requires?: ChangeCondition;
  /** Dedupe key (one per real-world change). */
  key: string;
}

export type ActivityType =
  | 'open'
  | 'like'
  | 'unlike'
  | 'save'
  | 'unsave'
  | 'join'
  | 'leave'
  | 'vote'
  | 'follow'
  | 'unfollow'
  | 'connect'
  | 'disconnect'
  | 'interested'
  | 'rsvp'
  | 'comment'
  | 'storyView'
  | 'search'
  | 'uninterested'
  | 'unrsvp'
  | 'openLoop'
  | 'resolveLoop'
  | 'dismissLoop'
  | 'chat'
  | 'block'
  | 'dislike'
  | 'undislike'
  | 'repost'
  | 'reply'
  // Phase 5
  | 'watch'
  | 'explore'
  // Phase 6A
  | 'create';

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  ref: EntityRef;
  at: number;
  /** Affinity change this action caused, per interest (for "what changed"). */
  affinity?: Record<ID, number>;
}

export interface ChatMessage {
  id: ID;
  threadId: ID;
  fromMe: boolean;
  body: string;
  at: number;
}

// ─── Buzz (text, news, memes, conversation) ─────────────────────────────────

/** 'photo' (Phase 6A) = a post whose point is its image(s). */
export type BuzzKind = 'post' | 'note' | 'photo' | 'meme' | 'poll' | 'news' | 'video';

/** Phase 6C: a short clip on a Buzz (one per post). */
export interface BuzzVideo {
  url: string;
  /** JPEG poster frame, when one was made on upload. */
  poster?: string;
  durationMs?: number;
  /** width / height, when known. */
  aspect?: number;
  /** Phase 9: the `media` row (REAL) — lets the owner's phone add a missing poster later. */
  mediaId?: string;
}

/** Seeded news card. Always a demo fixture in the prototype, never live data. */
export interface NewsMeta {
  headline: string;
  summary: string;
  /** Source label placeholder, e.g. "Demo source". */
  source: string;
  category: CategoryId;
  demo: true;
}

export interface BuzzItem {
  id: ID;
  kind: BuzzKind;
  /**
   * The World this conversation belongs to, if any. Phase 6B: '' = "Just
   * Buzz" (no World). Always check `repo.board(boardId)` before using it.
   */
  boardId: ID;
  authorId?: ID;
  /** Short post or Note (≤ ~250 words). */
  body?: string;
  title?: string;
  image?: string;
  images?: string[];
  /**
   * Legacy "meme" text. Phase 6B: never painted over media; shown as the
   * caption under the image.
   */
  memeText?: string;
  /** Phase 6B: width / height per image (from the media row), for true aspect ratios. */
  imageAspects?: number[];
  /** Phase 6C: a short video. `image` is then its poster frame (if any). */
  video?: BuzzVideo;
  poll?: Poll;
  news?: NewsMeta;
  createdAt: string;
  /** Age in hours, for recency and trending. */
  ageHours: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  /** Extra interests beyond the Board's. */
  interests?: ID[];
  /** Grid hint: half-width card or full row. */
  layout?: 'half' | 'full';
  /** Phase 6A: exact creation time (ms), for "just posted" pinning. */
  createdAtMs?: number;
  /** Phase 6D: when the author last edited the text (server time); shows "Edited". */
  editedAtMs?: number;
}

export interface BuzzReply {
  id: ID;
  buzzId: ID;
  authorId: ID;
  body: string;
  createdAt: string;
  /** Phase 6B: exact time, rendered with whenLabel ("Just now", "5m", "Yesterday"…). */
  createdAtMs?: number;
  /** Phase 6D: last edit (server time); shows "Edited". */
  editedAtMs?: number;
  /** Phase 6B optimistic state: sending, or failed (with Retry). */
  status?: 'sending' | 'failed';
  /** Phase 9.2: the reply this one answers (none = top-level). */
  parentId?: ID;
}

// ─── Drift (visual media) ───────────────────────────────────────────────────

export type DriftKind = 'photo' | 'video' | 'carousel' | 'meme';

export interface DriftItem {
  id: ID;
  kind: DriftKind;
  /** The World it belongs to. */
  boardId: ID;
  /** The creator. */
  authorId: ID;
  image: ImageSrc;
  images?: string[];
  caption: string;
  memeText?: string;
  /** Video length (static preview in the prototype). */
  durationSec?: number;
  /** App Review patch: a short clip bundled with the app, so the Demo has one video that really plays. */
  clipSource?: number;
  likeCount: number;
  createdAt: string;
  ageHours: number;
  interests?: ID[];
  /** Taller tile in the grid. */
  tall?: boolean;
  /** Phase 6A: exact creation time (ms). */
  createdAtMs?: number;
}

// ─── Happening (the Opportunity Graph surface) ──────────────────────────────

export type HappeningKind = 'move' | 'people' | 'match' | 'spark' | 'loop' | 'change' | 'plan';

export interface HappeningItem {
  id: ID;
  kind: HappeningKind;
  title: string;
  body?: string;
  /** WHY THIS MATTERS TO YOU — generated, never empty. */
  why: string[];
  ref: EntityRef;
  image?: ImageSrc;
  people?: ID[];
  score: number;
  /**
   * Phase 7C: why Happening selected it (decomposed signals, Graph Debug only).
   * `base` is the pre-7C score, so turning INTELLIGENCE.happening off restores the old order.
   */
  selection?: { base: number; total: number; signals: Record<string, number>; penalties: Record<string, number> };
}

export interface Notification {
  id: ID;
  title: string;
  body: string;
  ref?: EntityRef;
  at: number;
  read: boolean;
}
