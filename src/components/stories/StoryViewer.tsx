import { Href, router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Flame, Heart, MapPin, Send, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { Story, StoryItem } from '@/types/models';
import { fullscreenTop, useDeviceInsets } from '@/components/system/SafeArea';

interface Props {
  queue: Story[];
  startIndex: number;
}

type PauseReason = 'hold' | 'pinch' | 'input' | 'pan';

/**
 * Full-screen story viewer.
 * Gestures: tap left/right = previous/next · hold = pause (chrome hides) ·
 * pinch = zoom (springs back) · swipe down = close.
 */
export function StoryViewer({ queue, startIndex }: Props) {
  // Phase 8: full-screen route (covers the App Review banner too) → the phone's real insets.
  const insets = useDeviceInsets();
  const { width, height } = useWindowDimensions();
  const [storyIdx, setStoryIdx] = useState(startIndex);
  const [itemIdx, setItemIdx] = useState(0);
  const [paused, setPaused] = useState<Record<PauseReason, boolean>>({ hold: false, pinch: false, input: false, pan: false });
  // Which item has finished loading (or timed out). Keyed by item, so moving to
  // a new item is "not ready" without resetting state in an effect.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  // Bumped to restart the current item's progress from zero (tap back on the first item).
  const [restartTick, setRestartTick] = useState(0);
  const [reply, setReply] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const story = queue[storyIdx];
  const item: StoryItem | undefined = story?.items[itemIdx];
  const itemKey = item?.id ?? 'none';
  const ready = readyFor === itemKey;
  const author = item ? repo.user(item.authorId) : undefined;
  const board = item?.boardId ? repo.board(item.boardId) : story?.owner.kind === 'board' ? repo.board(story.owner.id) : undefined;
  const move = item?.moveId ? repo.move(item.moveId) : story?.owner.kind === 'move' ? repo.move(story.owner.id) : undefined;

  const markSeen = useChimp((s) => s.markStoryItemSeen);
  const liked = useChimp((s) => (item ? !!s.likedPosts[item.id] : false));
  const toggleLike = useChimp((s) => s.toggleLike);
  const sendMessage = useChimp((s) => s.sendMessage);

  // Progress state lives on the UI thread so the bars stay smooth.
  const progress = useSharedValue(0);
  const isPaused = Object.values(paused).some(Boolean);
  const duration = item?.durationMs ?? 5000;

  // ── Navigation ────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/happening');
  }, []);

  const goNext = useCallback(() => {
    if (!story) return;
    if (itemIdx < story.items.length - 1) setItemIdx((i) => i + 1);
    else if (storyIdx < queue.length - 1) {
      setStoryIdx((i) => i + 1);
      setItemIdx(0);
    } else close();
  }, [story, itemIdx, storyIdx, queue.length, close]);

  const goPrev = useCallback(() => {
    if (itemIdx > 0) setItemIdx((i) => i - 1);
    else if (storyIdx > 0) {
      const prev = queue[storyIdx - 1];
      setStoryIdx((i) => i - 1);
      setItemIdx(prev.items.length - 1);
    } else {
      cancelAnimation(progress);
      progress.set(0);
      setRestartTick((n) => n + 1);
    }
  }, [itemIdx, storyIdx, queue, progress]);

  // ── Progress timer (UI thread) ─────────────────────────────────────────────

  const run = useCallback(() => {
    const remaining = Math.max(60, (1 - progress.get()) * duration);
    progress.set(
      withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(goNext);
      }),
    );
  }, [duration, goNext, progress]);

  // New item: reset, wait for the image (or a short fallback), mark seen.
  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
    const t = setTimeout(() => setReadyFor(itemKey), 1800);
    if (item && story) markSeen(item.id, story.id);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  useEffect(() => {
    if (!ready || isPaused) cancelAnimation(progress);
    else run();
  }, [ready, isPaused, run, progress, restartTick]);

  const setPause = useCallback((reason: PauseReason, value: boolean) => setPaused((p) => (p[reason] === value ? p : { ...p, [reason]: value })), []);

  // ── Gestures ──────────────────────────────────────────────────────────────
  const scale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const dragY = useSharedValue(0);

  const tap = Gesture.Tap()
    .maxDuration(240)
    .maxDistance(14)
    .runOnJS(true)
    .onEnd((e, ok) => {
      if (!ok) return;
      if (e.x < width * 0.3) goPrev();
      else goNext();
    });

  const hold = Gesture.LongPress()
    .minDuration(250)
    .maxDistance(30)
    .runOnJS(true)
    .onStart(() => setPause('hold', true))
    .onFinalize(() => setPause('hold', false));

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.set(e.focalX);
      focalY.set(e.focalY);
      scheduleOnRN(setPause, 'pinch' as PauseReason, true);
    })
    .onUpdate((e) => {
      scale.set(Math.min(4, Math.max(1, e.scale)));
    })
    .onFinalize(() => {
      scale.set(withSpring(1, { damping: 18, stiffness: 180 }));
      scheduleOnRN(setPause, 'pinch' as PauseReason, false);
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetY(18)
    .failOffsetX([-24, 24])
    .onStart(() => scheduleOnRN(setPause, 'pan' as PauseReason, true))
    .onUpdate((e) => {
      dragY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > 140 || e.velocityY > 900) {
        scheduleOnRN(close);
      } else {
        dragY.set(withSpring(0, { damping: 20 }));
      }
    })
    .onFinalize(() => scheduleOnRN(setPause, 'pan' as PauseReason, false));

  const gesture = Gesture.Simultaneous(pinch, Gesture.Race(pan, hold, tap));

  const imageStyle = useAnimatedStyle(() => {
    const s = scale.get();
    return {
      transform: [
        { translateX: (focalX.get() - width / 2) * (1 - s) },
        { translateY: (focalY.get() - height / 2) * (1 - s) },
        { scale: s },
      ],
    };
  });
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }, { scale: 1 - Math.min(dragY.get() / 2000, 0.08) }],
    borderRadius: dragY.get() > 0 ? 24 : 0,
  }));

  const segments = useMemo(() => story?.items ?? [], [story]);

  if (!story || !item) return null;

  const chromeHidden = paused.hold || paused.pinch;
  const ownerTitle = story.owner.kind === 'person' ? author?.displayName : story.title;
  // Stories deep-link into the persistent object they belong to.
  const leaveTo = (href: Href) => {
    close();
    setTimeout(() => router.push(href), 260);
  };
  const cta = board
    ? { label: `View ${board.title} board`, go: () => leaveTo(`/board/${board.id}`) }
    : move
      ? { label: `View ${move.title}`, go: () => leaveTo(`/move/${move.id}`) }
      : author
        ? { label: `View ${author.displayName.split(' ')[0]}’s profile`, go: () => leaveTo(`/profile/${author.id}`) }
        : null;

  const sendReply = () => {
    if (!reply.trim() || !author) return;
    sendMessage(author.id, reply);
    setReply('');
    setToast(`Sent to ${author.displayName.split(' ')[0]}`);
    setTimeout(() => setToast(null), 1600);
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.sheet, sheetStyle]}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
              <Image
                key={item.id}
                source={{ uri: item.image }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
                onLoad={() => setReadyFor(item.id)}
                onError={() => setReadyFor(item.id)}
              />
            </Animated.View>
            <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={[styles.topShade, { height: 150 + insets.top }]} pointerEvents="none" />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={styles.bottomShade} pointerEvents="none" />
          </View>
        </GestureDetector>

        {!chromeHidden ? (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={[styles.top, { paddingTop: fullscreenTop(insets) }]} pointerEvents="box-none">
            <View style={styles.segments}>
              {segments.map((seg, i) => (
                <Segment key={seg.id} state={i < itemIdx ? 'done' : i === itemIdx ? 'active' : 'todo'} progress={progress} />
              ))}
            </View>
            <View style={styles.header}>
              <Tap onPress={() => cta?.go()} scaleTo={0.97} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Avatar uri={story.owner.kind === 'person' ? author?.avatar : story.cover} name={ownerTitle} size={40} ring="rgba(255,255,255,0.9)" ringWidth={2} />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <T v="bodyStrong" color={colors.white} numberOfLines={1} style={styles.shadow}>
                    {ownerTitle}
                  </T>
                  <T v="footnote" color="rgba(255,255,255,0.85)" numberOfLines={1} style={styles.shadow}>
                    {story.owner.kind === 'person' ? `${item.createdAt} · ${board?.title ?? ''}` : `by ${author?.displayName} · ${item.createdAt}`}
                  </T>
                </View>
              </Tap>
              <Tap onPress={close} accessibilityLabel="Close story" style={styles.close}>
                <X size={26} color={colors.white} strokeWidth={2.4} />
              </Tap>
            </View>
          </Animated.View>
        ) : null}

        {!chromeHidden ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomWrap} pointerEvents="box-none">
            <Animated.View entering={FadeIn.duration(150)} style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 14) }]}>
              <T v="title2" color={colors.white} style={[styles.shadow, { fontSize: 25, lineHeight: 31 }]}>
                {item.caption}
              </T>
              {item.location ? (
                <View style={styles.location}>
                  <MapPin size={14} color={colors.white} />
                  <T v="footnote" color={colors.white} weight="600" style={{ marginLeft: 5 }}>
                    {item.location}
                  </T>
                </View>
              ) : null}
              {cta ? (
                <Tap onPress={cta.go} haptic="light" style={styles.cta}>
                  <T v="footnote" weight="800" style={{ letterSpacing: 1 }}>
                    {cta.label.toUpperCase()}
                  </T>
                  <ArrowRight size={16} color={colors.ink} strokeWidth={2.6} style={{ marginLeft: 8 }} />
                </Tap>
              ) : null}
              <View style={styles.replyRow}>
                <View style={styles.replyInput}>
                  <TextInput
                    value={reply}
                    onChangeText={setReply}
                    onFocus={() => setPause('input', true)}
                    onBlur={() => setPause('input', false)}
                    onSubmitEditing={sendReply}
                    placeholder={`Reply to ${author?.displayName.split(' ')[0] ?? 'story'}…`}
                    placeholderTextColor="rgba(255,255,255,0.7)"
                    returnKeyType="send"
                    style={styles.replyText}
                  />
                  {reply.trim() ? (
                    <Tap onPress={sendReply} accessibilityLabel="Send reply" style={styles.send}>
                      <Send size={18} color={colors.white} />
                    </Tap>
                  ) : null}
                </View>
                <Tap onPress={() => toggleLike(item.id)} haptic="medium" accessibilityLabel={liked ? 'Unlike story' : 'Like story'} style={styles.react}>
                  <Heart size={26} color={liked ? colors.heart : colors.white} fill={liked ? colors.heart : 'transparent'} />
                </Tap>
                <Tap
                  onPress={() => {
                    if (!author) return;
                    sendMessage(author.id, '🔥');
                    setToast('Reaction sent');
                    setTimeout(() => setToast(null), 1400);
                  }}
                  haptic="light"
                  accessibilityLabel="Send fire reaction"
                  style={styles.react}
                >
                  <Flame size={26} color={colors.white} />
                </Tap>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        ) : null}

        {toast ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.toast} pointerEvents="none">
            <T v="footnote" weight="700" color={colors.ink}>
              {toast}
            </T>
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Segment({ state, progress }: { state: 'done' | 'active' | 'todo'; progress: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => ({
    width: `${(state === 'done' ? 1 : state === 'active' ? progress.get() : 0) * 100}%`,
  }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  sheet: { overflow: 'hidden', backgroundColor: '#0b0b0f' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 360 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  segmentFill: { height: 3, backgroundColor: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { paddingHorizontal: 18 },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    marginTop: 16,
    borderRadius: 25,
    backgroundColor: colors.white,
  },
  replyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  replyInput: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
  },
  replyText: { flex: 1, color: colors.white, fontSize: 16, height: 48 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  react: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
  },
});
