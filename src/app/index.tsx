import { Redirect } from 'expo-router';

import { nextStep, useSession } from '@/store/useSession';

/**
 * The gate (Phase 6A). Every guarded route falls back here, and this sends
 * you to the right place: Welcome when signed out, the next onboarding step
 * when your profile isn't finished, Buzz when you're in (REAL or DEMO).
 */
export default function Index() {
  const status = useSession((s) => s.status);
  const profile = useSession((s) => s.profile);
  if (status === 'booting' || status === 'switching') return null;
  if (status === 'ready') return <Redirect href="/buzz" />;
  if (status === 'onboarding') return <Redirect href={`/${nextStep(profile) ?? 'open-to'}`} />;
  return <Redirect href="/welcome" />;
}
