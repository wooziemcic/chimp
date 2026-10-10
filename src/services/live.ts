/**
 * Phase 7B — keeping a REAL account current on a real phone.
 *
 * Every piece of shared state follows the same recipe:
 *
 *   1. initial query            (world load, After Dark refresh, chat inbox)
 *   2. Realtime where it pays   (chat messages, After Dark rows, and ONE
 *                                 per-account `user_events` channel that says
 *                                 "something changed for you")
 *   3. foreground reconcile     (coming back to the app re-reads what may
 *                                 have changed while Realtime was asleep)
 *   4. reconnect reconcile      (a dropped channel that comes back re-reads;
 *                                 while it is down, a slow fallback re-reads)
 *   5. idempotent mutations     (set_connection & co. can be repeated safely)
 *
 * This module owns 2–4 for relationships (connections, requests, Crushes,
 * Sparks, blocks, follows) and nudges After Dark. Chat runs its own channel
 * and catch-up (store/useChat.ts).
 *
 * Reliability patch: the channel's lifecycle is a ChannelSupervisor and
 * "the app / network is back" comes from one shared wake (services/
 * realtimeHealth.ts). A failing channel no longer polls every 20 s and gets
 * replaced every 8 s forever: supabase-js rejoins it, the fallback re-read
 * backs off (3 s, then 30 s → 4 min) and stops, and after repeated failures the channel
 * is parked until the next wake. Activity events (likes, comments, replies,
 * World posts) refresh just that post (services/postSync.ts), not the world.
 *
 * Priority on foreground: relationships first (small, and what people notice
 * — a request, an accept), then After Dark if it's open, then the full world
 * only if it's old.
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { fetchPeople } from '@/services/backend/content';
import { diag, withRetry } from '@/services/backend/errors';
import { toUser } from '@/services/backend/mappers';
import { fetchRelationships, subscribeUserEvents, type UserEventRow } from '@/services/backend/people';
import * as realData from '@/services/backend/realData';
import { repo } from '@/services/repository';
import { useAfterDark } from '@/store/useAfterDark';
import { useArchives } from '@/store/useArchives';
import { usePins } from '@/store/usePins';
import { ACTIVITY_KINDS, isSocialKind, useSocialInbox } from '@/store/useSocialInbox';
import { relationshipWrites, useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { resetVideoPosters } from '@/services/videoPosters';
import { queuePostSync, resetPostSync } from '@/services/postSync';
import { ChannelSupervisor, onWake, singleFlight } from '@/services/realtimeHealth';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

interface LiveState {
  status: LiveStatus;
  /** Last time relationships were confirmed with the server (ms). */
  syncedAt: number;
  /** Someone asked you for a Vibe while After Dark wasn't open (a hint for its entry point). */
  vibeHint: boolean;
}
export const useLive = create<LiveState>(() => ({ status: 'off', syncedAt: 0, vibeHint: false }));

/** Tunables (exported for tests). */
export const LIVE = {
  /** Events arriving together become one reload. */
  debounceMs: 400,
  /**
   * While the channel is down: one quick re-read, then slower ones at these
   * delays, then nothing more until it's back or the next wake (was: 3 s,
   * then every 20 s, forever).
   */
  fallbackMs: [3_000, 30_000, 60_000, 120_000, 240_000],
  /** Foreground: re-read relationships if older than this. */
  relationshipsStaleMs: 5_000,
  /** Foreground: After Dark if older than this. */
  afterDarkStaleMs: 15_000,
  /** Foreground: the whole world if older than this. */
  worldStaleMs: 10 * 60_000,
  /** Pins / archives (only you change them) re-read at most this often. */
  listsStaleMs: 60_000,
};

let uid: string | null = null;
let supervisor: ChannelSupervisor | null = null;
let wakeSub: (() => void) | null = null;
let adSub: (() => void) | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let fallback: ReturnType<typeof setTimeout> | null = null;
let fallbackStep = 0;
let worldAt = 0;
let listsAt = 0;
let running: Promise<void> | null = null;
let again = false;

const RELATIONSHIP_EVENTS = new Set(['follow', 'connection_request', 'connection_accepted', 'connection_updated', 'mutual_crush', 'relationship_updated']);
const AFTER_DARK_EVENTS = new Set(['vibe_request', 'vibe_accepted', 'vibe_updated', 'challenge_your_turn', 'challenge_completed', 'plan_waiting', 'plan_updated']);

/** Re-read relationships now (one at a time; a call during a run queues one more). */
export function reconcileRelationships(reason: string): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const me = uid;
  if (!me) return Promise.resolve();
  running = (async () => {
    const started = Date.now();
    try {
      const r = await withRetry(() => fetchRelationships(me), { label: 'relationships' });
      if (uid !== me) return;
      // A Follow / Crush / Block / Connect of yours still on its way: this
      // snapshot may predate it. Don't flicker it back; read again shortly.
      const w = relationshipWrites();
      if (w.inFlight || w.at >= started) {
        diag('reconcile deferred', { reason });
        schedule(1_500);
        return;
      }
      useChimp.getState().applyRelationships(r);
      realData.setSparks(r.sparks);
      useLive.setState({ syncedAt: Date.now() });
      diag('reconciled', { reason, ms: Date.now() - started });
      // People we've never loaded (a brand-new account that just asked to connect).
      const unknown = [...new Set([...r.requestedOfMe, ...r.connected, ...r.requestedByMe, ...r.sparks])].filter((id) => !repo.user(id));
      if (unknown.length) {
        const rows = await fetchPeople(unknown).catch(() => []);
        if (uid === me && rows.length) realData.addPeople(rows.map(toUser));
      }
    } catch (e) {
      // Offline or the server is unhappy: what's on screen stays; the next trigger tries again.
      diag('reconcile failed', { reason, error: e instanceof Error ? e.name : 'unknown' });
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      schedule(0);
    }
  });
  return running;
}

function schedule(ms = LIVE.debounceMs) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void reconcileRelationships('event');
  }, ms);
}

/** What an event means for this phone. Exported for tests. */
export function routeEvent(e: Pick<UserEventRow, 'kind' | 'actor_id'>): 'relationships' | 'after_dark' | 'ignore' {
  if (RELATIONSHIP_EVENTS.has(e.kind)) {
    schedule();
    // A mutual Crush also changes After Dark's "It's mutual" list.
    if (e.kind === 'mutual_crush') useAfterDark.getState().noteEvent();
    return 'relationships';
  }
  if (AFTER_DARK_EVENTS.has(e.kind)) {
    const ad = useAfterDark.getState();
    if (ad.uid) ad.noteEvent();
    else if (e.kind === 'vibe_request') useLive.setState({ vibeHint: true });
    return 'after_dark';
  }
  return 'ignore';
}

/** While the channel is down: a few slow re-reads (backing off), then stop until it's back or the next wake. */
function startFallback() {
  if (fallback || fallbackStep >= LIVE.fallbackMs.length) return;
  fallback = setTimeout(() => {
    fallback = null;
    fallbackStep++;
    if (AppState.currentState === 'active') void foreground('fallback');
    if (supervisor && supervisor.status !== 'live' && supervisor.status !== 'paused') startFallback();
  }, LIVE.fallbackMs[fallbackStep]);
}
function stopFallback(reset = true) {
  if (fallback) clearTimeout(fallback);
  fallback = null;
  if (reset) fallbackStep = 0;
}

function onEvent(me: string, row: UserEventRow) {
  if (uid !== me) return;
  diag('event', { kind: row.kind });
  routeEvent(row);
  // Build 5 patch 2: follow / connection events also land in the in-app list.
  if (isSocialKind(row.kind)) {
    useSocialInbox.getState().add({ ...row, seen_at: row.seen_at ?? null });
    void ensurePeople([row.actor_id]);
  }
  // Phase 9 → reliability patch: activity refreshes just the post it's about.
  if (ACTIVITY_KINDS.has(row.kind)) routeActivity(row);
}

/**
 * What an activity event refreshes. Exported for tests.
 *   content_like            → that post's like total
 *   content_comment / reply → that Buzz's comments (and count)
 *   world_post              → that post, if it isn't loaded yet
 *   world_join              → the world, throttled (member lists live there)
 */
export function routeActivity(row: Pick<UserEventRow, 'kind' | 'ref_id' | 'ref_kind'>): 'post' | 'world' | 'ignore' {
  const kind = row.ref_kind === 'drift' ? 'drift' : row.ref_kind === 'buzz' ? 'buzz' : null;
  if (row.kind === 'world_join') {
    refreshWorldSoon();
    return 'world';
  }
  if (!kind || !row.ref_id) return 'ignore';
  if (row.kind === 'content_like') queuePostSync(kind, row.ref_id, { likes: true });
  else if (row.kind === 'content_comment' || row.kind === 'thread_reply') queuePostSync(kind, row.ref_id, { comments: true, likes: kind === 'drift' });
  else if (row.kind === 'world_post') queuePostSync(kind, row.ref_id, { row: true });
  else return 'ignore';
  return 'post';
}

function subscribe(me: string) {
  supervisor?.stop();
  supervisor = new ChannelSupervisor({
    name: 'events',
    open: (onStatus) => subscribeUserEvents(me, (row) => onEvent(me, row), onStatus),
    onStatus: (s) => {
      if (uid !== me) return;
      diag('events channel', { status: s });
      useLive.setState({ status: s === 'live' ? 'live' : s === 'off' ? 'off' : s === 'connecting' ? 'connecting' : 'reconnecting' });
      if (s === 'paused') stopFallback(false); // parked: nothing more until the next wake
    },
    onDown: () => {
      if (uid === me) startFallback();
    },
    onLive: ({ first, afterDown }) => {
      if (uid !== me) return;
      stopFallback();
      // Anything that happened while we weren't listening (on the first
      // subscribe: between the world load and now).
      void catchUp(afterDown || !first ? 'reconnect' : 'subscribed');
    },
  });
  supervisor.start();
}

/** One catch-up at a time; a request during a run → exactly one more after it. */
let catchUpReason = 'foreground';
const catchUpOnce = singleFlight(() => foreground(catchUpReason));
function catchUp(reason: string): Promise<void> {
  // A forced reason (reconnect) wins over a plain foreground for the queued run.
  if (reason !== 'foreground' || catchUpReason === 'foreground') catchUpReason = reason;
  return catchUpOnce();
}

/** Coming back to the app (or a reconnect): re-read what may have changed, most important first. */
export async function foreground(reason: string): Promise<void> {
  const me = uid;
  if (!me) return;
  catchUpReason = 'foreground';
  // Anything missed while Realtime was asleep (merged by id: never twice).
  void loadInbox(me);
  if (Date.now() - useLive.getState().syncedAt > LIVE.relationshipsStaleMs || reason !== 'foreground') await reconcileRelationships(reason);
  if (uid !== me) return;
  useAfterDark.getState().refreshIfActive(reason === 'foreground' ? LIVE.afterDarkStaleMs : 0);
  if (Date.now() - worldAt > LIVE.worldStaleMs) {
    worldAt = Date.now();
    void useSession.getState().refresh();
  }
}

/** Someone joined your World: the world (member lists live there), throttled. Likes / comments / posts never come here. */
let worldTimer: ReturnType<typeof setTimeout> | null = null;
export const WORLD_REFRESH_MIN_MS = 5 * 60_000;
function refreshWorldSoon() {
  if (worldTimer) return;
  worldTimer = setTimeout(() => {
    worldTimer = null;
    if (!uid || Date.now() - worldAt < WORLD_REFRESH_MIN_MS) return;
    worldAt = Date.now();
    void useSession.getState().refresh();
  }, 1_500);
}

/** Build 5 patch 2: load the in-app social list and the people it names. */
async function loadInbox(me: string): Promise<void> {
  // Pins / archives only change from your own taps (other phones rarely): not on every catch-up.
  if (Date.now() - listsAt > LIVE.listsStaleMs) {
    listsAt = Date.now();
    void usePins.getState().load(me, true); // Phase 9: pinned Worlds
    void useArchives.getState().load(me, true); // Phase 9.2: archived Boards
  }
  const before = new Set(useSocialInbox.getState().items.map((i) => i.id));
  await useSocialInbox.getState().load(me);
  if (uid !== me) return;
  // Activity that happened while Realtime was asleep (e.g. a like whose push you
  // just tapped): refresh those posts now, as if the events had arrived live.
  for (const e of useSocialInbox.getState().items) if (!before.has(e.id) && before.size && ACTIVITY_KINDS.has(e.kind)) routeActivity(e);
  await ensurePeople(useSocialInbox.getState().items.map((i) => i.actor_id));
}

/** Profiles we haven't loaded yet (e.g. a brand-new account that just followed you). */
async function ensurePeople(ids: (string | null)[]): Promise<void> {
  const me = uid;
  const unknown = [...new Set(ids.filter((id): id is string => !!id && !repo.user(id)))];
  if (!me || !unknown.length) return;
  const rows = await fetchPeople(unknown).catch(() => []);
  if (uid === me && rows.length) realData.addPeople(rows.map(toUser));
}

/** REAL accounts only. Idempotent; torn down on every account change. */
export function startLive(me: string): void {
  if (uid === me && supervisor) return;
  stopLive();
  uid = me;
  worldAt = Date.now();
  listsAt = 0;
  useLive.setState({ status: 'connecting', syncedAt: Date.now(), vibeHint: false });
  subscribe(me);
  // Opening After Dark loads the requests: the hint has done its job.
  adSub = useAfterDark.subscribe((s) => {
    if (s.uid && useLive.getState().vibeHint) useLive.setState({ vibeHint: false });
  });
  // Back from the background, or the network came back / changed: one catch-up.
  wakeSub = onWake((reason) => {
    if (uid !== me) return;
    stopFallback(); // a fresh start for the slow re-read if it's still down
    supervisor?.wake();
    void catchUp(reason === 'network' ? 'reconnect' : 'foreground');
  });
}

export function stopLive(): void {
  resetVideoPosters(); // Phase 9: no poster work for a signed-out account
  uid = null;
  supervisor?.stop();
  supervisor = null;
  wakeSub?.();
  wakeSub = null;
  adSub?.();
  adSub = null;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  if (worldTimer) clearTimeout(worldTimer);
  worldTimer = null;
  stopFallback();
  resetPostSync();
  again = false;
  useLive.setState({ status: 'off', syncedAt: 0, vibeHint: false });
  useSocialInbox.getState().reset();
  // A REAL account's pins / archive go with it (they're re-read on the next start).
  // The Demo's live on this phone and are never touched here (live never runs for it).
  if (usePins.getState().owner !== 'demo') usePins.getState().reset();
  if (useArchives.getState().owner !== 'demo') useArchives.getState().reset();
}
