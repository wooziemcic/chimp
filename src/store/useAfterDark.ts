/**
 * Phase 7A — After Dark v2 state. Not persisted: the backend is the source of
 * truth (REAL: Supabase via 0007; Demo: services/demoAfterDark.ts).
 *
 *   profile     your After Dark card (age, intent, Open Loop, photos, Discover opt-in)
 *   discover    cards of adults who opted in (never a score)
 *   vibes       the pair objects you're in (pending / active / paused / closed)
 *   challenges  + answers (theirs only once both have answered)
 *   loops       Open Loops and Plans of your Vibes
 *
 * A Vibe's chat is an ordinary conversation of kind 'vibe' handled by the
 * chat store (useChat): messages, voice notes, view-once photos, reactions,
 * Open Loops. Normal Messages never lists it; this store claims its live
 * messages so the chat list isn't disturbed.
 *
 * Crush stays the private Chimp primitive (useChimp.toggleCrush). A mutual
 * Crush only OFFERS "Start normal chat" or "Take it After Dark"; nothing is
 * unlocked until the other person accepts the Vibe.
 */
import { create } from 'zustand';

import type { ChallengeKind } from '@/data/afterDarkChallenges';
import type { AdProfilePatch, AdProfileRow, AnswerRow, ChallengeRow, DiscoverRow, EndReason, ReportReason, VibeOrigin, VibeRow } from '@/services/backend/afterDark';
import type { LoopRow } from '@/services/backend/chat';
import { fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import type { PickedImage } from '@/services/backend/media';
import { type AfterDarkApi, realAfterDarkApi } from '@/services/afterDarkApi';
import { userMessage } from '@/services/backend/errors';
import { ds } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { User } from '@/types/models';
import { claimConversations, useChat } from './useChat';
import { useChimp } from './useChimp';
import { onAccountChange } from './useSession';
import { logEvent } from '@/services/analytics';

export interface AdState {
  uid?: string;
  demo: boolean;
  loaded: boolean;
  error?: string;
  profile: AdProfileRow | null;
  profileLoaded: boolean;
  discover: DiscoverRow[];
  discoverLoaded: boolean;
  vibes: VibeRow[];
  challenges: ChallengeRow[];
  answers: AnswerRow[];
  loops: LoopRow[];
  /** People in your Vibes who aren't in the loaded world (REAL). */
  people: Record<string, User>;
  /** Phase 7B: the live channel (a dropped channel is reconciled on reconnect). */
  live: 'off' | 'connecting' | 'live' | 'error';
  /** When Vibes were last loaded from the server (ms). */
  refreshedAt: number;

  start: (uid: string, api?: AfterDarkApi) => Promise<void>;
  /**
   * The signed-in account After Dark WOULD use. Nothing is loaded and no
   * Realtime channel opens until activate() — i.e. until someone actually
   * goes into After Dark (or acts on a mutual Crush). People who never use
   * After Dark make no After Dark requests at all.
   */
  bind: (uid: string, api: AfterDarkApi) => void;
  activate: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  loadDiscover: () => Promise<void>;
  saveProfile: (patch: AdProfilePatch) => Promise<AdProfileRow>;
  uploadCardPhoto: (img: PickedImage) => Promise<string>;
  photoUrl: (path: string | null | undefined) => string | undefined;

  pass: (personId: string) => Promise<void>;
  /** Ask for a Vibe (pending until they accept). Returns the Vibe id. */
  requestVibe: (personId: string, origin: VibeOrigin, originText?: string | null) => Promise<string>;
  respond: (vibeId: string, accept: boolean) => Promise<void>;
  pause: (vibeId: string) => Promise<void>;
  resume: (vibeId: string) => Promise<void>;
  end: (vibeId: string, reason: EndReason, note?: string) => Promise<void>;
  /** End the Vibe and block the person everywhere in Chimp. */
  block: (vibeId: string) => Promise<void>;
  report: (personId: string, reason: ReportReason, note?: string, vibeId?: string) => Promise<void>;
  setControls: (vibeId: string, patch: { photos?: boolean; voice?: boolean }) => Promise<void>;
  /** Phase 7B patch: ask the server whether this may be sent into the Vibe now (null = couldn't tell). */
  canSend: (conversationId: string, type: 'photo' | 'voice' | 'text', viewOnce: boolean) => Promise<boolean | null>;

  sendChallenge: (vibeId: string, kind: ChallengeKind, deck: string, note?: string) => Promise<string>;
  answerChallenge: (challengeId: string, answers: number[]) => Promise<'waiting' | 'completed'>;
  refreshLoops: () => Promise<void>;
  /** Phase 7B: reload if After Dark is running and what we show is older than `maxAgeMs`. */
  refreshIfActive: (maxAgeMs?: number) => void;
  /** Phase 7B: something changed for you (a user_events row); reload soon if After Dark is running. */
  noteEvent: () => void;
  /** Phase 7B (Two Truths): three statements, one of them the lie (0–2). */
  sendTwoTruths: (vibeId: string, statements: string[], lie: number, note?: string) => Promise<string>;
}

let api: AfterDarkApi = realAfterDarkApi;
let unsubscribe: (() => void) | null = null;
let unclaim: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let loopsTimer: ReturnType<typeof setTimeout> | null = null;
/** Conversation ids of my Vibes (for claiming their live messages). */
let vibeConvs = new Set<string>();
let bound: { uid: string; api: AfterDarkApi } | null = null;
/** Something asked for After Dark before the account was bound (e.g. a deep link at launch). */
let wanted = false;

const EMPTY = {
  uid: undefined,
  demo: false,
  loaded: false,
  error: undefined,
  profile: null,
  profileLoaded: false,
  discover: [],
  discoverLoaded: false,
  vibes: [],
  challenges: [],
  answers: [],
  loops: [],
  people: {},
  live: 'off' as const,
  refreshedAt: 0,
};


export const useAfterDark = create<AdState>((set, get) => {
  const ensurePeople = async (ids: string[]) => {
    if (api.demo) return;
    const missing = [...new Set(ids)].filter((id) => !repo.user(id) && !get().people[id]);
    if (!missing.length) return;
    try {
      const rows = await fetchPeople(missing);
      set({ people: { ...get().people, ...Object.fromEntries(rows.map((p) => [p.id, toUser(p)])) } });
    } catch {
      // Names fall back to "Someone"; nothing else depends on it.
    }
  };

  const refreshSoon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void get().refresh();
    }, 300);
  };

  const loopsSoon = () => {
    if (loopsTimer) clearTimeout(loopsTimer);
    loopsTimer = setTimeout(() => {
      loopsTimer = null;
      // Plans also change the Vibe list's counts.
      void get().refresh();
    }, 300);
  };

  /** Run an action for the current account only; refresh afterwards. */
  const act = async <T>(fn: () => Promise<T>, after: 'all' | 'discover' | 'none' = 'all'): Promise<T> => {
    const uid = get().uid;
    if (!uid) throw new Error('You’re signed out.');
    const res = await fn();
    if (get().uid !== uid) return res;
    if (after === 'all') await get().refresh();
    if (after === 'discover') await get().loadDiscover();
    return res;
  };

  return {
    ...EMPTY,

    start: async (uid, which = realAfterDarkApi) => {
      if (get().uid === uid && api === which && unsubscribe) return;
      get().stop();
      bound = { uid, api: which };
      api = which;
      set({ uid, demo: which.demo, live: 'connecting' });
      unsubscribe = api.subscribe(uid, refreshSoon, {
        // Plans / Open Loops: only the ones in my Vibes matter here (normal chats have their own).
        onLoop: (cid) => {
          if (vibeConvs.has(cid)) loopsSoon();
        },
        onStatus: (status) => {
          if (get().uid !== uid) return;
          const was = get().live;
          if (status === 'SUBSCRIBED') {
            set({ live: 'live' });
            // Back after a drop: catch up on anything missed meanwhile.
            if (was === 'error') refreshSoon();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (unsubscribe) set({ live: 'error' });
          }
        },
      });
      unclaim = claimConversations((row) => {
        if (!vibeConvs.has(row.conversation_id)) return false;
        refreshSoon(); // last message / unread for the Vibes list
        return true;
      });
      await get().refresh();
    },

    bind: (uid, which) => {
      if (bound && (bound.uid !== uid || bound.api !== which)) get().stop();
      bound = { uid, api: which };
      if (wanted) get().activate();
    },

    activate: () => {
      wanted = true;
      if (!bound || (get().uid === bound.uid && api === bound.api && unsubscribe)) return;
      void get().start(bound.uid, bound.api);
    },

    stop: () => {
      bound = null;
      wanted = false;
      unsubscribe?.();
      unsubscribe = null;
      unclaim?.();
      unclaim = null;
      if (timer) clearTimeout(timer);
      timer = null;
      if (loopsTimer) clearTimeout(loopsTimer);
      loopsTimer = null;
      vibeConvs = new Set();
      api = realAfterDarkApi;
      set({ ...EMPTY });
    },

    refresh: async () => {
      const uid = get().uid;
      if (!uid) return;
      const using = api;
      try {
        const [profile, vibes] = await Promise.all([using.fetchMyProfile(uid), using.myVibes()]);
        if (get().uid !== uid || api !== using) return;
        vibeConvs = new Set(vibes.map((v) => v.conversation_id));
        const ids = vibes.map((v) => v.vibe_id);
        const [challenges, loops] = await Promise.all([using.fetchChallenges(ids), using.fetchVibeLoops(vibes.map((v) => v.conversation_id))]);
        const answers = await using.fetchAnswers(challenges.map((c) => c.id));
        if (get().uid !== uid || api !== using) return;
        set({ profile, profileLoaded: true, vibes, challenges, answers, loops, loaded: true, error: undefined, refreshedAt: Date.now() });
        void ensurePeople(vibes.map((v) => v.other_id));
      } catch (e) {
        if (get().uid === uid) set({ error: userMessage(e, 'Couldn’t load After Dark. Try again.'), loaded: true, profileLoaded: true });
      }
    },

    loadDiscover: async () => {
      const uid = get().uid;
      if (!uid) return;
      const using = api;
      try {
        const rows = await using.discover();
        if (get().uid !== uid || api !== using) return;
        set({ discover: rows, discoverLoaded: true, error: undefined });
      } catch (e) {
        if (get().uid === uid) set({ error: userMessage(e, 'Couldn’t load Discover. Try again.'), discoverLoaded: true });
      }
    },

    saveProfile: async (patch) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out.');
      const row = await api.saveProfile(uid, patch);
      if (get().uid === uid) set({ profile: row, profileLoaded: true });
      return row;
    },
    uploadCardPhoto: async (img) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out.');
      return api.uploadCardPhoto(uid, img);
    },
    photoUrl: (path) => api.photoUrl(path),

    pass: async (personId) => {
      // Optimistic: the card goes away now.
      set({ discover: get().discover.filter((d) => d.user_id !== personId) });
      await act(() => api.pass(get().uid!, personId), 'none');
      logEvent('discover_pass', { surface: 'discover' }); // never who
    },
    requestVibe: async (personId, origin, originText) => {
      const id = await act(() => api.requestVibe(personId, origin, originText ?? null));
      logEvent('vibe_request', { targetType: 'vibe', targetId: id, surface: 'discover', context: { origin } });
      set({ discover: get().discover.filter((d) => d.user_id !== personId) });
      return id;
    },
    respond: async (vibeId, accept) => {
      try {
        await act(() => api.respondVibe(vibeId, accept));
        logEvent(accept ? 'vibe_accept' : 'vibe_decline', { targetType: 'vibe', targetId: vibeId, surface: 'vibes' });
      } catch (e) {
        // e.g. "This request expired." — show what the server now says.
        void get().refresh();
        throw e;
      }
    },
    pause: (vibeId) => {
      logEvent('vibe_pause', { targetType: 'vibe', targetId: vibeId });
      return act(() => api.pauseVibe(vibeId));
    },
    resume: (vibeId) => act(() => api.resumeVibe(vibeId)),
    end: (vibeId, reason, note) => {
      // The reason category only (a fixed list); never the note.
      logEvent('vibe_close', { targetType: 'vibe', targetId: vibeId, context: { reason } });
      return act(() => api.endVibe(vibeId, reason, note));
    },
    block: async (vibeId) => {
      const v = get().vibes.find((x) => x.vibe_id === vibeId);
      if (!v) return;
      if (v.status !== 'closed') await act(() => api.endVibe(vibeId, 'blocked'), 'none');
      if (!useChimp.getState().blocked[v.other_id]) useChimp.getState().toggleBlock(v.other_id);
      await get().refresh();
    },
    report: (personId, reason, note, vibeId) => act(() => api.report(get().uid!, { subjectId: personId, vibeId, context: vibeId ? 'after_dark_vibe' : 'after_dark_profile', reason, note }), 'none'),
    canSend: (conversationId, type, viewOnce) => api.canSendInVibe(conversationId, type, viewOnce).catch(() => null),
    setControls: (vibeId, patch) => {
      if (patch.photos !== undefined) logEvent('photo_consent_change', { targetType: 'vibe', targetId: vibeId, context: { photos: patch.photos } });
      return act(() => api.setVibeControls(vibeId, patch.photos ?? null, patch.voice ?? null));
    },

    sendChallenge: (vibeId, kind, deck, note) => {
      logEvent('challenge_send', { targetType: 'vibe', targetId: vibeId, context: { kind } });
      return act(() => api.sendChallenge(vibeId, kind, deck, note));
    },
    answerChallenge: (challengeId, answers) => {
      logEvent('challenge_answer', { targetType: 'challenge', targetId: challengeId });
      return act(() => api.answerChallenge(challengeId, answers));
    },
    refreshIfActive: (maxAgeMs = 15_000) => {
      if (!unsubscribe || !get().uid) return;
      if (Date.now() - get().refreshedAt > maxAgeMs) refreshSoon();
    },
    noteEvent: () => {
      if (unsubscribe && get().uid) refreshSoon();
    },
    sendTwoTruths: (vibeId, statements, lie, note) => act(() => api.sendTwoTruths(vibeId, statements, lie, note)),

    refreshLoops: async () => {
      const uid = get().uid;
      if (!uid) return;
      const loops = await api.fetchVibeLoops(get().vibes.map((v) => v.conversation_id));
      if (get().uid === uid) set({ loops });
    },
  };
});

// ─── Selectors / helpers ───────────────────────────────────────────────────

export const vibeById = (s: AdState, id: string | undefined) => s.vibes.find((v) => v.vibe_id === id);
export const vibeByConversation = (s: AdState, cid: string | undefined) => s.vibes.find((v) => v.conversation_id === cid);
/** Your current (not ended) Vibe with someone, if any. */
export const vibeWith = (s: AdState, personId: string) => s.vibes.find((v) => v.other_id === personId && v.status !== 'closed');

/** A person in After Dark: the loaded world first, then people fetched for Vibes. */
export function adUser(id: string | null | undefined): User | undefined {
  if (!id) return undefined;
  return repo.user(id) ?? useAfterDark.getState().people[id] ?? useChat.getState().people[id];
}
const firstOnly = (id: string | null | undefined, fallback: string) => (adUser(id)?.displayName ?? fallback).split(' ')[0];
/**
 * A person's first name in After Dark — with a last initial when two people
 * you have Vibes with share a first name ("Maya C." and "Maya T.").
 */
export function firstNameOf(id: string | null | undefined, fallback = 'Someone'): string {
  const first = firstOnly(id, fallback);
  if (!id) return first;
  const twin = useAfterDark.getState().vibes.some((v) => v.other_id !== id && v.status !== 'closed' && firstOnly(v.other_id, '') === first);
  const last = (adUser(id)?.displayName ?? '').split(' ').slice(1).join(' ');
  return twin && last ? `${first} ${last[0]}.` : first;
}

/**
 * Mutual Crushes that haven't become a Vibe (or ended one): you both chose
 * each other. REAL: my_sparks() (mutual only). Demo: seeded Crushes on you.
 * Never anyone blocked. Shown only to the two people involved.
 */
export function mutualCrushIds(crushes: Record<string, true | undefined>, blocked: Record<string, true | undefined>, vibes: VibeRow[]): string[] {
  const sparks = new Set(ds().sparkCandidates);
  return Object.keys(crushes).filter((id) => crushes[id] && sparks.has(id) && !blocked[id] && !vibes.some((v) => v.other_id === id));
}

/** A challenge from my point of view. */
export function challengeView(s: AdState, c: ChallengeRow, me: string | undefined) {
  const mine = s.answers.find((a) => a.challenge_id === c.id && a.user_id === me);
  const theirs = s.answers.find((a) => a.challenge_id === c.id && a.user_id !== me);
  const bucket: 'incoming' | 'waiting' | 'completed' = c.status === 'completed' ? 'completed' : mine ? 'waiting' : 'incoming';
  return { mine: mine?.answers, theirs: theirs?.answers, bucket };
}

// After Dark is bound to the signed-in account: torn down on every account change.
onAccountChange(() => useAfterDark.getState().stop());
