/**
 * Chimp color tokens.
 * The light system is the default world. After Dark and individual Boards
 * may define their own atmospheres (see BoardTheme) but reuse these roles.
 */
export const colors = {
  // Surfaces
  bg: '#F5F7FB',
  bgSoft: '#EEF2FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F4F8',
  glass: 'rgba(255,255,255,0.86)',

  // Ink
  ink: '#0B0D12',
  ink2: '#2A2F3A',
  inkMuted: '#5E6675',
  inkFaint: '#8C94A3',
  line: '#E6EAF1',
  lineStrong: '#D6DCE6',

  // Accent — electric blue
  accent: '#1D6BFF',
  accentPressed: '#1457D6',
  accentSoft: '#EAF1FF',
  accentGlow: '#D9E6FF',

  // Supporting
  violet: '#8B5CF6',
  violetSoft: '#F1EBFF',
  pink: '#E0465E',
  pinkSoft: '#FCE8EC',
  success: '#12B76A',
  warning: '#F79009',
  danger: '#F04438',
  heart: '#F0384F',

  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(8,10,16,0.55)',
  scrimTop: 'rgba(0,0,0,0.0)',
  scrimBottom: 'rgba(0,0,0,0.72)',
} as const;

/** After Dark: its own visual territory. */
export const night = {
  bg: '#07060A',
  bg2: '#0E0A10',
  surface: '#16101A',
  surface2: '#1E1522',
  line: 'rgba(255,255,255,0.10)',
  lineStrong: 'rgba(255,255,255,0.18)',
  ink: '#FFFFFF',
  inkMuted: 'rgba(255,255,255,0.72)',
  inkFaint: 'rgba(255,255,255,0.48)',
  magenta: '#FF2E88',
  magentaDeep: '#C8175E',
  crimson: '#D6164F',
  glow: 'rgba(255,46,136,0.35)',
  glass: 'rgba(255,255,255,0.06)',
} as const;

export type ColorToken = keyof typeof colors;
