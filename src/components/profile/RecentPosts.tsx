import { router } from 'expo-router';
import { BarChart3, Copy, Play } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { SectionHeader } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type ProfilePost, recentPostsFor } from '@/graph/surfaces';
import { useGraphCtx } from '@/hooks/useGraph';
import { colors, radius } from '@/theme';
import { whenLabel } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

const PAGE = 12;
const GAP = 4;

/**
 * Profile → Recent Posts: a person's Buzz and World photo / video posts in one
 * 3-column grid, newest first. Photos and videos show their picture (videos
 * with a play badge); text-only Buzz is a small text card. Tapping a tile
 * opens that post. Built from the same items every feed shows (no copies), so
 * a new post, an edit or a deletion shows here at once; only what the viewer
 * may see is included (graph/surfaces → recentPostsFor).
 */
export const RecentPosts = memo(function RecentPosts({ personId, firstName, own }: { personId: string; firstName: string; own?: boolean }) {
  const ctx = useGraphCtx();
  const { width } = useWindowDimensions();
  const posts = useMemo(() => recentPostsFor(ctx, personId), [ctx, personId]);
  const [count, setCount] = useState(PAGE);
  const blocked = !own && !!ctx.s.blocked[personId];
  const size = Math.floor((Math.min(width, 700) - 32 - GAP * 2) / 3);

  return (
    <View style={{ marginTop: 22 }} testID="recent-posts">
      <SectionHeader title="Recent posts" subtitle={posts.length ? 'Newest first' : undefined} style={{ paddingHorizontal: 16 }} />
      {blocked ? (
        <View style={styles.empty} testID="recent-blocked">
          <T v="footnote" color={colors.inkMuted}>
            {`You blocked ${firstName}, so their posts are hidden.`}
          </T>
        </View>
      ) : !posts.length ? (
        <View style={styles.empty} testID="recent-empty">
          <T v="subhead" weight="700" color={colors.ink2}>
            {own ? 'No posts yet' : 'No recent posts'}
          </T>
          <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
            {own ? 'Your posts, photos and videos will show up here.' : `When ${firstName} posts, it’ll show up here.`}
          </T>
          {own ? (
            <Tap onPress={() => router.push('/create')} style={styles.cta} accessibilityLabel="Create a post">
              <T v="footnote" weight="700" color={colors.accent}>
                Create a post
              </T>
            </Tap>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            {posts.slice(0, count).map((p) => (
              <Tile key={p.key} post={p} size={size} />
            ))}
          </View>
          {count < posts.length ? (
            <Tap onPress={() => setCount((c) => c + PAGE)} style={styles.more} accessibilityLabel="Show more posts" testID="recent-more">
              <T v="subhead" weight="700" color={colors.accent}>
                Show more
              </T>
            </Tap>
          ) : null}
        </>
      )}
    </View>
  );
});

function Tile({ post: p, size }: { post: ProfilePost; size: number }) {
  const when = whenLabel(p.createdMs);
  const what = p.video ? 'Video' : p.thumb ? (p.multi ? 'Photos' : 'Photo') : p.poll ? 'Poll' : 'Post';
  const label = `${what}${p.text ? `: ${p.text.slice(0, 80)}` : ''}${when ? `, ${when}` : ''}`;
  return (
    <Tap onPress={() => pushOnce(p.href)} scaleTo={0.97} style={[styles.tile, { width: size, height: size }]} accessibilityLabel={label} testID={`recent-tile-${p.id}`}>
      {p.thumb ? (
        <>
          <Img uri={p.thumb} style={StyleSheet.absoluteFill} />
          {p.video || p.multi ? (
            <View style={styles.badge}>{p.video ? <Play size={12} color={colors.white} fill={colors.white} /> : <Copy size={12} color={colors.white} />}</View>
          ) : null}
        </>
      ) : p.video ? (
        // A video still being processed (no poster yet): a dark tile with a play badge.
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.ink }]}>
          <Play size={22} color={colors.white} fill={colors.white} />
        </View>
      ) : (
        <View style={styles.textCard}>
          <T v="caption" weight="600" color={colors.ink2} numberOfLines={size > 110 ? 5 : 4} style={{ lineHeight: 16 }}>
            {p.text || 'Post'}
          </T>
          {p.poll ? <BarChart3 size={13} color={colors.accent} style={{ marginTop: 'auto' }} /> : null}
        </View>
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: 16 },
  tile: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.bgSoft },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  textCard: { flex: 1, padding: 9, backgroundColor: colors.accentSoft },
  empty: { marginHorizontal: 16, paddingVertical: 16, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  cta: { alignSelf: 'flex-start', marginTop: 8, minHeight: 32, justifyContent: 'center' },
  more: { marginHorizontal: 16, marginTop: 10, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
