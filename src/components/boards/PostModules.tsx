import { router } from 'expo-router';
import { ChartNoAxesColumn, Bookmark, Ellipsis, Heart, Map as MapIcon, MapPin, MessageCircle, Utensils, VenetianMask } from 'lucide-react-native';
import { memo, ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { PhotoCarousel } from '@/components/media/PhotoCarousel';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { openMedia } from '@/store/useMediaViewer';
import { colors, radius, shadow } from '@/theme';
import type { BoardTheme, Post } from '@/types/models';
import { compact } from '@/utils/format';

interface ModuleProps {
  post: Post;
  theme: BoardTheme;
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function Author({ post, theme }: { post: Post; theme: BoardTheme }) {
  const u = repo.user(post.authorId);
  const masked = post.authorMode !== 'public';
  return (
    <View style={styles.author}>
      {masked ? (
        <View style={styles.maskAvatar}>
          <VenetianMask size={16} color={theme.mutedText} />
        </View>
      ) : (
        <Tap onPress={() => router.push(`/profile/${post.authorId}`)} accessibilityLabel={`Open ${u?.displayName}`}>
          <Avatar uri={u?.avatar} name={u?.displayName} size={34} />
        </Tap>
      )}
      <View style={{ flex: 1, marginLeft: 9 }}>
        <T v="footnote" weight="700" numberOfLines={1} color={theme.text}>
          {masked ? 'Verified member' : u?.displayName}
        </T>
        <T v="caption" color={theme.mutedText} weight="500">
          {`${post.createdAt} ago`}
        </T>
      </View>
      <Ellipsis size={18} color={theme.mutedText} />
    </View>
  );
}

function Kicker({ icon, label, theme }: { icon: ReactNode; label: string; theme: BoardTheme }) {
  return (
    <View style={styles.kicker}>
      {icon}
      <T v="caption" color={theme.primary} style={{ marginLeft: 6, letterSpacing: 0.8 }}>
        {label}
      </T>
    </View>
  );
}

export function Reactions({ post, theme }: ModuleProps) {
  const liked = useChimp((s) => !!s.likedPosts[post.id]);
  const saved = useChimp((s) => !!s.savedPosts[post.id]);
  const added = useChimp((s) => s.comments[post.id]?.length ?? 0);
  const toggleLike = useChimp((s) => s.toggleLike);
  const toggleSave = useChimp((s) => s.toggleSavePost);
  return (
    <View style={styles.reactions}>
      <Tap onPress={() => toggleLike(post.id)} haptic="light" style={styles.reaction} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
        <Heart size={20} color={liked ? colors.heart : theme.text} fill={liked ? colors.heart : 'transparent'} strokeWidth={2} />
        <T v="footnote" color={theme.text} style={{ marginLeft: 5 }}>
          {compact(post.likeCount + (liked ? 1 : 0))}
        </T>
      </Tap>
      <Tap onPress={() => router.push(`/comments/${post.id}`)} style={styles.reaction} accessibilityLabel="Comments">
        <MessageCircle size={20} color={theme.text} strokeWidth={2} />
        <T v="footnote" color={theme.text} style={{ marginLeft: 5 }}>
          {post.commentCount + added}
        </T>
      </Tap>
      <View style={{ flex: 1 }} />
      <Tap onPress={() => toggleSave(post.id)} haptic="light" style={styles.iconOnly} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
        <Bookmark size={20} color={saved ? theme.primary : theme.text} fill={saved ? theme.primary : 'transparent'} strokeWidth={2} />
      </Tap>
    </View>
  );
}

// ─── Photo post ─────────────────────────────────────────────────────────────

/**
 * Every photo of a post (was: only the first). One photo shows as before;
 * several swipe sideways with the same carousel Buzz uses, and a tap opens
 * the same full-screen viewer.
 */
function PostPhotos({ post }: { post: Post }) {
  const imgs = post.images ?? [];
  const [w, setW] = useState(0);
  if (!imgs.length) return null;
  if (imgs.length === 1) return <Img uri={imgs[0]} style={styles.photo} />;
  const open = (i: number) => openMedia(imgs, undefined, i, { caption: post.title ?? post.body, authorName: post.authorMode === 'public' ? repo.user(post.authorId)?.displayName : undefined, context: repo.board(post.boardId)?.title });
  return (
    <View style={styles.photoClip} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} testID="post-photos">
      {w ? <PhotoCarousel images={imgs} width={w} height={Math.round(w / 1.35)} onOpen={open} /> : <View style={{ aspectRatio: 1.35 }} />}
    </View>
  );
}

export const PhotoPost = memo(function PhotoPost({ post, theme }: ModuleProps) {
  return (
    <View style={[styles.module, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Author post={post} theme={theme} />
      <PostPhotos post={post} />
      {post.title ? (
        <T v="headline" color={theme.text} style={{ marginTop: 10 }}>
          {post.title}
        </T>
      ) : null}
      {post.body ? (
        <T v="footnote" color={theme.mutedText} weight="400" style={{ marginTop: 3, lineHeight: 18 }}>
          {post.body}
        </T>
      ) : null}
      <Reactions post={post} theme={theme} />
    </View>
  );
});

export const TextPost = memo(function TextPost({ post, theme }: ModuleProps) {
  return (
    <View style={[styles.module, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Author post={post} theme={theme} />
      {post.title ? (
        <T v="headline" color={theme.text} style={{ marginTop: 10 }}>
          {post.title}
        </T>
      ) : null}
      <T v="footnote" color={theme.mutedText} weight="400" style={{ marginTop: 4, lineHeight: 18 }}>
        {post.body}
      </T>
      <Reactions post={post} theme={theme} />
    </View>
  );
});

// ─── Poll ───────────────────────────────────────────────────────────────────

export const PollCard = memo(function PollCard({ post, theme }: ModuleProps) {
  const choice = useChimp((s) => s.pollVotes[post.id]);
  const vote = useChimp((s) => s.vote);
  const poll = post.poll!;
  const total = poll.options.reduce((n, o) => n + o.votes, 0) + (choice ? 1 : 0);
  const voted = !!choice;
  const leader = poll.options.reduce((a, b) => (b.votes > a.votes ? b : a)).id;

  return (
    <View style={[styles.module, { backgroundColor: theme.surfaceAlt, borderColor: 'transparent' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Kicker icon={<ChartNoAxesColumn size={15} color={theme.primary} strokeWidth={2.5} />} label="POLL" theme={theme} />
        <View style={{ flex: 1 }} />
        <Ellipsis size={18} color={theme.mutedText} />
      </View>
      <T v="headline" color={theme.text} style={{ marginTop: 10, fontSize: 18, lineHeight: 23 }}>
        {poll.question}
      </T>
      <View style={{ marginTop: 12, gap: 8 }}>
        {poll.options.map((o) => {
          const votes = o.votes + (choice === o.id ? 1 : 0);
          const pct = Math.round((votes / total) * 100);
          const mine = choice === o.id;
          return (
            <Tap
              key={o.id}
              onPress={() => vote(post.id, o.id)}
              haptic="select"
              scaleTo={0.98}
              accessibilityLabel={`Vote ${o.label}`}
              accessibilityState={{ selected: mine }}
              style={[styles.pollOption, { backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.8)' }, mine && { borderColor: theme.primary }]}
            >
              <View
                style={[
                  styles.pollFill,
                  {
                    width: `${pct}%`,
                    backgroundColor: withAlpha(theme.primary, mine ? 0.62 : !voted && o.id === leader ? 0.5 : 0.2),
                  },
                ]}
              />
              <T v="subhead" weight={mine ? '700' : '500'} color={theme.text} style={{ flex: 1 }}>
                {o.label}
              </T>
              <T v="subhead" weight="600" color={theme.text}>
                {`${pct}%`}
              </T>
            </Tap>
          );
        })}
      </View>
      <T v="caption" color={theme.mutedText} weight="500" style={{ marginTop: 10 }}>
        {voted ? `${compact(total)} votes · you voted · tap again to undo` : `${compact(total)} votes`}
      </T>
    </View>
  );
});

function withAlpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── Saved route ────────────────────────────────────────────────────────────

export const RouteCard = memo(function RouteCard({ post, theme }: ModuleProps) {
  const route = post.route!;
  return (
    <View style={[styles.module, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Kicker icon={<MapPin size={15} color={theme.primary} strokeWidth={2.5} />} label="SAVED ROUTE" theme={theme} />
        <View style={{ flex: 1 }} />
        <Ellipsis size={18} color={theme.mutedText} />
      </View>
      <T v="headline" color={theme.text} style={{ marginTop: 8, fontSize: 18 }}>
        {route.title}
      </T>
      <T v="footnote" color={theme.mutedText} weight="400" style={{ marginTop: 2 }}>
        {`${route.stops.length} stops · ${route.distanceKm} km · ${route.duration}`}
      </T>
      <RouteMap post={post} theme={theme} height={150} compact />
      <Tap onPress={() => router.push(`/route/${post.id}`)} style={[styles.routeBtn, { backgroundColor: withAlpha(theme.primary, 0.1) }]}>
        <MapIcon size={18} color={theme.text} />
        <T v="subhead" weight="600" style={{ marginLeft: 8 }}>
          View Route
        </T>
      </Tap>
    </View>
  );
});

/** Schematic map drawn with SVG — no native maps dependency needed in Expo Go. */
export function RouteMap({ post, theme, height, compact: small }: ModuleProps & { height: number; compact?: boolean }) {
  const stops = post.route!.stops;
  const W = 300;
  const H = (height / (small ? 150 : 260)) * (small ? 150 : 260);
  const pts = stops.map((s) => ({ x: s.x * W, y: s.y * H }));
  const d = pts.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} Q ${cx} ${prev.y} ${p.x} ${p.y}`;
  }, '');
  const shown = small ? [0, 2, 4] : stops.map((_, i) => i);
  return (
    <View style={[styles.map, { height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        {/* Streets */}
        {[0.2, 0.45, 0.7].map((y) => (
          <Path key={`h${y}`} d={`M 0 ${y * H} L ${W} ${y * H + 12}`} stroke="#E4E7EC" strokeWidth={7} />
        ))}
        {[0.25, 0.55, 0.8].map((x) => (
          <Path key={`v${x}`} d={`M ${x * W} 0 L ${x * W - 18} ${H}`} stroke="#E4E7EC" strokeWidth={6} />
        ))}
        <Path d={`M 0 ${H * 0.9} Q ${W * 0.4} ${H * 0.75} ${W} ${H * 0.95}`} stroke="#CFE6F7" strokeWidth={10} fill="none" />
        <Path d={d} stroke={theme.primary} strokeWidth={3} fill="none" strokeLinecap="round" />
        {pts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={5.5} fill={colors.white} stroke={theme.primary} strokeWidth={3} />
        ))}
      </Svg>
      {shown.map((i) => {
        const s = stops[i];
        return (
          <View key={s.id} style={[styles.pin, { left: `${s.x * 100}%`, top: `${s.y * 100}%` }]} pointerEvents="none">
            <Img uri={s.image} style={styles.pinImg} />
            {!small || i === 0 || i === stops.length - 1 ? (
              <T v="caption" weight="600" color={theme.text} numberOfLines={1} style={styles.pinLabel}>
                {s.name}
              </T>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ─── Place / food spot ──────────────────────────────────────────────────────

export const PlaceCard = memo(function PlaceCard({ post, theme }: ModuleProps) {
  const place = post.place!;
  return (
    <View style={[styles.module, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Kicker icon={<Utensils size={15} color={theme.primary} strokeWidth={2.5} />} label="FOOD SPOT" theme={theme} />
        <View style={{ flex: 1 }} />
        <Ellipsis size={18} color={theme.mutedText} />
      </View>
      <T v="headline" color={theme.text} style={{ marginTop: 8, fontSize: 18 }}>
        {place.name}
      </T>
      <T v="footnote" color={theme.mutedText} weight="400" style={{ marginTop: 2 }}>
        {[place.city, place.category, place.price].filter(Boolean).join(' • ')}
      </T>
      <Img uri={place.image} style={[styles.photo, { marginTop: 10 }]} />
      {post.body ? (
        <T v="footnote" color={theme.text} weight="400" style={{ marginTop: 10, lineHeight: 18 }}>
          {post.body}
        </T>
      ) : null}
      <Reactions post={post} theme={theme} />
    </View>
  );
});

export function PostModule({ post, theme }: ModuleProps) {
  switch (post.kind) {
    case 'poll':
      return <PollCard post={post} theme={theme} />;
    case 'route':
      return <RouteCard post={post} theme={theme} />;
    case 'place':
      return <PlaceCard post={post} theme={theme} />;
    case 'text':
      return <TextPost post={post} theme={theme} />;
    default:
      return <PhotoPost post={post} theme={theme} />;
  }
}

/** Rough heights so the two masonry columns stay balanced. */
export function estimateHeight(post: Post): number {
  switch (post.kind) {
    case 'poll':
      return 110 + (post.poll?.options.length ?? 0) * 52;
    case 'route':
      return 300;
    case 'place':
      return 330;
    case 'text':
      return 170;
    default:
      return 290;
  }
}

const styles = StyleSheet.create({
  module: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.sm,
  },
  author: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  maskAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', aspectRatio: 1.35, borderRadius: 14 },
  photoClip: { width: '100%', borderRadius: 14, overflow: 'hidden' },
  kicker: { flexDirection: 'row', alignItems: 'center' },
  reactions: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: -4 },
  reaction: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingRight: 14 },
  iconOnly: { minWidth: 40, minHeight: 40, alignItems: 'flex-end', justifyContent: 'center' },
  pollOption: {
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1.5,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  map: {
    marginTop: 10,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F4F5F7',
  },
  pin: { position: 'absolute', marginLeft: -50, marginTop: -40, alignItems: 'center', width: 100 },
  pinImg: { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: colors.white },
  pinLabel: { marginTop: 2, fontSize: 10, textAlign: 'center' },
  routeBtn: {
    marginTop: 10,
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
