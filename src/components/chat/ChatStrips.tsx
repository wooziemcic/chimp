import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronUp, Repeat } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useChat } from '@/store/useChat';
import { colors, radius } from '@/theme';
import type { ChemistryLine } from '@/utils/messaging';

/** "Open Loops · N": a quiet way in to what this chat wants to come back to. */
export function OpenLoopsEntry({ open, total, onPress }: { open: number; total: number; onPress: () => void }) {
  if (!total) return null;
  return (
    <Tap onPress={onPress} scaleTo={0.98} style={styles.loops} accessibilityLabel={`Open Loops, ${open} open`} testID="open-loops-entry">
      <Repeat size={14} color={colors.accent} />
      <T v="footnote" weight="700" color={colors.accent} style={{ marginLeft: 6 }}>
        {`Open Loops · ${open}`}
      </T>
    </Tap>
  );
}

/**
 * Group Chemistry: a collapsible strip. Deterministic facts only (who's
 * active, Same Brains, consensus, open loops, revealed Pings, shared Worlds).
 */
export function ChemistryStrip({ strip, lines }: { strip: string; lines: ChemistryLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.chemWrap}>
      <Tap onPress={() => setOpen((o) => !o)} scaleTo={0.99} style={styles.chemStrip} accessibilityLabel={`${strip}. ${open ? 'Hide' : 'Show'} details`} testID="chemistry-strip">
        <T v="footnote" weight="700" color={lines.length >= 3 ? colors.violet : colors.inkMuted}>
          {strip}
        </T>
        {lines.length ? (
          <T v="caption" color={colors.inkFaint} numberOfLines={1} style={{ flex: 1, marginLeft: 8 }}>
            {lines[0].text}
          </T>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {open ? <ChevronUp size={16} color={colors.inkFaint} /> : <ChevronDown size={16} color={colors.inkFaint} />}
      </Tap>
      {open ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.chemCard} testID="chemistry-card">
          {lines.length ? (
            lines.map((l) => (
              <View key={l.key} style={styles.chemLine}>
                <T style={{ width: 24, fontSize: 15 }}>{l.icon}</T>
                <T v="subhead" weight="500" color={colors.ink2} style={{ flex: 1 }}>
                  {l.text}
                </T>
              </View>
            ))
          ) : (
            <T v="subhead" color={colors.inkMuted} weight="400">
              Quiet for now. Chemistry shows up as people talk, react and plan here.
            </T>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** ⚡ Same Brain: a small burst when it happens (once; never replayed). */
export function SameBrainBurst({ conversationId }: { conversationId: string }) {
  const flash = useChat((s) => (s.flash?.conversationId === conversationId ? s.flash : undefined));
  const clear = useChat((s) => s.clearFlash);
  useEffect(() => {
    if (!flash) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const t = setTimeout(clear, 2200);
    return () => clearTimeout(t);
  }, [flash, clear]);
  if (!flash) return null;
  return (
    <View pointerEvents="none" style={styles.burstWrap}>
      <Animated.View key={flash.key} entering={ZoomIn.springify().damping(14)} exiting={FadeOut.duration(200)} style={styles.burst} testID="same-brain-burst">
        <T style={{ fontSize: 22, lineHeight: 26 }}>{flash.emoji}</T>
        <T v="subhead" weight="800" color={colors.white} style={{ marginLeft: 8 }}>
          ⚡ Same Brain
        </T>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  loops: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
  chemWrap: { marginTop: 6 },
  chemStrip: { flexDirection: 'row', alignItems: 'center', height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chemCard: { marginTop: 6, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 8 },
  chemLine: { flexDirection: 'row', alignItems: 'center' },
  burstWrap: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  burst: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.violet, shadowColor: colors.violet, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
