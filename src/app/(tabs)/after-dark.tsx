import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Moon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AfterDarkWorld } from '@/components/afterdark/AfterDarkWorld';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useChimp } from '@/store/useChimp';
import { BOARD_THEMES } from '@/theme';

const t = BOARD_THEMES.neonNight;

/**
 * After Dark — its own primary tab and its own territory: dark theme,
 * separate identity mode and content pool. 18+ and non-explicit by design.
 * Nothing from here feeds Drift, Buzz or Happening.
 */
export default function AfterDarkTab() {
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const confirmAge = useChimp((s) => s.confirmAge);

  if (ageConfirmed) return <AfterDarkWorld variant="tab" />;

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
          Nightlife, confessions, chemistry and discreet connections. Mature but never explicit. You can browse anonymously, and your main profile is never linked.
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
