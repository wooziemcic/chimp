import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, MapPin, Sparkles } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AvatarStack } from '@/components/ui/AvatarStack';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useFresh, useSignals } from '@/hooks/useGraph';
import { cardReason, moveRelevance } from '@/services/recommender';
import { useChimp } from '@/store/useChimp';
import { colors, shadow } from '@/theme';
import type { Move } from '@/types/models';
import { compact } from '@/utils/format';

interface Props {
  move: Move;
  width: number;
  height?: number;
  /** Hide the relevance line (e.g. where the context already explains it). */
  plain?: boolean;
}

/**
 * Image-led Move card from the approved Moves screen, plus one lightweight
 * line that answers "why is this relevant to me?".
 */
export const MoveCard = memo(function MoveCard({ move, width, height = width * 1.46, plain }: Props) {
  const state = useChimp((s) => s.moveState[move.id]);
  const fresh = useFresh({ kind: 'move', id: move.id });
  const signals = useSignals();
  const why = useMemo(() => (plain ? undefined : cardReason(moveRelevance(signals, move))), [signals, move, plain]);
  const going = !!state?.rsvp;
  const narrow = width < 150;

  return (
    <Tap
      onPress={() => router.push(`/move/${move.id}`)}
      scaleTo={0.97}
      accessibilityLabel={`${move.title}, ${move.city}, ${move.dateLabel}${why ? `. ${why.text}` : ''}`}
      style={[{ width, height }, styles.card, shadow.md]}
    >
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Img uri={move.image} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} locations={[0, 0.3, 1]} style={StyleSheet.absoluteFill} />
      </View>

      <View style={styles.top}>
        {going ? (
          <View style={[styles.flag, { backgroundColor: colors.success }]}>
            <Check size={11} color={colors.white} strokeWidth={3} />
            <T v="caption" color={colors.white} weight="800" style={{ fontSize: 10, marginLeft: 3 }}>
              GOING
            </T>
          </View>
        ) : fresh > 0 ? (
          <View style={styles.flag}>
            <T v="caption" color={colors.white} weight="800" style={{ fontSize: 10, letterSpacing: 0.6 }}>
              NEW
            </T>
          </View>
        ) : (
          <View />
        )}
        <View style={styles.count}>
          <AvatarStack userIds={move.attendeePreview} size={22} max={2} />
          <T v="footnote" weight="600" style={{ marginLeft: 5, fontSize: 12.5 }}>
            {compact(move.attendeeCount)}
          </T>
        </View>
      </View>

      <View style={styles.bottom}>
        {why ? (
          <View style={styles.why}>
            <Sparkles size={10} color="#BFD5FF" />
            <T v="caption" color="#DCE7FF" weight="700" numberOfLines={1} style={{ marginLeft: 4, fontSize: 10.5, flexShrink: 1 }}>
              {why.short}
            </T>
          </View>
        ) : null}
        <T
          v="headline"
          color={colors.white}
          numberOfLines={2}
          style={[styles.shadow, { fontSize: narrow ? 16 : 18, lineHeight: narrow ? 19 : 22 }]}
        >
          {move.title}
        </T>
        <T v="footnote" color="rgba(255,255,255,0.88)" weight="400" numberOfLines={narrow ? 1 : 2} style={[styles.shadow, { marginTop: 2, fontSize: 12, lineHeight: 15 }]}>
          {move.subtitle}
        </T>
        {/* One glass pill keeps place + date readable at narrow widths. */}
        <View style={styles.pill}>
          <MapPin size={11} color={colors.white} />
          <T v="caption" color={colors.white} weight="600" numberOfLines={1} style={{ marginLeft: 3, fontSize: 11, flexShrink: 1 }}>
            {`${move.city} · ${move.dateLabel}`}
          </T>
        </View>
      </View>
    </Tap>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 18, backgroundColor: colors.bgSoft },
  clip: { borderRadius: 18, overflow: 'hidden' },
  top: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingLeft: 4,
    paddingRight: 9,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  flag: { flexDirection: 'row', alignItems: 'center', height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: colors.accent },
  bottom: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  why: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(29,107,255,0.45)',
    marginBottom: 5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 24,
    paddingHorizontal: 8,
    marginTop: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(20,22,30,0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  shadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
});
