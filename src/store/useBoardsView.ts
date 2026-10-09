/**
 * Phase 9.2: how you like your Boards laid out — Covers (the grid) or
 * Timeline. Kept on this phone (a per-person view preference, not data).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type BoardsLayout = 'covers' | 'timeline';

export const useBoardsView = create<{ layout: BoardsLayout; setLayout: (l: BoardsLayout) => void }>()(
  persist((set) => ({ layout: 'covers', setLayout: (layout) => set({ layout }) }), {
    name: 'chimp-boards-view',
    storage: createJSONStorage(() => AsyncStorage),
  }),
);
