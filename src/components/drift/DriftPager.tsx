/**
 * Buzz → Drift (Phase 6C): the full-screen, vertical-swipe visual mode of Buzz.
 *
 *   - one item fills the page; swipe up / down for the next
 *   - only the visible clip plays (muted by default, one tap to unmute —
 *     the choice sticks while you drift); neighbours only mount their player
 *     when they're one swipe away, everything further is a poster
 *   - like · comment · save · not-for-me · share on the right, creator,
 *     caption, why it's here and the World (only when there is one) below
 *
 * Items are the same canonical Buzz / World media shown elsewhere (never copies).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Bookmark, ChevronRight, GalleryHorizontal, Heart, MessageCircle, Share2, Sparkles, ThumbsDown } from 'lucide-react-native';
import { memo, type RefObject, useCallback, useState } from 'react';
import { FlatList, Share, StyleSheet, View, type ViewToken } from 'react-native';

import { ChimpVideo, formatDuration } from '@/components/media/ChimpVideo';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { FeedEntry } from '@/graph/surfaces';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { openMedia } from '@/store/useMediaViewer';
import { colors } from '@/theme';
import { compact } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

interface Props {
  entries: FeedEntry[];
  width: number;
  /** Page height (the space Drift fills). */
  height: number;
  /** Space the overlaid header takes at the top. */
  topInset: number;
  /** Space the floating tab bar takes at the bottom. */
  bottomInset: number;
  /** Lets Buzz scroll back to the first item (tab-bar reselect). */
  listRef?: RefObject<FlatList<FeedEntry> | null>;
}

export function DriftPager({ entries, width, height, topInset, bottomInset, listRef }: Props) {
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  // FlatList needs a stable callback here.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const i = viewableItems[0]?.index;
    if (typeof i === 'number') setActive(i);
  }, []);
  const layout = useCallback((_: unknown, index: number) => ({ length: height, offset: height * index, index }), [height]);

  return (
    <FlatList
      ref={listRef}
      data={entries}
      keyExtractor={(e) => e.key}
      pagingEnabled
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={layout}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      extraData={`${active}:${muted}`}
      accessibilityLabel="Drift"
      renderItem={({ item, index }) => (
        <DriftEntryPage entry={item} width={width} height={height} active={index === active} near={Math.abs(index - active) <= 1} muted={muted} onToggleMute={toggleMute} topInset={topInset} bottomInset={bottomInset} />
      )}
    />
  );
}

const DriftEntryPage = memo(function DriftEntryPage({
  entry,
  width,
  height,
  active,
  near,
  muted,
  onToggleMute,
  topInset,
  bottomInset,
}: {
  entry: FeedEntry;
  width: number;
  height: number;
  active: boolean;
  near: boolean;
  muted: boolean;
  onToggleMute: () => void;
  topInset: number;
  bottomInset: number;
}) {
  const isBuzz = entry.kind === 'buzz';
  const liked = useChimp((s) => (isBuzz ? !!s.buzzLikes[entry.id] : !!s.driftLikes[entry.id]));
  const saved = useChimp((s) => (isBuzz ? !!s.buzzSaves[entry.id] : !!s.driftSaves[entry.id]));
  const disliked = useChimp((s) => (isBuzz ? !!s.buzzDislikes[entry.id] : !!s.driftDislikes?.[entry.id]));
  const toggleBuzzLike = useChimp((s) => s.toggleBuzzLike);
  const toggleDriftLike = useChimp((s) => s.toggleDriftLike);
  const toggleBuzzSave = useChimp((s) => s.toggleBuzzSave);
  const toggleDriftSave = useChimp((s) => s.toggleDriftSave);
  const toggleBuzzDislike = useChimp((s) => s.toggleBuzzDislike);
  const toggleDriftDislike = useChimp((s) => s.toggleDriftDislike);
  const author = entry.authorId ? repo.user(entry.authorId) : undefined;
  const board = entry.boardId ? repo.board(entry.boardId) : undefined;
  const replies = isBuzz ? repo.buzzItem(entry.id)?.replyCount ?? 0 : 0;
  // The feed is frozen while you drift, so the count is recomputed live from the item.
  const others = isBuzz ? repo.buzzItem(entry.id)?.likeCount ?? 0 : repo.driftItem(entry.id)?.likeCount ?? 0;
  const likes = others + (liked ? 1 : 0);

  const clip = entry.clip;
  const aspect = clip?.aspect ?? entry.aspects?.[0];
  // Portrait media fills the screen; wide media is shown whole on black.
  const fit = aspect && aspect > 0.8 ? 'contain' : 'cover';

  const like = () => (isBuzz ? toggleBuzzLike(entry.id) : toggleDriftLike(entry.id));
  const save = () => (isBuzz ? toggleBuzzSave(entry.id) : toggleDriftSave(entry.id));
  const notForMe = () => (isBuzz ? toggleBuzzDislike(entry.id) : toggleDriftDislike(entry.id));
  const comment = () => pushOnce(isBuzz ? `/buzz/${entry.id}` : `/comments/drift:${entry.id}`);
  const share = () => void Share.share({ message: `${entry.caption ? `${entry.caption} · ` : ''}${board ? `${board.title} on Chimp` : 'on Chimp'}` });
  const open = () => openMedia(entry.images.filter((x): x is string => typeof x === 'string'), entry.aspects, 0, { caption: entry.caption, authorName: author?.displayName, context: board?.title });

  return (
    <View style={{ width, height, backgroundColor: '#000' }} accessibilityLabel={`${author?.displayName ?? 'Someone'}: ${entry.caption || (clip ? 'video' : 'photo')}`}>
      {clip?.url && near && !disliked ? (
        <ChimpVideo uri={clip.url} poster={clip.poster} active={active} muted={muted} onToggleMute={onToggleMute} contentFit={fit} style={StyleSheet.absoluteFill} muteStyle={{ top: topInset + 8, right: 14 }} />
      ) : (
        <Tap onPress={clip ? undefined : open} disabled={!!clip} scaleTo={1} style={StyleSheet.absoluteFill} accessibilityLabel={clip ? 'Video' : 'Open photo'}>
          <Img uri={clip?.poster ?? entry.images[0]} tint="#000" contentFit={fit} style={StyleSheet.absoluteFill} />
        </Tap>
      )}
      <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={[styles.shadeTop, { height: topInset + 40 }]} pointerEvents="none" />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} style={[styles.shadeBottom, { height: 320 + bottomInset }]} pointerEvents="none" />

      {clip && !clip.url ? (
        <View style={styles.previewPill} pointerEvents="none">
          <T v="caption" color={colors.white} weight="700">
            {`Video preview${clip.durationMs ? ` · ${formatDuration(clip.durationMs)}` : ''}`}
          </T>
        </View>
      ) : null}
      {!clip && entry.images.length > 1 ? (
        <View style={[styles.countPill, { top: topInset + 10 }]} pointerEvents="none">
          <GalleryHorizontal size={13} color={colors.white} />
          <T v="caption" color={colors.white} weight="700" style={{ marginLeft: 4 }}>
            {`${entry.images.length} photos · tap to see all`}
          </T>
        </View>
      ) : null}

      {disliked ? (
        <View style={styles.dislikedCover}>
          <ThumbsDown size={26} color={colors.white} />
          <T v="subhead" weight="700" color={colors.white} align="center" style={{ marginTop: 10, paddingHorizontal: 40 }}>
            {board ? `Got it. You’ll see less like this from ${board.title}.` : 'Got it. You’ll see less like this.'}
          </T>
          <Tap onPress={notForMe} style={styles.undo} accessibilityLabel="Undo not for me">
            <T v="footnote" weight="700">
              Undo
            </T>
          </Tap>
        </View>
      ) : null}

      <View style={[styles.rail, { bottom: bottomInset + 96 }, disliked && { opacity: 0 }]} pointerEvents={disliked ? 'none' : 'auto'}>
        <Rail onPress={like} label={liked ? 'Unlike' : 'Like'} text={compact(likes)}>
          <Heart size={28} color={liked ? '#FF3D6E' : colors.white} fill={liked ? '#FF3D6E' : 'transparent'} />
        </Rail>
        <Rail onPress={comment} label={isBuzz ? 'Replies' : 'Comments'} text={replies ? compact(replies) : isBuzz ? 'Reply' : 'Comment'}>
          <MessageCircle size={26} color={colors.white} />
        </Rail>
        <Rail onPress={save} label={saved ? 'Unsave' : 'Save'} text={saved ? 'Saved' : 'Save'}>
          <Bookmark size={26} color={colors.white} fill={saved ? colors.white : 'transparent'} />
        </Rail>
        <Rail onPress={notForMe} label="Not for me" text="Not for me">
          <ThumbsDown size={24} color={colors.white} />
        </Rail>
        <Rail onPress={share} label="Share" text="Share">
          <Share2 size={24} color={colors.white} />
        </Rail>
      </View>

      <View style={[styles.bottom, { paddingBottom: bottomInset + 10 }]}>
        {author ? (
          <Tap onPress={() => pushOnce(`/profile/${author.id}`)} style={styles.author} accessibilityLabel={`Open ${author.displayName}’s profile`}>
            <Avatar uri={author.avatar} name={author.displayName} size={34} ring={colors.white} ringWidth={1.5} />
            <T v="bodyStrong" color={colors.white} style={{ marginLeft: 8, flexShrink: 1 }} numberOfLines={1}>
              {author.displayName}
            </T>
            {isBuzz && repo.buzzItem(entry.id)?.editedAtMs ? (
              <T v="caption" color="rgba(255,255,255,0.75)" weight="600" style={{ marginLeft: 6 }}>
                · Edited
              </T>
            ) : null}
          </Tap>
        ) : null}
        {entry.caption ? (
          <T v="callout" color={colors.white} weight="600" style={{ marginTop: 8, lineHeight: 21 }} numberOfLines={3}>
            {entry.caption}
          </T>
        ) : null}
        <View style={styles.reason}>
          <Sparkles size={12} color="rgba(255,255,255,0.8)" />
          <T v="caption" color="rgba(255,255,255,0.8)" weight="600" style={{ marginLeft: 5 }} numberOfLines={1}>
            {entry.reason}
          </T>
        </View>
        {board ? (
          <Tap onPress={() => pushOnce(`/board/${board.id}`)} style={styles.world} accessibilityLabel={`Open ${board.title}`}>
            <Img uri={board.cover} style={styles.worldImg} tint="rgba(255,255,255,0.2)" />
            <T v="subhead" color={colors.white} weight="700" numberOfLines={1} style={{ flex: 1, marginLeft: 8 }}>
              {board.title}
            </T>
            <ChevronRight size={16} color={colors.white} />
          </Tap>
        ) : null}
      </View>
    </View>
  );
});

function Rail({ onPress, label, text, children }: { onPress: () => void; label: string; text: string; children: React.ReactNode }) {
  return (
    <Tap onPress={onPress} haptic="light" accessibilityLabel={label} style={styles.railBtn}>
      {children}
      <T v="caption" color={colors.white} weight="700" numberOfLines={1} style={{ fontSize: 11.5 }}>
        {text}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  shadeTop: { position: 'absolute', left: 0, right: 0, top: 0 },
  shadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  rail: { position: 'absolute', right: 8, alignItems: 'center', gap: 14 },
  railBtn: { alignItems: 'center', minWidth: 60, minHeight: 50, justifyContent: 'center', gap: 3 },
  bottom: { position: 'absolute', left: 16, right: 84, bottom: 0 },
  author: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 44 },
  reason: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  world: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', marginTop: 10, paddingVertical: 6, paddingLeft: 6, paddingRight: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)' },
  worldImg: { width: 28, height: 28, borderRadius: 8 },
  previewPill: { position: 'absolute', alignSelf: 'center', top: '46%', paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  dislikedCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.82)' },
  undo: { marginTop: 14, height: 36, paddingHorizontal: 18, borderRadius: 18, backgroundColor: colors.white, justifyContent: 'center' },
  countPill: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.45)' },
});
