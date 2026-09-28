import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, BadgeCheck, Bookmark, Heart, Link2, MessageCircle, Newspaper, Repeat2, ThumbsDown } from 'lucide-react-native';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { VideoPoster } from '@/components/media/ChimpVideo';
import { Avatar } from '@/components/ui/Avatar';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Img } from '@/components/ui/Img';
import { OwnerMenu } from '@/components/ui/OwnerMenu';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { CATEGORIES } from '@/data/interests';
import { removeMyBuzz } from '@/services/backend/ownContent';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { openMedia, openVideo } from '@/store/useMediaViewer';
import { colors, radius, shadow } from '@/theme';
import type { BuzzItem } from '@/types/models';
import { compact, whenLabel } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

interface Props {
  item: BuzzItem;
  /** Width of the column the card sits in. */
  width: number;
  /** Full-length body (detail screen). The card never navigates to itself. */
  expanded?: boolean;
}

/**
 * A Buzz item (Phase 6B).
 *   - A World is optional context ("Just Buzz" has none); the chip shows only when there is one.
 *   - Media is never painted over: the photo stays untouched and the caption
 *     sits under it as its own editorial line (legacy "meme" text included).
 *   - Tapping media opens the one global viewer (a modal, not a route).
 *   - No touchable is nested inside another (clean on web, predictable on iOS).
 * Like / reply / repost / save; dislike is private and collapses the card with an Undo.
 */
export const BuzzCard = memo(function BuzzCard({ item, width, expanded }: Props) {
  const disliked = useChimp((s) => !!s.buzzDislikes[item.id]);
  const toggleDislike = useChimp((s) => s.toggleBuzzDislike);

  if (disliked && !expanded) {
    const where = repo.board(item.boardId)?.title;
    return (
      <View style={[styles.collapsed, { width }]}>
        <ThumbsDown size={15} color={colors.inkMuted} />
        <T v="footnote" color={colors.inkMuted} style={{ flex: 1, marginLeft: 8 }} numberOfLines={2}>
          {where ? `Got it. You’ll see less like this from ${where}.` : 'Got it. You’ll see less like this.'}
        </T>
        <Tap onPress={() => toggleDislike(item.id)} style={styles.undo} accessibilityLabel="Undo dislike">
          <T v="footnote" color={colors.accent} weight="700">
            Undo
          </T>
        </Tap>
      </View>
    );
  }

  // The detail screen already shows this item: never push it again (no route stacking).
  const open = expanded ? undefined : () => pushOnce(`/buzz/${item.id}`);

  if (item.kind === 'news') return <NewsCard item={item} width={width} onPress={open} expanded={expanded} />;
  if (item.video) return <VideoCard item={item} width={width} onPress={open} expanded={expanded} />;
  if (imagesOf(item).length) return <MediaCard item={item} width={width} onPress={open} expanded={expanded} />;
  return <TextCard item={item} width={width} onPress={open} expanded={expanded} />;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const imagesOf = (item: BuzzItem) => item.images ?? (item.image ? [item.image] : []);
/** The words that go with a post (legacy meme text becomes the caption). */
const captionOf = (item: BuzzItem) => item.memeText ?? item.body ?? item.title ?? '';
const clampAspect = (a?: number) => Math.min(1.91, Math.max(0.8, a && a > 0 ? a : 1));

/** Visible reply count: REAL = the replies we actually have (incl. just-sent); DEMO = fixture + local. */
export function useReplyCount(item: BuzzItem): number {
  const local = useChimp((s) => s.buzzReplies[item.id]?.length ?? 0);
  useDatasetVersion((d) => d.version); // re-render when REAL replies arrive
  if (repo.mode() === 'real') return repo.buzzReplies(item.id).filter((r) => r.status !== 'failed').length;
  return item.replyCount + local;
}

function viewerMeta(item: BuzzItem) {
  const u = item.authorId ? repo.user(item.authorId) : undefined;
  return { caption: captionOf(item) || undefined, authorName: u?.displayName, context: repo.board(item.boardId)?.title };
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function WorldChip({ boardId, onDark, authorId }: { boardId: string; onDark?: boolean; authorId?: string }) {
  const b = boardId ? repo.board(boardId) : undefined;
  if (!b) return null;
  // Phase 6D provenance: a quiet note when the author is the person who made this World.
  const byCreator = !!authorId && !!b.ownerId && authorId === (b.creatorId ?? b.ownerId);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Tap onPress={() => pushOnce(`/board/${b.id}`)} scaleTo={0.95} style={[styles.chip, onDark && styles.chipOnDark]} accessibilityLabel={`Open ${b.title}`}>
        <CategoryIcon id={b.category} size={12} color={colors.accent} />
        <T v="caption" color={colors.ink2} weight="600" numberOfLines={1} style={{ marginLeft: 5, fontSize: 12 }}>
          {b.title}
        </T>
      </Tap>
      {byCreator ? (
        <T v="caption" color={colors.inkFaint} weight="600" style={{ marginLeft: 6, fontSize: 11.5 }} testID="creator-tag">
          Creator
        </T>
      ) : null}
    </View>
  );
}

/** "18m", or "18m · Edited" once the author has changed it (Phase 6D). */
function when(item: BuzzItem) {
  const at = item.createdAtMs ? whenLabel(item.createdAtMs) : item.createdAt;
  return item.editedAtMs ? `${at} · Edited` : at;
}

/**
 * Phase 6D: ••• on your own REAL post: Edit (1 hour; not polls) and Delete.
 * On the detail screen a deleted post also closes the screen.
 */
function PostOwnerMenu({ item, expanded, onDark }: { item: BuzzItem; expanded?: boolean; onDark?: boolean }) {
  if (repo.mode() !== 'real' || !repo.isMe(item.authorId)) return null;
  return (
    <OwnerMenu
      what="post"
      createdAtMs={item.createdAtMs}
      editable={item.kind !== 'poll'}
      onDark={onDark}
      onEdit={() => router.push(`/edit-buzz/${item.id}`)}
      onDelete={async () => {
        await removeMyBuzz(item.id);
        if (expanded && router.canGoBack()) router.back();
      }}
    />
  );
}

function Author({ item, expanded }: { item: BuzzItem; expanded?: boolean }) {
  const u = item.authorId ? repo.user(item.authorId) : undefined;
  if (!u) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Tap onPress={() => pushOnce(`/profile/${u.id}`)} accessibilityLabel={u.displayName}>
        <Avatar uri={u.avatar} name={u.displayName} size={38} />
      </Tap>
      <View style={{ flex: 1, marginLeft: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="subhead" weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
            {u.username}
          </T>
          {u.verified ? <BadgeCheck size={14} color={colors.white} fill={colors.accent} style={{ marginLeft: 3 }} /> : null}
          <T v="caption" color={colors.inkFaint} weight="500" style={{ marginLeft: 5 }} testID="buzz-when">
            {when(item)}
          </T>
        </View>
        {repo.board(item.boardId) ? (
          <View style={{ marginTop: 3, flexDirection: 'row' }}>
            <WorldChip boardId={item.boardId} authorId={item.authorId} />
          </View>
        ) : null}
      </View>
      <PostOwnerMenu item={item} expanded={expanded} />
    </View>
  );
}

/** "WollyMc · 2h · Films" — the compact byline under a media post. */
function Byline({ item, expanded }: { item: BuzzItem; expanded?: boolean }) {
  const u = item.authorId ? repo.user(item.authorId) : undefined;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
      {u ? (
        <Tap onPress={() => pushOnce(`/profile/${u.id}`)} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={u.displayName}>
          <Avatar uri={u.avatar} name={u.displayName} size={22} />
          <T v="footnote" weight="700" style={{ marginLeft: 6 }} numberOfLines={1}>
            {u.username}
          </T>
          {u.verified ? <BadgeCheck size={13} color={colors.white} fill={colors.accent} style={{ marginLeft: 3 }} /> : null}
        </Tap>
      ) : null}
      <T v="caption" color={colors.inkFaint} weight="500" testID="buzz-when">
        {when(item)}
      </T>
      <WorldChip boardId={item.boardId} authorId={item.authorId} />
      {repo.mode() === 'real' && repo.isMe(item.authorId) ? (
        <View style={{ marginLeft: 'auto' }}>
          <PostOwnerMenu item={item} expanded={expanded} />
        </View>
      ) : null}
    </View>
  );
}

function Actions({ item, compactRow }: { item: BuzzItem; compactRow?: boolean }) {
  const liked = useChimp((s) => !!s.buzzLikes[item.id]);
  const saved = useChimp((s) => !!s.buzzSaves[item.id]);
  const reposted = useChimp((s) => !!s.buzzReposts[item.id]);
  const replies = useReplyCount(item);
  const toggleLike = useChimp((s) => s.toggleBuzzLike);
  const toggleDislike = useChimp((s) => s.toggleBuzzDislike);
  const toggleSave = useChimp((s) => s.toggleBuzzSave);
  const toggleRepost = useChimp((s) => s.toggleBuzzRepost);
  const size = compactRow ? 17 : 19;
  return (
    <View style={styles.actions}>
      <Tap onPress={() => toggleLike(item.id)} haptic="light" style={[styles.act, compactRow && styles.actTight]} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
        <Heart size={size} color={liked ? '#FF3D6E' : colors.ink2} fill={liked ? '#FF3D6E' : 'transparent'} />
        <T v="footnote" color={colors.inkMuted} weight="500" style={styles.count}>
          {compact(item.likeCount + (liked ? 1 : 0))}
        </T>
      </Tap>
      <Tap onPress={() => pushOnce(`/buzz/${item.id}`)} style={[styles.act, compactRow && styles.actTight]} accessibilityLabel={`${replies} replies`}>
        <MessageCircle size={size} color={colors.ink2} />
        {!compactRow || replies ? (
          <T v="footnote" color={colors.inkMuted} weight="500" style={styles.count}>
            {compact(replies)}
          </T>
        ) : null}
      </Tap>
      {!compactRow ? (
        <Tap onPress={() => toggleRepost(item.id)} haptic="light" style={styles.act} accessibilityLabel={reposted ? 'Undo repost' : 'Repost'}>
          <Repeat2 size={size} color={reposted ? colors.success : colors.ink2} />
          <T v="footnote" color={reposted ? colors.success : colors.inkMuted} weight="500" style={styles.count}>
            {compact(item.repostCount + (reposted ? 1 : 0))}
          </T>
        </Tap>
      ) : null}
      <View style={{ flex: 1 }} />
      <Tap onPress={() => toggleDislike(item.id)} haptic="light" style={[styles.icon, compactRow && styles.iconTight]} accessibilityLabel="Dislike: show me less like this">
        <ThumbsDown size={size - 1} color={colors.inkFaint} />
      </Tap>
      <Tap onPress={() => toggleSave(item.id)} haptic="light" style={[styles.icon, compactRow && styles.iconTight]} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
        <Bookmark size={size} color={saved ? colors.accent : colors.ink2} fill={saved ? colors.accent : 'transparent'} />
      </Tap>
    </View>
  );
}

function Poll({ item }: { item: BuzzItem }) {
  const vote = useChimp((s) => s.buzzVotes[item.id]);
  const voteBuzz = useChimp((s) => s.voteBuzz);
  if (!item.poll) return null;
  const total = Math.max(1, item.poll.options.reduce((a, o) => a + o.votes, 0) + (vote ? 1 : 0));
  return (
    <View style={{ marginTop: 10, gap: 7 }}>
      {item.poll.options.map((o) => {
        const votes = o.votes + (vote === o.id ? 1 : 0);
        const pct = Math.round((votes / total) * 100);
        const mine = vote === o.id;
        return (
          <Tap key={o.id} onPress={() => voteBuzz(item.id, o.id)} haptic="select" style={[styles.opt, mine && { borderColor: colors.accent }]} accessibilityLabel={`Vote ${o.label}`}>
            {vote ? <View style={[styles.optFill, { width: `${pct}%` }, mine && { backgroundColor: '#CFE0FF' }]} /> : null}
            <T v="footnote" weight={mine ? '700' : '600'} style={{ flex: 1 }} numberOfLines={1}>
              {o.label}
            </T>
            {vote ? (
              <T v="footnote" weight="700">
                {`${pct}%`}
              </T>
            ) : null}
          </Tap>
        );
      })}
    </View>
  );
}

function TextCard({ item, width, onPress, expanded }: { item: BuzzItem; width: number; onPress?: () => void; expanded?: boolean }) {
  return (
    <View style={[styles.card, { width }]}>
      <Author item={item} expanded={expanded} />
      <Tap onPress={onPress} disabled={!onPress} scaleTo={0.99} accessibilityLabel={item.title ?? item.body ?? item.poll?.question}>
        {item.title ? (
          <T v="headline" style={{ marginTop: 10 }}>
            {item.title}
          </T>
        ) : null}
        {item.body && item.kind !== 'poll' ? (
          <T v="callout" weight="400" color={colors.ink} numberOfLines={expanded ? undefined : item.kind === 'note' ? 5 : 6} style={{ marginTop: item.title ? 4 : 10, lineHeight: 22 }}>
            {item.body}
          </T>
        ) : null}
        {item.kind === 'note' && !expanded ? (
          <T v="footnote" color={colors.accent} weight="600" style={{ marginTop: 4 }}>
            Read the Note
          </T>
        ) : null}
        {item.kind === 'poll' ? (
          <T v="callout" weight="600" style={{ marginTop: 10 }}>
            {item.poll?.question}
          </T>
        ) : null}
      </Tap>
      {item.kind === 'poll' ? <Poll item={item} /> : null}
      <Actions item={item} compactRow={width < 240} />
    </View>
  );
}

/** Photo post: the media untouched, then the caption as its own line, then the byline. */
function MediaCard({ item, width, onPress, expanded }: { item: BuzzItem; width: number; onPress?: () => void; expanded?: boolean }) {
  const imgs = imagesOf(item);
  const caption = captionOf(item);
  const [page, setPage] = useState(0);
  const half = width < 240;
  const h = Math.round(width / clampAspect(item.imageAspects?.[0]));
  const view = (i: number) => openMedia(imgs, item.imageAspects, i, viewerMeta(item));
  // Short captions get the bold editorial treatment; long ones read as text.
  const bold = caption.length > 0 && caption.length <= 90;
  return (
    <View style={[styles.cardFlat, { width }]}>
      {imgs.length > 1 ? (
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            scrollEventThrottle={32}
          >
            {imgs.map((u, i) => (
              <Tap key={`${u}${i}`} onPress={() => view(i)} scaleTo={1} accessibilityLabel={`Photo ${i + 1} of ${imgs.length}`}>
                <Img uri={u} style={{ width, height: h }} />
              </Tap>
            ))}
          </ScrollView>
          <View style={styles.dots} pointerEvents="none">
            {imgs.map((u, i) => (
              <View key={`d${i}`} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
        </View>
      ) : (
        <Tap onPress={() => view(0)} scaleTo={0.995} accessibilityLabel="Open photo">
          <Img uri={imgs[0]} style={{ width, height: h }} />
        </Tap>
      )}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
        {caption ? (
          <Tap onPress={onPress} disabled={!onPress} scaleTo={0.99} accessibilityLabel={caption}>
            <T
              style={bold ? [styles.caption, half && styles.captionHalf] : undefined}
              v={bold ? undefined : 'callout'}
              weight={bold ? undefined : '400'}
              numberOfLines={expanded ? undefined : bold ? 3 : 5}
            >
              {caption}
            </T>
          </Tap>
        ) : null}
        <Byline item={item} expanded={expanded} />
        <Actions item={item} compactRow={half} />
      </View>
    </View>
  );
}

/**
 * Phase 6C: a short clip. In a feed it's a poster with a play badge — never
 * autoplaying, never sound on load. Tapping it opens the viewer, where it plays.
 */
function VideoCard({ item, width, onPress, expanded }: { item: BuzzItem; width: number; onPress?: () => void; expanded?: boolean }) {
  const v = item.video!;
  const caption = captionOf(item);
  const half = width < 240;
  const h = Math.round(width / Math.min(1.91, Math.max(0.8, v.aspect && v.aspect > 0 ? v.aspect : 0.8)));
  const bold = caption.length > 0 && caption.length <= 90;
  return (
    <View style={[styles.cardFlat, { width }]}>
      <Tap onPress={() => openVideo(v, viewerMeta(item))} scaleTo={0.995} accessibilityLabel="Play video">
        <VideoPoster poster={v.poster ?? item.image} durationMs={v.durationMs} width={width} height={h} />
      </Tap>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
        {caption ? (
          <Tap onPress={onPress} disabled={!onPress} scaleTo={0.99} accessibilityLabel={caption}>
            <T style={bold ? [styles.caption, half && styles.captionHalf] : undefined} v={bold ? undefined : 'callout'} weight={bold ? undefined : '400'} numberOfLines={expanded ? undefined : bold ? 3 : 5}>
              {caption}
            </T>
          </Tap>
        ) : null}
        <Byline item={item} expanded={expanded} />
        <Actions item={item} compactRow={half} />
      </View>
    </View>
  );
}

function NewsCard({ item, width, onPress, expanded }: { item: BuzzItem; width: number; onPress?: () => void; expanded?: boolean }) {
  const n = item.news!;
  const cat = CATEGORIES.find((c) => c.id === n.category)?.label ?? '';
  const board = repo.board(item.boardId);
  if (width < 240 && !expanded) {
    // Half-width: photo card with the headline, like the approved Travel tile.
    const h = Math.round(width * 1.05);
    return (
      <Tap onPress={onPress} disabled={!onPress} scaleTo={0.985} style={[styles.newsTile, { width, height: h }, shadow.sm]} accessibilityLabel={n.headline}>
        <Img uri={item.image} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.75)']} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.chip, { position: 'absolute', top: 10, left: 10 }]}>
          <CategoryIcon id={n.category} size={12} color={colors.accent} />
          <T v="caption" color={colors.ink2} weight="600" style={{ marginLeft: 5, fontSize: 12 }}>
            {cat}
          </T>
        </View>
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
          <T v="subhead" weight="700" color={colors.white} numberOfLines={4} style={{ lineHeight: 19 }}>
            {n.headline}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <T v="caption" color="rgba(255,255,255,0.8)" weight="500" style={{ flex: 1 }} numberOfLines={1}>
              {`${n.source} · ${item.createdAt}`}
            </T>
            <View style={styles.arrow}>
              <ArrowRight size={16} color={colors.ink} />
            </View>
          </View>
        </View>
      </Tap>
    );
  }
  return (
    <View style={[styles.card, { width }]}>
      <Tap onPress={onPress} disabled={!onPress} scaleTo={0.99} accessibilityLabel={n.headline}>
      <View style={{ flexDirection: 'row' }}>
        <Img uri={item.image} style={styles.newsThumb} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={styles.update}>
              <Newspaper size={12} color={colors.white} />
              <T v="caption" color={colors.white} weight="700" style={{ marginLeft: 4, fontSize: 11.5 }}>
                Update
              </T>
            </View>
            <T v="caption" color={colors.inkFaint} weight="500" style={{ marginLeft: 7, flex: 1 }} numberOfLines={1}>
              {item.createdAt}
            </T>
            <View style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}>
              <CategoryIcon id={n.category} size={12} color={colors.accent} />
              <T v="caption" color={colors.ink2} weight="600" style={{ marginLeft: 4, fontSize: 11.5 }}>
                {cat}
              </T>
            </View>
          </View>
          <T v="headline" style={{ marginTop: 7, lineHeight: 21 }} numberOfLines={expanded ? undefined : 3}>
            {n.headline}
          </T>
        </View>
      </View>
      <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 8, lineHeight: 20 }} numberOfLines={expanded ? undefined : 3}>
        {n.summary}
      </T>
      <T v="caption" color={colors.inkFaint} weight="500" style={{ marginTop: 6 }}>
        {`${n.source} · prototype fixture, not live news`}
      </T>
      </Tap>
      <View style={styles.actions}>
        <NewsLike item={item} />
        <Tap onPress={() => pushOnce(`/buzz/${item.id}`)} style={styles.act} accessibilityLabel="Replies">
          <MessageCircle size={18} color={colors.ink2} />
          <T v="footnote" color={colors.inkMuted} weight="500" style={styles.count}>
            {compact(item.replyCount)}
          </T>
        </Tap>
        {board ? (
          <Tap onPress={() => pushOnce(`/board/${board.id}`)} style={styles.act} accessibilityLabel={`View ${board.title}`}>
            <Link2 size={17} color={colors.ink2} />
            <T v="footnote" color={colors.ink2} weight="600" style={styles.count} numberOfLines={1}>
              View board
            </T>
          </Tap>
        ) : null}
        <View style={{ flex: 1 }} />
        <NewsDislike item={item} />
      </View>
    </View>
  );
}

function NewsLike({ item }: { item: BuzzItem }) {
  const liked = useChimp((s) => !!s.buzzLikes[item.id]);
  const toggleLike = useChimp((s) => s.toggleBuzzLike);
  return (
    <Tap onPress={() => toggleLike(item.id)} haptic="light" style={styles.act} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
      <Heart size={18} color={liked ? '#FF3D6E' : colors.ink2} fill={liked ? '#FF3D6E' : 'transparent'} />
      <T v="footnote" color={colors.inkMuted} weight="500" style={styles.count}>
        {compact(item.likeCount + (liked ? 1 : 0))}
      </T>
    </Tap>
  );
}

function NewsDislike({ item }: { item: BuzzItem }) {
  const toggleDislike = useChimp((s) => s.toggleBuzzDislike);
  return (
    <Tap onPress={() => toggleDislike(item.id)} haptic="light" style={styles.icon} accessibilityLabel="Dislike: show me less like this">
      <ThumbsDown size={17} color={colors.inkFaint} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: radius.xl, backgroundColor: colors.surface, ...shadow.sm },
  cardFlat: { borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden', ...shadow.sm },
  collapsed: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingLeft: 14, paddingRight: 6, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  undo: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.accentSoft, maxWidth: 190 },
  chipOnDark: { backgroundColor: 'rgba(255,255,255,0.92)' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginHorizontal: -6 },
  act: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 6, marginRight: 4 },
  icon: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconTight: { width: 32 },
  actTight: { paddingHorizontal: 4, marginRight: 0 },
  count: { marginLeft: 4 },
  opt: { height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  optFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.accentSoft },
  caption: { fontSize: 22, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  captionHalf: { fontSize: 17, lineHeight: 21 },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: colors.white, width: 16 },
  newsTile: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.bgSoft },
  newsThumb: { width: 92, height: 92, borderRadius: 16 },
  update: { flexDirection: 'row', alignItems: 'center', height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.accent },
  arrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
