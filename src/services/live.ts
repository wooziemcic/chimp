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
 * and foreground catch-up (store/useChat.ts).
 *
 * Priority on foreground: relationships first (small, and what people notice
 * — a request, an accept), then After Dark if it's open, then the full world
 * only if it's old.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { fetchPeople } from '@/services/backend/content';
import { diag, withRetry } from '@/services/backend/errors';
import { toUser } from '@/services/backend/mappers';
import { fetchRelationships, subscribeUserEvents, type UserEventRow } from '@/services/backend/people';
import * as realData from '@/services/backend/realData';
import { repo } from '@/services/repository';
import { useAfterDark } from '@/store/useAfterDark';
import { relationshipWrites, useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';

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
  /** While the channel is down: re-read once soon, then this often. */
  firstFallbackMs: 3_000,
  fallbackMs: 20_000,
  /** Resubscribe backoff after the channel closes on us. */
  backoffMs: [2_000, 4_000, 8_000, 15_000, 30_000],
  /** A channel that errored and hasn't rejoined by itself after this long is replaced. */
  stuckMs: 8_000,
  /** Foreground: re-read relationships if older than this. */
  relationshipsStaleMs: 5_000,
  /** Foreground: After Dark if older than this. */
  afterDarkStaleMs: 15_000,
  /** Foreground: the whole world if older than this. */
  worldStaleMs: 10 * 60_000,
};

let uid: string | null = null;
let unsubscribe: (() => void) | null = null;
let appSub: { remove: () => void } | null = null;
let adSub: (() => void) | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let fallback: ReturnType<typeof setInterval> | null = null;
let firstFallback: ReturnType<typeof setTimeout> | null = null;
let resubscribe: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let worldAt = 0;
let running: Promise<void> | null = null;
let again = false;
let lastAppState: AppStateStatus = AppState.currentState;

const RELATIONSHIP_EVENTS = new Set(['connection_request', 'connection_accepted', 'connection_updated', 'mutual_crush', 'relationship_updated']);
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

function startFallback() {
  if (fallback) return;
  const tick = () => {
    if (AppState.currentState === 'active') void foreground('fallback');
  };
  // One quick catch-up soon after the drop, then a slow re-read until the channel is back.
  firstFallback = setTimeout(tick, LIVE.firstFallbackMs);
  fallback = setInterval(tick, LIVE.fallbackMs);
}
function stopFallback() {
  if (fallback) clearInterval(fallback);
  fallback = null;
  if (firstFallback) clearTimeout(firstFallback);
  firstFallback = null;
}

/** Which channel is current (a replaced channel's late callbacks are ignored). */
let generation = 0;

function subscribe(me: string) {
  const gen = ++generation;
  unsubscribe?.();
  useLive.setState({ status: attempts ? 'reconnecting' : 'connecting' });
  unsubscribe = subscribeUserEvents(
    me,
    (row) => {
      if (uid !== me || gen !== generation) return;
      diag('event', { kind: row.kind });
      routeEvent(row);
    },
    (status) => {
      if (uid !== me || gen !== generation) return;
      diag('events channel', { status });
      if (status === 'SUBSCRIBED') {
        const wasDown = useLive.getState().status !== 'connecting' || attempts > 0;
        attempts = 0;
        stopFallback();
        if (resubscribe) clearTimeout(resubscribe);
        resubscribe = null;
        useLive.setState({ status: 'live' });
        // Anything that happened while we weren't listening (on the first
        // subscribe: between the world load and now).
        void foreground(wasDown ? 'reconnect' : 'subscribed');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // supabase-js rejoins by itself; until then, re-read slowly — and if it
        // doesn't come back, replace the channel.
        useLive.setState({ status: 'reconnecting' });
        startFallback();
        retryLater(me, LIVE.stuckMs);
      } else if (status === 'CLOSED') {
        // Closed under us (not by stopLive): subscribe again with backoff.
        useLive.setState({ status: 'reconnecting' });
        startFallback();
        retryLater(me, LIVE.backoffMs[Math.min(attempts, LIVE.backoffMs.length - 1)]);
      }
    },
  );
}

function retryLater(me: string, wait: number) {
  if (resubscribe) return;
  attempts++;
  resubscribe = setTimeout(() => {
    resubscribe = null;
    if (uid === me && useLive.getState().status !== 'live') subscribe(me);
  }, wait);
}

/** Coming back to the app (or a reconnect): re-read what may have changed, most important first. */
export async function foreground(reason: string): Promise<void> {
  const me = uid;
  if (!me) return;
  if (Date.now() - useLive.getState().syncedAt > LIVE.relationshipsStaleMs || reason !== 'foreground') await reconcileRelationships(reason);
  if (uid !== me) return;
  useAfterDark.getState().refreshIfActive(reason === 'foreground' ? LIVE.afterDarkStaleMs : 0);
  if (Date.now() - worldAt > LIVE.worldStaleMs) {
    worldAt = Date.now();
    void useSession.getState().refresh();
  }
}

/** REAL accounts only. Idempotent; torn down on every account change. */
export function startLive(me: string): void {
  if (uid === me && unsubscribe) return;
  stopLive();
  uid = me;
  attempts = 0;
  worldAt = Date.now();
  useLive.setState({ status: 'connecting', syncedAt: Date.now(), vibeHint: false });
  subscribe(me);
  // Opening After Dark loads the requests: the hint has done its job.
  adSub = useAfterDark.subscribe((s) => {
    if (s.uid && useLive.getState().vibeHint) useLive.setState({ vibeHint: false });
  });
  appSub = AppState.addEventListener('change', (state) => {
    const was = lastAppState;
    lastAppState = state;
    if (state === 'active' && was !== 'active' && uid === me) void foreground('foreground');
  });
}

export function stopLive(): void {
  uid = null;
  generation++;
  unsubscribe?.();
  unsubscribe = null;
  appSub?.remove();
  appSub = null;
  adSub?.();
  adSub = null;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  if (resubscribe) clearTimeout(resubscribe);
  resubscribe = null;
  stopFallback();
  again = false;
  useLive.setState({ status: 'off', syncedAt: 0, vibeHint: false });
}
