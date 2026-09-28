import { Image, ImageProps } from 'expo-image';
import { memo } from 'react';

import { colors } from '@/theme';
import type { ImageSrc } from '@/types/models';

interface Props extends Omit<ImageProps, 'source'> {
  /** Remote URL or bundled asset (require). */
  uri?: ImageSrc;
  tint?: string;
}

/**
 * Cached, fading image. A soft tinted background means cards still read as
 * designed while photos stream in (or if the network is unavailable).
 */
export const Img = memo(function Img({ uri, tint = colors.bgSoft, style, contentFit = 'cover', ...rest }: Props) {
  return (
    <Image
      // Bundled assets are numbers on native (objects on web); pass them through.
      source={uri === undefined || uri === '' ? undefined : typeof uri === 'string' ? { uri } : uri}
      style={[{ backgroundColor: tint }, style]}
      contentFit={contentFit}
      transition={220}
      cachePolicy="memory-disk"
      recyclingKey={typeof uri === 'string' ? uri : undefined}
      {...rest}
    />
  );
});
