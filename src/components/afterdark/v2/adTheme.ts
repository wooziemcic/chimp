/**
 * Phase 7A: After Dark v2's palette — black and plum, Chimp pink. Built on
 * the existing night tokens so After Dark keeps one visual territory.
 */
import { night } from '@/theme';

export const ad = {
  bg: night.bg,
  plum: '#140B18',
  plum2: '#1E1124',
  card: night.surface,
  card2: night.surface2,
  raised: '#2A1A30',
  line: night.line,
  lineStrong: night.lineStrong,
  ink: night.ink,
  muted: night.inkMuted,
  faint: night.inkFaint,
  pink: night.magenta,
  pinkDeep: night.magentaDeep,
  pinkSoft: 'rgba(255,46,136,0.14)',
  pinkLine: 'rgba(255,46,136,0.38)',
  glass: night.glass,
  ok: '#3DDC97',
  okSoft: 'rgba(61,220,151,0.14)',
  warn: '#F5B54A',
  warnSoft: 'rgba(245,181,74,0.14)',
  danger: '#FF5A5F',
} as const;

export const PINK_GRADIENT = ['#FF3D8F', '#C8175E'] as const;
export const PLUM_GRADIENT = ['#1E1124', '#07060A'] as const;
