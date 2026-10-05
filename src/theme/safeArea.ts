/**
 * Phase 8 — the safe-area contract, as pure numbers (no React, unit-tested).
 * Components use them through components/system/SafeArea.tsx and BoardTabs.
 * No device names: everything is derived from the insets the phone reports.
 */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Apple's minimum comfortable tap target. */
export const MIN_TAP = 44;
/** Space between the status bar (or notch / Dynamic Island) and full-screen controls. */
export const FULLSCREEN_GAP = 8;
/** Gap between the safe-area top and a pinned header row (Board tabs). */
export const PIN_GAP = 6;

/** The larger of what we see now and what the phone reported at launch. */
export function resolveDeviceInsets<T extends Insets>(current: T, launch: Insets | undefined | null): Insets {
  return {
    top: Math.max(current.top, launch?.top ?? 0),
    bottom: Math.max(current.bottom, launch?.bottom ?? 0),
    left: Math.max(current.left, launch?.left ?? 0),
    right: Math.max(current.right, launch?.right ?? 0),
  };
}

/** Where full-screen controls start (top of the 44-pt row). */
export function fullscreenTop(insets: Pick<Insets, 'top'>): number {
  return insets.top + FULLSCREEN_GAP;
}

/**
 * Scroll offset at which in-flow tabs (14 pt below their wrapper's top) would
 * reach the pinned position just below the safe area.
 */
export function pinAt(tabsY: number, safeTop: number): number {
  return tabsY + 14 - (safeTop + PIN_GAP);
}
