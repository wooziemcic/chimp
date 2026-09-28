import { Redirect } from 'expo-router';

/**
 * Legacy route kept so old links still land somewhere sensible.
 * Stories moved into Drift in Phase 4.
 * Hidden from the tab bar; safe to delete once nothing links here.
 */
export default function LegacyStories() {
  return <Redirect href="/happening" />;
}
