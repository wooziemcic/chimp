/**
 * Phase 6B full-screen media viewer (photos; video later on the same frame).
 *   - pinch to zoom (1–5×), double-tap to zoom in/out, pan while zoomed
 *   - swipe left/right between a post's images (paging disabled while zoomed)
 *   - swipe down (when not zoomed), ✕, or Android Back closes it — once
 *   - original aspect ratio, dark background, minimal caption/author
 * Expo Go compatible: react-native-gesture-handler + reanimated only.
 * Phase 6C: video items play here (expo-video): only the visible one plays,
 * tap pauses, a mute button, a progress bar; swipe down still closes.
 */
import { X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, StyleSheet, useWindowDimensions, View, type ViewToken } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { ChimpVideo } from '@/components/media/ChimpVideo';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type ViewerItem, useMediaViewer } from '@/store/useMediaViewer';

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const SPRING = { damping: 20, stiffness: 220 };

export function MediaViewer() {
  const items = useMediaViewer((s) => s.items);
  const start = useMediaViewer((s) => s.index);
  const meta = useMediaViewer((s) => s.meta);
  const close = useMediaViewer((s) => s.close);
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  // You opened the clip on purpose, so it plays with sound; one tap mutes.
  const [muted, setMuted] = useState(false);
  const list = useRef<FlatList<ViewerItem>>(null);
  const visible = items.length > 0;

  // A new open (or a jump to another image) resets the page and zoom. Done while
  // rendering (React's "adjust state when a prop changes" pattern), not in an effect.
  const openKey = visible ? start : -1;
  const [seenKey, setSeenKey] = useState(openKey);
  if (seenKey !== openKey) {
    setSeenKey(openKey);
    setIndex(start);
    setZoomed(false);
  }
  useEffect(() => {
    if (visible) requestAnimationFrame(() => list.current?.scrollToIndex({ index: start, animated: false }));
  }, [start, visible]);

  // FlatList requires a stable onViewableItemsChanged.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const i = viewableItems[0]?.index;
    if (typeof i === 'number') setIndex(i);
  }, []);

  const frameH = height;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent supportedOrientations={['portrait']}>
      <GestureHandlerRootView style={styles.root}>
        {visible ? (
          <FlatList
            ref={list}
            data={items}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed && items.length > 1}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(it, i) => `${it.uri}#${i}`}
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item, index: i }) =>
              item.video ? (
                <ViewerVideo item={item} width={width} height={frameH} active={i === index} muted={muted} onToggleMute={() => setMuted((m) => !m)} onDismiss={close} />
              ) : (
                <ZoomableImage item={item} width={width} height={frameH} active={i === index} onZoomChange={setZoomed} onDismiss={close} />
              )
            }
          />
        ) : null}
        <SafeAreaView edges={['top', 'bottom']} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.top} pointerEvents="box-none">
            {items.length > 1 ? (
              <View style={styles.count}>
                <T v="caption" weight="700" color="#fff">{`${index + 1} / ${items.length}`}</T>
              </View>
            ) : (
              <View />
            )}
            <Tap onPress={close} style={styles.close} accessibilityLabel="Close">
              <X size={24} color="#fff" />
            </Tap>
          </View>
          <View style={{ flex: 1 }} pointerEvents="none" />
          {meta.caption || meta.authorName ? (
            <View style={styles.meta} pointerEvents="none">
              {meta.caption ? (
                <T v="callout" weight="700" color="#fff" numberOfLines={3}>
                  {meta.caption}
                </T>
              ) : null}
              {meta.authorName ? (
                <T v="footnote" color="rgba(255,255,255,0.7)" style={{ marginTop: 4 }}>
                  {[meta.authorName, meta.context].filter(Boolean).join(' · ')}
                </T>
              ) : null}
            </View>
          ) : null}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A clip in the viewer: plays while visible; a vertical drag closes the viewer, as with photos. */
function ViewerVideo({ item, width, height, active, muted, onToggleMute, onDismiss }: { item: ViewerItem; width: number; height: number; active: boolean; muted: boolean; onToggleMute: () => void; onDismiss: () => void }) {
  const dragY = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .failOffsetX([-14, 14])
    .onUpdate((e) => {
      dragY.set(e.translationY);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 900) scheduleOnRN(onDismiss);
      else dragY.set(withSpring(0, SPRING));
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.get() }], opacity: 1 - Math.min(0.6, Math.abs(dragY.get()) / 500) }));
  const aspect = item.aspect && item.aspect > 0 ? item.aspect : 9 / 16;
  let w = width;
  let h = width / aspect;
  if (h > height) {
    h = height;
    w = height * aspect;
  }
  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ width: w, height: h }, style]}>
          <ChimpVideo uri={item.uri} poster={item.video?.poster} active={active} muted={muted} onToggleMute={onToggleMute} style={{ width: w, height: h }} muteStyle={{ bottom: 14, right: 14 }} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const ZoomableImage = memo(function ZoomableImage({
  item,
  width,
  height,
  active,
  onZoomChange,
  onDismiss,
}: {
  item: ViewerItem;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (z: boolean) => void;
  onDismiss: () => void;
}) {
  // Fit the image inside the screen at its original aspect ratio (from the
  // media row when known, otherwise from the image itself once it loads).
  const [loaded, setLoaded] = useState<number | undefined>(undefined);
  const aspect = item.aspect && item.aspect > 0 ? item.aspect : loaded ?? 1;
  let w = width;
  let h = width / aspect;
  if (h > height) {
    h = height;
    w = height * aspect;
  }

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragY = useSharedValue(0);
  const [zoomed, setZoomedLocal] = useState(false);
  // Leaving this image un-zooms it: the React flag is adjusted while rendering,
  // the UI-thread shared values in the effect below.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setZoomedLocal(false);
  }

  const setZoom = useCallback(
    (z: boolean) => {
      setZoomedLocal(z);
      onZoomChange(z);
    },
    [onZoomChange],
  );

  useEffect(() => {
    if (!active) {
      scale.set(1);
      savedScale.set(1);
      tx.set(0);
      ty.set(0);
    }
  }, [active, scale, savedScale, tx, ty]);

  const bounds = (s: number) => {
    'worklet';
    return { x: Math.max(0, (w * s - width) / 2), y: Math.max(0, (h * s - height) / 2) };
  };
  const clamp = (v: number, m: number) => {
    'worklet';
    return Math.min(m, Math.max(-m, v));
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(MAX_ZOOM, Math.max(0.8, savedScale.get() * e.scale)));
    })
    .onEnd(() => {
      if (scale.get() < 1.05) {
        scale.set(withSpring(1, SPRING));
        tx.set(withSpring(0, SPRING));
        ty.set(withSpring(0, SPRING));
        savedScale.set(1);
        scheduleOnRN(setZoom, false);
      } else {
        savedScale.set(scale.get());
        const b = bounds(scale.get());
        tx.set(withSpring(clamp(tx.get(), b.x), SPRING));
        ty.set(withSpring(clamp(ty.get(), b.y), SPRING));
        scheduleOnRN(setZoom, true);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.get() > 1.05) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedScale.set(1);
        scheduleOnRN(setZoom, false);
      } else {
        const s = DOUBLE_TAP_ZOOM;
        const b = bounds(s);
        scale.set(withTiming(s));
        tx.set(withTiming(clamp((width / 2 - e.x) * (s - 1), b.x)));
        ty.set(withTiming(clamp((height / 2 - e.y) * (s - 1), b.y)));
        savedScale.set(s);
        scheduleOnRN(setZoom, true);
      }
    });

  // Zoomed: pan around the image.
  const panZoomed = Gesture.Pan()
    .enabled(zoomed)
    .onStart(() => {
      startX.set(tx.get());
      startY.set(ty.get());
    })
    .onUpdate((e) => {
      const b = bounds(scale.get());
      tx.set(clamp(startX.get() + e.translationX, b.x + 40));
      ty.set(clamp(startY.get() + e.translationY, b.y + 40));
    })
    .onEnd(() => {
      const b = bounds(scale.get());
      tx.set(withSpring(clamp(tx.get(), b.x), SPRING));
      ty.set(withSpring(clamp(ty.get(), b.y), SPRING));
    });

  // Not zoomed: a vertical drag dismisses (horizontal drags page between images).
  const panDismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-14, 14])
    .failOffsetX([-14, 14])
    .onUpdate((e) => {
      dragY.set(e.translationY);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 900) scheduleOnRN(onDismiss);
      else dragY.set(withSpring(0, SPRING));
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, zoomed ? panZoomed : panDismiss));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() + dragY.get() }, { scale: scale.get() }],
    opacity: 1 - Math.min(0.6, Math.abs(dragY.get()) / 500),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ width: w, height: h }, style]}>
          <Img
            uri={item.uri}
            tint="#000"
            contentFit="contain"
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Photo"
            onLoad={(e) => {
              if (!item.aspect && e.source?.width && e.source?.height) setLoaded(e.source.width / e.source.height);
            }}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 4 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  count: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  meta: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.35)' },
});
