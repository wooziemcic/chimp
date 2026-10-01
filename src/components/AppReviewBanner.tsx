import { FlaskConical, LogOut } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useSession } from '@/store/useSession';
import { colors } from '@/theme';

/**
 * App Review Demo: a slim strip across the top of every screen saying this is
 * demo data, with "Exit App Review Demo" (→ Welcome). It sits above the app,
 * in the layout (not over it), so it never covers a header or a button.
 */
export function AppReviewBanner() {
  const insets = useSafeAreaInsets();
  const exit = useSession((s) => s.exitReviewDemo);
  const [busy, setBusy] = useState(false);
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} accessibilityRole="header" testID="app-review-banner">
      <View style={styles.row}>
        <FlaskConical size={15} color={colors.white} />
        <T v="footnote" weight="700" color={colors.white} style={{ marginLeft: 6, flex: 1 }} numberOfLines={1}>
          App Review Demo
        </T>
        <Tap
          onPress={() => {
            setBusy(true);
            void exit().finally(() => setBusy(false));
          }}
          disabled={busy}
          haptic="light"
          style={styles.exit}
          accessibilityLabel="Exit App Review Demo"
          testID="exit-app-review-demo"
        >
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <LogOut size={14} color={colors.accent} />}
          <T v="footnote" weight="800" color={colors.accent} style={{ marginLeft: 5 }}>
            Exit App Review Demo
          </T>
        </Tap>
      </View>
    </View>
  );
}

const BAR = 40;

/**
 * The app, with the App Review banner above it when `active`. The app sits in
 * its own safe-area provider below the banner, so screens don't pad for the
 * status bar twice (the banner already covers it).
 */
export function AppReviewFrame({ active, children }: { active: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const top = active ? insets.top + BAR : 0;
  return (
    <View style={{ flex: 1 }}>
      {active ? <AppReviewBanner /> : null}
      <SafeAreaProvider
        style={{ flex: 1 }}
        initialMetrics={{ insets: { ...insets, top: active ? 0 : insets.top }, frame: { ...frame, y: frame.y + top, height: frame.height - top } }}
      >
        {children}
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', height: BAR, paddingHorizontal: 14 },
  exit: { flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.white },
});
