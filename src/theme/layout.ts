/**
 * Phase 7C — the shared Chimp skeleton. One set of layout numbers for every
 * primary screen, light (normal Chimp) and dark (After Dark). Themes change
 * colour and mood; they never change this rhythm.
 *
 *   SAME CHIMP SKELETON. DIFFERENT MODE / MOOD.
 *
 * Built on the base scale in tokens.ts (space / radius / type), so there is
 * still one design system. Screens read these instead of their own numbers.
 */
import { radius, space } from './tokens';

export const layout = {
  /** Left/right gutter of every primary screen (headers, controls, cards). */
  gutter: space.lg, // 16
  /** Space above a screen title (below the safe area). */
  headerTop: space.xs + 2, // 6
  /** Title → its one-line subtitle. */
  headerToSubtitle: space.xs, // 4
  /** Header block → segmented navigation. */
  headerToSegmented: space.md, // 12
  /** Segmented navigation → first content. */
  segmentedToContent: space.md, // 12

  /** Segmented control: one height for Buzz tabs and After Dark tabs. */
  segmentedHeight: 38,
  segmentedPadding: 3,
  segmentedRadius: 22,

  /** Between sections of a screen. */
  sectionGap: space.xl, // 20
  /** Section label → its content. */
  sectionLabelGap: space.sm, // 8

  /** Cards. */
  cardPadding: 14,
  cardRadius: radius.lg, // 20
  /** Cards side by side (two-column rows). */
  compactGap: 10,
  /** Cards stacked vertically. */
  cardGap: 10,

  /** Empty states: compact — a title, one line, one action. */
  emptyPaddingV: space.lg, // 16
  emptyPaddingH: space.lg, // 16

  /** Floating bottom navigation (both modes). */
  navHeight: 64,
  /** Gap between the bar and the screen's bottom edge when there's no home indicator. */
  navMinBottomInset: 10,
  /** Extra room content keeps above the bar so the last item is never under it. */
  navBreathing: 14,
  navRadius: 28,
  navSideMargin: 14,
} as const;

/** Bottom inset of the floating bar itself for a given safe-area bottom. */
export function navBottomInset(safeBottom: number): number {
  return Math.max(safeBottom - 8, layout.navMinBottomInset);
}

/** Scroll padding a primary screen needs so its last item clears the bar. */
export function navScrollSpace(safeBottom: number): number {
  return layout.navHeight + navBottomInset(safeBottom) + layout.navBreathing;
}
