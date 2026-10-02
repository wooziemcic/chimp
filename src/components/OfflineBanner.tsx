/**
 * Phase 7C: a small "Offline" pill under the status bar while the phone has
 * no connection. Never blocks a tap (pointerEvents none), never a modal; it
 * appears after a short grace period so a brief hiccup doesn't flash it.
 * Sends still queue and retry on their own (7B), so this only informs.
 */
import { useNetInfo } from '@react-native-community/netinfo';
import { WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/components/ui/Text';

/**
 * Only "no network at all". `isInternetReachable` is not used: it comes from
 * a probe request to a fixed URL, which a captive or filtered network can
 * block while Chimp itself works fine — the pill must never cry wolf.
 */
export function isOffline(n: { isConnected: boolean | null }): boolean {
  return n.isConnected === false;
}

export function OfflineBanner() {
  const net = useNetInfo();
  const insets = useSafeAreaInsets();
  const offline = isOffline(net);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(offline), offline ? 1500 : 0);
    return () => clearTimeout(t);
  }, [offline]);
  if (!shown) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 4, pointerEvents: 'none' }]} accessibilityRole="alert" accessibilityLabel="You're offline" testID="offline-banner">
      <View style={styles.pill}>
        <WifiOff size={13} color="#fff" strokeWidth={2.4} />
        <T v="caption" weight="700" color="#fff" style={{ marginLeft: 6 }}>
          Offline
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: { flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(20,20,28,0.82)' },
});
