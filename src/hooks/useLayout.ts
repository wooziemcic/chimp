import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the floating tab bar, excluding the home-indicator inset. */
export const TAB_BAR_HEIGHT = 66;
export const TAB_BAR_MARGIN = 10;

/** Bottom padding a tab screen needs so content clears the floating bar. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + TAB_BAR_MARGIN + 16;
}

/**
 * Scale factor relative to the iPhone 12 design width (390pt). Used by the
 * editorial canvases so compositions keep their proportions on other phones.
 */
export function useDesignScale() {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 500);
  return { width: w, s: w / 390 };
}
