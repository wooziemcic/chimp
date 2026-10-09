import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ImageContentFit } from 'expo-image';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { colors } from '@/theme';
import type { ImageSrc } from '@/types/models';

interface Props {
  images: ImageSrc[];
  width: number;
  height: number;
  /** Tap on photo `i` (Buzz: the global media viewer). No tap when omitted. */
  onOpen?: (index: number) => void;
  contentFit?: ImageContentFit;
  /** Image placeholder tint (e.g. black behind a full-screen photo). */
  tint?: string;
  /** Where the page dots sit, from the bottom edge. */
  dotsBottom?: number;
  testID?: string;
}

/**
 * The Buzz photo carousel (moved out of BuzzCard unchanged, so Board and
 * World posts use the very same renderer): one photo is just the photo;
 * several swipe horizontally, one page per photo, with page dots.
 */
export function PhotoCarousel({ images, width, height, onOpen, contentFit, tint, dotsBottom = 10, testID }: Props) {
  const [page, setPage] = useState(0);
  if (!images.length) return null;
  if (images.length === 1) {
    return (
      <Tap onPress={onOpen ? () => onOpen(0) : undefined} disabled={!onOpen} scaleTo={0.995} accessibilityLabel="Open photo" testID={testID}>
        <Img uri={images[0]} style={{ width, height }} contentFit={contentFit} tint={tint} />
      </Tap>
    );
  }
  return (
    <View testID={testID}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        scrollEventThrottle={32}
      >
        {images.map((u, i) => (
          <Tap key={`${String(u)}${i}`} onPress={onOpen ? () => onOpen(i) : undefined} disabled={!onOpen} scaleTo={1} accessibilityLabel={`Photo ${i + 1} of ${images.length}`}>
            <Img uri={u} style={{ width, height }} contentFit={contentFit} tint={tint} />
          </Tap>
        ))}
      </ScrollView>
      <View style={[styles.dots, { bottom: dotsBottom }]} pointerEvents="none">
        {images.map((u, i) => (
          <View key={`d${i}`} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: colors.white, width: 16 },
});
