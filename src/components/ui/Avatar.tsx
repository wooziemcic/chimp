import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors } from '@/theme';
import type { ImageSrc } from '@/types/models';
import { Img } from './Img';
import { T } from './Text';

interface Props {
  uri?: ImageSrc;
  name?: string;
  size?: number;
  ring?: string;
  ringWidth?: number;
  online?: boolean;
  style?: ViewStyle;
}

/** Photo avatar with a gradient monogram fallback (used for WollyMc). */
export const Avatar = memo(function Avatar({ uri, name = '', size = 40, ring, ringWidth = 2, online, style }: Props) {
  const inner = ring ? size - ringWidth * 2 : size;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        ring ? { backgroundColor: ring } : null,
        style,
      ]}
    >
      {uri ? (
        <Img uri={uri} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
      ) : (
        <LinearGradient
          colors={['#3B82FF', '#1D4ED8', '#8B5CF6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: inner, height: inner, borderRadius: inner / 2, alignItems: 'center', justifyContent: 'center' }}
        >
          <T v="headline" color={colors.white} style={{ fontSize: inner * 0.42, lineHeight: inner * 0.5 }}>
            {name.slice(0, 1).toUpperCase()}
          </T>
        </LinearGradient>
      )}
      {online ? (
        <View
          style={[
            styles.dot,
            { width: size * 0.26, height: size * 0.26, borderRadius: size, right: size * 0.02, bottom: size * 0.02 },
          ]}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: colors.white,
  },
});
