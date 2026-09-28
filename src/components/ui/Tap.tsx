import * as Haptics from 'expo-haptics';
import { ReactNode } from 'react';
import { Platform, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const APressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale when pressed. 1 disables the effect. */
  scaleTo?: number;
  haptic?: 'light' | 'medium' | 'select' | false;
}

/** Pressable with a restrained spring scale and optional haptic tick. */
export function Tap({ children, style, scaleTo = 0.97, haptic = false, onPressIn, onPressOut, onPress, ...rest }: Props) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <APressable
      accessibilityRole="button"
      hitSlop={6}
      onPressIn={(e) => {
        if (scaleTo !== 1) scale.set(withSpring(scaleTo, { damping: 20, stiffness: 400 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, { damping: 16, stiffness: 300 }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && Platform.OS === 'ios') {
          if (haptic === 'select') Haptics.selectionAsync();
          else Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        onPress?.(e);
      }}
      style={[style, aStyle]}
      {...rest}
    >
      {children}
    </APressable>
  );
}
