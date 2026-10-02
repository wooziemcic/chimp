import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors, layout, night, shadow } from '@/theme';
import { Tap } from './Tap';
import { T } from './Text';

type Tone = 'light' | 'dark' | 'night';

/**
 * Pill segmented control — one component, one size for every mode (Phase 7C):
 *   light  Buzz (For You / Following / Trending / Drift)
 *   dark   over media (Drift)
 *   night  After Dark (Discover / Vibes / Challenges / Plans / Inbox), pink
 * `badge` puts a small dot on a segment (something new there).
 */
export function Segmented<K extends string>({
  value,
  options,
  onChange,
  dark,
  tone: toneProp,
  testIDPrefix,
}: {
  value: K;
  options: { id: K; label: string; badge?: boolean }[];
  onChange: (id: K) => void;
  /** Back-compat: `dark` = tone "dark". */
  dark?: boolean;
  tone?: Tone;
  testIDPrefix?: string;
}) {
  const tone: Tone = toneProp ?? (dark ? 'dark' : 'light');
  const { width } = useWindowDimensions();
  const many = options.length > 4;
  // Five labels on a 375-pt phone: a touch smaller and tighter so "Challenges" fits.
  const tight = many && width < 400;
  return (
    <View style={[styles.track, tone === 'dark' && styles.trackDark, tone === 'night' && styles.trackNight]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.id === value;
        const activeBg = tone === 'night' ? night.magenta : colors.accent;
        return (
          <Tap
            key={o.id}
            onPress={() => onChange(o.id)}
            haptic="select"
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.badge ? `${o.label}, new` : o.label}
            testID={testIDPrefix ? `${testIDPrefix}${o.id}` : undefined}
            style={[styles.seg, tight && { paddingHorizontal: 1 }, on && { backgroundColor: activeBg }, on && tone !== 'night' && shadow.glow]}
          >
            <T
              v={many ? 'footnote' : 'callout'}
              weight={on ? '700' : '600'}
              color={on ? colors.white : tone === 'light' ? colors.inkMuted : 'rgba(255,255,255,0.72)'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={1.15}
              style={tight ? { fontSize: 11.5, letterSpacing: -0.2 } : undefined}
            >
              {o.label}
            </T>
            {o.badge ? <View style={[styles.badge, { backgroundColor: on ? colors.white : tone === 'night' ? night.magenta : colors.accent }]} /> : null}
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    marginHorizontal: layout.gutter,
    padding: layout.segmentedPadding,
    borderRadius: layout.segmentedRadius,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  seg: { flex: 1, minWidth: 0, height: layout.segmentedHeight, borderRadius: layout.segmentedRadius - layout.segmentedPadding, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  trackDark: { backgroundColor: 'rgba(20,20,24,0.55)', borderColor: 'rgba(255,255,255,0.14)' },
  trackNight: { backgroundColor: night.surface, borderColor: night.line },
  badge: { position: 'absolute', top: 6, right: 8, width: 6, height: 6, borderRadius: 3 },
});
