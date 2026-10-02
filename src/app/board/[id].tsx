import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, CircleFadingPlus, Film, PenLine, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';

import { AfterDarkWorld } from '@/components/afterdark/AfterDarkWorld';
import { BoardHero, HERO_HEIGHT } from '@/components/boards/BoardHero';
import { BoardTabs } from '@/components/boards/BoardTabs';
import { ExploreStream, TodayEdition } from '@/components/boards/Edition';
import { WorldPeople } from '@/components/boards/WorldPeople';
import { Button, EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useGraphCtx } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { scoreBoard } from '@/graph/relevance';
import { buildEdition, buildExplore } from '@/graph/worlds';
import { worldStillExists } from '@/services/backend/content';
import * as realData from '@/services/backend/realData';
import { useDataset, useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { freshFor, useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { Board, BoardTab, ChangeEvent } from '@/types/models';
import { hrefFor } from '@/utils/links';

export default function BoardScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  // Phase 6C: read the World from the dataset as React state, so a new cover
  // (or any change to the World) shows here at once.
  const board = useDataset().boardMap[id];
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const confirmAge = useChimp((s) => s.confirmAge);
  // Phase 6D (final): a phone showing a cached World checks it still exists
  // (it may have been deleted elsewhere); if not, it leaves every surface and
  // this screen shows "not found" instead of acting on it.
  const personWorld = repo.mode() === 'real' && !!board?.ownerId;
  useEffect(() => {
    if (!personWorld) return;
    let live = true;
    void worldStillExists(id).then((ok) => {
      if (live && !ok) realData.removeBoard(id);
    });
    return () => {
      live = false;
    };
  }, [id, personWorld]);

  if (!board) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState title="World not found" body="It may have been deleted, or you no longer have access." action={<Button label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/boards'))} />} />
      </View>
    );
  }

  if (board.template === 'nightlife') {
    const t = board.theme;
    if (!ageConfirmed) {
      return (
        <View style={{ flex: 1, backgroundColor: t.background, justifyContent: 'center', padding: 24 }}>
          <StatusBar style="light" />
          <T v="title2" color={t.text} align="center">
            {`${board.title} is 18+`}
          </T>
          <T v="body" color={t.mutedText} align="center" style={{ marginTop: 8 }}>
            Mature, never explicit. Confirm your age to enter.
          </T>
          <Button label="I’m 18 or older" color={(t.secondary ?? t.primary)} onPress={confirmAge} style={{ marginTop: 20 }} />
          <Button label="Go back" variant="ghost" color={t.mutedText} onPress={() => router.back()} style={{ marginTop: 6 }} />
        </View>
      );
    }
    return <AfterDarkWorld variant="board" boardId={board.id} />;
  }

  return <StandardBoard board={board} initialTab={tab ?? 'today'} />;
}

const LEGACY_TAB: Record<string, BoardTab> = { posts: 'today', albums: 'explore', tips: 'explore' };
const EXPLORE_PAGE = 12;

/**
 * A Living World (Phase 5). Today is a finite, personalised edition; Explore
 * is the long-running stream; People is who's here. The order comes from the
 * same Opportunity Graph as every other surface (graph/worlds.ts).
 */
function StandardBoard({ board, initialTab }: { board: Board; initialTab: string }) {
  // Build 5 patch: the shared bottom bar stays on a Board; the last item clears it.
  const navSpace = useTabBarSpace();
  const [tab, setTab] = useState<BoardTab>(() => LEGACY_TAB[initialTab] ?? (['today', 'explore', 'people'].includes(initialTab) ? (initialTab as BoardTab) : 'today'));
  const markSeen = useChimp((s) => s.markSeen);
  const visitBoard = useChimp((s) => s.visitBoard);
  // Capture what changed *before* marking it seen, so the banner can explain it.
  const [fresh] = useState<ChangeEvent[]>(() => freshFor(useChimp.getState().changes, { kind: 'board', id: board.id }));
  const [count, setCount] = useState(EXPLORE_PAGE);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    markSeen({ kind: 'board', id: board.id });
    visitBoard(board.id);
  }, [board.id, markSeen, visitBoard]);

  const ctx = useGraphCtx();
  // Freeze the edition's order while you read it (likes/saves don't reshuffle it),
  // but rebuild when content changes — e.g. your own new post in this World (Phase 6B).
  // The edition is kept in state, keyed by dataset version + World, and rebuilt
  // (during render, React's "adjust state when a prop changes" pattern) only
  // when that key changes, not on every ctx change.
  const version = useDatasetVersion((d) => d.version);
  const editionKey = `${version}:${board.id}`;
  const [frozen, setFrozen] = useState(() => ({ key: editionKey, edition: buildEdition(ctx, board.id) }));
  let edition = frozen.edition;
  if (frozen.key !== editionKey) {
    edition = buildEdition(ctx, board.id);
    setFrozen({ key: editionKey, edition });
  }
  const explore = useMemo(() => (tab === 'explore' ? buildExplore(ctx, board.id) : []), [ctx, board.id, tab]);
  const joined = !!ctx.s.joined[board.id] || repo.isMe(board.ownerId);
  const why = useMemo(
    () => (joined ? [] : scoreBoard(ctx, board).reasons.filter((r) => r.kind !== 'editorial' && r.kind !== 'fresh').slice(0, 2)),
    [ctx, board, joined],
  );
  const story = repo.storiesFor({ kind: 'board', id: board.id })[0];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (tab !== 'explore') return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 600 && count < explore.length) setCount((c) => c + EXPLORE_PAGE);
  };
  const goExplore = () => {
    setTab('explore');
    scroller.current?.scrollTo({ y: HERO_HEIGHT - 40, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: board.theme.background }}>
      <StatusBar style="light" />
      <ScrollView ref={scroller} stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={200} contentContainerStyle={{ paddingBottom: navSpace }}>
        <BoardHero board={board} storyId={story?.id} />
        <View style={[styles.tabsWrap, { backgroundColor: board.theme.background }]}>
          <BoardTabs active={tab} onChange={setTab} theme={board.theme} />
        </View>
        <View style={{ backgroundColor: board.theme.background }}>
          {tab === 'today' ? (
            <>
              {fresh.length ? (
                <Tap onPress={() => router.push(hrefFor(fresh[0].ref))} style={[styles.fresh, { backgroundColor: board.theme.primarySoft }]}>
                  <Sparkles size={16} color={board.theme.primary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <T v="footnote" weight="700" color={board.theme.primary}>
                      {`New since your last visit · ${fresh.length} ${fresh.length === 1 ? 'change' : 'changes'}`}
                    </T>
                    <T v="footnote" weight="400" color={board.theme.text} numberOfLines={2} style={{ marginTop: 1 }}>
                      {fresh[0].detail ?? fresh[0].message}
                    </T>
                  </View>
                </Tap>
              ) : null}
              {why.length ? (
                <View style={[styles.why, { borderColor: board.theme.line }]}>
                  <T v="caption" weight="700" color={board.theme.primary} style={{ letterSpacing: 0.6 }}>
                    WHY THIS WORLD IS FOR YOU
                  </T>
                  {why.map((r) => (
                    <T key={r.text} v="footnote" weight="500" color={board.theme.text} style={{ marginTop: 3 }} numberOfLines={2}>
                      {`· ${r.text}`}
                    </T>
                  ))}
                </View>
              ) : null}
              <ContributeRow board={board} />
              {edition ? (
                <TodayEdition edition={edition} theme={board.theme} onExplore={goExplore} />
              ) : (
                <EmptyState icon={<Sparkles size={22} color={colors.accent} />} title="Quiet in here" body="Be the first to add an idea, a photo or a question." action={<Button label="Post here" onPress={() => router.push(`/create/buzz?board=${board.id}`)} />} />
              )}
            </>
          ) : null}
          {tab === 'explore' ? <ExploreStream entries={explore} count={count} theme={board.theme} onMore={() => setCount((c) => c + EXPLORE_PAGE)} /> : null}
          {tab === 'people' ? <WorldPeople board={board} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Contribute (Phase 6A) ──────────────────────────────────────────────────

/** Post / add photos / add video (Phase 6C) / add to Story, pre-filled with this World. Two by two. */
function ContributeRow({ board }: { board: Board }) {
  const t = board.theme;
  const items = [
    { label: 'Post here', icon: PenLine, href: `/create/buzz?board=${board.id}` },
    { label: 'Add photos', icon: Camera, href: `/create/drift?board=${board.id}` },
    { label: 'Add video', icon: Film, href: `/create/buzz?board=${board.id}&pick=video` },
    { label: 'Add to Story', icon: CircleFadingPlus, href: `/create/story?board=${board.id}` },
  ] as const;
  return (
    <View style={styles.contribute}>
      {items.map(({ label, icon: Icon, href }) => (
        <Tap key={label} onPress={() => router.push(href)} haptic="light" style={[styles.contributeBtn, { backgroundColor: t.primarySoft }]} accessibilityLabel={`${label} in ${board.title}`}>
          <Icon size={15} color={t.primary} />
          <T v="footnote" weight="700" color={t.primary} style={{ marginLeft: 5 }} numberOfLines={1}>
            {label}
          </T>
        </Tap>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  contribute: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  contributeBtn: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 19, paddingHorizontal: 8 },
  why: { marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1 },
  tabsWrap: {
    marginTop: -28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 14,
    paddingBottom: 10,
  },
  fresh: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: radius.md,
  },
  masonry: { flexDirection: 'row', paddingHorizontal: 12, gap: 10 },
  col: { flex: 1, gap: 10 },
  tip: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  tipIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  helpful: { flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: colors.surfaceMuted },
});
