import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { AuthScreen, EmailField, ErrorNote, Headline, PrimaryButton, TextLink } from '@/components/auth/AuthUI';
import { ChimpWorld } from '@/components/auth/ChimpWorld';
import { auth } from '@/components/auth/palette';
import { T } from '@/components/ui/Text';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { isBackendConfigured } from '@/lib/supabase';
import { isEmail, normalizeEmail, sendCode } from '@/services/backend/auth';
import { useSession } from '@/store/useSession';

/**
 * "Continue with Email" (Phase 6D): one path for new and returning people.
 * Your email → a 6-digit code → verified. Chimp then knows whether you have
 * a finished profile (→ Buzz) or not yet (→ onboarding); you never choose.
 */
export default function EmailScreen() {
  const { width, height } = useWindowDimensions();
  const kb = useKeyboardHeight();
  const enterDemo = useSession((s) => s.enterDemo);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isEmail(email);

  const go = async () => {
    setError(null);
    if (!valid) return setError('That doesn’t look like an email address.');
    setBusy(true);
    try {
      const address = normalizeEmail(email);
      await sendCode(address);
      router.push({ pathname: '/verify', params: { email: address } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The art gives way to the field and the button while you type.
  const artH = kb > 0 ? 0 : Math.round(Math.min(height * 0.42, width * 1.05));
  return (
    <AuthScreen
      footer={
        <>
          <PrimaryButton label="Continue" onPress={go} disabled={!valid} loading={busy} />
          <T style={{ color: auth.muted, fontSize: 15, textAlign: 'center', marginTop: 12 }} maxFontSizeMultiplier={1.3}>
            We’ll email you a 6-digit code. No password needed.
          </T>
        </>
      }
    >
      <StatusBar style="light" />
      {artH ? (
        <View style={{ height: artH, marginTop: -48 }} pointerEvents="none">
          <ChimpWorld variant="phone" width={width} height={artH} />
        </View>
      ) : null}
      <View style={{ marginTop: artH ? -28 : 4 }}>
        <Headline title={'Let’s\nget you in'} sub={'New here or coming back,\nit starts with your email.'} />
      </View>
      <View style={{ paddingHorizontal: 24, marginTop: 20, paddingBottom: 12 }}>
        <EmailField value={email} onChange={setEmail} onSubmit={go} />
        <ErrorNote text={error} />
        {!isBackendConfigured ? (
          <>
            <ErrorNote text="Chimp’s backend isn’t connected on this build yet (add the Supabase keys, see README → Phase 6A setup). You can still explore the Demo account." />
            <TextLink label="Enter the Demo account" onPress={() => void enterDemo()} color={auth.salmon} />
          </>
        ) : null}
      </View>
    </AuthScreen>
  );
}
