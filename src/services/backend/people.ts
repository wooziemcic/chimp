/**
 * Phase 7B: people and relationships, fetched when needed rather than only in
 * the big world load.
 *
 *   fetchPerson(id)         one profile by id (a profile route, a new request)
 *   searchPeople(q)         server search (finished profiles, never across a block)
 *   setConnection(id, act)  explicit, idempotent connection intents (0008);
 *                           falls back to Build 4's request_connection when
 *                           0008 isn't on the project yet
 *   fetchRelationships()    the small set of relationship state a phone must
 *                           keep current: connections, requests, Crushes,
 *                           Sparks, blocks, follows
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { backendError, kindOf } from './errors';
import type { ProfileRow } from './mappers';
import { topicSeq } from './realtimeTopic';

const sb = () => supabase();

export async function fetchPerson(id: string): Promise<ProfileRow | null> {
  const res = await sb().from('profiles').select('*').eq('id', id).maybeSingle();
  if (res.error) throw backendError(res.error, 'Loading profile');
  return (res.data as ProfileRow | null) ?? null;
}

export interface PersonHit {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
}
export async function searchPeople(q: string): Promise<PersonHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const res = await sb().rpc('search_people', { p_q: query, p_limit: 20 });
  if (res.error) {
    if (kindOf(res.error) === 'not_found_fn') return []; // 0008 not applied yet: local search only
    throw backendError(res.error, 'Searching people');
  }
  return (res.data as PersonHit[] | null) ?? [];
}

export type ConnectionAction = 'request' | 'accept' | 'decline' | 'cancel' | 'disconnect';
export type ConnectionView = 'none' | 'requested_by_me' | 'requested_of_me' | 'connected';

export async function setConnection(other: string, action: ConnectionAction): Promise<ConnectionView> {
  const res = await sb().rpc('set_connection', { p_other: other, p_action: action });
  if (!res.error) return res.data as ConnectionView;
  if (kindOf(res.error) !== 'not_found_fn') throw backendError(res.error, 'Updating connection');
  // Before 0008: Build 4's toggle (request / accept = on; the rest = off).
  const on = action === 'request' || action === 'accept';
  const old = await sb().rpc('request_connection', { other, on_: on });
  if (old.error) throw backendError(old.error, 'Updating connection');
  const st = old.data as 'none' | 'requested' | 'connected';
  return st === 'connected' ? 'connected' : st === 'requested' ? 'requested_by_me' : 'none';
}

export interface Relationships {
  connected: string[];
  requestedByMe: string[];
  requestedOfMe: string[];
  crushes: string[];
  sparks: string[];
  blocked: string[];
  following: string[];
}

export async function fetchRelationships(uid: string): Promise<Relationships> {
  const [conns, crushes, sparks, blocks, follows] = await Promise.all([
    sb().from('connections').select('user_a,user_b,requested_by,status'),
    sb().from('crushes').select('to_id').eq('from_id', uid),
    sb().rpc('my_sparks'),
    sb().from('blocks').select('blocked_id').eq('blocker_id', uid),
    sb().from('follows').select('followee_id').eq('follower_id', uid),
  ]);
  for (const [r, what] of [
    [conns, 'Loading connections'],
    [crushes, 'Loading Crushes'],
    [sparks, 'Loading Sparks'],
    [blocks, 'Loading blocks'],
    [follows, 'Loading follows'],
  ] as const) {
    if (r.error) throw backendError(r.error, what);
  }
  const rows = (conns.data ?? []) as { user_a: string; user_b: string; requested_by: string; status: string }[];
  const other = (c: { user_a: string; user_b: string }) => (c.user_a === uid ? c.user_b : c.user_a);
  return {
    connected: rows.filter((c) => c.status === 'connected').map(other),
    requestedByMe: rows.filter((c) => c.status === 'requested' && c.requested_by === uid).map(other),
    requestedOfMe: rows.filter((c) => c.status === 'requested' && c.requested_by !== uid).map(other),
    crushes: ((crushes.data ?? []) as { to_id: string }[]).map((r) => r.to_id),
    sparks: (sparks.data ?? []) as string[],
    blocked: ((blocks.data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id),
    following: ((follows.data ?? []) as { followee_id: string }[]).map((r) => r.followee_id),
  };
}

export interface UserEventRow {
  id: string;
  user_id: string;
  kind: string;
  actor_id: string | null;
  ref_id: string | null;
  created_at: string;
  seen_at?: string | null;
}

/** Build 5 patch 2: an in-app social notification (a row of your own user_events). */
export type SocialEventRow = UserEventRow & { seen_at: string | null };

/** Your recent social events, newest first (RLS: only your own rows are readable). */
export async function fetchSocialEvents(kinds: string[], limit = 50): Promise<SocialEventRow[]> {
  const { data, error } = await sb()
    .from('user_events')
    .select('id,user_id,kind,actor_id,ref_id,created_at,seen_at')
    .in('kind', kinds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('events unavailable');
  return (data ?? []) as SocialEventRow[];
}

/** Mark your events seen (0008 mark_events_seen; your own rows only). */
export async function markEventsSeen(): Promise<void> {
  await sb().rpc('mark_events_seen');
}

/**
 * Phase 7B: "something changed for you" — one Realtime channel per account on
 * user_events (rows are only ever the account's own: RLS + a server-side
 * filter). Each event is a nudge to reload a small, specific piece of state;
 * the event itself carries no private content.
 */
export function subscribeUserEvents(uid: string, onEvent: (e: UserEventRow) => void, onStatus: (status: string) => void): () => void {
  const channel: RealtimeChannel = sb()
    .channel(`events:${uid}:${topicSeq()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_events', filter: `user_id=eq.${uid}` }, (p) => onEvent(p.new as UserEventRow))
    .subscribe((status) => onStatus(status));
  return () => {
    void sb().removeChannel(channel);
  };
}
