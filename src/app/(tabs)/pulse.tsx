import { Redirect } from 'expo-router';

/**
 * Legacy route kept so old links still land somewhere sensible.
 * Pulse was retired in Phase 4; since Phase 5 the landing surface is Buzz.
 * Hidden from the tab bar; safe to delete once nothing links here.
 */
export default function LegacyPulse() {
  return <Redirect href="/buzz" />;
}
