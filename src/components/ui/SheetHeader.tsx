import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';
import { Tap } from './Tap';
import { T } from './Text';

/** Header for modal sheets: grabber, title, close. */
export function SheetHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View>
      <View style={styles.grabber} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <T v="title2">{title}</T>
          {subtitle ? (
            <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
              {subtitle}
            </T>
          ) : null}
        </View>
        {right}
        <Tap onPress={() => router.back()} accessibilityLabel="Close" style={styles.close}>
          <X size={20} color={colors.ink} strokeWidth={2.4} />
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
