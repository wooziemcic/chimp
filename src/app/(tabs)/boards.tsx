import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Archive, ChevronDown, ChevronUp, CalendarRange, LayoutGrid } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoardCard } from '@/components/boards/BoardCard';
import { BoardTimelineRow } from '@/components/boards/BoardTimelineRow';
import { PinnedBoardsRow } from '@/components/boards/PinnedBoards';
import { Chip } from '@/components/ui/Chip';
import { Button, EmptyState } from '@/components/ui/misc';
import { CreateButton } from '@/components/create/CreateButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { pinnedBoards } from '@/graph/boardPins';
import { type TimelineEntry, boardTimeline, lastActivity } from '@/graph/boardTimeline';
import { isAfterDarkBoard } from '@/graph/surfaces';
import { useSignals } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { rankJoinedBoards, suggestBoards } from '@/services/recommender';
import { useDataset } from '@/services/dataset';
import { useArchives } from '@/store/useArchives';
import { type BoardsLayout, useBoardsView } from '@/store/useBoardsView';
import { useChimp } from '@/store/useChimp';
import { usePins } from '@/store/usePins';
import { colors, radius } from '@/theme';
import type { Board } from '@/types/models';

type Segment = 'joined' | 'discover' | 'saved';
type TimelineItem = { key: string; head: string } | { key: string; entry: TimelineEntry };

/**
 * Boards — the World rack. "What worlds do I care about?"
 * Joined Worlds float up when they have news, then by relevance to you.
 * Discover is ranked by the graph and each card says why.
 *
 * Phase 9.2: pinned Boards sit at the top (newest pin far left), a small
 * Covers / Timeline switch lays out the same Boards as cards or by time
 * (kept on this phone), Search here finds Boards only, and Boards you
 * archived leave Joined (they're one tap away at the bottom).
 */
export default function BoardsScreen() {
  // Phase 9.1: `/boards?segment=saved&at=…` (You → Saved Boards) opens straight into
  // that segment; `at` makes a repeat tap apply again. The plain Boards tab still opens on Joined.
  const params = useLocalSearchParams<{ segment?: string; at?: string }>();
  const asked = params.segment === 'saved' || params.segment === 'discover' || params.segment === 'joined' ? (params.segment as Segment) : null;
  const askKey = asked ? `${asked}:${params.at ?? ''}` : null;
  const [segment, setSegment] = useState<Segment>(asked ?? 'joined');
  const [lastAsk, setLastAsk] = useState(askKey);
  if (askKey !== lastAsk) {
    setLastAsk(askKey);
    if (asked) setSegment(asked);
  }
  const joined = useChimp((s) => s.joined);
  const saved = useChimp((s) => s.savedBoards);
  const signals = useSignals();
  const bottom = useTabBarSpace();
  const { width } = useWindowDimensions();
  const cardW = Math.floor((width - 16 * 2 - 12) / 2);
  const layout = useBoardsView((s) => s.layout);
  const setLayout = useBoardsView((s) => s.setLayout);

  // Phase 6C: the lists follow the dataset too, so a World's new cover (or a new
  // World from a refresh) shows here at once, not only after your graph changes.
  const dataset = useDataset();
  const real = dataset.mode === 'real';
  const owner = real ? dataset.me.id : 'demo';
  const pins = usePins((s) => s.pins);
  const pinsOwner = usePins((s) => s.owner);
  const archivedFlags = useArchives((s) => s.archived);
  const archivesOwner = useArchives((s) => s.owner);
  const archived = archivesOwner === owner ? archivedFlags : NONE;
  const [showArchived, setShowArchived] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // The Demo keeps its pins and archive on this phone (REAL: loaded by the live layer).
      if (!real) {
        if (usePins.getState().owner !== 'demo') void usePins.getState().load('demo', false);
        if (useArchives.getState().owner !== 'demo') void useArchives.getState().load('demo', false);
      }
    }, [real]),
  );

  const allJoined = useMemo(() => {
    // Your own private planning Boards (Italy 2027) sit with the ones you joined.
    const own = dataset.boards.filter((b) => b.ownerId === dataset.me.id && !joined[b.id]);
    return [...rankJoinedBoards(signals).map((b) => dataset.boardMap[b.id] ?? b), ...own].filter((b) => !isAfterDarkBoard(b));
  }, [signals, joined, dataset]);
  const joinedBoards = useMemo(() => allJoined.filter((b) => !archived[b.id]), [allJoined, archived]);
  const archivedBoards = useMemo(() => allJoined.filter((b) => archived[b.id]), [allJoined, archived]);
  const discover = useMemo(() => suggestBoards(signals, 14).filter((d) => !isAfterDarkBoard(d.board)).map((d) => ({ ...d, board: dataset.boardMap[d.board.id] ?? d.board })), [signals, dataset]);
  const savedBoards = useMemo(() => dataset.boards.filter((b) => saved[b.id] && !isAfterDarkBoard(b)), [saved, dataset]);
  const pinned = useMemo(() => (pinsOwner === owner ? pinnedBoards(dataset.boardMap, pins).filter((b) => !archived[b.id]) : []), [pinsOwner, owner, dataset.boardMap, pins, archived]);

  const data = segment === 'joined' ? joinedBoards : segment === 'discover' ? discover.map((d) => d.board) : savedBoards;
  const extra = useMemo(() => (segment === 'joined' && showArchived ? archivedBoards : NO_BOARDS), [segment, showArchived, archivedBoards]);

  // Timeline: the same Boards, grouped by time (graph/boardTimeline.ts).
  const timeline = useMemo<TimelineItem[]>(() => {
    if (layout !== 'timeline') return [];
    const activity = lastActivity(dataset.buzz, dataset.drift);
    const groups = boardTimeline(data, dataset.moves, activity);
    const items: TimelineItem[] = groups.flatMap((g) => [{ key: `h:${g.id}`, head: g.title } as TimelineItem, ...g.entries.map((e) => ({ key: e.board.id, entry: e }))]);
    return items;
  }, [layout, data, dataset.buzz, dataset.drift, dataset.moves]);
  const archivedRows = useMemo(
    () => (layout === 'timeline' && extra.length ? boardTimeline(extra, dataset.moves, lastActivity(dataset.buzz, dataset.drift)).flatMap((g) => g.entries) : []),
    [layout, extra, dataset.buzz, dataset.drift, dataset.moves],
  );

  const header = (
    <View>
      <PageHeader title="Boards" right={<CreateButton href="/create/world" label="New World" />} searchHref="/search?scope=boards" />
      <PinnedBoardsRow boards={pinned} />
      <View style={styles.segments}>
        {(
          [
            ['joined', `Joined · ${joinedBoards.length}`],
            ['discover', 'Discover'],
            ['saved', `Saved · ${savedBoards.length}`],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} label={label} active={segment === id} onPress={() => setSegment(id)} style={{ flex: 1, justifyContent: 'center' }} />
        ))}
      </View>
      {data.length ? <LayoutSwitch layout={layout} onChange={setLayout} /> : null}
    </View>
  );
  const empty =
    segment === 'saved' ? (
      <EmptyState title="Nothing saved yet" body="Tap the bookmark on any World to keep it here." />
    ) : segment === 'joined' && archivedBoards.length ? (
      <EmptyState icon={<Archive size={22} color={colors.accent} />} title="Everything here is archived" body="Your archived Boards are just below." />
    ) : (
      <EmptyState
        icon={<LayoutGrid size={22} color={colors.accent} />}
        title="You haven’t joined a World yet"
        body="Find one in Discover, or start your own with + (a trip, a scene, a plan)."
        action={<Button label="Discover Worlds" onPress={() => setSegment('discover')} />}
      />
    );
  const archivedToggle =
    segment === 'joined' && archivedBoards.length ? (
      <Tap onPress={() => setShowArchived((v) => !v)} style={styles.archived} accessibilityLabel={showArchived ? 'Hide archived Boards' : `Show ${archivedBoards.length} archived Boards`} testID="boards-archived-toggle">
        <Archive size={15} color={colors.inkMuted} />
        <T v="footnote" weight="700" color={colors.inkMuted} style={{ marginLeft: 6, flex: 1 }}>
          {`Archived · ${archivedBoards.length}`}
        </T>
        {showArchived ? <ChevronUp size={16} color={colors.inkFaint} /> : <ChevronDown size={16} color={colors.inkFaint} />}
      </Tap>
    ) : null;

  const card = (item: Board) => (
    <BoardCard board={item} variant="magazine" width={cardW} showSave={segment !== 'joined'} reason={segment === 'discover' ? discover.find((d) => d.board.id === item.id)?.reason : undefined} />
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      {layout === 'timeline' ? (
        <FlatList
          key="timeline"
          data={timeline}
          keyExtractor={(i) => i.key}
          initialNumToRender={10}
          windowSize={7}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: bottom, gap: 10 }}
          renderItem={({ item }) =>
            'head' in item ? (
              <T v="label" color={colors.inkFaint} style={styles.groupHead} testID={`timeline-group-${item.key.slice(2)}`}>
                {item.head.toUpperCase()}
              </T>
            ) : (
              <BoardTimelineRow entry={item.entry} />
            )
          }
          ListEmptyComponent={empty}
          ListFooterComponent={
            archivedToggle ? (
              <View>
                {archivedToggle}
                {archivedRows.length ? (
                  <View style={{ gap: 10, marginTop: 10 }} testID="boards-archived">
                    {archivedRows.map((e) => (
                      <BoardTimelineRow key={e.board.id} entry={e} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null
          }
          testID="boards-timeline"
        />
      ) : (
        <FlatList
          key="rack"
          data={data}
          keyExtractor={(b) => b.id}
          numColumns={2}
          initialNumToRender={6}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingBottom: bottom, gap: 12 }}
          renderItem={({ item }) => card(item)}
          ListEmptyComponent={empty}
          ListFooterComponent={
            archivedToggle ? (
              <View>
                {archivedToggle}
                {extra.length ? (
                  <View style={styles.archivedGrid} testID="boards-archived">
                    {extra.map((b) => (
                      <View key={b.id}>{card(b)}</View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null
          }
          testID="boards-covers"
        />
      )}
    </SafeAreaView>
  );
}

const NONE: Record<string, number> = {};
const NO_BOARDS: Board[] = [];

/** Phase 9.2: Covers (grid) / Timeline — small, at the top-right of the list. */
function LayoutSwitch({ layout, onChange }: { layout: BoardsLayout; onChange: (l: BoardsLayout) => void }) {
  const opt = (id: BoardsLayout, Icon: typeof LayoutGrid, label: string) => {
    const on = layout === id;
    return (
      <Tap onPress={() => onChange(id)} haptic="select" scaleTo={0.94} style={[styles.switchBtn, on && styles.switchOn]} accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`layout-${id}`}>
        <Icon size={16} color={on ? colors.ink : colors.inkFaint} strokeWidth={2.2} />
      </Tap>
    );
  };
  return (
    <View style={styles.switchRow}>
      <View style={styles.switch}>
        {opt('covers', LayoutGrid, 'Covers')}
        {opt('timeline', CalendarRange, 'Timeline')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, marginBottom: 10 },
  switch: { flexDirection: 'row', padding: 2, borderRadius: 10, backgroundColor: colors.surfaceMuted },
  switchBtn: { width: 36, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  switchOn: { backgroundColor: colors.surface },
  groupHead: { marginHorizontal: 20, marginTop: 8 },
  archived: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  archivedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginTop: 12 },
});
