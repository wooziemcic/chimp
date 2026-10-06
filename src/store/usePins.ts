/**
 * Phase 9: pinned Worlds. One small list per account: the server's
 * board_pins (0012) for REAL accounts, this phone for the Demo.
 *
 * Pinning never changes who can see a World: a pin of a World you can no
 * longer see is simply not shown (surfaces read Worlds from the dataset,
 * which only ever holds Worlds you may see).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { fetchMyPins, setBoardPin } from '@/services/backend/content';

interface PinsState {
  /** Whose pins these are ('demo' or a REAL uid). */
  owner: string | null;
  /** boardId → pinned at (ms). */
  pins: Record<string, number>;
  /** false: this server can't store pins (0012 not applied) — the UI hides Pin. */
  supported: boolean;
  load: (owner: string, real: boolean) => Promise<void>;
  toggle: (boardId: string, real: boolean) => Promise<boolean>;
  forget: (boardId: string) => void;
  reset: () => void;
}

export const usePins = create<PinsState>()(
  persist(
    (set, get) => ({
      owner: null,
      pins: {},
      supported: true,
      load: async (owner, real) => {
        if (get().owner !== owner) set({ owner, pins: {}, supported: true });
        if (!real) return;
        const rows = await fetchMyPins(owner).catch(() => null);
        if (get().owner !== owner) return;
        if (!rows) {
          set({ supported: false });
          return;
        }
        set({ supported: true, pins: Object.fromEntries(rows.map((r) => [r.board_id, Date.parse(r.pinned_at) || Date.now()])) });
      },
      toggle: async (boardId, real) => {
        const was = get().pins;
        const on = !was[boardId];
        const next = { ...was };
        if (on) next[boardId] = Date.now();
        else delete next[boardId];
        set({ pins: next }); // optimistic
        if (!real) return on;
        try {
          await setBoardPin(boardId, on);
          return on;
        } catch (e) {
          set({ pins: was });
          throw e;
        }
      },
      forget: (boardId) => {
        if (!get().pins[boardId]) return;
        const { [boardId]: _gone, ...rest } = get().pins;
        set({ pins: rest });
      },
      reset: () => set({ owner: null, pins: {}, supported: true }),
    }),
    { name: 'chimp-pins', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ owner: s.owner, pins: s.pins }) },
  ),
);

/** Pinned board ids, most recently pinned first. */
export const pinnedIds = (pins: Record<string, number>) => Object.keys(pins).sort((a, b) => pins[b] - pins[a] || (a < b ? -1 : 1));
