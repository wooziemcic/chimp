/**
 * Phase 7C: what you've already been shown, counted per SITTING (see
 * config EXPOSURE). Local to this phone and this account; never uploaded,
 * never shown to anyone. Rankings read `snapshot`, which is refreshed when
 * a sitting starts (launch, coming back to the app) — never mid-scroll — and
 * ignores impressions from the current sitting, so lists stay stable.
 *
 * It also keeps a short log of which World Delta changes Happening selected
 * and why (for Graph Debug, and so a selection can be explained or undone).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { EXPOSURE } from '@/graph/config';

export interface Exposure {
  /** Separate sittings it was seen in. */
  n: number;
  first: number;
  last: number;
}

export type ExposureMap = Record<string, Exposure>;

export interface ExposureSnapshot {
  at: number;
  /** Only sittings that ended before this snapshot's sitting began. */
  seen: ExposureMap;
}

export interface DeltaSelection {
  key: string;
  at: number;
  total: number;
  signals: Record<string, number>;
  penalties: Record<string, number>;
  /** Plain, safe reasons it was chosen (the same ones the card shows). */
  why: string[];
}

interface ExposureState {
  owner: string | null;
  seen: ExposureMap;
  snapshot: ExposureSnapshot;
  selections: DeltaSelection[];
  /** Record that `keys` were on screen now. Cheap; safe to call on every mount. */
  record: (owner: string, keys: string[], now?: number) => void;
  /** Start a new sitting: rankings see everything up to (now − sitting gap). */
  refresh: (owner: string, now?: number) => void;
  logSelections: (owner: string, list: DeltaSelection[]) => void;
  reset: () => void;
}

const EMPTY: ExposureSnapshot = { at: 0, seen: {} };
const gapMs = () => EXPOSURE.sittingGapMin * 60_000;

/** Trim to the most recently seen keys. */
function trim(seen: ExposureMap): ExposureMap {
  const keys = Object.keys(seen);
  if (keys.length <= EXPOSURE.maxKeys) return seen;
  return Object.fromEntries(keys.map((k) => [k, seen[k]] as const).sort((a, b) => b[1].last - a[1].last).slice(0, EXPOSURE.maxKeys));
}

export function snapshotOf(seen: ExposureMap, now: number): ExposureSnapshot {
  const cutoff = now - gapMs();
  const out: ExposureMap = {};
  for (const [k, e] of Object.entries(seen)) {
    if (e.last < cutoff) out[k] = e;
    else if (e.n > 1) out[k] = { ...e, n: e.n - 1 }; // the current sitting doesn't count
  }
  return { at: now, seen: out };
}

export const useExposure = create<ExposureState>()(
  persist(
    (set, get) => ({
      owner: null,
      seen: {},
      snapshot: EMPTY,
      selections: [],
      record: (owner, keys, now = Date.now()) => {
        const st = get();
        const base = st.owner === owner ? st.seen : {};
        let changed = st.owner !== owner;
        const seen = { ...base };
        for (const k of keys) {
          const e = seen[k];
          if (!e) {
            seen[k] = { n: 1, first: now, last: now };
            changed = true;
          } else if (now - e.last >= gapMs()) {
            seen[k] = { n: e.n + 1, first: e.first, last: now };
            changed = true;
          } else if (now - e.last > 60_000) {
            // Same sitting: just keep it alive (a long scroll is still one sitting).
            seen[k] = { ...e, last: now };
            changed = true;
          }
        }
        if (changed) set({ owner, seen: trim(seen), ...(st.owner !== owner ? { snapshot: EMPTY, selections: [] } : {}) });
      },
      refresh: (owner, now = Date.now()) => {
        const st = get();
        const seen = st.owner === owner ? st.seen : {};
        set({ owner, seen, snapshot: snapshotOf(seen, now), ...(st.owner !== owner ? { selections: [] } : {}) });
      },
      logSelections: (owner, list) => {
        const st = get();
        if (st.owner !== owner || !list.length) return;
        const fresh = list.filter((x) => !st.selections.some((y) => y.key === x.key && x.at - y.at < gapMs()));
        if (!fresh.length) return;
        set({ selections: [...fresh, ...st.selections].slice(0, EXPOSURE.maxSelections) });
      },
      reset: () => set({ owner: null, seen: {}, snapshot: EMPTY, selections: [] }),
    }),
    {
      name: 'chimp-exposure',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ owner, seen, selections }) => ({ owner, seen, selections }),
    },
  ),
);

/** The snapshot rankings use (empty for a different account). */
export function exposureFor(owner: string): ExposureSnapshot {
  const st = useExposure.getState();
  return st.owner === owner ? st.snapshot : EMPTY;
}
