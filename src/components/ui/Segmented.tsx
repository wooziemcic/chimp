import { StyleSheet, View } from 'react-native';

import { colors, shadow } from '@/theme';
import { Tap } from './Tap';
import { T } from './Text';

/** Pill segmented control (Buzz: For You / Following / Trending / Drift). `dark` sits over media (Drift). */
export function Segmented<K extends string>({ value, options, onChange, dark }: { value: K; options: { id: K; label: string }[]; onChange: (id: K) => void; dark?: boolean }) {
  return (
    <View style={[styles.track, dark && styles.trackDark]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Tap
            key={o.id}
            onPress={() => onChange(o.id)}
            haptic="select"
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.seg, on && styles.on, on && shadow.glow]}
          >
            <T v="callout" weight={on ? '700' : '600'} color={on ? colors.white : dark ? 'rgba(255,255,255,0.82)' : colors.inkMuted} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {o.label}
            </T>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', marginHorizontal: 16, padding: 4, borderRadius: 26, backgroundColor: colors.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  seg: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.accent },
  trackDark: { backgroundColor: 'rgba(20,20,24,0.55)', borderColor: 'rgba(255,255,255,0.14)' },
});
