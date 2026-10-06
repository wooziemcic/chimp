/**
 * Phase 9: small bits of Happening state that belong to this phone:
 * when you last looked (for "Changed since you were here"), and the
 * server's people suggestions (refreshed at most every few minutes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SuggestionRow } from '@/graph/happeningNow';
import { fetchPeopleSuggestions } from '@/services/backend/people';

interface HappeningState {
  /** When Happening was last looked at, per account (ms). */
  seenAt: Record<string, number>;
  suggestions: SuggestionRow[] | null;
  suggestionsFor: string | null;
  suggestionsAt: number;
  markSeen: (owner: string, at: number) => void;
  loadSuggestions: (owner: string, real: boolean) => Promise<string[]>;
}

export const SUGGESTIONS_TTL_MS = 5 * 60_000;

export const useHappening = create<HappeningState>()(
  persist(
    (set, get) => ({
      seenAt: {},
      suggestions: null,
      suggestionsFor: null,
      suggestionsAt: 0,
      markSeen: (owner, at) => set({ seenAt: { ...get().seenAt, [owner]: at } }),
      loadSuggestions: async (owner, real) => {
        if (!real) return [];
        if (get().suggestionsFor === owner && Date.now() - get().suggestionsAt < SUGGESTIONS_TTL_MS) return [];
        const rows = await fetchPeopleSuggestions(12).catch(() => null);
        set({ suggestions: rows, suggestionsFor: owner, suggestionsAt: Date.now() });
        return (rows ?? []).map((r) => r.user_id);
      },
    }),
    { name: 'chimp-happening', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ seenAt: s.seenAt }) },
  ),
);
