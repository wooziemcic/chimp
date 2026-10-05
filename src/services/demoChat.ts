/**
 * Demo messaging (final messaging patch): an in-memory stand-in for the
 * Supabase chat, seeded with the Demo account's fixture people. It follows
 * the same rules as the server (0006): Same Brain thresholds and windows, the
 * Ping compatibility map and group threshold, who may rename/remove/delete.
 * Nothing here is sent anywhere and nothing real is ever read; it resets when
 * the app restarts.
 */
import type { ChatApi } from '@/services/chatApi';
import type { ConversationRow, GroupRole, LoopRow, MemberRow, MemberStatus, MessageRow, PingKind, PingMatchRow, PingRow, ReactionRow, SameBrainRow } from '@/services/backend/chat';
import { ME_ID } from '@/data/users';
import { applyPlanPatch } from '@/utils/afterDark';
import { pingsCompatible } from '@/utils/messaging';

interface Conv {
  id: string;
  /** Phase 7A: 'vibe' = an After Dark Vibe's private chat (never listed in Messages). */
  kind: 'direct' | 'group' | 'vibe';
  title: string | null;
  avatar: string | null;
  created_by: string;
  updated_at: string;
}

const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '😭'];
let seq = 0;
/** Demo photos never leave the phone: media id → local uri (and what kind of file it is). */
const photos = new Map<string, { url: string; aspect?: number; kind?: 'image' | 'audio' }>();
/** Phase 7A: a view-once photo's file is kept off the message (view_once_media in 0007). */
const onceMedia = new Map<string, string>();
const nid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const M = 60 * 1000;

let db: { convs: Conv[]; members: MemberRow[]; messages: MessageRow[]; reactions: ReactionRow[]; brains: SameBrainRow[]; pings: PingRow[]; matches: PingMatchRow[]; loops: LoopRow[] } | null = null;

function seed() {
  const g = 'demo_g_niagara';
  const t0 = Date.now();
  const msg = (id: string, sender: string, body: string, at: number): MessageRow => ({ id, conversation_id: g, sender_id: sender, body, media_id: null, message_type: 'text', client_id: null, created_at: new Date(t0 - at).toISOString(), deleted_at: null });
  const mem = (user_id: string, role: GroupRole): MemberRow => ({ conversation_id: g, user_id, role, status: 'active', joined_at: ago(3 * 24 * 60 * M), last_read_at: ago(0) });
  const messages = [
    msg('dm1', 'u_maya_c', 'Ok who’s actually free Saturday?', 120 * M),
    msg('dm2', 'u_zara', 'Me! Also we should go skiing next month.', 100 * M),
    msg('dm3', 'u_leo', 'Ski trip, yes 🙌', 99 * M),
    msg('dm4', 'u_maya_c', 'Boston dinner Friday still on?', 30 * M),
    msg('dm5', 'u_zara', 'Yes. I’ll book somewhere with dumplings.', 25 * M),
  ];
  const react = (message_id: string, user_id: string, emoji: string, at: number): ReactionRow => ({ id: nid('r'), message_id, conversation_id: g, user_id, emoji, created_at: new Date(t0 - at).toISOString() });
  db = {
    convs: [{ id: g, kind: 'group', title: 'Niagara crew', avatar: null, created_by: ME_ID, updated_at: messages[4].created_at }],
    members: [mem(ME_ID, 'owner'), mem('u_maya_c', 'admin'), mem('u_zara', 'member'), mem('u_leo', 'member')],
    messages,
    reactions: [
      react('dm2', 'u_maya_c', '🔥', 99 * M), react('dm2', 'u_leo', '🔥', 98.5 * M), react('dm2', ME_ID, '🔥', 98.2 * M),
      react('dm5', 'u_maya_c', '👍', 20 * M), react('dm5', 'u_leo', '👍', 12 * M),
    ],
    brains: [{ id: 'sb1', message_id: 'dm2', conversation_id: g, emoji: '🔥', participants: ['u_maya_c', 'u_leo', ME_ID], created_at: new Date(t0 - 98.2 * M).toISOString() }],
    // Hidden intent (never shown; only a match is): Maya and Zara are up for something tonight.
    pings: [
      { id: 'p1', conversation_id: g, sender_id: 'u_maya_c', kind: 'food', custom_text: null, created_at: ago(40 * M), expires_at: new Date(t0 + 20 * 60 * M).toISOString(), match_id: null },
      { id: 'p2', conversation_id: g, sender_id: 'u_zara', kind: 'free_tonight', custom_text: null, created_at: ago(35 * M), expires_at: new Date(t0 + 20 * 60 * M).toISOString(), match_id: null },
    ],
    matches: [],
    loops: [
      { id: 'l1', conversation_id: g, source_message_id: 'dm4', created_by: 'u_maya_c', title: 'Boston dinner', note: 'Friday, somewhere with dumplings', status: 'open', target_date: null, location_text: 'Boston', board_id: null, created_at: ago(28 * M), updated_at: ago(28 * M), resolved_at: null },
      { id: 'l2', conversation_id: g, source_message_id: null, created_by: ME_ID, title: 'Niagara hotel', note: null, status: 'resolved', target_date: null, location_text: 'Niagara Falls', board_id: null, created_at: ago(2 * 24 * 60 * M), updated_at: ago(24 * 60 * M), resolved_at: ago(24 * 60 * M) },
    ],
  };
}
const d = () => {
  if (!db) seed();
  return db!;
};
/** Start the Demo chats over (Settings → Reset demo data, or a fresh Demo). */
export function resetDemoChat() {
  db = null;
  photos.clear();
  onceMedia.clear();
  for (const fn of resetHooks) fn();
}

// ─── Phase 7A: the Demo After Dark backend (services/demoAfterDark.ts) keeps
// its Vibes' chats here, so a Vibe chat runs on exactly the same chat code.
// It decides who may send what in a Vibe (mirror of vibe_can_send in 0007). ──

type VibeGate = (cid: string, what: 'text' | 'photo' | 'voice' | 'other', viewOnce: boolean) => string | null;
let vibeGate: VibeGate = () => 'This Vibe isn’t active.';
const resetHooks = new Set<() => void>();

export const demoChatVibes = {
  /** Who may send what in a Vibe chat: an error message, or null when allowed. */
  setGate(fn: VibeGate) {
    vibeGate = fn;
  },
  /** Called when the Demo chats start over, so the Vibes start over too. */
  onReset(fn: () => void) {
    resetHooks.add(fn);
  },
  addConversation(cid: string, createdBy: string, members: { user_id: string; joined_at: string; last_read_at: string }[], updatedAt: string) {
    if (d().convs.some((c) => c.id === cid)) return;
    d().convs.push({ id: cid, kind: 'vibe', title: null, avatar: null, created_by: createdBy, updated_at: updatedAt });
    d().members.push(...members.map((m) => ({ conversation_id: cid, user_id: m.user_id, role: 'member' as GroupRole, status: 'active' as MemberStatus, joined_at: m.joined_at, last_read_at: m.last_read_at })));
  },
  addMessage(row: MessageRow, media?: { url: string; aspect?: number }) {
    if (media && row.media_id) photos.set(row.media_id, { ...media, kind: row.message_type === 'voice' ? 'audio' : 'image' });
    if (row.view_once && row.media_id) {
      onceMedia.set(row.id, row.media_id);
      row = { ...row, media_id: null };
    }
    d().messages.push(row);
    d().messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const c = conv(row.conversation_id);
    if (c && c.updated_at < row.created_at) c.updated_at = row.created_at;
  },
  addLoop(row: LoopRow) {
    d().loops.unshift(row);
  },
  /** An ended Vibe: its chat is closed for good (messages stay readable, nothing new). */
  messages: (cid: string) => d().messages.filter((m) => m.conversation_id === cid && !m.deleted_at),
  loops: (cids: string[]) => d().loops.filter((l) => cids.includes(l.conversation_id)),
  lastRead: (cid: string, uid = ME_ID) => d().members.find((m) => m.conversation_id === cid && m.user_id === uid)?.last_read_at,
  /** Ending a Vibe closes its open Plans and drops unmatched Pings (end_vibe in 0007). */
  closePlans(cid: string) {
    const now = new Date().toISOString();
    for (const l of d().loops) if (l.conversation_id === cid && l.plan_state && !['closed', 'completed'].includes(l.plan_state)) Object.assign(l, { plan_state: 'closed', updated_at: now });
    d().pings = d().pings.filter((p) => !(p.conversation_id === cid && !p.match_id));
  },
  removeConversation(cid: string) {
    d().convs = d().convs.filter((c) => c.id !== cid);
    d().members = d().members.filter((m) => m.conversation_id !== cid);
    d().messages = d().messages.filter((m) => m.conversation_id !== cid);
    d().loops = d().loops.filter((l) => l.conversation_id !== cid);
  },
};

const role = (cid: string, uid = ME_ID) => d().members.find((m) => m.conversation_id === cid && m.user_id === uid && m.status !== 'left')?.role;
const isMember = (cid: string) => !!role(cid);
const deny = (msg: string) => {
  throw new Error(msg);
};
const conv = (cid: string) => d().convs.find((c) => c.id === cid);
const isVibe = (cid: string) => conv(cid)?.kind === 'vibe';
/** Phase 7A: a Vibe chat only takes part while the Vibe is active (can_participate in 0007). */
const participate = (cid: string, msg: string) => {
  if (!isMember(cid)) deny(msg);
  if (isVibe(cid)) {
    const why = vibeGate(cid, 'other', false);
    if (why) deny(why);
  }
};

export const demoChatApi: ChatApi = {
  demo: true,
  fetchConversations: async () =>
    d()
      .convs.filter((c) => c.kind !== 'vibe' && isMember(c.id))
      .map((c): ConversationRow => {
        const msgs = d().messages.filter((m) => m.conversation_id === c.id && !m.deleted_at);
        const last = msgs[msgs.length - 1];
        const me = d().members.find((m) => m.conversation_id === c.id && m.user_id === ME_ID)!;
        return {
          conversation_id: c.id,
          kind: c.kind as 'direct' | 'group',
          other_id: null,
          title: c.title,
          avatar_url: c.avatar,
          member_count: d().members.filter((m) => m.conversation_id === c.id && m.status !== 'left').length,
          my_role: me.role,
          my_status: me.status,
          other_status: 'active',
          last_message_id: last?.id ?? null,
          last_body: last?.body ?? null,
          last_type: last?.message_type ?? null,
          last_sender: last?.sender_id ?? null,
          last_at: last?.created_at ?? null,
          updated_at: c.updated_at,
          unread: msgs.filter((m) => m.sender_id !== ME_ID && m.created_at > me.last_read_at).length,
        };
      }),
  fetchMessages: async (cid) => d().messages.filter((m) => m.conversation_id === cid && !m.deleted_at),
  sendMessage: async (uid, cid, clientId, body, media, replyTo, extra) => {
    if (!isMember(cid)) deny('You’re not in this chat.');
    const dup = d().messages.find((m) => m.conversation_id === cid && m.client_id === clientId);
    if (dup) return dup;
    const type = media ? extra?.kind ?? 'photo' : 'text';
    const viewOnce = !!extra?.viewOnce;
    if (type === 'voice' && !media) deny('A voice note needs its recording.');
    if (viewOnce && type !== 'photo') deny('Only photos can be view-once.');
    // The file must be my own upload, of the kind the message says (0007's guard).
    if (media && photos.get(media.id)?.kind !== (type === 'voice' ? 'audio' : 'image')) deny('That file can’t be sent as this message.');
    if (isVibe(cid)) {
      const why = vibeGate(cid, type, viewOnce);
      if (why) deny(why);
    } else if (type === 'voice' || viewOnce) deny('Voice notes and view-once photos are only in After Dark.');
    const row: MessageRow = {
      id: nid('m'),
      conversation_id: cid,
      sender_id: uid,
      body: type === 'voice' ? null : body?.trim() || null,
      media_id: viewOnce ? null : media?.id ?? null,
      message_type: type,
      client_id: clientId,
      created_at: new Date().toISOString(),
      deleted_at: null,
      reply_to: replyTo && d().messages.some((m) => m.id === replyTo && m.conversation_id === cid) ? replyTo : null,
      ...(viewOnce ? { view_once: true, viewed_at: null } : {}),
      ...(type === 'voice' && extra?.durationMs != null ? { duration_ms: Math.round(extra.durationMs) } : {}),
    };
    if (viewOnce && media) onceMedia.set(row.id, media.id);
    d().messages.push(row);
    conv(cid)!.updated_at = row.created_at;
    return row;
  },
  markRead: async (cid) => {
    const me = d().members.find((m) => m.conversation_id === cid && m.user_id === ME_ID);
    if (me) me.last_read_at = new Date().toISOString();
  },
  // Phase 8: the same cursor rules as 0011, in memory. Demo people never read
  // or receive anything new on their own, so what you send stays "Sent" —
  // the Demo never pretends someone saw it.
  markReadUpto: async (cid, messageId) => {
    const me = d().members.find((m) => m.conversation_id === cid && m.user_id === ME_ID && m.status !== 'left');
    if (!me) return;
    const msgs = d().messages.filter((m) => m.conversation_id === cid);
    const upto = messageId ? msgs.find((m) => m.id === messageId)?.created_at : msgs.map((m) => m.created_at).sort().pop();
    if (upto && upto > me.last_read_at) me.last_read_at = upto;
  },
  markDelivered: async () => 0,
  fetchReceipts: async (cid) => {
    const c = conv(cid);
    if (!c || c.kind === 'vibe' || !isMember(cid)) return [];
    return d()
      .members.filter((m) => m.conversation_id === cid && (m.user_id === ME_ID || m.status === 'active' || m.status === 'request'))
      .map((m) => {
        const shown = m.user_id === ME_ID || m.status === 'active';
        return { user_id: m.user_id, status: m.status, joined_at: m.joined_at, read_at: shown ? m.last_read_at : null, delivered_at: shown ? m.last_read_at : null };
      });
  },
  respondToRequest: async () => undefined,
  startConversation: async () => deny('Demo 1:1 chats live on each person’s profile.'),
  deleteMessage: async (id) => {
    const m = d().messages.find((x) => x.id === id);
    if (!m || m.sender_id !== ME_ID) deny('You can only delete your own messages.');
    Object.assign(m!, { deleted_at: new Date().toISOString(), body: null, media_id: null });
  },
  mediaUrls: async (ids) => Object.fromEntries(ids.filter((id) => photos.has(id)).map((id) => [id, photos.get(id)!])),
  createGroup: async (title, ids, avatarMediaId) => {
    const others = [...new Set(ids.filter((x) => x && x !== ME_ID))];
    if (!title.trim()) deny('Give the group a name (up to 60 characters).');
    if (others.length < 2) deny('A group needs you and at least 2 other people.');
    const id = nid('demo_g');
    const now = new Date().toISOString();
    d().convs.push({ id, kind: 'group', title: title.trim(), avatar: (avatarMediaId && photos.get(avatarMediaId)?.url) || null, created_by: ME_ID, updated_at: now });
    d().members.push({ conversation_id: id, user_id: ME_ID, role: 'owner', status: 'active', joined_at: now, last_read_at: now }, ...others.map((u) => ({ conversation_id: id, user_id: u, role: 'member' as GroupRole, status: 'active' as MemberStatus, joined_at: now, last_read_at: now })));
    return id;
  },
  updateGroup: async (cid, patch) => {
    if (!['owner', 'admin'].includes(role(cid) ?? '')) deny('Only the group’s owner or an admin can change it.');
    const c = conv(cid)!;
    if (patch.title !== undefined) c.title = patch.title.trim();
    if (patch.clearAvatar) c.avatar = null;
    else if (patch.avatarMediaId) c.avatar = photos.get(patch.avatarMediaId)?.url ?? c.avatar;
  },
  addGroupMembers: async (cid, ids) => {
    if (!['owner', 'admin'].includes(role(cid) ?? '')) deny('Only the group’s owner or an admin can add people.');
    let n = 0;
    for (const u of ids) {
      const cur = d().members.find((m) => m.conversation_id === cid && m.user_id === u);
      if (cur && cur.status !== 'left') continue;
      const now = new Date().toISOString();
      if (cur) Object.assign(cur, { status: 'active', role: 'member', joined_at: now, last_read_at: now });
      else d().members.push({ conversation_id: cid, user_id: u, role: 'member', status: 'active', joined_at: now, last_read_at: now });
      n++;
    }
    return n;
  },
  removeGroupMember: async (cid, who) => {
    const mine = role(cid);
    const theirs = role(cid, who);
    if (!theirs) return;
    if (!(mine === 'owner' || (mine === 'admin' && theirs === 'member'))) deny('Only the group’s owner (or an admin, for members) can remove people.');
    Object.assign(d().members.find((m) => m.conversation_id === cid && m.user_id === who)!, { status: 'left', role: 'member' });
  },
  setGroupRole: async (cid, who, r) => {
    if (role(cid) !== 'owner') deny('Only the owner can change roles.');
    const m = d().members.find((x) => x.conversation_id === cid && x.user_id === who && x.role !== 'owner');
    if (m) m.role = r;
  },
  leaveGroup: async (cid) => {
    const me = d().members.find((m) => m.conversation_id === cid && m.user_id === ME_ID);
    if (!me) return;
    const wasOwner = me.role === 'owner';
    Object.assign(me, { status: 'left', role: 'member' });
    const left = d().members.filter((m) => m.conversation_id === cid && m.status === 'active');
    if (!left.length) d().convs = d().convs.filter((c) => c.id !== cid);
    else if (wasOwner) [...left].sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || a.joined_at.localeCompare(b.joined_at))[0].role = 'owner';
  },
  deleteGroup: async (cid) => {
    if (role(cid) !== 'owner') deny('Only the group’s owner can delete it.');
    d().convs = d().convs.filter((c) => c.id !== cid);
  },
  fetchMembers: async (cid) => d().members.filter((m) => m.conversation_id === cid),
  fetchReactions: async (cid) => d().reactions.filter((r) => r.conversation_id === cid),
  react: async (messageId, emoji, on) => {
    const m = d().messages.find((x) => x.id === messageId);
    if (!m || !isMember(m.conversation_id)) deny('You can’t react here.');
    participate(m!.conversation_id, 'You can’t react here.');
    if (!on) {
      d().reactions = d().reactions.filter((r) => !(r.message_id === messageId && r.user_id === ME_ID && r.emoji === emoji));
      return { same_brain: false };
    }
    if (m!.deleted_at) deny('That message was deleted.');
    if (!REACTIONS.includes(emoji)) deny('Unknown reaction.');
    if (!d().reactions.some((r) => r.message_id === messageId && r.user_id === ME_ID && r.emoji === emoji)) d().reactions.push({ id: nid('r'), message_id: messageId, conversation_id: m!.conversation_id, user_id: ME_ID, emoji, created_at: new Date().toISOString() });
    const group = conv(m!.conversation_id)?.kind === 'group';
    const need = group ? 3 : 2;
    const win = (group ? 90 : 30) * 1000;
    const who = d().reactions.filter((r) => r.message_id === messageId && r.emoji === emoji && Date.now() - Date.parse(r.created_at) <= win).map((r) => r.user_id);
    if (who.length >= need && !d().brains.some((b) => b.message_id === messageId && b.emoji === emoji)) {
      d().brains.push({ id: nid('sb'), message_id: messageId, conversation_id: m!.conversation_id, emoji, participants: who, created_at: new Date().toISOString() });
      return { same_brain: true };
    }
    return { same_brain: false };
  },
  fetchSameBrain: async (cid) => d().brains.filter((b) => b.conversation_id === cid),
  sendPing: async (cid, kind: PingKind, text) => {
    participate(cid, 'You can’t Ping here.');
    const now = Date.now();
    d().pings = d().pings.filter((p) => !(p.conversation_id === cid && ((p.sender_id === ME_ID && !p.match_id) || (!p.match_id && Date.parse(p.expires_at) <= now))));
    const mine: PingRow = { id: nid('p'), conversation_id: cid, sender_id: ME_ID, kind, custom_text: kind === 'custom' ? text?.trim() || null : null, created_at: new Date().toISOString(), expires_at: new Date(now + 24 * 3600 * 1000).toISOString(), match_id: null };
    d().pings.push(mine);
    const chosen: PingRow[] = [];
    for (const p of d().pings.filter((x) => x.conversation_id === cid && x.sender_id !== ME_ID && !x.match_id && Date.parse(x.expires_at) > now && isMember(cid)).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (pingsCompatible(mine.kind, mine.custom_text, p.kind, p.custom_text) && chosen.every((c) => pingsCompatible(c.kind, c.custom_text, p.kind, p.custom_text))) chosen.push(p);
    }
    const need = conv(cid)?.kind === 'group' ? 3 : 2;
    if (chosen.length + 1 < need) return { status: 'waiting' };
    const all = [...chosen, mine];
    const match: PingMatchRow = { id: nid('pm'), conversation_id: cid, kinds: all.map((p) => p.kind), participants: all.map((p) => p.sender_id), custom_text: mine.custom_text, created_at: new Date().toISOString() };
    d().matches.push(match);
    for (const p of all) p.match_id = match.id;
    return { status: 'matched', match_id: match.id };
  },
  // Only my own Pings, exactly like the server's RLS.
  fetchMyPings: async (cid) => d().pings.filter((p) => p.conversation_id === cid && p.sender_id === ME_ID && Date.parse(p.expires_at) > Date.now()),
  cancelPing: async (id) => {
    d().pings = d().pings.filter((p) => !(p.id === id && p.sender_id === ME_ID && !p.match_id));
  },
  fetchPingMatches: async (cid) => d().matches.filter((m) => m.conversation_id === cid).reverse(),
  fetchLoops: async (cid) => d().loops.filter((l) => l.conversation_id === cid),
  createLoop: async (uid, cid, title, sourceMessageId, extra) => {
    participate(cid, 'You’re not in this chat.');
    if (extra?.plan_state != null && !isVibe(cid)) deny('Plans live in After Dark Vibes.');
    const now = new Date().toISOString();
    const row: LoopRow = { id: nid('l'), conversation_id: cid, source_message_id: sourceMessageId ?? null, created_by: uid, title: title.trim(), note: null, status: 'open', target_date: null, location_text: null, board_id: null, ...(extra ?? {}), created_at: now, updated_at: now, resolved_at: null };
    if (row.plan_state != null) Object.assign(row, { plan_state: 'proposed', plan_by: uid });
    d().loops.unshift(row);
    return row;
  },
  updateLoop: async (id, patch) => {
    const l = d().loops.find((x) => x.id === id);
    if (!l || !isMember(l.conversation_id)) deny('Open Loop not found.');
    participate(l!.conversation_id, 'Open Loop not found.');
    if (patch.plan_state != null && !isVibe(l!.conversation_id)) deny('Plans live in After Dark Vibes.');
    const wasOpen = l!.status === 'open';
    const planned = applyPlanPatch(l!, patch, ME_ID);
    if ('error' in planned) deny(planned.error);
    Object.assign(l!, (planned as { row: LoopRow }).row, { updated_at: new Date().toISOString() });
    if (patch.status === 'resolved' && wasOpen) l!.resolved_at = new Date().toISOString();
    if (patch.status === 'open') l!.resolved_at = null;
    return { ...l! };
  },
  deleteLoop: async (id) => {
    const l = d().loops.find((x) => x.id === id);
    if (!l) return;
    if (isVibe(l.conversation_id)) participate(l.conversation_id, 'Open Loop not found.');
    if (l.created_by !== ME_ID && !['owner', 'admin'].includes(role(l.conversation_id) ?? '')) deny('Only the person who made it (or the group’s owner) can delete it.');
    d().loops = d().loops.filter((x) => x.id !== id);
  },
  viewOnceAvailable: async () => true,
  // Phase 7A: open a view-once photo — only its recipient, only once.
  openViewOnce: async (messageId) => {
    const m = d().messages.find((x) => x.id === messageId);
    if (!m || !isMember(m.conversation_id) || !m.view_once) deny('Photo not found.');
    if (m!.sender_id === ME_ID) deny('Only the person you sent it to can open it.');
    const file = onceMedia.get(m!.id);
    if (m!.viewed_at || m!.deleted_at || !file) deny('This photo was already opened.');
    // Only while the Vibe is active and nobody is blocked.
    const why = vibeGate(m!.conversation_id, 'other', false);
    if (why) deny(why);
    const url = photos.get(file!)?.url ?? null;
    photos.delete(file!);
    onceMedia.delete(m!.id);
    Object.assign(m!, { viewed_at: new Date().toISOString() });
    return url;
  },
  uploadAudio: async (_uid, uri) => {
    const id = nid('media');
    photos.set(id, { url: uri, kind: 'audio' });
    return { id, url: uri };
  },
  subscribeInbox: () => () => undefined,
  subscribeConversation: () => () => undefined,
  uploadPhoto: async (_uid, img) => {
    const id = nid('media');
    const p = { url: img.uri, aspect: img.width && img.height ? img.width / img.height : undefined };
    photos.set(id, { ...p, kind: 'image' });
    return { id, ...p };
  },
  avatarUrl: (path) => path ?? undefined,
};
