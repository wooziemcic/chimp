import { useEffect, useState } from 'react';

/**
 * The current time as React state, refreshed every `everyMs`.
 * Use it instead of calling Date.now() during render, so time-based UI
 * (e.g. "your post stays on top for 30 minutes") updates predictably.
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
