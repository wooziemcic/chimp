import { Redirect } from 'expo-router';

/**
 * Legacy route kept so old links still land somewhere sensible.
 * Moves moved into Happening in Phase 4.
 * Hidden from the tab bar; safe to delete once nothing links here.
 */
export default function LegacyMoves() {
  return <Redirect href="/happening" />;
}
