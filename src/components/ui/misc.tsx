import { ChevronRight } from 'lucide-react-native';
import { ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, radius, shadow, space } from '@/theme';
import { Tap } from './Tap';
import { T } from './Text';

// ─── SectionHeader ──────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  subtitle,
  onSeeAll,
  dark,
  style,
  right,
}: {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  dark?: boolean;
  style?: ViewStyle;
  right?: ReactNode;
}) {
  // Phase 9.1: iOS sizes an adjustsFontSizeToFit title once, on its first layout. A section that
  // first lays out before its row has its real width (the REAL You screen, filled in after the
  // account's data arrives) kept a tiny title. Re-measure whenever the title's width changes.
  const [titleW, setTitleW] = useState(0);
  return (
    <View style={[styles.sectionRow, style]}>
      <View style={{ flex: 1 }} onLayout={(e) => setTitleW(Math.round(e.nativeEvent.layout.width))}>
        <T key={titleW} v="title2" color={dark ? colors.white : colors.ink} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 24, lineHeight: 30 }}>
          {title}
        </T>
        {subtitle ? (
          <T v="footnote" color={dark ? 'rgba(255,255,255,0.6)' : colors.inkFaint} style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
      {onSeeAll ? (
        <Tap onPress={onSeeAll} style={styles.seeAll} accessibilityLabel={`See all ${title}`}>
          <T v="subhead" color={dark ? 'rgba(255,255,255,0.85)' : colors.inkMuted}>
            See all
          </T>
          <ChevronRight size={18} color={dark ? 'rgba(255,255,255,0.85)' : colors.inkMuted} />
        </Tap>
      ) : null}
    </View>
  );
}

// ─── StatItem ───────────────────────────────────────────────────────────────

export function StatItem({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  return (
    <Tap onPress={onPress} disabled={!onPress} scaleTo={onPress ? 0.95 : 1} style={styles.stat}>
      <T v="title3" style={{ fontSize: 19 }}>
        {value}
      </T>
      <T v="caption" color={colors.inkMuted} weight="500" style={{ marginTop: 3, fontSize: 12 }}>
        {label}
      </T>
    </Tap>
  );
}

// ─── Fresh badge (World Delta, subtle) ──────────────────────────────────────

/** Compact "new since your last visit" marker. */
export function FreshBadge({ count, variant = 'pill', style }: { count: number; variant?: 'pill' | 'dot' | 'glass' | 'pip'; style?: ViewStyle }) {
  if (count <= 0) return null;
  if (variant === 'pip') {
    // One quiet "changed since you left" signal per object — no numbers.
    return <View style={[styles.pip, style]} accessibilityLabel="New since your last visit" />;
  }
  if (variant === 'dot') {
    return (
      <View style={[styles.dotBadge, style]} accessibilityLabel={`${count} new since your last visit`}>
        <T v="caption" color={colors.white} weight="700" style={{ fontSize: 10.5, lineHeight: 12 }}>
          {count > 9 ? '9+' : count}
        </T>
      </View>
    );
  }
  const glass = variant === 'glass';
  return (
    <View style={[styles.freshPill, glass && styles.freshGlass, style]}>
      <View style={[styles.freshDot, glass && { backgroundColor: '#7FB0FF' }]} />
      <T v="caption" color={glass ? colors.white : colors.accent} weight="700">
        {`${count} new`}
      </T>
    </View>
  );
}

// ─── Glass pill (image overlays) ────────────────────────────────────────────

export function GlassPill({ children, style, dark = true }: { children: ReactNode; style?: ViewStyle; dark?: boolean }) {
  return <View style={[styles.glass, dark ? styles.glassDark : styles.glassLight, style]}>{children}</View>;
}

// ─── Buttons ────────────────────────────────────────────────────────────────

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  style,
  size = 'md',
  color = colors.accent,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'white';
  icon?: ReactNode;
  style?: ViewStyle;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  disabled?: boolean;
}) {
  const h = size === 'lg' ? 54 : size === 'md' ? 46 : 36;
  const bg = variant === 'primary' ? color : variant === 'secondary' ? colors.accentSoft : variant === 'white' ? colors.white : 'transparent';
  const fg = variant === 'primary' ? colors.white : variant === 'white' ? colors.ink : color;
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      style={[
        styles.button,
        { height: h, backgroundColor: bg, paddingHorizontal: size === 'sm' ? 14 : 20, opacity: disabled ? 0.5 : 1 },
        variant === 'primary' ? shadow.glow : null,
        variant === 'white' ? shadow.md : null,
        style,
      ]}
    >
      {icon ? <View style={{ marginRight: 8 }}>{icon}</View> : null}
      <T v={size === 'sm' ? 'footnote' : 'bodyStrong'} color={fg} weight="700">
        {label}
      </T>
    </Tap>
  );
}

// ─── Match ring ─────────────────────────────────────────────────────────────

export function MatchRing({ value, size = 46, stroke = 3.5 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.accentSoft} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <T v="caption" weight="800" style={{ fontSize: size * 0.24, lineHeight: size * 0.28 }}>
        {`${value}%`}
      </T>
      <T v="caption" color={colors.inkFaint} weight="500" style={{ fontSize: size * 0.15, lineHeight: size * 0.17 }}>
        match
      </T>
    </View>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, body, action, dark }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode; dark?: boolean }) {
  return (
    <View style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <T v="headline" align="center" color={dark ? colors.white : colors.ink}>
        {title}
      </T>
      {body ? (
        <T v="subhead" color={dark ? 'rgba(255,255,255,0.7)' : colors.inkMuted} align="center" style={{ marginTop: 6, maxWidth: 280 }}>
          {body}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ dark }: { dark?: boolean }) {
  return (
    <View style={[styles.loading, dark && { backgroundColor: '#07060A' }]}>
      <ActivityIndicator color={dark ? '#FF2E88' : colors.accent} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 12 },
  stat: { alignItems: 'flex-start', minHeight: 44, justifyContent: 'center' },
  pip: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: colors.white,
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  dotBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  freshGlass: { backgroundColor: 'rgba(12,16,28,0.42)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  freshDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginRight: 5 },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  glassDark: { backgroundColor: 'rgba(20,22,30,0.38)', borderColor: 'rgba(255,255,255,0.32)' },
  glassLight: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: 'rgba(255,255,255,0.9)' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.sm,
  },
});

/** Thin rounded progress bar (Open Loop progress). 0..100. */
export function ProgressBar({ value, color = colors.accent, track = colors.surfaceMuted, height = 6, style }: { value: number; color?: string; track?: string; height?: number; style?: ViewStyle }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={{ width: `${pct}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}
