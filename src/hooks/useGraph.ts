import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { buildAgentBrief } from '@/graph/agent';
import type { GraphState } from '@/graph/graph';
import { loopProgress } from '@/graph/loops';
import { getContext } from '@/graph/relevance';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { freshCount, graphStateOf, unseenChanges, useChimp } from '@/store/useChimp';
import type { EntityRef, OpenLoop } from '@/types/models';

/** The slice of state the behaviour layer reads. Shallow-compared. */
export function useSignals(): GraphState {
  // Same field references as the store, so graph contexts memoise.
  return useChimp(useShallow(graphStateOf));
}

/** Graph + scoring context for the current state (memoised across components). */
export function useGraphCtx() {
  const s = useSignals();
  // Re-derive when the active dataset changes (DEMO ↔ REAL, new content).
  const version = useDatasetVersion((d) => d.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getContext(s), [s, version]);
}

export function useUnseenChanges() {
  const changes = useChimp((s) => s.changes);
  return useMemo(() => unseenChanges(changes), [changes]);
}

/** Number of unseen changes attached to any graph node (blue pips). */
export function useFresh(ref: EntityRef | undefined) {
  const changes = useChimp((s) => s.changes);
  return useMemo(
    () => (ref ? freshCount(changes, ref) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changes, ref?.kind, ref?.id],
  );
}

/** Graph-derived explanation of why WollyMc and a person might meet. */
export function useMatch(personId: string | undefined) {
  const ctx = useGraphCtx();
  return useMemo(() => (personId ? ctx.match(personId) : undefined), [ctx, personId]);
}

export function useAgentBrief() {
  const ctx = useGraphCtx();
  const baseline = useChimp((s) => s.baseline);
  return useMemo(() => buildAgentBrief(ctx, baseline), [ctx, baseline]);
}

export function useLoopProgress(loop: OpenLoop) {
  const ctx = useGraphCtx();
  return useMemo(() => loopProgress(ctx, loop), [ctx, loop]);
}

/** WollyMc's small avatar: a picked photo, else the bundled portrait crop. */
export function useMyAvatar() {
  const picked = useChimp((s) => s.profile.avatarUri);
  return picked ?? repo.me().avatar;
}

export function useIdentityMode(context: string) {
  return useChimp((s) => s.identity[context] ?? s.identity.default ?? 'public');
}
