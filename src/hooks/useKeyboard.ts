import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, type KeyboardEvent, LayoutAnimation, Platform, useWindowDimensions } from 'react-native';

/**
 * Phase 6D: how much of the screen the software keyboard covers, in points
 * (0 when it's hidden). Built on React Native's own Keyboard events, so it
 * runs in Expo Go (no native keyboard library).
 *
 *   iOS      keyboardWillShow/Hide/ChangeFrame: the height arrives before the
 *            keyboard animates, and the layout change is animated with the
 *            keyboard's own curve, so content moves with it (no jump).
 *   Android  keyboardDidShow/Hide. If the window already shrank for the
 *            keyboard (adjustResize), only the part it didn't absorb counts.
 *   Web      visualViewport (mobile browsers), plus a `chimp-keyboard` event
 *            the web test harness uses to simulate an iPhone keyboard.
 *
 * Screens pad their bottom edge by this height, so the keyboard never
 * covers what's being typed or the button that submits it.
 */
export function useKeyboardHeight(): number {
  const { height: windowH } = useWindowDimensions();
  // Already up (e.g. arriving from a screen that was typing): start from it.
  const [raw, setRaw] = useState(() => (Platform.OS === 'web' ? 0 : Math.round(Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0)));
  // Android: the window height while the keyboard was hidden.
  const [baseH, setBaseH] = useState(() => Dimensions.get('window').height);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const vv = window.visualViewport;
      const onViewport = () => {
        if (!vv) return;
        const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
        setRaw(covered > 80 ? covered : 0);
      };
      const onSim = (e: Event) => setRaw(Math.max(0, Number((e as CustomEvent<number>).detail) || 0));
      vv?.addEventListener('resize', onViewport);
      window.addEventListener('chimp-keyboard', onSim);
      return () => {
        vv?.removeEventListener('resize', onViewport);
        window.removeEventListener('chimp-keyboard', onSim);
      };
    }

    const ios = Platform.OS === 'ios';
    const animate = (e: KeyboardEvent) => {
      if (!ios || !e.duration) return;
      try {
        LayoutAnimation.configureNext({ duration: e.duration, update: { duration: e.duration, type: LayoutAnimation.Types.keyboard } });
      } catch {
        /* layout still updates, just without the animation */
      }
    };
    const show = (e: KeyboardEvent) => {
      animate(e);
      // iOS: what the keyboard's final frame covers (0 when it slides off or floats away).
      const covered = ios ? Dimensions.get('screen').height - e.endCoordinates.screenY : e.endCoordinates.height;
      setRaw(Math.max(0, Math.round(covered)));
    };
    const hide = (e: KeyboardEvent) => {
      animate(e);
      setRaw(0);
      if (!ios) setBaseH(Dimensions.get('window').height);
    };
    const subs = ios
      ? [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardWillChangeFrame', show), Keyboard.addListener('keyboardWillHide', hide)]
      : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  if (Platform.OS === 'android' && raw > 0) return Math.max(0, raw - Math.max(0, baseH - windowH));
  return raw;
}
