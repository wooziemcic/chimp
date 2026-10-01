import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/auth/AuthUI';
import { ChimpWorld } from '@/components/auth/ChimpWorld';
import { auth } from '@/components/auth/palette';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { resetDemoChat } from '@/services/demoChat';
import { useSession } from '@/store/useSession';

/**
 * The first thing a new person sees: the Chimp looking out at a world of possibilities.
 * One way in (Continue with Email). Below it, App Review Demo: the seeded Demo
 * with no sign-in, so App Review can see everything (no account is created).
 */
export default function Welcome() {
  const { width, height } = useWindowDimensions();
  const enterReviewDemo = useSession((s) => s.enterReviewDemo);
  const artH = Math.round(height * 0.74);
  return (
    <View style={{ flex: 1, backgroundColor: auth.bg }}>
      <StatusBar style="light" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ChimpWorld variant="welcome" width={width} height={artH} />
      </View>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.brand}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <T style={styles.word}>Ch</T>
            <View>
              <View style={styles.dot} />
              <T style={styles.word}>ı</T>
            </View>
            <T style={styles.word}>mp</T>
          </View>
          <T style={styles.tag}>{'People. Places. Ideas.\nA bigger you.'}</T>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ paddingHorizontal: 24 }}>
          {/* Phase 6D: one path for new and returning people (no Sign Up / Sign In choice). */}
          <PrimaryButton label="Continue with Email" onPress={() => router.push('/email')} />
          <T style={styles.foot}>Explore. Connect. Plan. Create.</T>
          <Tap
            onPress={() => {
              resetDemoChat();
              void enterReviewDemo();
            }}
            style={styles.review}
            accessibilityLabel="App Review Demo"
            accessibilityHint="Opens a sample account with demo data. No sign-in."
            testID="app-review-demo"
          >
            <T style={styles.reviewLabel}>App Review Demo</T>
            <T style={styles.reviewSub}>Sample account with demo data · no sign-in</T>
          </Tap>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { paddingHorizontal: 28, paddingTop: 36 },
  word: { color: auth.cream, fontSize: 84, lineHeight: 90, fontWeight: '900', letterSpacing: -3 },
  dot: { position: 'absolute', top: 6, left: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: auth.coral, zIndex: 2 },
  tag: { color: '#E6E3F5', fontSize: 21, lineHeight: 28, marginTop: 6, fontWeight: '500' },
  foot: { color: auth.lilac, fontSize: 16, textAlign: 'center', marginTop: 18 },
  review: { alignSelf: 'center', alignItems: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16 },
  reviewLabel: { color: auth.cream, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  reviewSub: { color: auth.muted, fontSize: 12, marginTop: 2 },
});
