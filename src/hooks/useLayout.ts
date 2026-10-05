import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, navComposerSpace, navScrollSpace } from '@/theme/layout';

import { useKeyboardHeight } from './useKeyboard';

export { keepsBottomNav } from '@/theme/layout';

/** Height of the floating tab bar, excluding the home-indicator inset (Phase 7C: from the shared layout). */
export const TAB_BAR_HEIGHT = layout.navHeight;

/**
 * Bottom padding a primary screen needs so its last item clears the floating
 * bar — the same in normal Chimp and After Dark (Phase 7C: one rule, see theme/layout).
 */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return navScrollSpace(insets.bottom);
}

/**
 * Build 5 patch: space a chat composer leaves below itself for the bar. While
 * the keyboard is up the bar steps aside (0), so the composer sits on the keyboard.
 */
export function useComposerNavSpace(): number {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  return kb > 0 ? 0 : navComposerSpace(insets.bottom);
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
