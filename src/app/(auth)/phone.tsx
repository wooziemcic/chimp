import { Redirect } from 'expo-router';

/** Phase 6D: phone sign-in is retired. Old links land on the email screen. */
export default function PhoneRedirect() {
  return <Redirect href="/email" />;
}
