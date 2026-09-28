import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, TextLink } from '@/components/auth/AuthUI';
import { ChimpWorld } from '@/components/auth/ChimpWorld';
import { auth } from '@/components/auth/palette';
import { T } from '@/components/ui/Text';
import { isBackendConfigured } from '@/lib/supabase';
import { useSession } from '@/store/useSession';

/** The first thing a new person sees: the Chimp looking out at a world of possibilities. */
export default function Welcome() {
  const { width, height } = useWindowDimensions();
  const enterDemo = useSession((s) => s.enterDemo);
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
          {!isBackendConfigured ? <TextLink label="Explore the Demo account" onPress={() => void enterDemo()} color={auth.faint} /> : null}
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
});
