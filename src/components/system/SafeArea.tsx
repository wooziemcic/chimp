/**
 * Phase 8 — one safe-area contract for every screen.
 *
 *   App screens (tabs, Board, chats, profiles…) render INSIDE the app frame and
 *   use `useSafeAreaInsets()` / `SafeAreaView` as before. In the App Review Demo
 *   that frame starts below the review banner, so its top inset is 0 there —
 *   correct, because the banner already covers the status bar.
 *
 *   Full-screen surfaces (React Native <Modal> viewers, fullScreenModal routes
 *   such as the story viewer and Drift) cover the WHOLE phone, banner included.
 *   They must use `useDeviceInsets()`: the phone's real insets, captured once at
 *   the root (outside the App Review frame), never 0 on a phone with a notch or
 *   Dynamic Island, and never below what the phone reported at launch (iOS can
 *   report 0 inside a freshly presented Modal for a frame or two).
 *
 *   Controls on full-screen surfaces go in <FullscreenTopBar>: always below the
 *   status bar / notch / Dynamic Island, 44-pt targets, inside the side insets.
 *
 * No device names and no guessed numbers: everything comes from the insets.
 */
import { createContext, type ReactNode, useContext } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { type EdgeInsets, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fullscreenTop, MIN_TAP, resolveDeviceInsets } from '@/theme/safeArea';

export { FULLSCREEN_GAP, fullscreenTop, MIN_TAP, resolveDeviceInsets } from '@/theme/safeArea';

const DeviceInsetsContext = createContext<EdgeInsets | null>(null);

/** Mounted once at the root, OUTSIDE the App Review frame. */
export function DeviceInsetsProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <DeviceInsetsContext.Provider value={insets}>{children}</DeviceInsetsContext.Provider>;
}

/**
 * The phone's real safe area, for anything that covers the whole screen.
 * (Chimp is portrait-only, so the launch insets stay valid.)
 */
export function useDeviceInsets(): EdgeInsets {
  const root = useContext(DeviceInsetsContext);
  const local = useSafeAreaInsets();
  return resolveDeviceInsets(root ?? local, initialWindowMetrics?.insets);
}

/**
 * The top row of a full-screen viewer: close / back on one side, a label or
 * count on the other. Positioned from the device insets, never from a guess.
 */
export function FullscreenTopBar({ left, right, style, testID }: { left?: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const insets = useDeviceInsets();
  return (
    <View
      style={[styles.bar, { paddingTop: fullscreenTop(insets), paddingLeft: Math.max(12, insets.left + 8), paddingRight: Math.max(12, insets.right + 8) }, style]}
      pointerEvents="box-none"
      testID={testID ?? 'fullscreen-top-bar'}
    >
      <View style={styles.side} pointerEvents="box-none">
        {left}
      </View>
      <View style={[styles.side, { justifyContent: 'flex-end' }]} pointerEvents="box-none">
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  side: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, flexShrink: 1, gap: 8 },
});
