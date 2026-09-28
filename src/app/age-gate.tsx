import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Moon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useChimp } from '@/store/useChimp';
import { BOARD_THEMES } from '@/theme';

/** One-time 18+ confirmation before entering After Dark. */
export default function AgeGate() {
  const insets = useSafeAreaInsets();
  const confirmAge = useChimp((s) => s.confirmAge);

  const enter = () => {
    confirmAge();
    router.back();
    setTimeout(() => router.navigate('/after-dark'), 250);
  };

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.backdrop}>
      <Tap style={StyleSheet.absoluteFill} scaleTo={1} onPress={() => router.back()} accessibilityLabel="Dismiss" />
      <Animated.View entering={SlideInDown.springify().damping(18)} style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <LinearGradient colors={['#1E1522', '#0E0A10']} style={StyleSheet.absoluteFill} />
        <View style={styles.icon}>
          <Moon size={26} color={BOARD_THEMES.neonNight.primary} fill={BOARD_THEMES.neonNight.primary} />
        </View>
        <T v="title2" color="#fff" align="center">
          After Dark is 18+
        </T>
        <T v="body" color={BOARD_THEMES.neonNight.mutedText} align="center" style={{ marginTop: 8 }}>
          Nightlife, dating and bolder conversation. Mature but never explicit. You can browse anonymously, and your main profile is never linked.
        </T>
        <Tap onPress={enter} haptic="medium" style={styles.primary}>
          <LinearGradient colors={['#FF3D8F', '#C8175E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <T v="bodyStrong" color="#fff">
            I’m 18 or older, enter
          </T>
        </Tap>
        <Tap onPress={() => router.back()} style={styles.secondary}>
          <T v="bodyStrong" color={BOARD_THEMES.neonNight.mutedText}>
            Not now
          </T>
        </Tap>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  icon: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,46,136,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  primary: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 24, overflow: 'hidden' },
  secondary: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
