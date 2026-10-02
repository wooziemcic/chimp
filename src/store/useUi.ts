import { create } from 'zustand';

import type { CategoryId } from '@/types/models';

/** Ephemeral UI state (not persisted). */
export const usePulseLens = create<{ lens: CategoryId | null; setLens: (l: CategoryId | null) => void }>((set) => ({
  lens: null,
  setLens: (lens) => set({ lens }),
}));

/**
 * Build 5 patch: the primary tab you were on, so the shared bottom bar shown
 * over a Board or a chat can highlight it and send you back to any tab.
 */
export const useNavMemory = create<{ lastTab: string; setLastTab: (t: string) => void }>((set) => ({
  lastTab: 'buzz',
  setLastTab: (lastTab) => set({ lastTab }),
}));
