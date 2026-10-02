import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Moon } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ad } from '@/components/afterdark/v2/adTheme';
import { AfterDarkHome } from '@/components/afterdark/v2/AfterDarkHome';
import { CardEditor } from '@/components/afterdark/v2/CardEditor';
import { EmptyNote } from '@/components/afterdark/v2/VibeParts';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useTabBarSpace } from '@/hooks/useLayout';
import { useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { isBackendConfigured } from '@/lib/supabase';
import { BOARD_THEMES } from '@/theme';

const t = BOARD_THEMES.neonNight;

/**
 * After Dark — its own primary tab and its own territory: dark theme,
 * 18+ and non-explicit by design. Phase 7A: a romantic interaction layer
 * (Discover · Vibes · Challenges · Plans · Inbox) on Chimp's own primitives.
 * Nothing from here feeds Drift, Buzz or Happening.
 *
 *   18+ confirmation → your After Dark card (age, required once) → After Dark
 */
export default function AfterDarkTab() {
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const confirmAge = useChimp((s) => s.confirmAge);
  const started = useAfterDark((s) => !!s.uid);
  const profileLoaded = useAfterDark((s) => s.profileLoaded);
  const hasAge = useAfterDark((s) => (s.profile?.age ?? 0) >= 18);
  const hasProfile = useAfterDark((s) => s.profile != null);
  const error = useAfterDark((s) => s.error);
  const refresh = useAfterDark((s) => s.refresh);
  const tabSpace = useTabBarSpace();
  const offline = useSession((s) => s.mode === 'real' && !isBackendConfigured);
  const activate = useAfterDark((s) => s.activate);
  // After Dark loads only once you're in it (18+ confirmed).
  useEffect(() => {
    if (ageConfirmed) activate();
  }, [ageConfirmed, activate]);

  if (ageConfirmed) {
    if (!started || !profileLoaded || (error && !hasProfile)) {
      return (
        <SafeAreaView style={styles.root}>
          <StatusBar style="light" />
          {offline ? (
            <View style={{ padding: 16 }}>
              <EmptyNote title="After Dark needs Chimp’s servers" body="This build isn’t connected to them, so Vibes can’t load here." />
            </View>
          ) : error ? (
            <View style={{ padding: 16 }}>
              <EmptyNote title="After Dark isn’t reachable right now" body={error} action={<Tap onPress={() => void refresh()} accessibilityLabel="Try again"><T v="bodyStrong" color={ad.pink}>Try again</T></Tap>} />
            </View>
          ) : (
            <ActivityIndicator color={ad.pink} style={{ marginTop: 80 }} />
          )}
        </SafeAreaView>
      );
    }
    if (!hasAge) {
      return (
        <SafeAreaView style={styles.root} edges={['top']}>
          <StatusBar style="light" />
          <CardEditor setup bottomPad={tabSpace} />
        </SafeAreaView>
      );
    }
    return <AfterDarkHome />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={['#1E1522', '#07060A']} style={StyleSheet.absoluteFill} />
      <View style={styles.body}>
        <View style={styles.icon}>
          <Moon size={30} color={t.primary} fill={t.primary} />
        </View>
        <T v="display" color="#fff" align="center" style={{ fontSize: 42, lineHeight: 48 }}>
          After Dark
        </T>
        <View style={styles.age}>
          <T v="footnote" color={t.primary} weight="800">
            18+
          </T>
        </View>
        <T v="body" color={t.mutedText} align="center" style={{ marginTop: 14, lineHeight: 23 }}>
          Real attraction. Mutual intent. Playful chemistry. Real plans. Nobody gets access to you unless you say yes. Mature, never explicit.
        </T>
        <Tap onPress={confirmAge} haptic="medium" style={styles.primary} accessibilityLabel="I’m 18 or older, enter After Dark">
          <LinearGradient colors={['#FF3D8F', '#C8175E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <T v="bodyStrong" color="#fff">
            I’m 18 or older, enter
          </T>
        </Tap>
        <Tap onPress={() => router.navigate('/buzz')} style={styles.secondary}>
          <T v="bodyStrong" color={t.mutedText}>
            Not now
          </T>
        </Tap>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07060A' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 90 },
  icon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,46,136,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  age: { alignSelf: 'center', marginTop: 10, height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1.5, borderColor: t.primary, justifyContent: 'center' },
  primary: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 28, overflow: 'hidden' },
  secondary: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
