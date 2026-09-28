import { Stack } from 'expo-router';

import { AUTH_BG } from '@/components/auth/palette';

/** Welcome, email, verify and onboarding (Phase 6A; email since 6D). Dark, flat 2D Chimp world. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: AUTH_BG }, animation: 'slide_from_right' }} />;
}
