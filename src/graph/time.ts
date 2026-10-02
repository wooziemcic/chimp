/**
 * Phase 7C: time as a signal.
 *
 * Affinity (config AFFINITY) is static interest: it moves with what you do
 * and never decays. This module answers a different question — "is this
 * becoming relevant NOW?" — from the timestamps of your own actions, each
 * kind with its own half-life (config DECAY). Pure functions, `now` is
 * always passed in, so every result is reproducible in tests.
 */
import type { ActivityEvent, ActivityType, EntityRef } from '@/types/models';

import { DECAY, MOMENTUM } from './config';

const H = 3_600_000;

/** 0.5 ^ (age / half-life); 1 for anything in the future or undated. */
export function decay(ageMs: number, halfLifeHours: number): number {
  if (!(ageMs > 0) || !(halfLifeHours > 0)) return 1;
  return Math.pow(0.5, ageMs / (halfLifeHours * H));
}

export function halfLifeFor(type: ActivityType): number {
  return DECAY.halfLifeHours[type] ?? DECAY.defaultHours;
}

/** Weight of one action now (1 when just done, halving every half-life). Seeded history (at ≤ 0) is 0. */
export function actionWeight(e: ActivityEvent, now: number): number {
  if (!(e.at > 0)) return 0;
  return decay(now - e.at, halfLifeFor(e.type));
}

/**
 * Momentum per interest, 0..1: recent affinity GAINS, each decayed by its
 * action's half-life. A static 0.6 affinity you haven't touched in a month
 * has ~0 momentum; three Japan saves this week have a lot.
 */
export function interestMomentum(activity: ActivityEvent[], now: number): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const e of activity) {
    if (!e.affinity || !(e.at > 0)) continue;
    const w = decay(now - e.at, Math.min(halfLifeFor(e.type), MOMENTUM.maxHalfLifeHours));
    if (w <= 0.001) continue;
    for (const [i, d] of Object.entries(e.affinity)) raw[i] = (raw[i] ?? 0) + d * w;
  }
  const out: Record<string, number> = {};
  for (const [i, v] of Object.entries(raw)) if (v > 0) out[i] = Math.min(1, v / MOMENTUM.full);
  return out;
}

/** Best momentum over a list of interests (primary ones count fully, the rest half). */
export function momentumFor(momentum: Record<string, number>, interests: string[]): number {
  let best = 0;
  interests.forEach((i, idx) => {
    best = Math.max(best, (momentum[i] ?? 0) * (idx < 2 ? 1 : 0.5));
  });
  return best;
}

/**
 * Recent INTENT, 0..1: deliberate actions (save, join, RSVP, open a loop,
 * follow, connect, create) on the thing itself or on its interests.
 * Undo actions cancel (they carry no positive affinity and aren't intent types).
 */
export function intentFor(activity: ActivityEvent[], now: number, target: { refs?: EntityRef[]; interests?: string[] }): number {
  const refs = new Set((target.refs ?? []).map((r) => `${r.kind}:${r.id}`));
  const interests = new Set(target.interests ?? []);
  let sum = 0;
  for (const e of activity) {
    if (!MOMENTUM.intentTypes.includes(e.type)) continue;
    const w = actionWeight(e, now);
    if (w <= 0.001) continue;
    if (refs.has(`${e.ref.kind}:${e.ref.id}`)) sum += w;
    else if (e.affinity && Object.keys(e.affinity).some((i) => interests.has(i))) sum += 0.5 * w;
  }
  return Math.min(1, sum / MOMENTUM.intentFull);
}

/** When you last acted on this thing (ms), or 0. Used to clear repetition / saturation. */
export function lastActionOn(activity: ActivityEvent[], refs: EntityRef[]): number {
  const keys = new Set(refs.map((r) => `${r.kind}:${r.id}`));
  for (const e of activity) if (keys.has(`${e.ref.kind}:${e.ref.id}`) && e.type !== 'open') return e.at; // newest first
  return 0;
}

/** A content item's own timing from its age (0..1). */
export function ageTiming(ageHours: number): number {
  return decay(Math.max(0, ageHours) * H, DECAY.contentHours);
}
