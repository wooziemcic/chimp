/**
 * Real-time chat (Phase 6B) — the Supabase side.
 *
 * Tables (see supabase/migrations/0002_phase6b.sql): conversations,
 * conversation_members, messages. Only members can read or send (RLS), the
 * sender is always you, blocks stop messages both ways, and people who aren't
 * connected land in each other's Message Requests.
 *
 * Realtime: one channel per signed-in account listens for new rows in
 * `messages` (and member updates). Supabase Realtime applies the same RLS, so
 * you only ever receive messages from your own conversations. No polling.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

const sb = () => supabase();

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw Object.assign(new Error(`${what}: ${res.error.message}`), { code: res.error.code });
  return res.data as T;
}

export type MemberStatus = 'active' | 'request' | 'declined' | 'left';
export type GroupRole = 'owner' | 'admin' | 'member';

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  media_id: string | null;
  message_type: 'text' | 'photo';
  client_id: string | null;
  created_at: string;
  deleted_at: string | null;
  /** 0006: the message this one replies to (same conversation). */
  reply_to?: string | null;
}

export interface ConversationRow {
  conversation_id: string;
  /** Final messaging patch (0006): 'direct' (1:1) or 'group'. */
  kind?: 'direct' | 'group';
  /** 1:1 only (null for groups). */
  other_id: string | null;
  title?: string | null;
  /** Group photo: a Storage path (turned into a URL with mediaUrl). */
  avatar_url?: string | null;
  member_count?: number;
  my_role?: GroupRole;
  my_status: MemberStatus;
  other_status: MemberStatus;
  last_message_id: string | null;
  last_body: string | null;
  last_type: 'text' | 'photo' | null;
  last_sender: string | null;
  last_at: string | null;
  updated_at: string;
  unread: number;
}

/** 'active' (message freely) · 'request' (lands in their Requests) · null (not allowed). */
export async function canMessage(otherId: string): Promise<'active' | 'request' | null> {
  return must(await sb().rpc('can_message', { other: otherId }), 'Checking messaging') as 'active' | 'request' | null;
}

/** Open (or create) your 1:1 conversation with someone. Idempotent. */
export async function startConversation(otherId: string): Promise<string> {
  const res = await sb().rpc('start_direct_conversation', { other: otherId });
  if (res.error) {
    if (/not_allowed/.test(res.error.message)) throw Object.assign(new Error('not_allowed'), { code: 'not_allowed' });
    throw new Error(`Opening chat: ${res.error.message}`);
  }
  return res.data as string;
}

export async function fetchConversations(): Promise<ConversationRow[]> {
  return (must(await sb().rpc('my_conversations'), 'Loading chats') as ConversationRow[] | null) ?? [];
}

/** Newest `limit` messages (returned oldest → newest). */
export async function fetchMessages(conversationId: string, limit = 60): Promise<MessageRow[]> {
  const rows = must(
    await sb().from('messages').select('*').eq('conversation_id', conversationId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit),
    'Loading messages',
  ) as MessageRow[];
  return rows.reverse();
}

/**
 * Send one message. `clientId` makes retries idempotent: if the first attempt
 * actually reached the server, the retry returns that same row (no duplicate).
 */
export async function sendMessage(uid: string, conversationId: string, clientId: string, body: string | null, media?: { id: string } | null, replyTo?: string | null): Promise<MessageRow> {
  const res = await sb()
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: uid, body: body?.trim() || null, media_id: media?.id ?? null, message_type: media ? 'photo' : 'text', client_id: clientId, ...(replyTo ? { reply_to: replyTo } : {}) })
    .select('*')
    .single();
  if (res.error?.code === '23505') {
    const again = await sb().from('messages').select('*').eq('conversation_id', conversationId).eq('sender_id', uid).eq('client_id', clientId).single();
    return must(again, 'Sending') as MessageRow;
  }
  if (res.error && /row-level security|violates row-level/i.test(res.error.message)) {
    throw new Error('You can’t message this person right now.');
  }
  return must(res, 'Sending') as MessageRow;
}

export async function markRead(conversationId: string): Promise<void> {
  must(await sb().rpc('mark_conversation_read', { cid: conversationId }), 'Marking read');
}

export async function respondToRequest(conversationId: string, accept: boolean): Promise<void> {
  must(await sb().rpc('respond_to_request', { cid: conversationId, accept }), accept ? 'Accepting' : 'Declining');
}

/** Media URLs for photo messages. */
export async function mediaUrls(ids: string[]): Promise<Record<string, { url: string; aspect?: number }>> {
  if (!ids.length) return {};
  const { mediaUrl } = await import('@/lib/supabase');
  const rows = must(await sb().from('media').select('id,storage_path,width,height').in('id', ids), 'Loading photos') as { id: string; storage_path: string; width: number | null; height: number | null }[];
  return Object.fromEntries(rows.map((r) => [r.id, { url: mediaUrl(r.storage_path), aspect: r.width && r.height ? r.width / r.height : undefined }]));
}

// ─── Final messaging patch (0006): groups, reactions, Same Brain, Pings, Open Loops ─
// Every write goes through a checked database function (or RLS). Hidden Pings
// are never readable by anyone but their sender: the client only ever gets
// its own, plus the matches everyone in the chat can see.

/** Server messages that are written for people are shown as they are. */
function said<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(res.error.code === '42501' || res.error.code === '22023' ? res.error.message : `${what}: ${res.error.message}`);
  return res.data as T;
}

export const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '😭'] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface MemberRow {
  conversation_id: string;
  user_id: string;
  role: GroupRole;
  status: MemberStatus;
  joined_at: string;
  last_read_at: string;
}
export interface ReactionRow {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}
export interface SameBrainRow {
  id: string;
  message_id: string;
  conversation_id: string;
  emoji: string;
  participants: string[];
  created_at: string;
}
export type PingKind = 'free_tonight' | 'food' | 'hang_out' | 'call' | 'need_advice' | 'thinking_of_you' | 'custom';
export interface PingRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: PingKind;
  custom_text: string | null;
  created_at: string;
  expires_at: string;
  match_id: string | null;
}
export interface PingMatchRow {
  id: string;
  conversation_id: string;
  kinds: PingKind[];
  participants: string[];
  custom_text: string | null;
  created_at: string;
}
export interface LoopRow {
  id: string;
  conversation_id: string;
  source_message_id: string | null;
  created_by: string | null;
  title: string;
  note: string | null;
  status: 'open' | 'resolved';
  target_date: string | null;
  location_text: string | null;
  board_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}
export type LoopPatch = Partial<Pick<LoopRow, 'title' | 'note' | 'status' | 'target_date' | 'location_text' | 'board_id'>>;

export async function createGroup(title: string, memberIds: string[], avatarMediaId?: string | null): Promise<string> {
  return said(await sb().rpc('create_group', { p_title: title, p_members: memberIds, p_avatar_media_id: avatarMediaId ?? null }), 'Creating the group') as string;
}
export async function updateGroup(cid: string, patch: { title?: string; avatarMediaId?: string; clearAvatar?: boolean }): Promise<void> {
  said(await sb().rpc('update_group', { cid, p_title: patch.title ?? null, p_avatar_media_id: patch.avatarMediaId ?? null, p_clear_avatar: !!patch.clearAvatar }), 'Updating the group');
}
export async function addGroupMembers(cid: string, userIds: string[]): Promise<number> {
  return said(await sb().rpc('add_group_members', { cid, p_users: userIds }), 'Adding people') as number;
}
export async function removeGroupMember(cid: string, who: string): Promise<void> {
  said(await sb().rpc('remove_group_member', { cid, who }), 'Removing');
}
export async function setGroupRole(cid: string, who: string, role: 'admin' | 'member'): Promise<void> {
  said(await sb().rpc('set_group_role', { cid, who, new_role: role }), 'Changing role');
}
export async function leaveGroup(cid: string): Promise<void> {
  said(await sb().rpc('leave_group', { cid }), 'Leaving');
}
export async function deleteGroup(cid: string): Promise<void> {
  said(await sb().rpc('delete_group', { cid }), 'Deleting the group');
}
export async function fetchMembers(cid: string): Promise<MemberRow[]> {
  return must(await sb().from('conversation_members').select('conversation_id,user_id,role,status,joined_at,last_read_at').eq('conversation_id', cid), 'Loading members') as MemberRow[];
}
/** Unsend: your own message only (RLS "messages unsend"; 0006 blanks its words). */
export async function deleteMessage(id: string): Promise<void> {
  const rows = must(await sb().from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id'), 'Deleting message') as { id: string }[] | null;
  if (!rows?.length) throw new Error('You can only delete your own messages.');
}
export async function fetchReactions(cid: string): Promise<ReactionRow[]> {
  return must(await sb().from('message_reactions').select('*').eq('conversation_id', cid).order('created_at', { ascending: false }).limit(2000), 'Loading reactions') as ReactionRow[];
}
export async function react(messageId: string, emoji: string, on: boolean): Promise<{ same_brain: boolean }> {
  return said(await sb().rpc('react', { p_message_id: messageId, p_emoji: emoji, p_on: on }), 'Reacting') as { same_brain: boolean };
}
export async function fetchSameBrain(cid: string): Promise<SameBrainRow[]> {
  return must(await sb().from('same_brain_events').select('*').eq('conversation_id', cid).order('created_at', { ascending: false }).limit(200), 'Loading Same Brain') as SameBrainRow[];
}
export async function sendPing(cid: string, kind: PingKind, text?: string): Promise<{ status: 'waiting' | 'matched'; match_id?: string }> {
  return said(await sb().rpc('send_ping', { cid, p_kind: kind, p_text: text ?? null }), 'Sending your Ping') as { status: 'waiting' | 'matched'; match_id?: string };
}
/** Only YOUR Pings come back (RLS): nobody's hidden intent is ever readable. */
export async function fetchMyPings(cid: string): Promise<PingRow[]> {
  return must(await sb().from('mutual_pings').select('*').eq('conversation_id', cid).gt('expires_at', new Date().toISOString()), 'Loading your Pings') as PingRow[];
}
export async function cancelPing(id: string): Promise<void> {
  must(await sb().from('mutual_pings').delete().eq('id', id), 'Cancelling');
}
export async function fetchPingMatches(cid: string): Promise<PingMatchRow[]> {
  return must(await sb().from('ping_matches').select('*').eq('conversation_id', cid).order('created_at', { ascending: false }).limit(50), 'Loading matches') as PingMatchRow[];
}
export async function fetchLoops(cid: string): Promise<LoopRow[]> {
  return must(await sb().from('chat_loops').select('*').eq('conversation_id', cid).order('created_at', { ascending: false }), 'Loading Open Loops') as LoopRow[];
}
export async function createLoop(uid: string, cid: string, title: string, sourceMessageId?: string | null, extra?: LoopPatch): Promise<LoopRow> {
  return must(
    await sb().from('chat_loops').insert({ conversation_id: cid, created_by: uid, title: title.trim(), source_message_id: sourceMessageId ?? null, ...(extra ?? {}) }).select('*').single(),
    'Creating the Open Loop',
  ) as LoopRow;
}
export async function updateLoop(id: string, patch: LoopPatch): Promise<LoopRow> {
  const res = await sb().from('chat_loops').update(patch).eq('id', id).select('*').single();
  if (res.error?.code === '42501') throw new Error(res.error.message);
  return must(res, 'Saving the Open Loop') as LoopRow;
}
export async function deleteLoop(id: string): Promise<void> {
  const res = await sb().from('chat_loops').delete().eq('id', id).select('id');
  const rows = must(res, 'Deleting the Open Loop') as { id: string }[];
  if (!rows.length) throw new Error('Only the person who made it (or the group’s owner) can delete it.');
}

/**
 * Live updates inside one open conversation: reactions, Same Brain, Open
 * Loops, revealed Ping matches, member changes. (Realtime applies RLS; DELETE
 * events carry only a random id, so they reveal nothing.)
 */
export function subscribeConversation(
  cid: string,
  h: {
    onReaction: (r: ReactionRow) => void;
    onReactionGone: (id: string) => void;
    onSameBrain: (e: SameBrainRow) => void;
    onLoop: (l: LoopRow) => void;
    onLoopGone: (id: string) => void;
    onMatch: (m: PingMatchRow) => void;
    onMembers: () => void;
  },
): () => void {
  const f = `conversation_id=eq.${cid}`;
  const channel: RealtimeChannel = sb()
    .channel(`conv:${cid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: f }, (p) => h.onReaction(p.new as ReactionRow))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) => h.onReactionGone((p.old as { id: string }).id))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'same_brain_events', filter: f }, (p) => h.onSameBrain(p.new as SameBrainRow))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_loops', filter: f }, (p) => h.onLoop(p.new as LoopRow))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_loops', filter: f }, (p) => h.onLoop(p.new as LoopRow))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_loops' }, (p) => h.onLoopGone((p.old as { id: string }).id))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ping_matches', filter: f }, (p) => h.onMatch(p.new as PingMatchRow))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: f }, () => h.onMembers())
    .subscribe();
  return () => {
    void sb().removeChannel(channel);
  };
}

/**
 * Listen for new messages in any of my conversations (and membership changes,
 * e.g. someone accepting a request). Returns an unsubscribe function.
 */
export function subscribeInbox(uid: string, handlers: { onMessage: (m: MessageRow) => void; onMessageUpdate?: (m: MessageRow) => void; onMembers: () => void; onConversation?: () => void; onStatus?: (s: string) => void }): () => void {
  const channel: RealtimeChannel = sb()
    .channel(`inbox:${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => handlers.onMessage(payload.new as MessageRow))
    // 0006: a deleted (unsent) message, and group renames / photos.
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => handlers.onMessageUpdate?.(payload.new as MessageRow))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, () => handlers.onConversation?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, () => handlers.onMembers())
    .subscribe((status) => handlers.onStatus?.(status));
  return () => {
    void sb().removeChannel(channel);
  };
}
