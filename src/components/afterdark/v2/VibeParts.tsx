/**
 * Phase 7A: small shared pieces of After Dark v2 (dark, photo-first).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Lock } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { INTERESTS } from '@/data/interests';
import { ME } from '@/data/users';
import type { VibeRow, VibeStatus } from '@/services/backend/afterDark';
import { ds } from '@/services/dataset';
import { adUser } from '@/store/useAfterDark';
import { layout } from '@/theme';
import { ad, PINK_GRADIENT } from './adTheme';

export const interestLabel = (id: string) => INTERESTS.find((i) => i.id === id)?.label ?? id.replace(/^i_/, '').replace(/_/g, ' ');

/** "You + Maya": your photo and theirs, overlapping — a Vibe is the pair. */
export function PairAvatars({ otherId, size = 44, ring = ad.bg }: { otherId: string; size?: number; ring?: string }) {
  const me = ds().me ?? ME;
  const them = adUser(otherId);
  return (
    <View style={{ width: size * 1.62, height: size }}>
      <Avatar uri={me.avatar} name={me.displayName} size={size} ring={ring} ringWidth={2} style={{ position: 'absolute', left: 0 }} />
      <Avatar uri={them?.avatar} name={them?.displayName ?? '?'} size={size} ring={ring} ringWidth={2} style={{ position: 'absolute', left: size * 0.62 }} />
    </View>
  );
}

const STATUS_STYLE: Record<VibeStatus | 'cooling', { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: ad.ok, bg: ad.okSoft },
  pending: { label: 'Pending', color: ad.pink, bg: ad.pinkSoft },
  cooling: { label: 'Cooling', color: ad.warn, bg: ad.warnSoft },
  paused: { label: 'Paused', color: ad.muted, bg: ad.glass },
  closed: { label: 'Closed', color: ad.faint, bg: ad.glass },
};

export function StatusPill({ status }: { status: VibeStatus | 'cooling' }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]} testID={`status-${status}`}>
      <View style={[styles.dot, { backgroundColor: s.color }]} />
      <T v="caption" weight="700" color={s.color}>
        {s.label}
      </T>
    </View>
  );
}

export function StagePill({ stage }: { stage: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: ad.pinkSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.pinkLine }]}>
      <T v="caption" weight="800" color={ad.pink}>
        {stage}
      </T>
    </View>
  );
}

/** How a Vibe started, in one line ("Maya answered your Open Loop"). */
export function originLine(v: Pick<VibeRow, 'origin' | 'requested_by_me'>, first: string): string {
  if (v.origin === 'mutual_crush') return 'You both had a Crush';
  if (v.origin === 'open_loop') return v.requested_by_me ? `You answered ${first}’s Open Loop` : `${first} answered your Open Loop`;
  return v.requested_by_me ? `You sent ${first} interest` : `${first} sent you interest`;
}

export function previewOf(v: Pick<VibeRow, 'last_body' | 'last_type' | 'last_sender'>, me: string | undefined): string {
  const who = v.last_sender === me ? 'You: ' : '';
  if (v.last_type === 'voice') return `${who}🎤 Voice note`;
  if (v.last_type === 'photo') return `${who}📷 Photo`;
  return v.last_body ? `${who}${v.last_body}` : '';
}

export function DarkButton({ label, onPress, tone = 'pink', icon, busy, disabled, small, style, testID, accessibilityLabel }: { label: string; onPress: () => void; tone?: 'pink' | 'ghost' | 'danger' | 'soft'; icon?: ReactNode; busy?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle; testID?: string; accessibilityLabel?: string }) {
  const h = small ? 38 : 48;
  return (
    <Tap
      onPress={onPress}
      disabled={disabled || busy}
      haptic="light"
      style={[
        styles.btn,
        { height: h, borderRadius: h / 2, paddingHorizontal: small ? 14 : 18 },
        tone === 'ghost' && { borderWidth: 1, borderColor: ad.lineStrong },
        tone === 'soft' && { backgroundColor: ad.glass },
        tone === 'danger' && { backgroundColor: 'rgba(255,90,95,0.14)' },
        (disabled || busy) && { opacity: 0.5 },
        style,
      ]}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      testID={testID}
    >
      {tone === 'pink' ? <LinearGradient colors={PINK_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {busy ? <ActivityIndicator color="#fff" /> : icon}
      <T v={small ? 'footnote' : 'bodyStrong'} weight="700" color={tone === 'danger' ? ad.danger : '#fff'} style={{ marginLeft: icon || busy ? 6 : 0 }} numberOfLines={1}>
        {label}
      </T>
    </Tap>
  );
}

/** A dark bottom sheet. */
export function DarkSheet({ visible, onClose, title, subtitle, children, testID, onDismissed }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; testID?: string; onDismissed?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    // onDismiss (iOS) fires once the sheet is fully gone: the moment it's safe to present the photo picker.
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismissed}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 6 }]} onPress={() => undefined} testID={testID}>
            <View style={styles.grabber} />
            <T v="title3" color={ad.ink} style={{ marginTop: 12 }}>
              {title}
            </T>
            {subtitle ? (
              <T v="footnote" color={ad.muted} style={{ marginTop: 4, lineHeight: 18 }}>
                {subtitle}
              </T>
            ) : null}
            <View style={{ marginTop: 14 }}>{children}</View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * A selectable row inside a sheet. `locked`: the capability exists but isn't
 * yours to use right now (e.g. the other person controls photos) — shown
 * dimmed with a lock and a calm note, and it can't be tapped.
 */
export function ChoiceRow({ label, sub, selected, onPress, testID, danger, locked, style }: { label: string; sub?: string; selected?: boolean; onPress: () => void; testID?: string; danger?: boolean; locked?: boolean; style?: ViewStyle }) {
  return (
    <Tap
      onPress={locked ? undefined : onPress}
      disabled={locked}
      style={[styles.choice, style, selected && { borderColor: ad.pink, backgroundColor: ad.pinkSoft }, locked && styles.choiceLocked]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!locked }}
      accessibilityLabel={locked ? `${label}, locked${sub ? `. ${sub}` : ''}` : label}
      testID={testID}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="callout" weight="600" color={danger ? ad.danger : locked ? ad.muted : ad.ink} numberOfLines={1}>
          {label}
        </T>
        {sub ? (
          <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 2, lineHeight: 16 }}>
            {sub}
          </T>
        ) : null}
      </View>
      {locked ? (
        <View style={styles.lockPill} testID={testID ? `${testID}-locked` : undefined}>
          <Lock size={12} color={ad.muted} />
          <T v="caption" weight="700" color={ad.muted} style={{ marginLeft: 4 }}>
            Locked
          </T>
        </View>
      ) : null}
      {selected !== undefined ? <View style={[styles.radio, selected && { borderColor: ad.pink, backgroundColor: ad.pink }]} /> : null}
    </Tap>
  );
}

/** A section title inside an After Dark tab (Phase 7C: sentence case, the shared rhythm). */
export function SectionLabel({ children, right, first }: { children: string; right?: ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: first ? 4 : layout.sectionGap, marginBottom: layout.sectionLabelGap }}>
      <T v="headline" color={ad.ink} style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </T>
      {right}
    </View>
  );
}

/** Phase 7C: a compact empty state — a title, one line, one action. */
export function EmptyNote({ title, body, action, testID }: { title: string; body?: string; action?: ReactNode; testID?: string }) {
  return (
    <View style={styles.empty} testID={testID}>
      <T v="callout" weight="700" color={ad.ink}>
        {title}
      </T>
      {body ? (
        <T v="footnote" color={ad.muted} style={{ marginTop: 4, lineHeight: 18 }}>
          {body}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: 12, alignItems: 'flex-start' }}>{action}</View> : null}
    </View>
  );
}

export function ErrorLine({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <T v="footnote" color={ad.danger} style={{ marginTop: 8 }} testID="ad-error">
      {text}
    </T>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', height: 24, paddingHorizontal: 9, borderRadius: 12, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: ad.plum2, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 8, maxHeight: '92%', borderTopWidth: StyleSheet.hairlineWidth, borderColor: ad.lineStrong },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: ad.lineStrong },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: ad.line, marginBottom: 8, backgroundColor: ad.glass },
  choiceLocked: { opacity: 0.6, borderStyle: 'dashed' },
  lockPill: { flexDirection: 'row', alignItems: 'center', height: 24, paddingHorizontal: 8, borderRadius: 12, marginLeft: 10, backgroundColor: ad.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.lineStrong },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: ad.lineStrong },
  empty: { paddingVertical: layout.emptyPaddingV, paddingHorizontal: layout.emptyPaddingH, borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line, backgroundColor: ad.card },
});
