import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { Story } from '@/types/models';

export const RING_UNSEEN: [string, string, string] = ['#3B82FF', '#8B5CF6', '#EC4899'];
export const RING_NIGHT: [string, string, string] = ['#FF2E88', '#C8175E', '#7C3AED'];

export function useStoryUnseen(story: Story) {
  return useChimp((s) => story.items.filter((i) => !s.seenStoryItems[i.id]).length);
}

interface Props {
  story: Story;
  size: number;
  lane: 'trending' | 'friend';
  label?: string;
  meta?: string;
  float?: number; // seconds per float cycle, 0 disables
}

/** A story as a floating object on the Stories canvas, or a ring in the friends row. */
export const StoryBubble = memo(function StoryBubble({ story, size, lane, label, meta, float = 0 }: Props) {
  const unseen = useStoryUnseen(story);
  const night = story.owner.kind === 'board' && story.owner.id === 'after-dark';
  const ring = unseen > 0 ? (night ? RING_NIGHT : RING_UNSEEN) : (['#D6DCE6', '#D6DCE6', '#D6DCE6'] as const);
  const author = repo.user(story.items[0]?.authorId);
  const ringW = size > 80 ? 3.5 : 2.5;
  const gap = size > 80 ? 4 : 3;
  const inner = size - (ringW + gap) * 2;

  const y = useSharedValue(0);
  useEffect(() => {
    if (!float) return;
    y.value = withRepeat(withTiming(1, { duration: float * 1000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [float, y]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (y.value - 0.5) * 6 }] }));

  return (
    // Wider than the bubble so two-line labels never clip; centred over it.
    // (On the canvas the slot x is the bubble's left edge, so shift back by the extra width.)
    <Animated.View style={[{ alignItems: 'center', width: Math.max(size + 26, 84), marginLeft: float ? -(Math.max(size + 26, 84) - size) / 2 : 0 }, aStyle]}>
      <Tap
        onPress={() => router.push(`/story/${story.id}?lane=${lane}`)}
        scaleTo={0.94}
        haptic="light"
        accessibilityLabel={`Watch ${story.title} story${unseen ? `, ${unseen} new` : ''}`}
      >
        <LinearGradient colors={ring} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: size - ringW * 2, height: size - ringW * 2, borderRadius: size, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Img uri={story.cover} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
          </View>
        </LinearGradient>
        {lane === 'trending' && author ? (
          <Avatar uri={author.avatar} name={author.displayName} size={Math.max(24, size * 0.26)} ring={colors.white} ringWidth={2} style={styles.author} />
        ) : null}
        {lane === 'trending' && unseen > 0 ? (
          <View style={[styles.count, night && { backgroundColor: '#FF2E88' }]}>
            <T v="caption" color={colors.white} weight="800" style={{ fontSize: 10.5 }}>
              {unseen}
            </T>
          </View>
        ) : null}
      </Tap>
      {label ? (
        <T v={size > 80 ? 'subhead' : 'caption'} weight="700" numberOfLines={2} align="center" style={{ marginTop: 6, lineHeight: size > 80 ? 17 : 14 }}>
          {label}
        </T>
      ) : null}
      {meta ? (
        <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1} align="center" style={{ marginTop: 1 }}>
          {meta}
        </T>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  author: { position: 'absolute', right: -2, bottom: -2 },
  count: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
