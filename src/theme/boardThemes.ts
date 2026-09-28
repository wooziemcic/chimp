/**
 * Board theme engine.
 *
 * "AI may eventually choose the ingredients. Chimp controls the recipe."
 *
 * A theme is created from a handful of ingredients (mode + one or two
 * colours). The recipe derives every other token and enforces contrast, so no
 * combination of ingredients can produce an unreadable board or an arbitrary
 * layout. Layout is chosen separately from a fixed set of templates.
 */
import type { BoardTheme } from '@/types/models';

// ─── Colour maths (small, dependency-free) ──────────────────────────────────

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function luminance(hex: string): number {
  const c = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Nudge `fg` darker/lighter until it reaches `min` contrast against `bg`. */
function ensureContrast(fg: string, bg: string, min: number): string {
  let out = fg;
  const toward = luminance(bg) > 0.4 ? '#000000' : '#FFFFFF';
  for (let i = 0; i < 12 && contrast(out, bg) < min; i++) out = mix(out, toward, 0.12);
  return out;
}

// ─── Recipe ─────────────────────────────────────────────────────────────────

export interface ThemeIngredients {
  id: string;
  mode: 'light' | 'dark';
  /** Signature colour. */
  primary: string;
  secondary?: string;
  /** Optional tint for the page background; derived from primary otherwise. */
  tint?: string;
  /** Optional glow/highlight for dark themes. */
  accent?: string;
  /** Accent treatment from a closed set. Defaults: neon for dark themes with an accent, else soft. */
  accentStyle?: BoardTheme['accentStyle'];
}

const BASE = {
  light: { page: '#FFFFFF', surface: '#FFFFFF', text: '#0B0D12', muted: '#5E6675' },
  dark: { page: '#07060A', surface: '#16101A', text: '#FFFFFF', muted: '#B9B3BF' },
};

export function createBoardTheme(ing: ThemeIngredients): BoardTheme {
  const base = BASE[ing.mode];
  const tint = ing.tint ?? ing.primary;
  const dark = ing.mode === 'dark';

  const background = dark ? mix(base.page, tint, 0.04) : mix(base.page, tint, 0.035);
  const surface = dark ? mix(base.surface, tint, 0.06) : base.surface;
  // Primary must stay legible as text on the surface (kickers, tab labels).
  const primary = ensureContrast(ing.primary, surface, dark ? 4 : 3.2);
  const onPrimary = contrast('#FFFFFF', primary) >= 3 ? '#FFFFFF' : '#0B0D12';

  return {
    id: ing.id,
    mode: ing.mode,
    background,
    surface,
    surfaceAlt: dark ? mix(surface, primary, 0.12) : mix('#FFFFFF', primary, 0.1),
    primary,
    primarySoft: dark ? alpha(primary, 0.16) : mix('#FFFFFF', primary, 0.13),
    onPrimary,
    secondary: ing.secondary,
    text: base.text,
    mutedText: ensureContrast(base.muted, surface, 4.5),
    line: dark ? 'rgba(255,255,255,0.10)' : mix('#E6EAF1', primary, 0.08),
    gradient: dark ? [alpha(mix(base.page, primary, 0.3), 0.55), base.page] : ['rgba(0,0,0,0.28)', 'rgba(0,0,0,0.55)'],
    accent: ing.accent,
    accentStyle: ing.accentStyle ?? (dark && ing.accent ? 'neon' : 'soft'),
  };
}

// ─── Presets ────────────────────────────────────────────────────────────────

export const BOARD_THEMES = {
  /** Japan Trip — sakura. */
  sakura: createBoardTheme({ id: 'sakura', mode: 'light', primary: '#E0465E', secondary: '#1F2A44' }),
  /** After Dark — neon night. */
  neonNight: createBoardTheme({ id: 'neonNight', mode: 'dark', primary: '#FF2E88', secondary: '#D6164F', accent: '#FF4D9A', tint: '#FF2E88' }),
  /** Evening rooftops — a second dark theme on the standard template. */
  dusk: createBoardTheme({ id: 'dusk', mode: 'dark', primary: '#F59E0B', secondary: '#8B5CF6', tint: '#312E81' }),
  electric: createBoardTheme({ id: 'electric', mode: 'light', primary: '#1D6BFF' }),
  graphite: createBoardTheme({ id: 'graphite', mode: 'light', primary: '#111318', tint: '#6B7280', accentStyle: 'ink' }),
  ember: createBoardTheme({ id: 'ember', mode: 'light', primary: '#E4572E' }),
  citrus: createBoardTheme({ id: 'citrus', mode: 'light', primary: '#F08A24' }),
  violet: createBoardTheme({ id: 'violet', mode: 'light', primary: '#8B5CF6' }),
  jade: createBoardTheme({ id: 'jade', mode: 'light', primary: '#0F9D8A' }),
  sunlight: createBoardTheme({ id: 'sunlight', mode: 'light', primary: '#D99A00' }),
  terracotta: createBoardTheme({ id: 'terracotta', mode: 'light', primary: '#C2410C' }),
  lagoon: createBoardTheme({ id: 'lagoon', mode: 'light', primary: '#0EA5E9' }),
  brass: createBoardTheme({ id: 'brass', mode: 'light', primary: '#A16207' }),
} satisfies Record<string, BoardTheme>;

export type BoardThemeId = keyof typeof BOARD_THEMES;

/** Resolve a theme id; unknown ids fall back to a neutral preset, never a crash. */
export function getBoardTheme(id: string): BoardTheme {
  return (BOARD_THEMES as Record<string, BoardTheme>)[id] ?? BOARD_THEMES.electric;
}

/**
 * Example of how a future user-created board gets a theme without new code:
 *   createBoardTheme({ id: 'kathmandu', mode: 'light', primary: '#B91C1C', secondary: '#1D4ED8' })
 */
