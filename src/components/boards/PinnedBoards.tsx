import { Pin } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { openWorldActions } from '@/components/worlds/WorldActionSheet';
import { repo } from '@/services/repository';
import { colors, radius, shadow } from '@/theme';
import type { Board } from '@/types/models';
import { compact } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

export const PIN_GOLD = '#A77B1E';

/** The pinned row at the top of Boards (was a section of Happening). */
export function PinnedBoardsRow({ boards }: { boards: Board[] }) {
  if (!boards.length) return null;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.head}>
        <Pin size={13} color={PIN_GOLD} fill={PIN_GOLD} />
        <T v="label" color={colors.inkFaint} style={{ marginLeft: 6 }}>
          PINNED
        </T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} testID="boards-pinned">
        {boards.map((b) => (
          <PinnedBoard key={b.id} board={b} />
        ))}
      </ScrollView>
    </View>
  );
}

function PinnedBoard({ board }: { board: Board }) {
  const owner = board.ownerId && !repo.isMe(board.ownerId) ? repo.user(board.ownerId) : undefined;
  const members = board.memberCount;
  return (
    <Tap
      onPress={() => pushOnce(`/board/${board.id}`)}
      onLongPress={() => openWorldActions(board.id)}
      delayLongPress={380}
      scaleTo={0.97}
      style={[styles.pin, shadow.sm]}
      accessibilityLabel={`${board.title}, pinned${owner?.username ? `, by @${owner.username}` : ''}`}
      accessibilityHint="Long-press to unpin"
      testID={`pinned-${board.id}`}
    >
      <Img uri={board.cover} style={styles.cover} />
      <View style={styles.badge}>
        <Pin size={11} color={PIN_GOLD} fill={PIN_GOLD} />
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        <T v="subhead" weight="700" numberOfLines={1}>
          {board.title}
        </T>
        <T v="caption" color={colors.inkMuted} numberOfLines={1}>
          {repo.isMe(board.ownerId) ? 'Yours' : owner?.username ? `by @${owner.username}` : board.ownerId ? 'A member’s Board' : 'Chimp World'}
          {members ? ` · ${compact(members)}` : ''}
        </T>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  pin: { width: 140, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  cover: { width: 140, height: 88 },
  badge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
});
