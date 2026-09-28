import { create } from 'zustand';

import type { CategoryId } from '@/types/models';

/** Ephemeral UI state (not persisted). */
export const usePulseLens = create<{ lens: CategoryId | null; setLens: (l: CategoryId | null) => void }>((set) => ({
  lens: null,
  setLens: (lens) => set({ lens }),
}));
