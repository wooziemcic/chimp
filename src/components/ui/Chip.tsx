import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radius, shadow } from '@/theme';
import { Tap } from './Tap';
import { T } from './Text';

interface ChipProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onPress?: () => void;
  size?: 'md' | 'sm';
  tone?: 'light' | 'dark';
  activeColor?: string;
  style?: ViewStyle;
}

/** Filter / segment chip (Boards, Buzz, Drift, After Dark). */
export function Chip({ label, icon, active, onPress, size = 'md', tone = 'light', activeColor = colors.accent, style }: ChipProps) {
  const h = size === 'md' ? 44 : 34;
  const dark = tone === 'dark';
  return (
    <Tap
      onPress={onPress}
      haptic="select"
      accessibilityState={{ selected: !!active }}
      style={[
        styles.chip,
        { height: h, paddingHorizontal: size === 'md' ? 16 : 12 },
        dark ? styles.dark : styles.light,
        active && { backgroundColor: activeColor, borderColor: activeColor },
        active && !dark ? shadow.glow : null,
        active && dark ? styles.darkActiveGlow : null,
        style,
      ]}
    >
      {icon ? <View style={{ marginRight: 7 }}>{icon}</View> : null}
      <T v={size === 'md' ? 'callout' : 'footnote'} color={active ? colors.white : dark ? 'rgba(255,255,255,0.88)' : colors.ink2} weight="600" numberOfLines={1}>
        {label}
      </T>
    </Tap>
  );
}

/** Small static interest tag (profiles, people cards). */
export function InterestChip({ label, icon, active, onPress }: { label: string; icon?: ReactNode; active?: boolean; onPress?: () => void }) {
  return (
    <Tap
      onPress={onPress}
      disabled={!onPress}
      scaleTo={onPress ? 0.96 : 1}
      style={[styles.interest, active ? { backgroundColor: colors.accentSoft, borderColor: '#CFE0FF' } : null]}
    >
      {icon ? <View style={{ marginRight: 5 }}>{icon}</View> : null}
      <T v="footnote" color={active ? colors.accent : colors.ink2} weight="600">
        {label}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  light: { backgroundColor: colors.surface, borderColor: colors.line },
  dark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.16)' },
  darkActiveGlow: {
    shadowColor: '#FF2E88',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  interest: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
