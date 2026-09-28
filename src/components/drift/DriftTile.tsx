import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { GalleryHorizontal, Heart, Play } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, fonts } from '@/theme';
import type { DriftItem } from '@/types/models';
import { compact } from '@/utils/format';

export const duration = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');

/**
 * One visual in the Drift feed. Always shows where it comes from:
 * the World (Board) and the creator.
 */
export const DriftTile = memo(function DriftTile({ item, width }: { item: DriftItem; width: number }) {
  const liked = useChimp((s) => !!s.driftLikes[item.id]);
  const board = repo.board(item.boardId);
  const author = repo.user(item.authorId);
  const h = Math.round(width * (item.tall ? 1.62 : 1.18));

  return (
    <Tap
      onPress={() => router.push(`/drift/${item.id}`)}
      scaleTo={0.975}
      accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Post'} by ${author?.displayName ?? ''} in ${board?.title ?? ''}: ${item.caption}`}
      style={[styles.tile, { width, height: h }]}
    >
      <Img uri={item.image} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />


      <View style={styles.top}>
        <View style={styles.world}>
          <T v="caption" color={colors.ink2} weight="700" numberOfLines={1} style={{ fontSize: 11 }}>
            {board?.title}
          </T>
        </View>
        <View style={{ flex: 1 }} />
        {item.kind === 'video' ? (
          <View style={styles.badge}>
            <Play size={10} color={colors.white} fill={colors.white} />
            <T v="caption" color={colors.white} weight="700" style={{ fontSize: 10.5, marginLeft: 3 }}>
              {duration(item.durationSec)}
            </T>
          </View>
        ) : item.kind === 'carousel' ? (
          <View style={styles.badge}>
            <GalleryHorizontal size={12} color={colors.white} />
            <T v="caption" color={colors.white} weight="700" style={{ fontSize: 10.5, marginLeft: 3 }}>
              {item.images?.length ?? 1}
            </T>
          </View>
        ) : null}
      </View>

      <View style={styles.bottom}>
        <Avatar uri={author?.avatar} name={author?.displayName} size={22} ring={colors.white} ringWidth={1.5} />
        <T v="caption" color={colors.white} weight="600" numberOfLines={1} style={[styles.shadow, { marginLeft: 6, flex: 1 }]}>
          {author?.displayName.split(' ')[0]}
        </T>
        <Heart size={13} color={colors.white} fill={liked ? colors.white : 'transparent'} />
        <T v="caption" color={colors.white} weight="600" style={[styles.shadow, { marginLeft: 3 }]}>
          {compact(item.likeCount + (liked ? 1 : 0))}
        </T>
      </View>
    </Tap>
  );
});

const styles = StyleSheet.create({
  tile: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.bgSoft },
  top: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center' },
  world: { height: 24, maxWidth: '72%', paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)' },
  bottom: { position: 'absolute', left: 9, right: 10, bottom: 9, flexDirection: 'row', alignItems: 'center' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  meme: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 40,
    fontFamily: fonts.handBold,
    fontSize: 26,
    lineHeight: 27,
    color: colors.white,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
    transform: [{ rotate: '-3deg' }],
  },
});
