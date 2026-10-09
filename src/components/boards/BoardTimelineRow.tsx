import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { openWorldActions } from '@/components/worlds/WorldActionSheet';
import type { TimelineEntry } from '@/graph/boardTimeline';
import { colors, radius, shadow } from '@/theme';
import { BOARD_ACCESS, accessOf } from '@/utils/boardVisibility';
import { compact } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

/** Phase 9.2: one Board in the Timeline layout (the same Board as its cover card). */
export const BoardTimelineRow = memo(function BoardTimelineRow({ entry }: { entry: TimelineEntry }) {
  const b = entry.board;
  return (
    <Tap
      onPress={() => pushOnce(`/board/${b.id}`)}
      onLongPress={() => openWorldActions(b.id)}
      delayLongPress={380}
      accessibilityHint="Long-press to pin"
      scaleTo={0.985}
      style={[styles.row, shadow.sm]}
      accessibilityLabel={`Open ${b.title}. ${entry.why}`}
      testID={`timeline-${b.id}`}
    >
      <Img uri={b.cover} style={styles.cover} />
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <T v="bodyStrong" numberOfLines={1}>
          {b.title}
        </T>
        <T v="footnote" color={colors.ink2} weight="500" numberOfLines={1} style={{ marginTop: 1 }}>
          {entry.why}
        </T>
        <T v="caption" color={colors.inkFaint} weight="500" numberOfLines={1} style={{ marginTop: 1 }}>
          {`${BOARD_ACCESS[accessOf(b)].label} · ${compact(b.memberCount)} ${b.memberCount === 1 ? 'member' : 'members'}`}
        </T>
      </View>
      <ChevronRight size={16} color={colors.inkFaint} style={{ marginLeft: 6 }} />
    </Tap>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, padding: 10, borderRadius: radius.lg, backgroundColor: colors.surface },
  cover: { width: 60, height: 60, borderRadius: radius.md },
});
