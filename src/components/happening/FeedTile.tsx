import { GalleryHorizontal, Heart, Play, Sparkles } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { duration } from '@/components/drift/DriftTile';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { FeedEntry } from '@/graph/surfaces';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import { compact } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

/**
 * One tile in Happening's visual stream (Phase 6B, formerly Drift). The media
 * is never painted over: the caption sits under it, then who posted it, then
 * WHY it's in your Happening (the Opportunity Graph's reason).
 */
export const FeedTile = memo(function FeedTile({ entry, width }: { entry: FeedEntry; width: number }) {
  const liked = useChimp((s) => (entry.kind === 'drift' ? !!s.driftLikes[entry.id] : !!s.buzzLikes[entry.id]));
  const author = entry.authorId ? repo.user(entry.authorId) : undefined;
  const board = entry.boardId ? repo.board(entry.boardId) : undefined;
  const aspect = entry.aspects?.[0] ?? (entry.video ? 0.62 : entry.images.length > 1 ? 0.85 : 0.8);
  const h = Math.round(width / Math.min(1.3, Math.max(0.6, aspect)));
  const open = () => pushOnce(entry.kind === 'drift' ? `/drift/${entry.id}` : `/buzz/${entry.id}`);
  return (
    <Tap onPress={open} scaleTo={0.975} style={{ width }} accessibilityLabel={`${entry.caption || 'Photo'}${author ? ` by ${author.displayName}` : ''}. ${entry.reason}`}>
      <View style={[styles.media, { height: h }]}>
        <Img uri={entry.images[0]} style={StyleSheet.absoluteFill} />
        {entry.video || entry.images.length > 1 ? (
          <View style={styles.badge}>
            {entry.video ? <Play size={10} color={colors.white} fill={colors.white} /> : <GalleryHorizontal size={12} color={colors.white} />}
            <T v="caption" color={colors.white} weight="700" style={{ fontSize: 10.5, marginLeft: 3 }}>
              {entry.video ? duration(entry.durationSec) : entry.images.length}
            </T>
          </View>
        ) : null}
        <View style={styles.likes}>
          <Heart size={12} color={colors.white} fill={liked ? colors.white : 'transparent'} />
          <T v="caption" color={colors.white} weight="700" style={{ fontSize: 10.5, marginLeft: 3 }}>
            {compact(entry.likeCount + (liked ? 1 : 0))}
          </T>
        </View>
      </View>
      {entry.caption ? (
        <T v="footnote" weight="700" numberOfLines={2} style={{ marginTop: 6, lineHeight: 17 }}>
          {entry.caption}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        {author ? <Avatar uri={author.avatar} name={author.displayName} size={16} /> : null}
        <T v="caption" color={colors.inkMuted} weight="600" numberOfLines={1} style={{ marginLeft: author ? 5 : 0, flex: 1, fontSize: 11.5 }}>
          {[author?.displayName.split(' ')[0], board?.title].filter(Boolean).join(' · ')}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
        <Sparkles size={11} color={colors.accent} />
        <T v="caption" color={colors.accent} weight="700" numberOfLines={1} style={{ marginLeft: 4, flex: 1, fontSize: 11.5 }}>
          {entry.reason}
        </T>
      </View>
    </Tap>
  );
});

const styles = StyleSheet.create({
  media: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.bgSoft },
  badge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)' },
  likes: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.38)' },
});
