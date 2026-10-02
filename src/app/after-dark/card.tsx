/** Phase 7A: edit your After Dark card. */
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ad } from '@/components/afterdark/v2/adTheme';
import { CardEditor } from '@/components/afterdark/v2/CardEditor';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';

export default function AfterDarkCardScreen() {
  const insets = useSafeAreaInsets();
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const loaded = useAfterDark((s) => s.profileLoaded);
  const activate = useAfterDark((s) => s.activate);
  useEffect(() => {
    if (ageConfirmed) activate();
  }, [ageConfirmed, activate]);
  if (!ageConfirmed) return <Redirect href="/after-dark" />;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="card-screen">
      <StatusBar style="light" />
      <View style={styles.head}>
        <Tap onPress={() => router.back()} style={styles.icon} accessibilityLabel="Back" testID="card-back">
          <ChevronLeft size={24} color="#fff" />
        </Tap>
        <T v="headline" color={ad.ink}>
          Your After Dark card
        </T>
      </View>
      {loaded ? <CardEditor bottomPad={insets.bottom + 30} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ad.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ad.line },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
