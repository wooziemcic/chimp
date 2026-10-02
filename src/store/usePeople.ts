/**
 * Phase 7B: people you open by id. A profile route never decides "not found"
 * from a local snapshot: if the person isn't in the loaded world yet, it is
 * fetched (with short retries for transient failures) and added to it.
 *
 *   loading   → first fetch running ("Loading Maya's profile…")
 *   retrying  → a transient failure; trying again
 *   offline   → the connection failed (Retry)
 *   missing   → the server has no such profile, confirmed more than once
 *   ready     → in the dataset (repo.user works everywhere)
 */
import { create } from 'zustand';

import { BackendError, diag, kindOf } from '@/services/backend/errors';
import { toUser } from '@/services/backend/mappers';
import { fetchPerson } from '@/services/backend/people';
import * as realData from '@/services/backend/realData';
import { repo } from '@/services/repository';
import { onAccountChange } from './useSession';

export type PersonStatus = 'loading' | 'retrying' | 'offline' | 'missing' | 'ready';

interface PeopleState {
  status: Record<string, PersonStatus>;
  /** When we last fetched someone (for refresh-on-focus). */
  fetchedAt: Record<string, number>;
  ensure: (id: string, opts?: { force?: boolean }) => Promise<PersonStatus>;
  reset: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A brand-new profile can lag a moment behind the id that pointed at it: try a few times before "missing". */
const MISSING_RETRIES = [600, 1200, 2400];
const TRANSIENT_RETRIES = [800, 1600, 3000];
const running = new Map<string, Promise<PersonStatus>>();

export const usePeople = create<PeopleState>((set, get) => {
  const mark = (id: string, s: PersonStatus) => set({ status: { ...get().status, [id]: s } });

  const load = async (id: string, force: boolean): Promise<PersonStatus> => {
    if (repo.mode() !== 'real') return repo.user(id) ? 'ready' : 'missing';
    if (!force && repo.user(id)) {
      mark(id, 'ready');
      return 'ready';
    }
    if (!repo.user(id)) mark(id, 'loading');
    let missingTries = 0;
    let transientTries = 0;
    for (;;) {
      try {
        const row = await fetchPerson(id);
        if (row) {
          realData.addPeople([toUser(row)]);
          set({ fetchedAt: { ...get().fetchedAt, [id]: Date.now() } });
          mark(id, 'ready');
          return 'ready';
        }
        if (missingTries >= MISSING_RETRIES.length) {
          diag('person missing', { tries: missingTries + 1 });
          mark(id, repo.user(id) ? 'ready' : 'missing');
          return repo.user(id) ? 'ready' : 'missing';
        }
        await sleep(MISSING_RETRIES[missingTries++]);
      } catch (e) {
        const kind = kindOf(e);
        if (repo.user(id)) return 'ready'; // a refresh of someone we already show: keep showing them
        if (transientTries >= TRANSIENT_RETRIES.length) {
          mark(id, 'offline');
          diag('person fetch failed', { kind, code: e instanceof BackendError ? e.code : undefined });
          return 'offline';
        }
        mark(id, 'retrying');
        await sleep(TRANSIENT_RETRIES[transientTries++]);
      }
    }
  };

  return {
    status: {},
    fetchedAt: {},
    ensure: (id, opts) => {
      const key = id;
      const existing = running.get(key);
      if (existing) return existing;
      const p = load(id, !!opts?.force).finally(() => running.delete(key));
      running.set(key, p);
      return p;
    },
    reset: () => {
      running.clear();
      set({ status: {}, fetchedAt: {} });
    },
  };
});

onAccountChange(() => usePeople.getState().reset());
