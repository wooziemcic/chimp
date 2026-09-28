import { router } from 'expo-router';
import { CalendarClock, Calendar, CheckCheck, Heart, LayoutGrid, Link2, PlayCircle, Sparkles, UserPlus } from 'lucide-react-native';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { EmptyState } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useUnseenChanges } from '@/hooks/useGraph';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { ChangeEvent, ChangeType } from '@/types/models';
import { hrefFor } from '@/utils/links';
import { timeAgo } from '@/utils/format';

const ICON: Record<ChangeType, typeof Sparkles> = {
  BOARD_ACTIVITY: LayoutGrid,
  PERSON_BECAME_RELEVANT: UserPlus,
  MOVE_OPENED: Calendar,
  MOVE_CLOSING: CalendarClock,
  NEW_MATCH: Heart,
  OPEN_LOOP_PROGRESS: Sparkles,
  STORY_UPDATE: PlayCircle,
  NEW_CONNECTION_ACTIVITY: Link2,
};

/**
 * World Delta — a finite list of what changed since the last visit, each
 * with the reason it matters. Ends in "You're caught up", not an infinite feed.
 */
export default function DeltaSheet() {
  const insets = useSafeAreaInsets();
  const unseen = useUnseenChanges();
  const markChangeSeen = useChimp((s) => s.markChangeSeen);
  const markAll = useChimp((s) => s.markAllChangesSeen);

  const open = (d: ChangeEvent) => {
    markChangeSeen(d.id);
    router.back();
    setTimeout(() => router.push(hrefFor(d.ref)), 250);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader
        title="Since you left"
        subtitle={unseen.length ? `${unseen.length} things changed in your world` : 'Nothing new yet'}
        right={
          unseen.length ? (
            <Tap onPress={markAll} style={styles.markAll} accessibilityLabel="Mark all as seen">
              <CheckCheck size={16} color={colors.accent} />
              <T v="footnote" color={colors.accent} weight="600" style={{ marginLeft: 4 }}>
                All seen
              </T>
            </Tap>
          ) : null
        }
      />
      <FlatList
        data={unseen}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        renderItem={({ item }) => <DeltaRow delta={item} onPress={() => open(item)} />}
        ListEmptyComponent={
          <EmptyState
            icon={<CheckCheck size={24} color={colors.accent} />}
            title="You’re caught up"
            body="We’ll collect what changes in your boards, people and Moves while you’re away."
          />
        }
        ListFooterComponent={
          unseen.length ? (
            <T v="footnote" color={colors.inkFaint} align="center" style={{ marginTop: 10 }}>
              That’s everything. No endless feed here.
            </T>
          ) : null
        }
      />
    </View>
  );
}

function DeltaRow({ delta, onPress }: { delta: ChangeEvent; onPress: () => void }) {
  const Icon = ICON[delta.type] ?? Sparkles;
  const image = repo.imageFor(delta.ref);
  return (
    <Tap onPress={onPress} scaleTo={0.98} style={styles.row}>
      <View>
        <Img uri={image} style={[styles.thumb, delta.ref.kind === 'person' && { borderRadius: 26 }]} />
        <View style={styles.kind}>
          <Icon size={12} color={colors.white} strokeWidth={2.5} />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T v="subhead" weight="700" numberOfLines={2}>
          {delta.message}
        </T>
        {delta.detail ? (
          <T v="footnote" color={colors.inkMuted} weight="400" numberOfLines={2} style={{ marginTop: 2 }}>
            {delta.detail}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <T v="caption" color={colors.accent} numberOfLines={1} style={{ flexShrink: 1 }}>
            {delta.reason}
          </T>
          <T v="caption" color={colors.inkFaint} weight="500" numberOfLines={1} style={{ flexShrink: 0 }}>
            {`  ·  ${timeAgo(delta.createdAt)}`}
          </T>
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  markAll: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  thumb: { width: 52, height: 52, borderRadius: 14 },
  kind: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
