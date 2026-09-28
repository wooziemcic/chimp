import { memo, useCallback, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { T } from '@/components/ui/Text';
import type { PulsePage } from '@/services/recommender';
import { colors, fonts } from '@/theme';
import { CANVAS_HEIGHT, CARD_SLOTS, CIRCLE_SLOTS } from './layout';
import { PulseCard, PulseCircle } from './PulseTiles';

interface Props {
  pages: PulsePage[];
  width: number;
  s: number;
  annotate: boolean;
  onOpenAfterDark: () => void;
}

/** Horizontally paged editorial canvas with the approved composition. */
export const PulseCanvas = memo(function PulseCanvas({ pages, width, s, annotate, onOpenAfterDark }: Props) {
  const [page, setPage] = useState(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const p = Math.round(e.nativeEvent.contentOffset.x / width);
      if (p !== page) setPage(p);
    },
    [page, width],
  );

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={32}
        decelerationRate="fast"
      >
        {pages.map((pg, pi) => (
          <View key={pi} style={{ width, height: CANVAS_HEIGHT * s }}>
            {pg.circles.map((e, i) => (
              <PulseCircle key={`c-${entityKey(e)}`} entity={e} slot={CIRCLE_SLOTS[i]} s={s} index={i} onOpenAfterDark={onOpenAfterDark} />
            ))}
            {pg.cards.map((e, i) => (
              <PulseCard key={`k-${entityKey(e)}`} entity={e} slot={CARD_SLOTS[i]} s={s} index={i + 3} onOpenAfterDark={onOpenAfterDark} />
            ))}
            {annotate && pi === 0 ? <Annotations s={s} /> : null}
          </View>
        ))}
      </ScrollView>
      {pages.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${pages.length}`}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function entityKey(e: PulsePage['cards'][number]) {
  return e.kind === 'board' ? e.board.id : e.kind === 'move' ? e.move.id : e.person.id;
}

/** Handwritten margin notes from the approved design. */
function Annotations({ s }: { s: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: 352 * s, top: 40 * s, width: 38 * s, transform: [{ rotate: '-6deg' }] }}>
        <T style={[styles.hand, { fontSize: 18 * s, lineHeight: 18 * s }]}>{'Real\npeople.\nReal\nplans.'}</T>
        <Svg width={40 * s} height={40 * s} viewBox="0 0 40 40" style={{ marginTop: 2, marginLeft: 2 * s }}>
          <Path d="M30 4 C 34 18, 28 30, 8 32" stroke={colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M14 26 L 7 32 L 15 37" stroke={colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
      <View style={{ position: 'absolute', left: 14 * s, top: 440 * s, flexDirection: 'row', alignItems: 'flex-end' }}>
        <T style={[styles.hand, { fontSize: 22 * s, lineHeight: 22 * s, transform: [{ rotate: '-6deg' }] }]}>{'A more\n  connected you'}</T>
        <Svg width={44 * s} height={34 * s} viewBox="0 0 44 34" style={{ marginLeft: 2, marginBottom: 10 * s }}>
          <Path d="M2 30 C 16 30, 30 22, 38 6" stroke={colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M30 8 L 38 4 L 40 13" stroke={colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Deeper blue + white halo keeps the notes legible over glows and photos.
  hand: {
    fontFamily: fonts.handBold,
    color: colors.accentPressed,
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lineStrong },
  dotActive: { backgroundColor: colors.accent, width: 8 },
});
