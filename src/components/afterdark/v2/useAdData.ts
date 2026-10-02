/**
 * Phase 7A: derived After Dark data for screens (counts, mutual Crushes).
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { challengeView, mutualCrushIds, useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';
import { useMinuteClock } from '@/components/chat/useGroupChemistry';
import { displayStatus } from '@/utils/afterDark';

/** Mutual Crushes that haven't become a Vibe. */
export function useMutualCrushes(): string[] {
  const crushes = useChimp((s) => s.crushes);
  const blocked = useChimp((s) => s.blocked);
  const vibes = useAfterDark((s) => s.vibes);
  return useMemo(() => mutualCrushIds(crushes, blocked, vibes), [crushes, blocked, vibes]);
}

/** Badge counts for the five tabs. Counts only, never who or why. */
export function useAdCounts() {
  const { vibes, challenges, answers, loops, uid } = useAfterDark(useShallow((s) => ({ vibes: s.vibes, challenges: s.challenges, answers: s.answers, loops: s.loops, uid: s.uid })));
  const mutual = useMutualCrushes();
  return useMemo(() => {
    const s = { vibes, challenges, answers } as Parameters<typeof challengeView>[0];
    const live = new Set(vibes.filter((v) => v.status === 'active').map((v) => v.vibe_id));
    const openConvs = new Set(vibes.filter((v) => v.status !== 'closed').map((v) => v.conversation_id));
    return {
      vibes: vibes.filter((v) => v.status === 'pending' && v.my_role === 'recipient').length + mutual.length,
      challenges: challenges.filter((c) => live.has(c.vibe_id) && challengeView(s, c, uid).bucket === 'incoming').length,
      plans: loops.filter((l) => openConvs.has(l.conversation_id) && l.plan_state === 'proposed' && l.plan_by && l.plan_by !== uid).length,
      inbox: vibes.filter((v) => v.status !== 'closed').reduce((n, v) => n + v.unread, 0),
    };
  }, [vibes, challenges, answers, loops, uid, mutual]);
}

/** Display status with "Cooling", re-evaluated each minute. */
export function useDisplayStatus() {
  const now = useMinuteClock();
  return (v: Parameters<typeof displayStatus>[0]) => displayStatus(v, now);
}
