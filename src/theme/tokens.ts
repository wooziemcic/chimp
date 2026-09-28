import { Platform, TextStyle, ViewStyle } from 'react-native';

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 20,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

/** Minimum comfortable touch target (Apple HIG). */
export const HIT = 44;

export const fonts = {
  hand: 'Caveat_600SemiBold',
  handBold: 'Caveat_700Bold',
} as const;

type TextVariant =
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'subhead'
  | 'footnote'
  | 'caption'
  | 'eyebrow'
  | 'label';

export const type: Record<TextVariant, TextStyle> = {
  display: { fontSize: 44, lineHeight: 48, fontWeight: '800', letterSpacing: -1.2 },
  title1: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  title2: { fontSize: 26, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  subhead: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 17, fontWeight: '500' },
  caption: { fontSize: 11.5, lineHeight: 14, fontWeight: '600' },
  eyebrow: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 2.2 },
  label: { fontSize: 12, lineHeight: 15, fontWeight: '600', letterSpacing: 0.4 },
};

export const shadow: Record<'sm' | 'md' | 'lg' | 'glow', ViewStyle> = {
  sm: Platform.select({
    ios: { shadowColor: '#0B1A3A', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
    default: { elevation: 2 },
  }) as ViewStyle,
  md: Platform.select({
    ios: { shadowColor: '#0B1A3A', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    default: { elevation: 5 },
  }) as ViewStyle,
  lg: Platform.select({
    ios: { shadowColor: '#0B1A3A', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
    default: { elevation: 10 },
  }) as ViewStyle,
  glow: Platform.select({
    ios: { shadowColor: '#1D6BFF', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    default: { elevation: 6 },
  }) as ViewStyle,
};
