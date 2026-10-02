/**
 * Phase 7A — After Dark v2, the Supabase side (see 0007_phase7a_after_dark.sql).
 *
 * Every change to a Vibe goes through a checked database function; the app
 * never writes Vibe rows itself. A Vibe's private chat is an ordinary
 * conversation of kind 'vibe' (messages, reactions, Open Loops and Plans use
 * the chat code in ./chat.ts), which normal Messages never lists.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import type { ChallengeKind } from '@/data/afterDarkChallenges';
import { mediaUrl, supabase } from '@/lib/supabase';
import { backendError } from './errors';
import type { LoopRow } from './chat';

const sb = () => supabase();

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw backendError(res.error, what);
  return res.data as T;
}

export type VibeStatus = 'pending' | 'active' | 'paused' | 'closed';
export type VibeOrigin = 'mutual_crush' | 'open_loop' | 'interest';
export type AdIntent = 'dating' | 'casual' | 'serious' | 'open';
export type EndReason = 'not_feeling_it' | 'timing' | 'different' | 'met_someone' | 'other';
export type ReportReason = 'fake' | 'harassment' | 'inappropriate' | 'underage' | 'safety' | 'spam' | 'other';

export interface AdProfileRow {
  user_id: string;
  discoverable: boolean;
  age: number | null;
  intent: AdIntent | null;
  prompt: string | null;
  photo_paths: string[];
}
export type AdProfilePatch = Partial<Pick<AdProfileRow, 'discoverable' | 'age' | 'intent' | 'prompt' | 'photo_paths'>>;

export interface DiscoverRow {
  user_id: string;
  first_name: string;
  age: number;
  city: string | null;
  interests: string[];
  intent: AdIntent | null;
  prompt: string | null;
  avatar_url: string | null;
  photo_paths: string[];
  shared_worlds: string[];
  mutual_connections: number;
}

export interface VibeRow {
  vibe_id: string;
  conversation_id: string;
  other_id: string;
  status: VibeStatus;
  my_role: 'requester' | 'recipient';
  origin: VibeOrigin;
  origin_text: string | null;
  requested_by_me: boolean;
  paused_by_me: boolean;
  closed_by_me: boolean;
  my_allows_photos: boolean;
  my_allows_voice: boolean;
  their_allows_photos: boolean;
  their_allows_voice: boolean;
  created_at: string;
  updated_at: string;
  last_body: string | null;
  last_type: 'text' | 'photo' | 'voice' | null;
  last_sender: string | null;
  last_at: string | null;
  unread: number;
  challenges_completed: number;
  challenges_waiting_on_me: number;
  challenges_waiting_on_them: number;
  open_loops: number;
  plans_pending: number;
  plans_confirmed: number;
  /** How many messages each of you has sent (for the descriptive stage only). */
  messages_from_me: number;
  messages_from_them: number;
  /** Phase 7B: a request nobody answered in time (closed by the server, not by either of you). */
  expired?: boolean;
}

export interface ChallengeRow {
  id: string;
  vibe_id: string;
  kind: ChallengeKind;
  deck: string;
  sent_by: string | null;
  note: string | null;
  status: 'waiting' | 'completed';
  created_at: string;
  completed_at: string | null;
  /** Phase 7B (Two Truths): the three statements; which is the lie is the sender's answer. */
  statements?: string[] | null;
}

export interface AnswerRow {
  challenge_id: string;
  user_id: string;
  answers: number[];
}

export async function fetchMyAdProfile(uid: string): Promise<AdProfileRow | null> {
  const res = await sb().from('after_dark_profiles').select('user_id,discoverable,age,intent,prompt,photo_paths').eq('user_id', uid).maybeSingle();
  return must(res, 'Loading your After Dark card') as AdProfileRow | null;
}

export async function saveAdProfile(uid: string, patch: AdProfilePatch): Promise<AdProfileRow> {
  const res = await sb().from('after_dark_profiles').upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' }).select('user_id,discoverable,age,intent,prompt,photo_paths').single();
  return must(res, 'Saving your After Dark card') as AdProfileRow;
}

export async function discover(): Promise<DiscoverRow[]> {
  return (must(await sb().rpc('after_dark_discover', { p_limit: 30 }), 'Loading Discover') as DiscoverRow[] | null) ?? [];
}

export async function pass(uid: string, other: string): Promise<void> {
  const res = await sb().from('after_dark_passes').upsert({ from_id: uid, to_id: other }, { onConflict: 'from_id,to_id' });
  must(res, 'Passing');
}

export async function myVibes(): Promise<VibeRow[]> {
  return (must(await sb().rpc('my_vibes'), 'Loading Vibes') as VibeRow[] | null) ?? [];
}

export async function requestVibe(other: string, origin: VibeOrigin, originText?: string | null): Promise<string> {
  return must(await sb().rpc('request_vibe', { p_other: other, p_origin: origin, p_origin_text: originText ?? null }), 'Taking it After Dark') as string;
}
export async function respondVibe(vibeId: string, accept: boolean): Promise<void> {
  must(await sb().rpc('respond_vibe', { p_vibe: vibeId, p_accept: accept }), accept ? 'Accepting' : 'Declining');
}
export async function pauseVibe(vibeId: string): Promise<void> {
  must(await sb().rpc('pause_vibe', { p_vibe: vibeId }), 'Pausing');
}
export async function resumeVibe(vibeId: string): Promise<void> {
  must(await sb().rpc('resume_vibe', { p_vibe: vibeId }), 'Resuming');
}
export async function endVibe(vibeId: string, reason: EndReason | 'blocked', note?: string): Promise<void> {
  must(await sb().rpc('end_vibe', { p_vibe: vibeId, p_reason: reason, p_note: note ?? null }), 'Ending the Vibe');
}
/**
 * Phase 7B patch: may I send this into the Vibe right now? Asks the server
 * (vibe_can_send, the same check the "messages send" policy runs), so a stale
 * screen can't make a photo look sendable. null = couldn't tell (offline):
 * the server still decides when the message is sent.
 */
export async function canSendInVibe(conversationId: string, type: 'photo' | 'voice' | 'text', viewOnce: boolean): Promise<boolean | null> {
  const res = await sb().rpc('vibe_can_send', { cid: conversationId, p_type: type, p_view_once: viewOnce });
  if (res.error) return null;
  return res.data === true;
}
export async function setVibeControls(vibeId: string, photos: boolean | null, voice: boolean | null): Promise<void> {
  must(await sb().rpc('set_vibe_controls', { p_vibe: vibeId, p_photos: photos, p_voice: voice }), 'Saving');
}

export async function fetchChallenges(vibeIds: string[]): Promise<ChallengeRow[]> {
  if (!vibeIds.length) return [];
  return must(await sb().from('vibe_challenges').select('*').in('vibe_id', vibeIds).order('created_at', { ascending: false }).limit(300), 'Loading challenges') as ChallengeRow[];
}
/** Your answers always; theirs only for completed challenges (RLS). */
export async function fetchAnswers(challengeIds: string[]): Promise<AnswerRow[]> {
  if (!challengeIds.length) return [];
  return must(await sb().from('vibe_challenge_answers').select('challenge_id,user_id,answers').in('challenge_id', challengeIds), 'Loading answers') as AnswerRow[];
}
export async function sendChallenge(vibeId: string, kind: ChallengeKind, deck: string, note?: string): Promise<string> {
  return must(await sb().rpc('send_challenge', { p_vibe: vibeId, p_kind: kind, p_deck: deck, p_note: note ?? null }), 'Sending the challenge') as string;
}
/** Phase 7B: Two Truths and a Lie (statements are cleaned and checked on the server). */
export async function sendTwoTruths(vibeId: string, statements: string[], lie: number, note?: string): Promise<string> {
  return must(await sb().rpc('send_two_truths', { p_vibe: vibeId, p_statements: statements, p_lie: lie, p_note: note ?? null }), 'Sending the challenge') as string;
}
export async function answerChallenge(challengeId: string, answers: number[]): Promise<'waiting' | 'completed'> {
  return must(await sb().rpc('answer_challenge', { p_challenge: challengeId, p_answers: answers }), 'Answering') as 'waiting' | 'completed';
}

/** Open Loops and Plans of your Vibes (members-only, RLS). */
export async function fetchVibeLoops(conversationIds: string[]): Promise<LoopRow[]> {
  if (!conversationIds.length) return [];
  return must(await sb().from('chat_loops').select('*').in('conversation_id', conversationIds).order('updated_at', { ascending: false }).limit(300), 'Loading plans') as LoopRow[];
}

export async function report(uid: string, r: { subjectId: string; vibeId?: string; context: 'after_dark_vibe' | 'after_dark_profile'; reason: ReportReason; note?: string }): Promise<void> {
  must(await sb().from('reports').insert({ reporter_id: uid, subject_id: r.subjectId, vibe_id: r.vibeId ?? null, context: r.context, reason: r.reason, note: r.note?.trim() || null }), 'Reporting');
}

export const photoUrl = (path: string | null | undefined) => (path ? (/^https?:|^file:|^blob:|^data:/.test(path) ? path : mediaUrl(path)) : undefined);

/**
 * Live: Vibe state changes (accepted, paused, ended, controls), challenges, and
 * Phase 7B: Open Loops / Plans (inserts and edits; RLS applies). Deletions and
 * anything missed while disconnected come through the account's user_events
 * channel and the reconnect / foreground reconcile (services/live.ts).
 */
export function subscribeAfterDark(uid: string, onChange: () => void, opts?: { onStatus?: (status: string) => void; onLoop?: (conversationId: string) => void }): () => void {
  const loop = (p: { new?: { conversation_id?: string } }) => (opts?.onLoop ? p.new?.conversation_id && opts.onLoop(p.new.conversation_id) : onChange());
  const channel: RealtimeChannel = sb()
    .channel(`afterdark:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vibes' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vibe_challenges' }, () => onChange())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_loops' }, loop)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_loops' }, loop)
    .subscribe((status) => opts?.onStatus?.(status));
  return () => {
    void sb().removeChannel(channel);
  };
}
