import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AuthScreen, ErrorNote, OtpBoxes, PrimaryButton, TextLink } from '@/components/auth/AuthUI';
import { ChimpWorld } from '@/components/auth/ChimpWorld';
import { auth } from '@/components/auth/palette';
import { T } from '@/components/ui/Text';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { maskEmail, sendCode, verifyCode } from '@/services/backend/auth';
import { useSession } from '@/store/useSession';

const RESEND_AFTER = 60;
const CODE = 6;

/**
 * "Check your email" (Phase 6D): six digits, Verify, Resend, Change email.
 *
 * Keyboard-safe by construction: the content is top-aligned in the space
 * ABOVE the keyboard (AuthScreen pads by the measured keyboard height), in
 * this order: title, where the code went, the six boxes, any error, Verify,
 * Resend / Change email. With the number pad up everything sits above it on
 * an iPhone 12, 15 Pro Max or 17; with Larger Text it scrolls instead of
 * hiding. The Chimp art only fills space that's left over.
 */
export default function VerifyScreen() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const { width } = useWindowDimensions();
  const kb = useKeyboardHeight();
  const signedIn = useSession((s) => s.signedIn);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER);
  const [spare, setSpare] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const verify = async (value = code) => {
    if (value.length !== CODE || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const user = await verifyCode(email, value);
      // Finished profile → Buzz; new or unfinished → onboarding (the gate decides).
      await signedIn(user.id, user.email);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setSent(null);
    try {
      await sendCode(email);
      setWait(RESEND_AFTER);
      setCode('');
      setSent('A new code is on its way. Use the newest email.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const compact = kb > 0;
  return (
    <AuthScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/email'))}>
      <StatusBar style="light" />
      <View style={{ paddingHorizontal: 28 }}>
        <T style={[styles.title, compact && styles.titleCompact]} maxFontSizeMultiplier={1.2} accessibilityRole="header">
          Check your email
        </T>
        <T style={styles.sub} maxFontSizeMultiplier={1.3}>
          {'We sent a 6-digit code to '}
          <T style={styles.addr} maxFontSizeMultiplier={1.3} testID="verify-email">
            {maskEmail(email)}
          </T>
        </T>
      </View>
      <OtpBoxes value={code} onChange={setCode} onComplete={(v) => void verify(v)} invalid={!!error} />
      <View style={{ paddingHorizontal: 24 }}>
        <ErrorNote text={error} />
        {sent ? <T style={styles.sent}>{sent}</T> : null}
        <View style={{ marginTop: 18 }}>
          <PrimaryButton label="Verify" onPress={() => void verify()} disabled={code.length !== CODE} loading={busy} />
        </View>
        <View style={styles.links}>
          {wait > 0 ? (
            <T style={styles.wait} maxFontSizeMultiplier={1.3}>{`Resend in ${wait}s`}</T>
          ) : (
            <TextLink label="Resend code" onPress={() => void resend()} color={auth.salmon} />
          )}
          <TextLink label="Change email" onPress={() => (router.canGoBack() ? router.back() : router.replace('/email'))} />
        </View>
        <T style={styles.hint} maxFontSizeMultiplier={1.3}>
          Can’t find it? Check Spam or Promotions. The code works for a limited time.
        </T>
      </View>
      {/* Whatever height is left over (keyboard down, tall phones) gets the art. */}
      <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} onLayout={(e) => setSpare(Math.floor(e.nativeEvent.layout.height))} pointerEvents="none">
        {spare >= 170 ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <ChimpWorld variant="quiet" width={width} height={Math.min(spare, 260)} />
          </View>
        ) : null}
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  title: { color: auth.cream, fontSize: 40, lineHeight: 44, fontWeight: '900', letterSpacing: -1 },
  titleCompact: { fontSize: 32, lineHeight: 36 },
  sub: { color: '#D9D6EE', fontSize: 17, lineHeight: 24, marginTop: 8 },
  addr: { color: auth.cream, fontWeight: '700' },
  sent: { color: auth.lilac, fontSize: 14, marginTop: 10, textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingHorizontal: 6, flexWrap: 'wrap' },
  wait: { color: auth.faint, fontSize: 15, fontWeight: '600', paddingVertical: 10 },
  hint: { color: auth.faint, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6 },
});
