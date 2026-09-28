import { Redirect } from 'expo-router';

/**
 * Legacy route. Phase 6C: Drift is the vertical media mode of Buzz
 * (Buzz → Drift), not a tab. Old links, notifications or restored navigation
 * state land there instead of crashing. World media still opens in the
 * full-screen viewer at /drift/[id]; Stories stay in Happening.
 */
export default function LegacyDrift() {
  return <Redirect href="/buzz?tab=drift" />;
}
