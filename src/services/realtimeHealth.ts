/**
 * Reliability patch — one owner for "the app is back" and "the network is
 * back", and one shape for every Realtime channel's lifecycle.
 *
 * WAKE
 *   One AppState listener and one NetInfo listener for the whole app (live.ts
 *   and the chat store used to each run their own resume catch-up). A wake
 *   first checks the shared Realtime socket — after iOS suspends the app, or
 *   when Wi-Fi ↔ cellular changes, the socket can look open while it's dead,
 *   and supabase-js only notices at its next heartbeat (up to ~50 s). We send
 *   a heartbeat now; no answer within a few seconds → the library's own
 *   reconnect runs at once (channels rejoin by themselves). Then each
 *   registered owner runs ONE catch-up.
 *
 * CHANNEL SUPERVISOR
 *   supabase-js already rejoins a channel after a drop. The supervisor only
 *   (a) reports SUBSCRIBED / down so its owner can catch up once, (b) gives up
 *   after repeated failures (a channel the server keeps refusing would
 *   otherwise rejoin every 10 s forever), and (c) re-subscribes after a
 *   server-side close with exponential backoff (capped), then pauses until
 *   the next wake. A paused channel costs nothing.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { isBackendConfigured, supabase } from '@/lib/supabase';
import { diag } from '@/services/backend/errors';

// ─── Wake ────────────────────────────────────────────────────────────────────

export type WakeReason = 'foreground' | 'network';

/** Tunables (exported for tests). */
export const HEALTH = {
  /** Wakes arriving together (AppState + NetInfo on the same resume) become one. */
  wakeDebounceMs: 300,
  /** A heartbeat answered this recently means the socket is fine: no probe. */
  okFreshMs: 5_000,
  /** No heartbeat answer within this long after a wake → reconnect now. */
  probeMs: 3_500,
  /** Network wakes closer together than this (a flapping link) only re-check the socket; no catch-up. */
  networkWakeMinMs: 20_000,
};

const wakeListeners = new Set<(reason: WakeReason) => void>();
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReason: WakeReason | null = null;
let watching = false;
let appSub: { remove: () => void } | null = null;
let netSub: (() => void) | null = null;
let lastApp: AppStateStatus = AppState.currentState;
let lastNet: { connected: boolean; type: string } | null = null;
let lastNetworkWakeAt = 0;
let deferredNetworkWake: ReturnType<typeof setTimeout> | null = null;

/** Run `cb` once per wake (resume from background, or the network coming back / changing). */
export function onWake(cb: (reason: WakeReason) => void): () => void {
  startWakeWatch();
  wakeListeners.add(cb);
  return () => {
    wakeListeners.delete(cb);
  };
}

/** Trigger a wake by hand (tests, and the wake watchers below). */
export function wake(reason: WakeReason): void {
  pendingReason = pendingReason === 'foreground' ? 'foreground' : reason;
  if (wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    const r = pendingReason ?? reason;
    pendingReason = null;
    diag('wake', { reason: r });
    probeRealtime();
    // A link flapping on and off: re-check the socket each time, but catch up at most once per
    // networkWakeMinMs — the last flap still gets its catch-up when the window ends.
    if (r === 'network') {
      const since = Date.now() - lastNetworkWakeAt;
      if (since < HEALTH.networkWakeMinMs) {
        if (!deferredNetworkWake)
          deferredNetworkWake = setTimeout(() => {
            deferredNetworkWake = null;
            wake('network');
          }, HEALTH.networkWakeMinMs - since);
        return;
      }
      lastNetworkWakeAt = Date.now();
    }
    for (const cb of [...wakeListeners]) {
      try {
        cb(r);
      } catch (e) {
        diag('wake listener failed', { error: e instanceof Error ? e.name : 'unknown' });
      }
    }
  }, HEALTH.wakeDebounceMs);
}

/** Exported for tests: what a NetInfo change means. */
export function netChange(prev: { connected: boolean; type: string } | null, next: { connected: boolean; type: string }): boolean {
  if (!prev) return false; // the first report is just the starting point
  if (!prev.connected && next.connected) return true; // back online
  return next.connected && prev.connected && prev.type !== next.type; // Wi-Fi ↔ cellular
}

function startWakeWatch() {
  if (watching) return;
  watching = true;
  appSub = AppState.addEventListener('change', (state) => {
    const was = lastApp;
    lastApp = state;
    if (state === 'active' && was !== 'active') wake('foreground');
  });
  try {
    netSub = NetInfo.addEventListener((s: NetInfoState) => {
      const next = { connected: s.isConnected !== false && s.isInternetReachable !== false, type: String(s.type) };
      const changed = netChange(lastNet, next);
      lastNet = next;
      if (changed) wake('network');
    });
  } catch {
    netSub = null; // no NetInfo (tests): AppState still wakes
  }
}

/** Tests / sign-out of the last account: stop watching. */
export function stopWakeWatch(): void {
  appSub?.remove();
  appSub = null;
  netSub?.();
  netSub = null;
  watching = false;
  lastNet = null;
  lastNetworkWakeAt = 0;
  if (deferredNetworkWake) clearTimeout(deferredNetworkWake);
  deferredNetworkWake = null;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  pendingReason = null;
}

// ─── Realtime socket probe ──────────────────────────────────────────────────

let heartbeatHooked = false;
let lastOkAt = 0;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

/** Exported for tests: when the socket last answered a heartbeat (ms). */
export const lastHeartbeatOk = () => lastOkAt;

/**
 * Is the shared Realtime socket really alive? Closed → connect now (instead of
 * waiting out the library's backoff). Open but silent → one heartbeat; still
 * silent after `probeMs` → a second heartbeat, which makes supabase-js tear the
 * dead socket down and reconnect at once. Channels then rejoin by themselves.
 */
export function probeRealtime(): void {
  if (!isBackendConfigured) return;
  let rt: ReturnType<typeof supabase>['realtime'];
  try {
    rt = supabase().realtime;
  } catch {
    return;
  }
  if (!rt?.getChannels || !rt.getChannels().length) return;
  if (!heartbeatHooked) {
    heartbeatHooked = true;
    rt.onHeartbeat((status) => {
      if (status === 'ok') lastOkAt = Date.now();
    });
  }
  if (!rt.isConnected()) {
    diag('realtime probe', { state: 'closed → connect' });
    rt.connect();
    return;
  }
  if (Date.now() - lastOkAt < HEALTH.okFreshMs || probeTimer) return;
  const t0 = Date.now();
  // A heartbeat already on its way (the library's own, often fired right at resume): don't send a
  // second one now — in phoenix that would count as a timeout and tear a healthy socket down. Wait for it.
  if (!rt.pendingHeartbeatRef) void rt.sendHeartbeat();
  probeTimer = setTimeout(() => {
    probeTimer = null;
    if (lastOkAt >= t0 || !rt.isConnected()) return;
    diag('realtime probe', { state: 'silent → reconnect' });
    void rt.sendHeartbeat(); // still waiting on a heartbeat → the library reconnects now
  }, HEALTH.probeMs);
}

// ─── Channel supervisor ─────────────────────────────────────────────────────

export type SupervisedStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'paused';

export interface SupervisorOptions {
  /** Diagnostics only (never ids or tokens). */
  name: string;
  /** Create the channel; return its unsubscribe. `onStatus` gets supabase-js subscribe statuses. */
  open: (onStatus: (status: string) => void) => () => void;
  /** SUBSCRIBED. `afterDown`: it was down (or replaced) since the last time — events may have been missed. */
  onLive?: (info: { first: boolean; afterDown: boolean }) => void;
  /** The channel went down (error, timeout or closed). */
  onDown?: () => void;
  onStatus?: (status: SupervisedStatus) => void;
}

/** Tunables (exported for tests). */
export const SUPERVISOR = {
  /** Failures in a row (no SUBSCRIBED in between) before the channel is parked until the next wake. */
  maxErrors: 5,
  /** Re-subscribe after a server-side close: exponential, capped; then park. */
  closedBackoffMs: [2_000, 5_000, 15_000, 45_000, 120_000],
  /** A parked channel tries once more after these (still in the foreground), then waits for a wake. */
  parkedRetryMs: [180_000, 600_000],
};

export class ChannelSupervisor {
  status: SupervisedStatus = 'off';
  private unsub: (() => void) | null = null;
  private gen = 0;
  private errors = 0;
  private closes = 0;
  private everLive = false;
  private downSinceLive = false;
  private parks = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Channels created so far (tests / diagnostics). */
  joins = 0;

  constructor(private opts: SupervisorOptions) {}

  start(): void {
    this.subscribe();
  }

  /** Resume / network back: a parked (or closed-and-waiting) channel tries again now. A live or rejoining one is left alone. */
  wake(): void {
    if (this.status === 'paused' || (this.status === 'reconnecting' && this.retry)) {
      this.errors = 0;
      this.closes = 0;
      this.parks = 0;
      this.subscribe();
    }
  }

  stop(): void {
    this.gen++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.unsub?.();
    this.unsub = null;
    this.set('off');
  }

  private set(s: SupervisedStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private subscribe() {
    const gen = ++this.gen;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    // The old channel goes BEFORE the new one exists (never two for one purpose).
    this.unsub?.();
    this.unsub = null;
    if (this.everLive) this.downSinceLive = true;
    this.set(this.everLive ? 'reconnecting' : 'connecting');
    this.joins++;
    this.unsub = this.opts.open((s) => {
      if (gen === this.gen) this.onChannel(s);
    });
  }

  private onChannel(s: string) {
    if (s === 'SUBSCRIBED') {
      const first = !this.everLive;
      const afterDown = this.downSinceLive;
      this.everLive = true;
      this.downSinceLive = false;
      this.errors = 0;
      this.closes = 0;
      this.parks = 0;
      this.set('live');
      this.opts.onLive?.({ first, afterDown });
      return;
    }
    if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
      this.downSinceLive = true;
      this.errors++;
      this.opts.onDown?.();
      if (this.errors >= SUPERVISOR.maxErrors) return this.park(`${this.errors} failures`);
      this.set('reconnecting'); // supabase-js rejoins this channel by itself
      return;
    }
    if (s === 'CLOSED') {
      // Closed under us (we never get here from stop(): the generation changed first).
      this.downSinceLive = true;
      this.opts.onDown?.();
      const wait = SUPERVISOR.closedBackoffMs[this.closes++];
      if (wait == null) return this.park('closed repeatedly');
      this.set('reconnecting');
      const gen = this.gen;
      this.retry = setTimeout(() => {
        this.retry = null;
        if (gen === this.gen) this.subscribe();
      }, wait);
    }
  }

  /** Stop trying (no rejoin loop) until the next wake. */
  private park(why: string) {
    diag('channel parked', { name: this.opts.name, why });
    this.gen++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.unsub?.();
    this.unsub = null;
    this.set('paused');
    // Still in the foreground on a poor link: a slow, bounded retry (then only a wake brings it back).
    const wait = SUPERVISOR.parkedRetryMs[this.parks++];
    if (wait != null) {
      const gen = this.gen;
      this.retry = setTimeout(() => {
        this.retry = null;
        if (gen !== this.gen || this.status !== 'paused') return;
        this.errors = 0;
        this.closes = 0;
        this.subscribe();
      }, wait);
    }
  }
}

// ─── Single-flight ──────────────────────────────────────────────────────────

/**
 * Coalesce a catch-up: a call while one is running doesn't start a second in
 * parallel — it runs exactly once more after the current one (so nothing that
 * happened during it is missed).
 */
export function singleFlight(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = fn()
      .catch(() => undefined)
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void run();
        }
      });
    return running;
  };
  return run;
}
