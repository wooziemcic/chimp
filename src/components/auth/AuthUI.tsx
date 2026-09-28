import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, ChevronLeft, Mail } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { auth } from './palette';

// ─── Shell ──────────────────────────────────────────────────────────────────

/**
 * Dark, full-bleed auth screen with an optional back button, a scrolling body
 * and a footer. Phase 6D: the bottom edge follows the keyboard (measured, not
 * guessed), so the footer button always sits just above it and the body
 * scrolls in whatever height is left. Drag the body down to dismiss (iOS).
 */
export function AuthScreen({ children, back = true, footer, scroll = true, onBack }: { children: ReactNode; back?: boolean; footer?: ReactNode; scroll?: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const Body = scroll ? ScrollView : View;
  return (
    <View style={{ flex: 1, backgroundColor: auth.bg, paddingTop: insets.top, paddingBottom: kb > 0 ? kb : insets.bottom }}>
      {back ? (
        <Tap onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/welcome')))} style={styles.back} accessibilityLabel="Back">
          <ChevronLeft size={28} color={auth.cream} />
        </Tap>
      ) : null}
      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scroll ? { flexGrow: 1 } : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </Body>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

export function Headline({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ paddingHorizontal: 28 }}>
      <T style={styles.headline}>{title}</T>
      {sub ? <T style={styles.sub}>{sub}</T> : null}
    </View>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

export function PrimaryButton({ label, onPress, disabled, loading, arrow = true }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; arrow?: boolean }) {
  return (
    <Tap onPress={onPress} disabled={disabled || loading} haptic="medium" scaleTo={0.98} accessibilityLabel={label} style={[styles.primary, (disabled || loading) && { opacity: 0.45 }]}>
      <LinearGradient colors={auth.cta as unknown as [string, string, string]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      {loading ? (
        <ActivityIndicator color={auth.cream} />
      ) : (
        <>
          <T style={styles.primaryLabel}>{label}</T>
          {arrow ? <ArrowRight size={24} color={auth.cream} style={{ position: 'absolute', right: 28 }} /> : null}
        </>
      )}
    </Tap>
  );
}

export function OutlineButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} haptic="light" scaleTo={0.98} accessibilityLabel={label} style={styles.outline}>
      <T style={styles.outlineLabel}>{label}</T>
    </Tap>
  );
}

export function TextLink({ label, onPress, color = auth.muted }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Tap onPress={onPress} style={{ paddingVertical: 10, alignSelf: 'center' }} accessibilityLabel={label}>
      <T style={{ color, fontSize: 15, fontWeight: '600' }}>{label}</T>
    </Tap>
  );
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.error}>
      <T style={{ color: auth.peach, fontSize: 14, lineHeight: 19 }}>{text}</T>
    </View>
  );
}

// ─── Email field ────────────────────────────────────────────────────────────

export function EmailField({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean }) {
  return (
    <View style={styles.field}>
      <Mail size={22} color={auth.muted} />
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\s/g, ''))}
        placeholder="you@example.com"
        placeholderTextColor={auth.faint}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoFocus={autoFocus}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        maxFontSizeMultiplier={1.3}
        style={styles.fieldInput}
        accessibilityLabel="Email address"
        testID="email-input"
      />
    </View>
  );
}

// ─── OTP boxes ──────────────────────────────────────────────────────────────

/**
 * Six boxes over one real TextInput that covers them (Phase 6D). Because the
 * input spans the whole row, a long-press anywhere offers Paste, the iOS
 * one-time-code suggestion above the keyboard fills it, and a pasted
 * "123 456" or "Your code is 123456" is reduced to its digits. The box size
 * comes from the measured row width, so the six always fit (iPhone SE to
 * Pro Max, any text size) without per-device layouts.
 */
export function OtpBoxes({ value, onChange, length = 6, onComplete, autoFocus = true, invalid }: { value: string; onChange: (v: string) => void; length?: number; onComplete?: (v: string) => void; autoFocus?: boolean; invalid?: boolean }) {
  const [rowW, setRowW] = useState(0);
  const [focused, setFocused] = useState(false);
  const gap = rowW && rowW < 320 ? 7 : 10;
  const box = rowW ? Math.max(36, Math.min(56, Math.floor((rowW - gap * (length - 1)) / length))) : 48;
  const boxH = Math.round(box * 1.2);
  return (
    <View style={styles.otpWrap}>
      <View onLayout={(e) => setRowW(e.nativeEvent.layout.width)} style={{ height: boxH }}>
        <View style={[styles.otpRow, { gap }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length }).map((_, i) => {
            const ch = value[i] ?? '';
            const active = focused && i === Math.min(value.length, length - 1);
            return (
              <View key={i} testID={`otp-box-${i}`} style={[styles.otpBox, { width: box, height: boxH }, !!ch && styles.otpBoxFilled, active && { borderColor: auth.coral }, invalid && { borderColor: 'rgba(255,107,97,0.7)' }]}>
                <T style={[styles.otpChar, { fontSize: Math.round(box * 0.5) }]} maxFontSizeMultiplier={1}>
                  {ch}
                </T>
              </View>
            );
          })}
        </View>
        <TextInput
          value={value}
          onChangeText={(t) => {
            const v = t.replace(/\D/g, '').slice(0, length);
            onChange(v);
            if (v.length === length) onComplete?.(v);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          autoFocus={autoFocus}
          autoCorrect={false}
          caretHidden
          contextMenuHidden={false}
          selectionColor="transparent"
          style={[StyleSheet.absoluteFill, styles.otpInput]}
          accessibilityLabel={`Verification code, ${length} digits`}
          accessibilityValue={{ text: value ? value.split('').join(' ') : 'empty' }}
          testID="otp-input"
        />
      </View>
    </View>
  );
}

// ─── Onboarding progress ────────────────────────────────────────────────────

export function Steps({ at, of = 4 }: { at: number; of?: number }) {
  return (
    <View style={styles.steps}>
      {Array.from({ length: of }).map((_, i) => (
        <View key={i} style={[styles.step, i <= at && { backgroundColor: auth.coral }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { marginLeft: 12, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  footer: { paddingHorizontal: 24, paddingBottom: 8, paddingTop: 8 },
  headline: { color: auth.cream, fontSize: 44, lineHeight: 48, fontWeight: '900', letterSpacing: -1 },
  sub: { color: '#D9D6EE', fontSize: 19, lineHeight: 26, marginTop: 10 },
  primary: { height: 60, borderRadius: 30, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: auth.cream, fontSize: 20, fontWeight: '700' },
  outline: { height: 60, borderRadius: 30, borderWidth: 1.5, borderColor: auth.line, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  outlineLabel: { color: auth.cream, fontSize: 20, fontWeight: '600' },
  error: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,107,97,0.12)', borderWidth: 1, borderColor: 'rgba(255,107,97,0.35)' },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 64, borderRadius: 32, borderWidth: 1.5, borderColor: auth.line, backgroundColor: 'rgba(20,23,49,0.85)', paddingHorizontal: 20 },
  fieldInput: { flex: 1, color: auth.cream, fontSize: 19, minHeight: 56, marginLeft: 12 },
  otpWrap: { paddingHorizontal: 24, marginTop: 22 },
  otpRow: { flexDirection: 'row', justifyContent: 'center' },
  otpBox: { borderRadius: 14, borderWidth: 1.5, borderColor: auth.line, backgroundColor: 'rgba(20,23,49,0.85)', alignItems: 'center', justifyContent: 'center' },
  otpBoxFilled: { borderColor: auth.lilac },
  otpChar: { color: auth.cream, fontWeight: '800' },
  otpInput: { color: 'transparent', backgroundColor: 'transparent', fontSize: 16, borderWidth: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', caretColor: 'transparent' } as object) : null) },
  steps: { flexDirection: 'row', gap: 6, paddingHorizontal: 28, marginBottom: 18 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: auth.line },
});
