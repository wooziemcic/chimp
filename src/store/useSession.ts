/**
 * Session & account mode (Phase 6A).
 *
 *   booting     → reading the saved mode and Supabase session
 *   signedOut   → Welcome / email / verify
 *   onboarding  → signed in, profile not finished (profile → phrase → interests → Open To)
 *   switching   → Phase 6B: an account change is in progress. The app's
 *                 screens are UNMOUNTED (root layout shows a transition
 *                 screen) while the local store bucket and the active dataset
 *                 are swapped together, so nothing renders half-swapped.
 *   ready       → the app (REAL account, or the DEMO account)
 *
 * DEMO and REAL never share state: each has its own persisted bucket for the
 * local graph (`chimp-store` = the WollyMc demo, `chimp-store:real:{uid}` =
 * a real account) and its own Dataset (see services/dataset.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { isBackendConfigured } from '@/lib/supabase';
import { currentUserId, deleteMyAccount, fetchAccess, onSessionEnded, signOutBackend, signOutLocal } from '@/services/backend/auth';
import { type ProfilePatch, type RealRaw, fetchLikeTotals, loadRealWorld, mapRealWorld, saveProfile as saveProfileRow } from '@/services/backend/content';
import { clearRealCache, readRealCache, writeRealCache } from '@/services/backend/realCache';
import type { ProfileRow } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { demoDataset, ds, emptyDataset, setDataset } from '@/services/dataset';
import type { AccountMode, OpenTo } from '@/types/models';
import { startupMark } from '@/utils/startup';
import { emptyCreations, realInitialData, useChimp } from './useChimp';

export type SessionStatus = 'booting' | 'signedOut' | 'onboarding' | 'switching' | 'ready';
export type OnboardingStep = 'profile-setup' | 'phrase' | 'interests' | 'open-to';

const MODE_KEY = 'chimp-account';
/** App Review Demo: the Demo opened from Welcome without signing in (see enterReviewDemo). */
const REVIEW_KEY = 'chimp-review-demo';
const DEMO_BUCKET = 'chimp-store';
const realBucket = (uid: string) => `chimp-store:real:${uid}`;

interface SessionState {
  status: SessionStatus;
  mode: AccountMode | null;
  uid?: string;
  /** Phase 6D: the verified email of the REAL account. */
  email?: string;
  /**
   * Phase 6D: developer tools are shown when the SERVER says this account is
   * a developer (my_access(): its verified email is on the developer list).
   * UI visibility only; the server enforces everything it protects.
   */
  developer: boolean;
  /**
   * App Review Demo: the seeded Demo opened from Welcome, with no account at
   * all (for Apple's reviewers). A banner offers "Exit App Review Demo", which
   * goes back to Welcome. Never a developer; never touches Supabase.
   */
  reviewDemo: boolean;
  profile: ProfileRow | null;
  /** Last load/sync problem, shown quietly (never blocks the app). */
  error?: string;
  syncing: boolean;
  boot: () => Promise<void>;
  /** After a successful OTP verification. */
  signedIn: (uid: string, email?: string) => Promise<void>;
  saveProfile: (patch: ProfilePatch) => Promise<ProfileRow>;
  finishOnboarding: () => Promise<void>;
  /** Re-load everything the REAL account can see (pull to refresh). */
  refresh: () => Promise<void>;
  /** Phase 6C: only the real like totals (Trending), cheap enough to repeat. */
  refreshLikes: () => Promise<void>;
  enterDemo: () => Promise<void>;
  /** From Welcome (signed out): the seeded Demo, fresh, no sign-in, no Supabase user. */
  enterReviewDemo: () => Promise<void>;
  /** Leave the App Review Demo → Welcome. */
  exitReviewDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Phase 6D: permanently delete the signed-in REAL account (server-side),
   * then forget it on this phone and return to Welcome. Throws, changing
   * nothing, if the server didn't delete it.
   */
  deleteAccount: (transferWorlds: boolean) => Promise<{ deletedWorlds: number; handedOnWorlds: number }>;
}

/** Which onboarding step a profile still needs (null = done). */
export function nextStep(p: ProfileRow | null): OnboardingStep | null {
  if (!p || !p.username || !p.display_name) return 'profile-setup';
  if (!p.profile_phrase) return 'phrase';
  if ((p.interests ?? []).length < 3) return 'interests';
  if (!p.onboarded_at) return 'open-to';
  return null;
}

/** Development-only trace of account transitions. */
function trace(step: string, extra?: Record<string, unknown>) {
  if (__DEV__) console.log(`[chimp:session] ${step}`, extra ? JSON.stringify(extra) : '');
}

/** Wait until React has committed the transition screen (the tabs are unmounted). */
const afterCommit = () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 0));

/**
 * Point the local graph store at a bucket; start it fresh if it doesn't
 * exist yet. Only ever called while the app is unmounted (`switching`).
 */
async function switchBucket(name: string, fresh: () => object) {
  useChimp.persist.setOptions({ name });
  const stored = await AsyncStorage.getItem(name);
  if (stored) await useChimp.persist.rehydrate();
  else useChimp.setState({ ...fresh() });
  trace('bucket', { name, restored: !!stored });
}

function profileEdits(p: ProfileRow) {
  return {
    avatarUri: p.avatar_url ?? undefined,
    bio: p.bio ?? '',
    city: p.city ?? '',
    openTo: (p.open_to ?? []) as OpenTo[],
    displayName: p.display_name ?? undefined,
    username: p.username ?? undefined,
    phrase: p.profile_phrase ?? undefined,
    emoji: p.profile_emoji ?? undefined,
    focusY: p.avatar_focus_y ?? 0.3,
  };
}

let unsubDemo: (() => void) | null = null;
let stopWatch: (() => void) | null = null;

function publishDemo() {
  const s = useChimp.getState();
  setDataset(demoDataset(s.created ?? emptyCreations(), { profilePhrase: s.profile.phrase ?? undefined, profileEmoji: s.profile.emoji ?? undefined }));
}

/** Things bound to the signed-in account (e.g. chat realtime) register a teardown here. */
const accountTeardowns = new Set<() => void>();
export function onAccountChange(fn: () => void): () => void {
  accountTeardowns.add(fn);
  return () => accountTeardowns.delete(fn);
}

export const useSession = create<SessionState>((set, get) => {
  /**
   * Every account change runs through here:
   *   1. status → switching (root layout unmounts every app screen)
   *   2. wait for that commit
   *   3. tear down account-bound work, then run `swap` (store bucket + dataset)
   *   4. `swap` sets the final status (ready / signedOut)
   * Serialised: a second change waits for the first to finish.
   */
  let chain: Promise<void> = Promise.resolve();
  const transition = (label: string, swap: () => Promise<void>) => {
    const run = async () => {
      const from = get().mode;
      trace(`${label}: start`, { from, status: get().status });
      set({ status: 'switching' });
      await afterCommit();
      for (const fn of [...accountTeardowns]) {
        try {
          fn();
        } catch (e) {
          trace('teardown failed', { error: String(e) });
        }
      }
      try {
        await swap();
        trace(`${label}: done`, { mode: get().mode, status: get().status, dataset: ds().mode, version: ds().version });
      } catch (e) {
        trace(`${label}: failed`, { error: e instanceof Error ? e.message : String(e) });
        // Never leave the app stuck on the transition screen.
        realData.stopReal();
        setDataset(emptyDataset());
        set({ status: 'signedOut', mode: null, uid: undefined, profile: null, error: e instanceof Error ? e.message : String(e) });
      }
    };
    chain = chain.then(run, run);
    return chain;
  };

  /**
   * Enter the REAL account: its own bucket, the backend world, the honest graph.
   * Call inside `transition`, or at boot (nothing is mounted yet then).
   * Phase 6C: `cached` = this account's last load, shown at once; refresh() follows.
   */
  const swapToReal = async (uid: string, profile: ProfileRow, cached?: RealRaw | null) => {
    unsubDemo?.();
    unsubDemo = null;
    setDataset(emptyDataset());
    await switchBucket(realBucket(uid), () => realInitialData({ ...profileEdits(profile), interests: profile.interests ?? [] }));
    // The backend profile is the source of truth for identity fields.
    useChimp.setState({ profile: { ...useChimp.getState().profile, ...profileEdits(profile) } });
    realData.startReal(uid, profile); // publishes the REAL dataset
    if (cached && cached.uid === uid) {
      const w = mapRealWorld(cached);
      realData.applyLoaded(w.profile ?? profile, w.parts, w.followerCount);
    }
    await AsyncStorage.setItem(MODE_KEY, 'real');
    set({ status: 'ready', mode: 'real', uid });
    startupMark(cached ? 'Buzz ready (cached world)' : 'Buzz ready (loading world)');
  };
  const enterReal = async (uid: string, profile: ProfileRow, cached?: RealRaw | null) => {
    // Phase 6C: at launch nothing is mounted yet, so there's nothing to switch away
    // from: no transition screen, straight to Buzz.
    if (get().status === 'booting') await swapToReal(uid, profile, cached);
    else await transition('enter REAL', () => swapToReal(uid, profile, cached));
    if (get().status === 'ready') {
      if (cached) void get().refresh();
      else await get().refresh();
    }
  };

  /**
   * Enter the seeded Demo. `fresh` (App Review Demo) starts it from the seeded
   * state, so every reviewer sees the same world.
   */
  const enterDemoWith = (fresh: boolean) => {
    const swap = async () => {
      // Leaving REAL: its session stays (a later sign-in is instant) but nothing of it stays in memory.
      realData.stopReal();
      setDataset(emptyDataset());
      await switchBucket(DEMO_BUCKET, () => ({}));
      if (fresh) useChimp.getState().resetDemo();
      publishDemo(); // the DEMO dataset, complete, before any screen mounts
      unsubDemo?.();
      unsubDemo = useChimp.subscribe((s, prev) => {
        if (s.created !== prev.created || s.profile.phrase !== prev.profile.phrase || s.profile.emoji !== prev.profile.emoji) publishDemo();
      });
      await AsyncStorage.setItem(MODE_KEY, 'demo');
      set({ status: 'ready', mode: 'demo', uid: undefined, email: undefined, profile: null });
      startupMark('Buzz ready (Demo)');
    };
    // At launch nothing is mounted: no transition screen needed (Phase 6C).
    return get().status === 'booting' ? swap() : transition('enter DEMO', swap);
  };

  /** Ask the server whether this account is a developer (never decided on the phone). */
  const loadAccess = async (uid: string) => {
    const { developer } = await fetchAccess();
    if (get().uid === uid) set({ developer });
  };

  return {
    status: 'booting',
    mode: null,
    developer: false,
    reviewDemo: false,
    profile: null,
    syncing: false,

    boot: async () => {
      startupMark('boot');
      // Phase 6D: sessions persist (AsyncStorage + auto refresh), so you verify
      // once per phone. If Supabase itself ends the session (refresh token
      // revoked, account deleted on another phone), return to Welcome cleanly.
      if (isBackendConfigured && !stopWatch) {
        stopWatch = onSessionEnded(() => {
          if (get().mode === 'real' && (get().status === 'ready' || get().status === 'onboarding')) {
            trace('session ended by Supabase');
            void get().signOut();
          }
        });
      }
      const mode = (await AsyncStorage.getItem(MODE_KEY)) as AccountMode | null;
      if (mode === 'demo') {
        // Relaunching inside the App Review Demo keeps its banner (and its way out).
        if ((await AsyncStorage.getItem(REVIEW_KEY)) === '1') set({ reviewDemo: true, developer: false });
        return get().enterDemo();
      }
      if (!isBackendConfigured) return set({ status: 'signedOut', mode: null });
      try {
        const u = await currentUserId();
        startupMark('session known', u ? 'signed in' : 'signed out');
        if (!u) return set({ status: 'signedOut', mode: null });
        // Phase 6C fast path: this account's last load is on the phone → Buzz now,
        // Supabase in the background. (Only this uid's cache; never another account's.)
        const cached = await readRealCache(u.id);
        if (cached?.profile && !nextStep(cached.profile)) {
          set({ uid: u.id, email: u.email, profile: cached.profile });
          void loadAccess(u.id);
          return await enterReal(u.id, cached.profile, cached);
        }
        await get().signedIn(u.id, u.email);
      } catch (e) {
        set({ status: 'signedOut', error: e instanceof Error ? e.message : String(e) });
      }
    },

    signedIn: async (uid, email) => {
      set({ uid, email, developer: false });
      void loadAccess(uid);
      const { fetchMyProfile } = await import('@/services/backend/content');
      const profile = await fetchMyProfile(uid);
      set({ profile });
      if (nextStep(profile)) {
        set({ status: 'onboarding', mode: 'real' });
        await AsyncStorage.setItem(MODE_KEY, 'real');
        return;
      }
      await enterReal(uid, profile!);
    },

    saveProfile: async (patch) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out. Sign in again.');
      const row = await saveProfileRow(uid, patch);
      set({ profile: row });
      if (get().status === 'ready') {
        realData.setProfile(row);
        useChimp.setState({ profile: { ...useChimp.getState().profile, ...profileEdits(row) } });
      }
      return row;
    },

    finishOnboarding: async () => {
      const row = await get().saveProfile({ onboarded_at: new Date().toISOString() });
      await enterReal(row.id, row);
    },

    refresh: async () => {
      const uid = get().uid;
      if (get().mode !== 'real' || !uid) return;
      set({ syncing: true });
      try {
        const world = await loadRealWorld(uid);
        // Signed out / switched while this was loading: drop it.
        if (get().mode !== 'real' || get().uid !== uid) return;
        realData.applyLoaded(world.profile, world.parts, world.followerCount);
        startupMark('fresh world loaded');
        void writeRealCache(world.raw);
        if (world.profile) set({ profile: world.profile });
        // The backend is the source of truth for your relationships and reactions.
        const flags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, true as const]));
        const r = (kind: string, target: string) => world.mine.reactions.filter((x) => x.kind === kind && x.target_kind === target).map((x) => x.target_id);
        useChimp.setState({
          joined: flags(world.mine.joined),
          savedBoards: flags(world.mine.saved),
          buzzLikes: flags(r('like', 'buzz')),
          buzzDislikes: flags(r('dislike', 'buzz')),
          buzzSaves: flags(r('save', 'buzz')),
          buzzReposts: flags(r('repost', 'buzz')),
          driftLikes: flags(r('like', 'drift')),
          driftSaves: flags(r('save', 'drift')),
          driftDislikes: flags(r('dislike', 'drift')),
          buzzVotes: world.mine.votes,
          crushes: flags(world.mine.crushes),
          following: flags(world.mine.following),
          // Phase 6B: real, mutual connections; pending requests both ways; server-side blocks.
          connections: Object.fromEntries(world.mine.connected.map((id) => [id, { userId: id, status: 'connected' as const, since: '' }])),
          connectRequests: flags(world.mine.requestedByMe),
          incomingConnects: flags(world.mine.requestedOfMe),
          blocked: flags(world.mine.blocked),
          // Phase 6D: Worlds you follow / asked to join.
          followedBoards: flags(world.mine.followedBoards),
          joinRequested: flags(world.mine.requestedBoards),
        });
        set({ error: undefined });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
        realData.markLoaded();
      } finally {
        set({ syncing: false });
      }
    },

    refreshLikes: async () => {
      if (get().mode !== 'real' || get().status !== 'ready') return;
      const d = ds();
      const totals = await fetchLikeTotals(
        d.buzz.map((b) => b.id),
        d.drift.map((x) => x.id),
      ).catch(() => null);
      if (!totals || get().mode !== 'real') return;
      const s = useChimp.getState();
      realData.applyLikeTotals(totals, (kind, id) => (kind === 'buzz' ? !!s.buzzLikes[id] : !!s.driftLikes[id]));
    },

    enterDemo: () => enterDemoWith(false),

    enterReviewDemo: async () => {
      // Only from Welcome: nobody is signed in, so there's no account to be a developer of.
      if (get().status !== 'signedOut') return;
      await AsyncStorage.setItem(REVIEW_KEY, '1');
      set({ reviewDemo: true, developer: false });
      await enterDemoWith(true);
    },

    exitReviewDemo: async () => {
      if (!get().reviewDemo) return;
      await get().signOut();
    },

    signOut: async () => {
      const leavingDemo = get().mode === 'demo';
      const leavingReview = get().reviewDemo;
      await transition(leavingDemo ? 'leave DEMO' : 'sign out', async () => {
        unsubDemo?.();
        unsubDemo = null;
        // Leaving Demo signs nothing out; leaving REAL removes the Supabase session
        // and this account's cached content (Phase 6C).
        const leaving = get().uid;
        if (get().mode === 'real') {
          await signOutBackend().catch((e) => trace('supabase signOut failed', { error: String(e) }));
          if (leaving) await clearRealCache(leaving);
        }
        realData.stopReal();
        await AsyncStorage.removeItem(MODE_KEY);
        await AsyncStorage.removeItem(REVIEW_KEY);
        // Park the local store on the demo bucket with the matching dataset; nothing real stays in memory.
        setDataset(emptyDataset());
        await switchBucket(DEMO_BUCKET, () => ({}));
        setDataset(demoDataset(useChimp.getState().created ?? emptyCreations()));
        set({ status: 'signedOut', mode: null, uid: undefined, email: undefined, developer: false, reviewDemo: false, profile: null, error: undefined });
      });
      // Phase 6D: the developer opens Demo from their own account without signing
      // out, so leaving Demo goes back to that account when its session is still here.
      // (The App Review Demo always goes back to Welcome.)
      if (leavingDemo && !leavingReview && isBackendConfigured) {
        const u = await currentUserId().catch(() => null);
        if (u) await get().signedIn(u.id, u.email);
      }
    },

    deleteAccount: async (transferWorlds) => {
      const uid = get().uid;
      if (get().mode !== 'real' || !uid) throw new Error('Sign in to the account you want to delete.');
      // 1. The server deletes the account (or throws, and nothing here changes).
      const result = await deleteMyAccount(transferWorlds);
      // 2. Forget it on this phone: session, cached world, local store bucket.
      await transition('account deleted', async () => {
        unsubDemo?.();
        unsubDemo = null;
        realData.stopReal();
        await signOutLocal().catch((e) => trace('local signOut failed', { error: String(e) }));
        await clearRealCache(uid);
        await AsyncStorage.removeItem(MODE_KEY);
        setDataset(emptyDataset());
        await switchBucket(DEMO_BUCKET, () => ({}));
        await AsyncStorage.removeItem(realBucket(uid));
        setDataset(demoDataset(useChimp.getState().created ?? emptyCreations()));
        set({ status: 'signedOut', mode: null, uid: undefined, email: undefined, developer: false, profile: null, error: undefined });
      });
      return result;
    },
  };
});
