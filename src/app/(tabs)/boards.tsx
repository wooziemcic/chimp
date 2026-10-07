import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LayoutGrid } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoardCard } from '@/components/boards/BoardCard';
import { Chip } from '@/components/ui/Chip';
import { Button, EmptyState } from '@/components/ui/misc';
import { CreateButton } from '@/components/create/CreateButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { isAfterDarkBoard } from '@/graph/surfaces';
import { useSignals } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { rankJoinedBoards, suggestBoards } from '@/services/recommender';
import { useDataset } from '@/services/dataset';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';

type Segment = 'joined' | 'discover' | 'saved';

/**
 * Boards — the World rack. "What worlds do I care about?"
 * Joined Worlds float up when they have news, then by relevance to you.
 * Discover is ranked by the graph and each card says why.
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

  // Phase 6C: the lists follow the dataset too, so a World's new cover (or a new
  // World from a refresh) shows here at once, not only after your graph changes.
  const dataset = useDataset();
  const joinedBoards = useMemo(() => {
    // Your own private planning Boards (Italy 2027) sit with the ones you joined.
    const own = dataset.boards.filter((b) => b.ownerId === dataset.me.id && !joined[b.id]);
    return [...rankJoinedBoards(signals).map((b) => dataset.boardMap[b.id] ?? b), ...own].filter((b) => !isAfterDarkBoard(b));
  }, [signals, joined, dataset]);
  const discover = useMemo(() => suggestBoards(signals, 14).filter((d) => !isAfterDarkBoard(d.board)).map((d) => ({ ...d, board: dataset.boardMap[d.board.id] ?? d.board })), [signals, dataset]);
  const savedBoards = useMemo(() => dataset.boards.filter((b) => saved[b.id] && !isAfterDarkBoard(b)), [saved, dataset]);

  const data = segment === 'joined' ? joinedBoards : segment === 'discover' ? discover.map((d) => d.board) : savedBoards;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <FlatList
        key="rack"
        data={data}
        keyExtractor={(b) => b.id}
        numColumns={2}
        initialNumToRender={6}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View>
            <PageHeader title="Boards" right={<CreateButton href="/create/world" label="New World" />} />
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
          </View>
        }
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingBottom: bottom, gap: 12 }}
        renderItem={({ item }) => (
          <BoardCard
            board={item}
            variant="magazine"
            width={cardW}
            showSave={segment !== 'joined'}
            reason={segment === 'discover' ? discover.find((d) => d.board.id === item.id)?.reason : undefined}
          />
        )}
        ListEmptyComponent={
          segment === 'saved' ? (
            <EmptyState title="Nothing saved yet" body="Tap the bookmark on any World to keep it here." />
          ) : (
            <EmptyState
              icon={<LayoutGrid size={22} color={colors.accent} />}
              title="You haven’t joined a World yet"
              body="Find one in Discover, or start your own with + (a trip, a scene, a plan)."
              action={<Button label="Discover Worlds" onPress={() => setSegment('discover')} />}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
});
