/**
 * Phase 7A: After Dark's deterministic rules, shared by REAL and Demo.
 * The server (0007) is the authority for REAL accounts; the Demo backend uses
 * these to behave the same way. Nothing here scores people.
 */
import type { LoopPatch, LoopRow, PlanState } from '@/services/backend/chat';
import type { AdIntent, VibeRow, VibeStatus } from '@/services/backend/afterDark';

export const INTENTS: { id: AdIntent; label: string }[] = [
  { id: 'dating', label: 'Dating' },
  { id: 'serious', label: 'Something serious' },
  { id: 'casual', label: 'Something casual' },
  { id: 'open', label: 'Seeing where it goes' },
];
export const intentLabel = (i: AdIntent | null | undefined) => INTENTS.find((x) => x.id === i)?.label;

export const END_REASONS: { id: 'not_feeling_it' | 'timing' | 'different' | 'met_someone' | 'other'; label: string }[] = [
  { id: 'not_feeling_it', label: 'Not feeling it' },
  { id: 'timing', label: 'Timing isn’t right' },
  { id: 'different', label: 'Looking for something different' },
  { id: 'met_someone', label: 'Met someone' },
  { id: 'other', label: 'Other' },
];

export const REPORT_REASONS: { id: 'fake' | 'harassment' | 'inappropriate' | 'underage' | 'safety' | 'spam' | 'other'; label: string }[] = [
  { id: 'harassment', label: 'Harassment or pressure' },
  { id: 'inappropriate', label: 'Inappropriate photos or messages' },
  { id: 'fake', label: 'Fake profile' },
  { id: 'underage', label: 'Might be under 18' },
  { id: 'safety', label: 'I feel unsafe' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'other', label: 'Something else' },
];

// ─── Plans (Open Loops with a plan state) ──────────────────────────────────

export const PLAN_LABEL: Record<PlanState, string> = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  paused: 'Paused',
  completed: 'Completed',
  closed: 'Closed',
};

/**
 * The plan rules (mirror of chat_loops_plan_guard in 0007): whoever proposes
 * or changes a plan's details becomes its proposer, and only the OTHER person
 * confirms it. Returns the updated row, or an error message.
 */
export function applyPlanPatch(old: LoopRow, patch: LoopPatch, me: string): { row: LoopRow } | { error: string } {
  const next: LoopRow = { ...old, ...patch };
  if (old.plan_state == null && patch.plan_state === undefined) return { row: next };
  if (patch.plan_state === null && old.plan_state != null) return { error: 'Close the plan instead.' };
  const detail = (k: keyof LoopRow) => patch[k as keyof LoopPatch] !== undefined && patch[k as keyof LoopPatch] !== old[k];
  const changed = detail('plan_at') || detail('title') || detail('location_text') || detail('target_date');
  const want = (patch.plan_state ?? old.plan_state) as PlanState;
  if (old.plan_state === 'closed' || old.plan_state === 'completed') {
    const other = (k: keyof LoopPatch) => patch[k] !== undefined && patch[k] !== old[k];
    if (want !== old.plan_state || changed || other('note') || other('status') || other('board_id')) return { error: 'This plan is finished.' };
    return { row: next };
  }
  // A note or status change isn't a new proposal: the proposer stays the proposer.
  if (!changed && want === old.plan_state) return { row: { ...next, plan_by: old.plan_by } };
  if (want === 'confirmed' && old.plan_state !== 'confirmed') {
    if (old.plan_state !== 'proposed' || old.plan_by === me || changed) return { error: 'The other person confirms a plan.' };
    return { row: { ...next, plan_state: 'confirmed', plan_by: old.plan_by } };
  }
  if (want === 'completed') {
    if (old.plan_state !== 'confirmed') return { error: 'Only a confirmed plan can be completed.' };
    return { row: { ...next, plan_state: 'completed', plan_by: old.plan_by } };
  }
  if (want === 'paused' || want === 'closed') return { row: { ...next, plan_state: want, plan_by: old.plan_by } };
  if (want === 'confirmed' && changed) return { row: { ...next, plan_state: 'proposed', plan_by: me } };
  if (want === 'confirmed') return { row: { ...next, plan_by: old.plan_by } };
  return { row: { ...next, plan_state: 'proposed', plan_by: me } };
}

/** "Fri · 8:30 PM" */
export function planWhen(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// ─── Vibe progression (descriptive, never a score) ─────────────────────────

export type VibeStage = 'Curious' | 'Spark' | 'Building' | 'Strong Vibe';

/** A plain description of where a pair is. No percentages, no "compatibility". */
export function vibeStage(v: Pick<VibeRow, 'status' | 'challenges_completed' | 'plans_confirmed' | 'open_loops' | 'plans_pending' | 'messages_from_me' | 'messages_from_them'>): VibeStage {
  if (v.status === 'pending') return 'Curious';
  const talked = v.messages_from_me > 0 && v.messages_from_them > 0;
  if (v.plans_confirmed > 0 || (talked && v.challenges_completed >= 3 && v.messages_from_me + v.messages_from_them >= 20)) return 'Strong Vibe';
  if (talked && (v.challenges_completed > 0 || v.open_loops > 0 || v.plans_pending > 0)) return 'Building';
  if (talked || v.challenges_completed > 0) return 'Spark';
  return 'Curious';
}

/** Quiet for a while → "Cooling" (shown with Keep it going / Close Vibe). */
export const COOLING_AFTER_MS = 5 * 24 * 3600 * 1000;
export function displayStatus(v: Pick<VibeRow, 'status' | 'updated_at' | 'last_at'>, now: number): VibeStatus | 'cooling' {
  if (v.status !== 'active') return v.status;
  const last = Math.max(Date.parse(v.last_at ?? '') || 0, Date.parse(v.updated_at) || 0);
  return now - last > COOLING_AFTER_MS ? 'cooling' : 'active';
}

/**
 * Momentum, never pressure: one contextual next step for a pair. Never
 * "why haven't you replied", never last-seen.
 */
export function nudge(v: VibeRow, firstName: string): string | undefined {
  if (v.status === 'pending') return v.my_role === 'recipient' ? `${firstName} wants to take it After Dark. Your call.` : `Waiting on ${firstName}. No rush.`;
  if (v.status === 'paused') return v.paused_by_me ? 'You paused this Vibe. Pick it up whenever you like.' : `${firstName} paused this Vibe for now.`;
  if (v.status === 'closed') return 'This Vibe has ended.';
  if (v.challenges_waiting_on_me > 0) return `${firstName} is waiting on your answer.`;
  if (v.plans_pending > 0) return 'A plan is waiting for a yes.';
  if (v.open_loops > 0) return v.open_loops === 1 ? 'Your Open Loop is still open.' : `${v.open_loops} Open Loops still open.`;
  if (v.challenges_completed > 0 && v.plans_confirmed === 0) return 'You’ve played together. Suggest a plan?';
  if (!v.last_at) return 'Say hi, or send a Challenge.';
  return undefined;
}
