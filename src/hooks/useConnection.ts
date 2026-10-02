/**
 * Phase 7B: one Connect button behaviour everywhere (profile, cards, rows).
 *
 *   Connect → sends a request          Requested → cancels it
 *   Accept  → accepts theirs           Connected → asks first, then disconnects
 *
 * Taps while a request is running are ignored, so a double tap never undoes
 * itself. A failure undoes the optimistic change and says why.
 */
import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { userMessage } from '@/services/backend/errors';
import type { ConnectionAction, ConnectionView } from '@/services/backend/people';
import { connectionBusy, connectionViewOf, intentFor, useChimp } from '@/store/useChimp';

export const CONNECT_LABEL: Record<ConnectionView, string> = {
  none: 'Connect',
  requested_by_me: 'Requested',
  requested_of_me: 'Accept',
  connected: 'Connected',
};

export function useConnection(userId: string, displayName = 'them') {
  const view = useChimp((s) => connectionViewOf(s, userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (action: ConnectionAction) => {
      if (connectionBusy(userId)) return;
      setBusy(true);
      setError(null);
      useChimp
        .getState()
        .connectionAction(userId, action)
        .catch((e: unknown) => {
          const msg = userMessage(e, 'Couldn’t update the connection. Try again.');
          setError(msg);
          if (Platform.OS !== 'web') Alert.alert('Connection', msg);
        })
        .finally(() => setBusy(false));
    },
    [userId],
  );

  const press = useCallback(() => {
    const now = connectionViewOf(useChimp.getState(), userId);
    if (now !== 'connected' || Platform.OS === 'web') return run(intentFor(now));
    const first = displayName.split(' ')[0];
    Alert.alert(`Disconnect from ${first}?`, `You can connect again later; ${first} would need to accept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => run('disconnect') },
    ]);
  }, [userId, displayName, run]);

  return { view, label: CONNECT_LABEL[view], busy, error, press, run };
}
