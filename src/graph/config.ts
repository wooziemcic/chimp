/**
 * Every tunable number in Chimp's behaviour layer lives here.
 *
 * Nothing in this file optimises for raw engagement: there is no dwell
 * time, no click-through, no streaks. Signals are deliberate actions (join,
 * save, follow, RSVP, open a loop), what the user says they want (Open
 * Loops, Open To) and what changed in the world.
 */
import type { ActivityType, EntityKind } from '@/types/models';

// ─── Interest affinity ──────────────────────────────────────────────────────

export const AFFINITY = {
  min: 0,
  max: 1,
  /**
   * Nudge per action, applied to the interests of the thing acted on.
   * Undo actions carry the negative value so toggling is reversible.
   */
  rules: {
    open: 0.01, // view a Board / Move / profile
    storyView: 0.02,
    like: 0.03,
    vote: 0.03,
    comment: 0.04,
    chat: 0.04,
    save: 0.05,
    follow: 0.06,
    interested: 0.06,
    join: 0.08,
    connect: 0.08,
    openLoop: 0.08,
    resolveLoop: 0.04,
    rsvp: 0.1,
    repost: 0.04,
    reply: 0.04,
    /** Phase 5: watching a Drift item in the viewer (once per item). */
    watch: 0.03,
    /** Phase 5: opening a branch in Happening (once per node). */
    explore: 0.03,
    /** Phase 6A: posting, sharing or making a World (its interests grow). */
    create: 0.06,

    /**
     * Dislike = "show me less like this". Deliberately small so one tap can't
     * swing a World; it also feeds NEGATIVE below. Never shown publicly.
     */
    dislike: -0.04,
    undislike: 0.04,

    unlike: -0.03,
    unsave: -0.05,
    unfollow: -0.06,
    uninterested: -0.06,
    leave: -0.08,
    disconnect: -0.08,
    dismissLoop: -0.04,
    unrsvp: -0.1,
  } as Partial<Record<ActivityType, number>>,
  /** The first N interests of an object are primary and get the full nudge… */
  primaryInterests: 2,
  /** …the rest get this fraction, so joining Japan Trip mostly means "Japan". */
  secondaryFactor: 0.5,
  /** "High" affinity for wording like "You’ve been into Japan lately". */
  high: 0.6,
  /** Minimum affinity for an interest to count as a reason at all. */
  meaningful: 0.35,
  /** Phase 6A: interests you pick in onboarding start here (REAL accounts)… */
  onboarding: 0.5,
  /** …and their Worlds' secondary interests start lower (below the Happening threshold). */
  onboardingSecondary: 0.2,
  /** Seed values for the Phase 3 demo (Japan and Travel moderate). */
  seed: {
    i_startups: 0.6,
    i_travel: 0.5,
    i_japan: 0.45,
    i_food: 0.42,
    i_film: 0.4,
    i_photo: 0.4,
    i_ai: 0.38,
    i_creativity: 0.32,
    i_nightlife: 0.3,
    i_italy: 0.3,
    i_design: 0.2,
    i_science: 0.2,
    i_style: 0.15,
    i_vintage: 0.1,
  } as Record<string, number>,
};

// ─── Relevance (Boards, Moves, Stories) ─────────────────────────────────────

/**
 * relevance = interest affinity + board relationship + open-loop relevance
 *           + people you know + freshness + editorial  (+ tiny tiebreak)
 * Each part is 0..1; weights sum to 100 so a score reads as 0..100.
 */
export const RELEVANCE = {
  weights: {
    interest: 35,
    relationship: 20,
    loop: 20,
    social: 12,
    freshness: 5,
    editorial: 8,
  },
  /** Deterministic tiebreak from the id hash, never random. */
  tiebreak: 0.01,
  relationship: {
    joined: 1,
    owned: 1,
    rsvp: 1,
    interested: 0.8,
    saved: 0.7,
    /** You saved / voted / liked / commented on something inside the Board. */
    touched: 0.55,
    viewed: 0.15,
    /** Engagement flowing through a RELATED_TO Board edge. */
    relatedFactor: 0.5,
    /** A Move's own Board counts almost as much as the Move. */
    moveBoardFactor: 0.85,
  },
  loop: {
    /** The entity is explicitly linked to an active loop (SUPPORTS). */
    direct: 1,
    /** Via the entity's Board. */
    viaBoard: 0.8,
    /** Loop's primary interest is one of the entity's primary interests. */
    primaryInterest: 0.6,
    /** Any interest overlap. */
    anyInterest: 0.3,
    /** Each additional matching loop adds this (capped at 1). */
    extraLoop: 0.1,
  },
  social: {
    connection: 1,
    following: 0.6,
    /** Someone you haven't met but who is a strong match. */
    strongMatch: 0.45,
    /**
     * Phase 7A: someone you have a PRIVATE Crush on. A deliberately small,
     * silent personalisation signal: it never adds a reason or a name to any
     * sentence (so nothing on screen can reveal the Crush), and on its own it
     * is under a tenth of a full social score.
     */
    privateCrush: 0.15,
    /** Same signal for people suggestions, in matchScore points (scale ~30–100). */
    privateCrushPeople: 1,
    /** Sum needed for a full score. */
    full: 2,
  },
  /** Freshness per unseen change on the entity (capped at 1). */
  freshPerChange: 0.6,
};

// ─── People matching ────────────────────────────────────────────────────────

export const MATCH = {
  /** matchScore = base + span × Σ(weight × part), parts 0..1. */
  base: 30,
  span: 68,
  weights: {
    interests: 0.3,
    boards: 0.2,
    moves: 0.12,
    loops: 0.15,
    mutuals: 0.1,
    openTo: 0.08,
    place: 0.05,
  },
  /** Counts that saturate a part to 1. */
  boardsFull: 3,
  movesFull: 2,
  mutualsFull: 2,
  openToFull: 2,
  /** A following-overlap (you follow someone they're connected to) is worth this. */
  followOverlap: 0.5,
  /** At or above: counted in your Matches and suggested as someone to meet. */
  suggestAt: 60,
  /** At or above: shown as a "match" relationship (strong match). */
  strongAt: 78,
  /** Crossing this upward creates a NEW_MATCH change event. */
  newMatchAt: 85,
  /** A rise this large since the session baseline creates PERSON_BECAME_RELEVANT. */
  becameRelevantDelta: 6,
};

// ─── Open Loops ─────────────────────────────────────────────────────────────

/**
 * Progress is derived from the graph, never typed in. Each step is worth
 * its weight; steps with no possible candidate are left out of the total.
 * Open loops cap below 100 until the user marks them resolved.
 */
export const LOOP_PROGRESS = {
  steps: {
    board: 20, // joined a Board that supports the loop
    follow: 15, // followed someone who fits it
    connect: 30, // connected with someone who fits it
    chat: 20, // started a conversation with them
    move: 15, // interested in / RSVP'd to a Move that fits it
  },
  openCap: 95,
};

/** Loops Chimp suggests once affinity for their primary interest reaches this. */
export const SUGGEST_LOOP_AT = 0.4;

// ─── World Delta release ────────────────────────────────────────────────────

export const RELEASE = {
  /** Minimum time away before anything is released. */
  awayThresholdMs: 10 * 60 * 1000,
  /** [upper bound of time away in minutes, number of changes released]. */
  schedule: [
    [30, 1],
    [120, 2],
    [Infinity, 3],
  ] as [number, number][],
  /** Keep the change log finite. */
  maxStored: 40,
  /** Spacing between released changes' timestamps. */
  spacingMs: 7 * 60 * 1000,
};

// ─── Negative feedback (dislike) ────────────────────────────────────────────

/**
 * Penalties (in score points, 0..100 scale) applied to Buzz and Drift items
 * similar to ones you disliked: same World, or sharing its interests.
 * Capped so a single dislike nudges rather than buries.
 */
export const NEGATIVE = {
  perSameBoard: 6,
  perSharedInterest: 2.5,
  /** Same author you disliked before. */
  perSameAuthor: 3,
  maxPenalty: 16,
};

// ─── Surfaces (Phase 4) ─────────────────────────────────────────────────────

/** Buzz and Drift reuse the relevance parts with their own weights (sum 100). */
export const SURFACE_WEIGHTS = {
  buzz: { interest: 30, relationship: 18, loop: 10, social: 18, freshness: 14, editorial: 10 },
  drift: { interest: 34, relationship: 18, loop: 8, social: 16, freshness: 14, editorial: 10 },
};

/** Trending decays popularity with age (hours) — used only on the Trending tab. */
export const TRENDING = { halfLifeHours: 10 };

/** Happening only shows items with real graph context; below this they're dropped. */
export const HAPPENING = { minScore: 30, maxItems: 14, nodes: 7 };

/** Which entity kinds get freshness pips. */
export const PIP_KINDS: EntityKind[] = ['board', 'move', 'person', 'post', 'story'];

// ─── Living Worlds: Board "Today" edition (Phase 5) ─────────────────────────

/**
 * A World's Today edition is ordered by: an editorial base per module,
 * plus a personal boost from what you've done *inside this World*
 * (watching its Drift lifts Watch, saving its posts lifts Top post,
 * following its people lifts From your people), plus a little of the
 * module's best item relevance. Items inside modules use the shared
 * scorers plus a nudge from the World's topics you care about.
 */
export const EDITION = {
  base: { buzzing: 60, news: 58, top: 55, watch: 50, stories: 46, people: 44, trending: 40 },
  boost: {
    /** Per action of that kind inside the World. */
    buzzing: 5,
    top: 6,
    watch: 8,
    people: 6,
    /** Unseen story changes in this World. */
    fresh: 6,
    /** × the module's best item score (0..100). */
    relevance: 0.1,
    /** × your affinity for the World's strongest topic (0..1). */
    topic: 10,
    cap: 20,
  },
  /** × topic affinity (0..1), added to an item's score. */
  topicWeight: 10,
  /** Buzzing mixes relevance with heat (log10 of decayed likes) × this. */
  heatWeight: 4,
  /** Cover/lead bias per format. */
  lead: { news: 4, drift: 0, post: -2 },
};

// ─── Opportunity signals (Phase 7C) ─────────────────────────────────────────

/**
 * Phase 7C: every ranked thing (a person, a Buzz, a Happening change, a
 * Discover card) is scored from the same decomposed signals, each 0..1:
 *
 *   opportunity = Σ weight × signal  −  Σ penalty × penaltySignal     (× 100)
 *
 *   relevance      does it fit who you are (interests, Worlds, match parts)
 *   timing         is it relevant NOW (recency half-lives + interest momentum)
 *   relationship   people / Worlds you already have a tie with
 *   intent         things you said you want (Open Loops, Open To, saves, RSVPs)
 *   actionability  is there something concrete to do (an opener, a poll, a plan)
 *   novelty        new to you (not already followed, not seen before)
 *   confidence     how much evidence the score rests on
 *   repetition     you saw it in an earlier sitting and didn't act
 *   saturation     you've seen it in many sittings without acting
 *   safety         a gate, not a weight: unsafe = never ranked
 *
 * Weights per surface sum to 1. Nothing here is ever shown to people as a
 * number: the UI only shows plain reasons. No percentages are invented.
 */
export const SIGNALS = {
  people: { relevance: 0.5, relationship: 0.12, timing: 0.12, intent: 0.1, actionability: 0.08, novelty: 0.05, confidence: 0.03 },
  buzz: { relevance: 0.34, relationship: 0.24, timing: 0.18, intent: 0.08, actionability: 0.06, novelty: 0.06, confidence: 0.04 },
  happening: { relevance: 0.3, relationship: 0.15, timing: 0.25, intent: 0.15, actionability: 0.08, novelty: 0.05, confidence: 0.02 },
  discover: { relevance: 0.4, relationship: 0.2, timing: 0.1, intent: 0.15, actionability: 0.05, novelty: 0.08, confidence: 0.02 },
  /** Points removed at full penalty (score scale 0..100). */
  penalties: { repetition: 10, saturation: 20 },
  /**
   * Strong, recent intent (you saved it, joined its World, opened a loop on
   * it) cancels up to this share of saturation: relevance can recover.
   */
  intentRecovery: 0.75,
};

/**
 * Half-life (hours) of each kind of action when it is used as a TIMING
 * signal. Affinity itself still never decays (it is "static interest");
 * these half-lives measure "is this interest becoming relevant right now".
 */
export const DECAY = {
  halfLifeHours: {
    open: 24,
    storyView: 24,
    watch: 36,
    explore: 36,
    like: 72,
    vote: 72,
    dislike: 336,
    comment: 120,
    reply: 120,
    repost: 120,
    chat: 168,
    save: 336,
    interested: 336,
    rsvp: 504,
    create: 336,
    follow: 720,
    join: 720,
    connect: 1440,
    openLoop: 720,
    resolveLoop: 168,
  } as Partial<Record<ActivityType, number>>,
  /** Any action not listed. */
  defaultHours: 168,
  /** A Buzz post's own timing (age) half-life. */
  contentHours: 24,
};

export const MOMENTUM = {
  /** Sum of decayed affinity gains on an interest that counts as full momentum. */
  full: 0.2,
  /**
   * Momentum is about THIS WEEK: an action's momentum half-life is its
   * DECAY half-life capped here (a join still counts as intent for a month,
   * but as momentum for days).
   */
  maxHalfLifeHours: 96,
  /** Actions that express INTENT (not just attention). */
  intentTypes: ['save', 'join', 'rsvp', 'interested', 'openLoop', 'follow', 'connect', 'create'] as ActivityType[],
  /** Sum of decayed intent actions that counts as full intent. */
  intentFull: 1.5,
};

/**
 * Exposure (what you've already been shown). Counted per SITTING, not per
 * render: two impressions closer than `sittingGapMin` are one sitting.
 * Rankings read a snapshot taken when a sitting starts, so a list never
 * reshuffles under your thumb, and nothing from the current sitting counts.
 */
export const EXPOSURE = {
  sittingGapMin: 30,
  /** Seen in an earlier sitting within this window → repetition (decays). */
  repeatHalfLifeHours: 24,
  /** Saturation starts at this many sittings without acting… */
  saturationFrom: 3,
  /** …and is full here. */
  saturationFull: 7,
  /** Keep the store finite. */
  maxKeys: 600,
  maxSelections: 40,
};

/** Kill switches: false = the pre-7C ordering for that surface (reversible). */
export const INTELLIGENCE = {
  people: true,
  buzzForYou: true,
  happening: true,
  discover: true,
};

// ─── Happening: the horizontal interest graph (Phase 5) ─────────────────────

export const HAPPENING_GRAPH = {
  /** A World at or above this strength shows its extra ("strong") branch. */
  strongAt: 62,
  /** Node diameters (pt) scale with strength 0..100. */
  major: { min: 78, max: 104 },
  minor: { min: 42, max: 54 },
  child: 50,
  /** Horizontal room a branch takes when you open it. */
  expandWidth: 170,
};
