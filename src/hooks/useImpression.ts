import { useEffect } from 'react';

import { ds } from '@/services/dataset';
import { useExposure } from '@/store/useExposure';

/**
 * Phase 7C: note that something was on screen (counted once per sitting,
 * local only). Used by rankings to avoid showing the same thing again and
 * again; never uploaded, never shown to anyone.
 */
export function useImpression(key: string | null | undefined): void {
  useEffect(() => {
    if (!key) return;
    useExposure.getState().record(ds().me.id, [key]);
  }, [key]);
}
