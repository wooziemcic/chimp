import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, HIT, shadow } from '@/theme';
import { Tap } from './Tap';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  variant?: 'light' | 'glass' | 'dark' | 'plain';
  badge?: boolean;
  badgeColor?: string;
  label: string;
  style?: ViewStyle;
}

/** Circular icon control; always at least a 44pt hit area. */
export function IconButton({ children, onPress, size = 48, variant = 'light', badge, badgeColor = colors.accent, label, style }: Props) {
  const bg =
    variant === 'light'
      ? colors.white
      : variant === 'glass'
        ? 'rgba(255,255,255,0.9)'
        : variant === 'dark'
          ? 'rgba(255,255,255,0.08)'
          : 'transparent';
  return (
    <Tap
      onPress={onPress}
      accessibilityLabel={label}
      haptic="light"
      style={[
        {
          width: Math.max(size, HIT),
          height: Math.max(size, HIT),
          borderRadius: size,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
        },
        variant === 'light' || variant === 'glass' ? shadow.sm : null,
        variant === 'dark' ? styles.darkBorder : null,
        style,
      ]}
    >
      {children}
      {badge ? <View style={[styles.badge, { backgroundColor: badgeColor }]} /> : null}
    </Tap>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.white,
  },
  darkBorder: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
});
