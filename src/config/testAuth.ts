/**
 * TEMPORARY — developer test sign-in (Phase 6A), while Twilio toll-free
 * verification is pending.
 *
 * What it is:
 *   Five fictional numbers (555-01xx is reserved for fiction; nobody owns
 *   them) sign in with the fixed code 123456 and NO text message is sent.
 *   They become ordinary REAL Chimp accounts: a real Supabase Auth user and
 *   session, the real profile/content tables, RLS, Storage, onboarding and an
 *   honest empty social graph. They never see Demo (WollyMc) data.
 *
 * How it works (no secrets in the app):
 *   The app still calls the normal Supabase phone OTP API. Supabase's own
 *   "Test Phone Numbers and OTPs" setting (Dashboard → Authentication →
 *   Providers → Phone) makes it skip the SMS for these numbers and accept
 *   123456. This file only decides whether the APP allows those numbers at
 *   all, and explains what's happening on screen.
 *
 * Active only when BOTH are true:
 *   - a development build (`__DEV__`, i.e. `npx expo start`), and
 *   - EXPO_PUBLIC_ENABLE_TEST_AUTH=true (in .env.local; restart with -c).
 * Otherwise the app refuses these numbers outright (and they're fictional,
 * so no real user is affected).
 *
 * To remove when Twilio is approved:
 *   1. Set EXPO_PUBLIC_ENABLE_TEST_AUTH=false (or delete the line).
 *   2. Delete the test numbers in the Supabase dashboard.
 *   Optional clean-up later: delete this file and its imports (auth.ts,
 *   phone.tsx, verify.tsx, settings.tsx). Real-number sign-in never touches it.
 */

/** The one switch. Read literally so Expo inlines it at build time. */
export const TEST_AUTH_ENABLED: boolean = __DEV__ && process.env.EXPO_PUBLIC_ENABLE_TEST_AUTH === 'true';

/** Fixed code for every test number (must match the Supabase dashboard). */
export const TEST_AUTH_CODE = '123456';

/** Whitelisted numbers, E.164. */
export const TEST_PHONE_NUMBERS: readonly string[] = ['+15555550101', '+15555550102', '+15555550103', '+15555550104', '+15555550105'];

const digits = (phone: string) => phone.replace(/\D/g, '');
const TEST_DIGITS = new Set(TEST_PHONE_NUMBERS.map(digits));

/** Is this one of the test numbers? Accepts "+15555550101" or Supabase's stored "15555550101". */
export function isTestPhone(phone: string | null | undefined): boolean {
  return !!phone && TEST_DIGITS.has(digits(phone));
}

/** A test number AND test sign-in is switched on in this build. */
export function testAuthActive(phone: string | null | undefined): boolean {
  return TEST_AUTH_ENABLED && isTestPhone(phone);
}

/** Supabase dashboard value for "Test Phone Numbers and OTPs". */
export const TEST_OTP_DASHBOARD_VALUE = TEST_PHONE_NUMBERS.map((p) => `${digits(p)}=${TEST_AUTH_CODE}`).join(',');
