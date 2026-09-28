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
import { pingsCompatible } from '@/utils/messaging';

interface Conv {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  avatar: string | null;
  created_by: string;
  updated_at: string;
}

const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '😭'];
let seq = 0;
/** Demo photos never leave the phone: media id → local uri. */
const photos = new Map<string, { url: string; aspect?: number }>();
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
}

const role = (cid: string, uid = ME_ID) => d().members.find((m) => m.conversation_id === cid && m.user_id === uid && m.status !== 'left')?.role;
const isMember = (cid: string) => !!role(cid);
const deny = (msg: string) => {
  throw new Error(msg);
};
const conv = (cid: string) => d().convs.find((c) => c.id === cid);

export const demoChatApi: ChatApi = {
  demo: true,
  fetchConversations: async () =>
    d()
      .convs.filter((c) => isMember(c.id))
      .map((c): ConversationRow => {
        const msgs = d().messages.filter((m) => m.conversation_id === c.id && !m.deleted_at);
        const last = msgs[msgs.length - 1];
        const me = d().members.find((m) => m.conversation_id === c.id && m.user_id === ME_ID)!;
        return {
          conversation_id: c.id,
          kind: c.kind,
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
  sendMessage: async (uid, cid, clientId, body, media, replyTo) => {
    if (!isMember(cid)) deny('You’re not in this chat.');
    const dup = d().messages.find((m) => m.conversation_id === cid && m.client_id === clientId);
    if (dup) return dup;
    const row: MessageRow = { id: nid('m'), conversation_id: cid, sender_id: uid, body: body?.trim() || null, media_id: media?.id ?? null, message_type: media ? 'photo' : 'text', client_id: clientId, created_at: new Date().toISOString(), deleted_at: null, reply_to: replyTo && d().messages.some((m) => m.id === replyTo && m.conversation_id === cid) ? replyTo : null };
    d().messages.push(row);
    conv(cid)!.updated_at = row.created_at;
    return row;
  },
  markRead: async (cid) => {
    const me = d().members.find((m) => m.conversation_id === cid && m.user_id === ME_ID);
    if (me) me.last_read_at = new Date().toISOString();
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
    if (!isMember(cid)) deny('You can’t Ping here.');
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
    if (!isMember(cid)) deny('You’re not in this chat.');
    const now = new Date().toISOString();
    const row: LoopRow = { id: nid('l'), conversation_id: cid, source_message_id: sourceMessageId ?? null, created_by: uid, title: title.trim(), note: null, status: 'open', target_date: null, location_text: null, board_id: null, ...(extra ?? {}), created_at: now, updated_at: now, resolved_at: null };
    d().loops.unshift(row);
    return row;
  },
  updateLoop: async (id, patch) => {
    const l = d().loops.find((x) => x.id === id);
    if (!l || !isMember(l.conversation_id)) deny('Open Loop not found.');
    const wasOpen = l!.status === 'open';
    Object.assign(l!, patch, { updated_at: new Date().toISOString() });
    if (patch.status === 'resolved' && wasOpen) l!.resolved_at = new Date().toISOString();
    if (patch.status === 'open') l!.resolved_at = null;
    return { ...l! };
  },
  deleteLoop: async (id) => {
    const l = d().loops.find((x) => x.id === id);
    if (!l) return;
    if (l.created_by !== ME_ID && !['owner', 'admin'].includes(role(l.conversation_id) ?? '')) deny('Only the person who made it (or the group’s owner) can delete it.');
    d().loops = d().loops.filter((x) => x.id !== id);
  },
  subscribeInbox: () => () => undefined,
  subscribeConversation: () => () => undefined,
  uploadPhoto: async (_uid, img) => {
    const id = nid('media');
    const p = { url: img.uri, aspect: img.width && img.height ? img.width / img.height : undefined };
    photos.set(id, p);
    return { id, ...p };
  },
  avatarUrl: (path) => path ?? undefined,
};
