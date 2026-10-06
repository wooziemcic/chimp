import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Bookmark, ChevronRight, GalleryHorizontal, Heart, MessageCircle, Play, Share2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Share, StyleSheet, useWindowDimensions, View, ViewToken } from 'react-native';

import { duration } from '@/components/drift/DriftTile';
import { ChimpVideo } from '@/components/media/ChimpVideo';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Button, EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { driftQueue, isAfterDarkBoard } from '@/graph/surfaces';
import { useGraphCtx } from '@/hooks/useGraph';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, fonts } from '@/theme';
import type { DriftItem } from '@/types/models';
import { compact } from '@/utils/format';
import { fullscreenTop, MIN_TAP, useDeviceInsets } from '@/components/system/SafeArea';

/**
 * Full-screen Drift: swipe up for the next thing, newest first. The order is
 * frozen when you open it (the pager never jumps under you).
 * Video is a still preview in the prototype, except the Demo's bundled clip
 * (App Review patch), which plays while it's on screen.
 */
/** How long an item must stay on screen to count as watched. */
const WATCH_DWELL_MS = 1500;

export default function DriftViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { height, width } = useWindowDimensions();
  const ctx = useGraphCtx();
  const markSeen = useChimp((s) => s.markSeen);
  // Freeze the queue at open time.
  const queue = useMemo(() => {
    const start = repo.driftItem(id);
    if (!start) return [];
    const ranked = driftQueue(ctx);
    return isAfterDarkBoard(repo.board(start.boardId)) ? [start] : ranked.some((d) => d.id === id) ? ranked : [start, ...ranked];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const startIndex = Math.max(0, queue.findIndex((d) => d.id === id));

  const watchDrift = useChimp((s) => s.watchDrift);
  const [activeId, setActiveId] = useState(id);
  // Phase 5: staying on an item for a moment counts as watching it (once per
  // item, +0.03 to its interests). Scrolling past doesn't.
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (dwell.current) clearTimeout(dwell.current);
  }, []);
  // FlatList requires a stable onViewableItemsChanged. Store actions are stable,
  // so this callback is created once.
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const v = viewableItems[0]?.item as DriftItem | undefined;
      if (dwell.current) clearTimeout(dwell.current);
      if (!v) return;
      setActiveId(v.id);
      markSeen({ kind: 'drift', id: v.id });
      dwell.current = setTimeout(() => watchDrift(v.id), WATCH_DWELL_MS);
    },
    [markSeen, watchDrift, setActiveId],
  );

  const getItemLayout = useCallback((_: unknown, index: number) => ({ length: height, offset: height * index, index }), [height]);

  if (!queue.length) return <EmptyState title="This post isn’t available" body="It may have been deleted, or you no longer have access." action={<Button label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/buzz'))} />} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <FlatList
        data={queue}
        keyExtractor={(d) => d.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={getItemLayout}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
        windowSize={3}
        extraData={activeId}
        renderItem={({ item }) => <DriftPage item={item} width={width} height={height} active={item.id === activeId} />}
      />
    </View>
  );
}

function DriftPage({ item, width, height, active }: { item: DriftItem; width: number; height: number; active: boolean }) {
  // Phase 8: full-screen route (covers the App Review banner too) → the phone's real insets.
  const insets = useDeviceInsets();
  const [muted, setMuted] = useState(true);
  const liked = useChimp((s) => !!s.driftLikes[item.id]);
  const saved = useChimp((s) => !!s.driftSaves[item.id]);
  const toggleLike = useChimp((s) => s.toggleDriftLike);
  const toggleSave = useChimp((s) => s.toggleDriftSave);
  const myComments = useChimp((s) => s.comments[`drift:${item.id}`]?.length ?? 0);
  const board = repo.board(item.boardId);
  const author = repo.user(item.authorId);

  return (
    <View style={{ width, height }}>
      {item.clipSource ? (
        <ChimpVideo uri={item.clipSource} poster={item.image} active={active} muted={muted} onToggleMute={() => setMuted((m) => !m)} contentFit="cover" style={StyleSheet.absoluteFill} muteStyle={{ top: fullscreenTop(insets) + MIN_TAP + 4, right: 14 }} />
      ) : (
        <Img uri={item.image} tint="#111" style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']} locations={[0, 0.2, 0.55, 1]} style={StyleSheet.absoluteFill} />

      {item.kind === 'video' && !item.clipSource ? (
        <View style={styles.play} pointerEvents="none">
          <Play size={30} color={colors.white} fill={colors.white} />
          <T v="caption" color={colors.white} weight="700" style={{ marginTop: 6 }}>
            {`Video preview · ${duration(item.durationSec)}`}
          </T>
        </View>
      ) : null}

      <View style={[styles.topBar, { top: fullscreenTop(insets) }]}>
        <T v="headline" color={colors.white}>
          Happening
        </T>
        {item.kind === 'carousel' ? (
          <View style={styles.pill}>
            <GalleryHorizontal size={13} color={colors.white} />
            <T v="caption" color={colors.white} weight="700" style={{ marginLeft: 4 }}>
              {`${item.images?.length ?? 1} photos`}
            </T>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Tap onPress={() => router.back()} accessibilityLabel="Close" style={styles.iconBtn}>
          <X size={22} color={colors.white} />
        </Tap>
      </View>

      <View style={[styles.actions, { bottom: insets.bottom + 150 }]}>
        <Tap onPress={() => toggleLike(item.id)} haptic="light" accessibilityLabel={liked ? 'Unlike' : 'Like'} style={styles.action}>
          <Heart size={28} color={liked ? '#FF3D6E' : colors.white} fill={liked ? '#FF3D6E' : 'transparent'} />
          <T v="caption" color={colors.white} weight="700">
            {compact(item.likeCount + (liked ? 1 : 0))}
          </T>
        </Tap>
        <Tap onPress={() => router.push(`/comments/drift:${item.id}`)} haptic="light" accessibilityLabel="Comments" style={styles.action}>
          <MessageCircle size={26} color={colors.white} />
          <T v="caption" color={colors.white} weight="700">
            {myComments ? compact(myComments) : 'Comment'}
          </T>
        </Tap>
        <Tap onPress={() => toggleSave(item.id)} haptic="light" accessibilityLabel={saved ? 'Unsave' : 'Save'} style={styles.action}>
          <Bookmark size={26} color={colors.white} fill={saved ? colors.white : 'transparent'} />
          <T v="caption" color={colors.white} weight="700">
            {saved ? 'Saved' : 'Save'}
          </T>
        </Tap>
        <Tap onPress={() => Share.share({ message: `${item.caption} · ${board?.title} on Chimp` })} accessibilityLabel="Share" style={styles.action}>
          <Share2 size={25} color={colors.white} />
          <T v="caption" color={colors.white} weight="700">
            Share
          </T>
        </Tap>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]}>
        <Tap onPress={() => router.push(`/profile/${item.authorId}`)} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar uri={author?.avatar} name={author?.displayName} size={34} ring={colors.white} ringWidth={1.5} />
          <T v="bodyStrong" color={colors.white} style={{ marginLeft: 8 }}>
            {author?.displayName}
          </T>
        </Tap>
        <T v="callout" color={colors.white} weight="400" style={{ marginTop: 8, lineHeight: 21 }}>
          {/* Phase 6B: captions (incl. legacy meme text) are never painted over the media. */}
          {item.memeText ?? item.caption}
        </T>
        {board ? (
          <Tap onPress={() => router.push(`/board/${board.id}`)} style={styles.world} accessibilityLabel={`Open ${board.title}`}>
            <Img uri={board.cover} style={styles.worldImg} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <T v="caption" color="rgba(255,255,255,0.75)" weight="600">
                FROM THE WORLD
              </T>
              <T v="subhead" color={colors.white} weight="700" numberOfLines={1}>
                {board.title}
              </T>
            </View>
            <ChevronRight size={18} color={colors.white} />
          </Tap>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 12, flexDirection: 'row', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.4)', marginLeft: 10 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', top: '42%', alignSelf: 'center', alignItems: 'center', padding: 14, borderRadius: 40 },
  actions: { position: 'absolute', right: 10, alignItems: 'center', gap: 18 },
  action: { alignItems: 'center', minWidth: 52, minHeight: 52, justifyContent: 'center', gap: 3 },
  bottom: { position: 'absolute', left: 16, right: 76, bottom: 0 },
  world: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  worldImg: { width: 38, height: 38, borderRadius: 10 },
  meme: {
    position: 'absolute',
    left: 22,
    right: 22,
    top: '24%',
    fontFamily: fonts.handBold,
    fontSize: 44,
    lineHeight: 44,
    color: colors.white,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
    transform: [{ rotate: '-3deg' }],
  },
});
