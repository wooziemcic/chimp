/**
 * Phase 7C: After Dark Discover as opportunities, and "Why you may vibe".
 *
 * Pure functions over what the Discover card already shows (shared Worlds,
 * interests, mutual connections, intent, an Open Loop prompt) plus your own
 * timing and what you've already been shown. Deliberately NOT used:
 *   - your private Crushes (Discover never reorders around them),
 *   - anything the card doesn't already show (no inferred traits),
 *   - any number: no score, no percentage, no "compatibility".
 */
import { INTERESTS } from '@/data/interests';
import type { AdIntent, DiscoverRow } from '@/services/backend/afterDark';
import type { ExposureSnapshot } from '@/store/useExposure';
import type { ActivityEvent } from '@/types/models';

import { INTELLIGENCE, SIGNALS } from './config';
import { combine, confidenceOf, exposurePenalties, type Opportunity } from './signals';
import { momentumFor } from './time';

const label = (id: string) => INTERESTS.find((i) => i.id === id)?.label ?? id.replace(/^i_/, '').replace(/_/g, ' ');

export interface VibeContext {
  myInterests: string[];
  myIntent: AdIntent | null | undefined;
  activity: ActivityEvent[];
  momentum: Record<string, number>;
  exposure: ExposureSnapshot;
  now: number;
}

/** Intent compatibility 0..1 (both visible on the cards, so safe to use). */
export function intentFit(mine: AdIntent | null | undefined, theirs: AdIntent | null | undefined): number {
  if (!mine || !theirs) return 0.3;
  if (mine === theirs) return 1;
  if (mine === 'open' || theirs === 'open') return 0.6;
  if ((mine === 'dating' && theirs === 'serious') || (mine === 'serious' && theirs === 'dating')) return 0.7;
  return 0.2;
}

export function discoverOpportunity(row: DiscoverRow, c: VibeContext): Opportunity {
  const shared = row.interests.filter((i) => c.myInterests.includes(i));
  const fit = intentFit(c.myIntent, row.intent);
  const e = exposurePenalties(c.exposure, `discover:${row.user_id}`, { activity: c.activity, refs: [{ kind: 'person', id: row.user_id }], intent: 0, now: c.now });
  const signals = {
    relevance: Math.min(1, shared.length / 3) * 0.7 + Math.min(1, row.shared_worlds.length / 2) * 0.3,
    relationship: Math.min(1, row.mutual_connections / 2) * 0.6 + Math.min(1, row.shared_worlds.length) * 0.4,
    timing: momentumFor(c.momentum, shared),
    intent: fit,
    actionability: row.prompt ? 1 : 0.5,
    novelty: e.seenBefore ? 0.3 : 1,
    confidence: confidenceOf([shared.length, row.shared_worlds.length, row.mutual_connections, row.intent ? 1 : 0]),
  };
  return combine(signals, SIGNALS.discover, { repetition: e.repetition, saturation: e.saturation });
}

/** Best opportunity first; ties keep the server's order (newest profiles first). */
export function rankDiscover(rows: DiscoverRow[], c: VibeContext): DiscoverRow[] {
  if (!INTELLIGENCE.discover) return rows;
  return rows
    .map((row, idx) => ({ row, idx, o: discoverOpportunity(row, c) }))
    .sort((a, b) => b.o.total - a.o.total || a.idx - b.idx)
    .map((x) => x.row);
}

const SAME_INTENT: Record<AdIntent, string> = {
  dating: 'You’re both open to dating',
  serious: 'You both want something serious',
  casual: 'You’re both up for something casual',
  open: 'You’re both seeing where it goes',
};

/**
 * "Why you may vibe": at most three plain, safe reasons, strongest first.
 * Only things both people can already see on each other's cards. Never a
 * number, never a Crush, never an inference about the person.
 */
export function whyYouMayVibe(row: DiscoverRow, mine: { interests: string[]; intent: AdIntent | null | undefined }): string[] {
  const out: { text: string; w: number }[] = [];
  if (row.shared_worlds.length) out.push({ text: `You’re both in ${row.shared_worlds.slice(0, 2).join(' and ')}`, w: 3 + row.shared_worlds.length });
  const shared = row.interests.filter((i) => mine.interests.includes(i));
  if (shared.length) out.push({ text: `You both like ${shared.slice(0, 3).map(label).join(', ')}`, w: 2 + shared.length });
  if (row.mutual_connections) out.push({ text: `${row.mutual_connections} mutual connection${row.mutual_connections === 1 ? '' : 's'}`, w: 2 + row.mutual_connections });
  if (mine.intent && row.intent && mine.intent === row.intent) out.push({ text: SAME_INTENT[row.intent], w: 2.5 });
  return out.sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.text);
}
