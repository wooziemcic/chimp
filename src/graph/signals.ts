/**
 * Phase 7C: decomposed opportunity signals (see config SIGNALS).
 *
 * One combiner for every surface. Each surface builds its own signals from
 * the graph it already has (match parts, relevance parts, World Delta) and
 * this module turns them into one comparable number plus a breakdown that
 * Graph Debug can show. The breakdown is developer-only: people only ever
 * see plain reasons, never a score or a percentage.
 */
import type { ActivityEvent, EntityRef } from '@/types/models';
import type { ExposureSnapshot } from '@/store/useExposure';

import { EXPOSURE, SIGNALS } from './config';
import { decay, lastActionOn } from './time';

export type SignalName = 'relevance' | 'timing' | 'relationship' | 'intent' | 'actionability' | 'novelty' | 'confidence';
export type Signals = Record<SignalName, number>;
export type SignalWeights = Record<SignalName, number>;

export interface Penalties {
  repetition: number;
  saturation: number;
  /** Already in score points (e.g. the capped dislike penalty). */
  extraPoints?: number;
}

export interface Opportunity {
  /** 0..100-ish; only for ordering. */
  total: number;
  signals: Signals;
  penalties: Penalties;
  safe: boolean;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * total = 100 × Σ w·signal − repetition·P.rep − saturation·P.sat − extra.
 * Unsafe items get −Infinity (never ranked; callers also filter them out).
 */
export function combine(signals: Signals, weights: SignalWeights, penalties: Penalties, safe = true): Opportunity {
  const s = Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, clamp01(v)])) as Signals;
  let sum = 0;
  for (const k of Object.keys(weights) as SignalName[]) sum += weights[k] * (s[k] ?? 0);
  const p = { repetition: clamp01(penalties.repetition), saturation: clamp01(penalties.saturation), extraPoints: penalties.extraPoints ?? 0 };
  const total = 100 * sum - SIGNALS.penalties.repetition * p.repetition - SIGNALS.penalties.saturation * p.saturation - p.extraPoints;
  return { total: safe ? Math.round(total * 100) / 100 : -Infinity, signals: s, penalties: p, safe };
}

/**
 * Repetition and saturation for one thing, from the exposure snapshot.
 *  - repetition: seen in an earlier sitting, fading with EXPOSURE.repeatHalfLifeHours.
 *  - saturation: many sittings without acting; strong intent cancels most of it.
 * Acting on it after you last saw it clears both (it was useful, not noise).
 */
export function exposurePenalties(
  exp: ExposureSnapshot,
  key: string,
  opts: { activity: ActivityEvent[]; refs: EntityRef[]; intent: number; now: number },
): { repetition: number; saturation: number; seenBefore: boolean } {
  const e = exp.seen[key];
  if (!e) return { repetition: 0, saturation: 0, seenBefore: false };
  const acted = lastActionOn(opts.activity, opts.refs);
  if (acted >= e.last) return { repetition: 0, saturation: 0, seenBefore: true };
  const repetition = decay(opts.now - e.last, EXPOSURE.repeatHalfLifeHours);
  const raw = clamp01((e.n - EXPOSURE.saturationFrom + 1) / (EXPOSURE.saturationFull - EXPOSURE.saturationFrom + 1));
  const saturation = raw * (1 - SIGNALS.intentRecovery * clamp01(opts.intent));
  return { repetition, saturation, seenBefore: true };
}

/** Share of evidence parts that are non-zero (how much the score rests on). */
export function confidenceOf(parts: number[], needed = 4): number {
  return clamp01(parts.filter((x) => x > 0.05).length / needed);
}

/** "relevance 0.62 · timing 0.40 · … − saturation 0.3" for Graph Debug. */
export function describe(o: Opportunity): string {
  const sig = (Object.entries(o.signals) as [string, number][]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
  const pen = [o.penalties.repetition ? `rep ${o.penalties.repetition.toFixed(2)}` : '', o.penalties.saturation ? `sat ${o.penalties.saturation.toFixed(2)}` : '', o.penalties.extraPoints ? `−${o.penalties.extraPoints}pt` : '']
    .filter(Boolean)
    .join(' · ');
  return `${o.total.toFixed(1)} = ${sig}${pen ? ` − ${pen}` : ''}`;
}
