/**
 * Phase 9.2: Boards you archived. Like pins, a small personal list: the
 * server's board_archives (0013) for REAL accounts, this phone for the Demo.
 * Archiving only tidies YOUR Boards tab (the Board leaves Joined and pinned);
 * it doesn't change the Board, its members, or who can see it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { fetchMyArchives, setBoardArchive } from '@/services/backend/content';

interface ArchivesState {
  /** Whose archive this is ('demo' or a REAL uid). */
  owner: string | null;
  /** boardId → archived at (ms). */
  archived: Record<string, number>;
  /** false: this server can't store archives yet (0013 not applied) — the UI hides Archive. */
  supported: boolean;
  load: (owner: string, real: boolean) => Promise<void>;
  toggle: (boardId: string, real: boolean) => Promise<boolean>;
  reset: () => void;
}

export const useArchives = create<ArchivesState>()(
  persist(
    (set, get) => ({
      owner: null,
      archived: {},
      supported: true,
      load: async (owner, real) => {
        if (get().owner !== owner) set({ owner, archived: {}, supported: true });
        if (!real) return;
        let rows: Awaited<ReturnType<typeof fetchMyArchives>>;
        try {
          rows = await fetchMyArchives(owner);
        } catch {
          return; // offline / a transient error: keep what we have (and keep Archive available)
        }
        if (get().owner !== owner) return;
        if (!rows) {
          set({ supported: false });
          return;
        }
        set({ supported: true, archived: Object.fromEntries(rows.map((r) => [r.board_id, Date.parse(r.archived_at) || Date.now()])) });
      },
      toggle: async (boardId, real) => {
        const was = get().archived;
        const on = !was[boardId];
        const next = { ...was };
        if (on) next[boardId] = Date.now();
        else delete next[boardId];
        set({ archived: next }); // optimistic
        const owner = get().owner;
        if (!real) return on;
        if (!owner) {
          set({ archived: was });
          throw new Error('Couldn’t archive this Board right now. Try again.');
        }
        try {
          await setBoardArchive(owner, boardId, on);
          return on;
        } catch (e) {
          set({ archived: was });
          throw e;
        }
      },
      reset: () => set({ owner: null, archived: {}, supported: true }),
    }),
    { name: 'chimp-archives', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ owner: s.owner, archived: s.archived }) },
  ),
);
