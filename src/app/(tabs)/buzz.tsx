import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronRight, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BuzzCard } from '@/components/buzz/BuzzCard';
import { DriftPager } from '@/components/drift/DriftPager';
import { ComposeRow, CreateButton } from '@/components/create/CreateButton';
import { Button, EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type BuzzTab, type FeedEntry, buildDriftFeed, isAfterDarkRef, rankBuzz } from '@/graph/surfaces';
import { useGraphCtx, useUnseenChanges } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { useNow } from '@/hooks/useNow';
import { useDataset } from '@/services/dataset';
import { useSession } from '@/store/useSession';
import { colors, radius } from '@/theme';
import { packRows, pinFresh } from '@/utils/buzzRows';

type Tab = BuzzTab | 'drift';

const TABS: { id: Tab; label: string }[] = [
  { id: 'forYou', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'trending', label: 'Trending' },
  { id: 'drift', label: 'Drift' },
];

/**
 * Buzz — "What are people saying and what is buzzing?"
 * Chimp's conversation layer: thoughts, takes, photos, videos, polls and
 * (demo) news. A World is optional context, never required.
 *
 * Phase 6C — four sub-tabs, each with its own ordering:
 *   For You    the graph's ranking (with a freshness boost). Your own posts
 *              from the last 30 minutes lead, newest first.
 *   Following  people and Worlds you chose (and you), newest first.
 *   Trending   most likes first (real totals), then newest. Nothing pins here.
 *   Drift      full-screen vertical media (photos, videos, World media).
 */
export default function BuzzScreen() {
  // `/buzz?tab=drift` (e.g. an old Drift link) opens straight into that sub-tab.
  const params = useLocalSearchParams<{ tab?: string }>();
  const asked = TABS.some((t) => t.id === params.tab) ? (params.tab as Tab) : null;
  const [tab, setTab] = useState<Tab>(asked ?? 'forYou');
  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== lastAsked) {
    setLastAsked(asked);
    if (asked) setTab(asked);
  }
  const ctx = useGraphCtx();
  const bottom = useTabBarSpace();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const full = width - 32;
  const half = Math.floor((full - 10) / 2);
  const worldUpdates = useUnseenChanges().filter((c) => !isAfterDarkRef(c.ref) && (c.type === 'BOARD_ACTIVITY' || c.type === 'STORY_UPDATE' || c.type === 'NEW_CONNECTION_ACTIVITY'));

  const syncing = useSession((s) => s.syncing);
  const refresh = useSession((s) => s.refresh);
  const refreshLikes = useSession((s) => s.refreshLikes);
  const data = useDataset();
  const real = data.mode === 'real';
  const now = useNow();
  const rows = useMemo(() => {
    if (tab === 'drift') return [];
    const ranked = rankBuzz(ctx, tab).map((x) => x.item);
    return packRows(tab === 'forYou' ? pinFresh(ranked, (id) => !!id && id === data.me.id, now) : ranked);
  }, [ctx, tab, now, data.me.id]);

  // Trending is "most liked": keep the real totals current while you're looking at it.
  useEffect(() => {
    if (tab !== 'trending' || !real) return;
    void refreshLikes();
    const t = setInterval(() => void refreshLikes(), 60_000);
    return () => clearInterval(t);
  }, [tab, real, refreshLikes]);

  // Drift keeps its order while you're in it (a like mustn't reshuffle what you're
  // swiping through); it refreshes when content changes or you come back to it.
  const driftKey = tab === 'drift' ? `${data.version}` : '';
  const [drift, setDrift] = useState<{ key: string; entries: FeedEntry[] }>({ key: '', entries: [] });
  let driftEntries = drift.entries;
  if (tab === 'drift' && drift.key !== driftKey) {
    driftEntries = buildDriftFeed(ctx);
    setDrift({ key: driftKey, entries: driftEntries });
  } else if (tab !== 'drift' && drift.key) {
    setDrift({ key: '', entries: [] });
  }
  const [driftH, setDriftH] = useState(0);

  const tabs = <Segmented value={tab} onChange={setTab} options={TABS} dark={tab === 'drift'} />;

  if (tab === 'drift') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar style="light" />
        <View style={{ flex: 1 }} onLayout={(e) => setDriftH(Math.round(e.nativeEvent.layout.height))}>
          {driftH > 0 && driftEntries.length ? (
            <DriftPager entries={driftEntries} width={width} height={driftH} topInset={insets.top + 64} bottomInset={bottom - 16} />
          ) : driftH > 0 ? (
            <View style={[styles.driftEmpty, { paddingTop: insets.top + 80 }]}>
              <EmptyState
                dark
                title={data.contentReady ? 'Nothing to drift through yet' : 'Loading…'}
                body={data.contentReady ? 'Photos and short videos from Buzz and your Worlds show up here. Post the first one.' : undefined}
                action={data.contentReady ? <Button label="Add a photo or video" onPress={() => router.push('/create/buzz')} /> : undefined}
              />
            </View>
          ) : null}
        </View>
        <View style={[styles.driftTop, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          {tabs}
        </View>
      </View>
    );
  }

  const loading = real && !data.contentReady;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(r) => r.key}
        initialNumToRender={6}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: bottom, gap: 10 }}
        refreshing={real ? syncing && !loading : false}
        onRefresh={real ? () => void refresh() : undefined}
        ListHeaderComponent={
          <View style={{ marginBottom: 4 }}>
            <PageHeader title="Buzz" subtitle="Thoughts. Photos. Takes. Real people." right={<CreateButton href="/create" />} />
            {tabs}
            <ComposeRow />
            {tab === 'forYou' && worldUpdates.length ? (
              <Tap onPress={() => router.push('/delta')} style={styles.updates} accessibilityLabel="Open what changed">
                <Sparkles size={15} color={colors.accent} />
                <T v="footnote" weight="600" color={colors.ink2} style={{ marginLeft: 8, flex: 1 }} numberOfLines={1}>
                  {`${worldUpdates.length} new in your Worlds · ${worldUpdates[0].message}`}
                </T>
                <ChevronRight size={16} color={colors.inkFaint} />
              </Tap>
            ) : null}
          </View>
        }
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.items.length === 2 ? (
              row.items.map((it) => <BuzzCard key={it.id} item={it} width={half} />)
            ) : (
              <BuzzCard item={row.items[0]} width={full} />
            )}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <BuzzSkeleton width={full} />
          ) : (
            <EmptyState
              title={tab === 'following' ? 'Nothing from your people yet' : real ? 'Buzz is quiet' : 'Quiet for now'}
              body={tab === 'following' ? 'Follow people or join Worlds and their conversation shows up here.' : real ? 'Be the first: say something. A World is optional.' : 'Check back soon.'}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

/** First launch on a new phone (nothing cached yet): the shape of Buzz while it loads. Never fake content. */
function BuzzSkeleton({ width }: { width: number }) {
  return (
    <View style={{ paddingHorizontal: 16, gap: 10 }} accessibilityLabel="Loading Buzz">
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skel, { width, height: i === 1 ? 220 : 116 }]}>
          <View style={styles.skelLine} />
          <View style={[styles.skelLine, { width: '60%', marginTop: 10 }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  driftTop: { position: 'absolute', left: 0, right: 0, top: 0 },
  driftEmpty: { flex: 1, backgroundColor: '#000' },
  skel: { borderRadius: radius.xl, backgroundColor: colors.surface, padding: 16, opacity: 0.8 },
  skelLine: { height: 12, borderRadius: 6, width: '85%', backgroundColor: colors.surfaceMuted },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, alignItems: 'flex-start' },
  updates: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
});
