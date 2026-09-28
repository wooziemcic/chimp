/**
 * Chat state. Not persisted: the backend is the source of truth; this is the
 * live, optimistic view of it.
 *
 *   start(uid, api) → subscribe to Realtime + load my conversations
 *   send            → optimistic bubble (sending) → saved row (sent) | failed → retry
 *   realtime        → new messages appear without refresh; unread counts update
 *   open            → marks the conversation read, loads its reactions, Same
 *                     Brain, Open Loops, Ping matches and members, and listens
 *                     for live changes to them while it's open
 *   stop()          → on sign-out / account switch (nothing leaks between accounts)
 *
 * Final messaging patch: one store, two backends (services/chatApi.ts).
 * REAL accounts use Supabase; the Demo account uses an in-memory seeded
 * stand-in (services/demoChat.ts). Which one is fixed at start(), so REAL
 * and Demo data can never mix. (Demo 1:1 practice chats stay in useChimp.)
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { ConversationRow, GroupRole, LoopPatch, LoopRow, MemberRow, MemberStatus, MessageRow, PingKind, PingMatchRow, PingRow, ReactionRow, SameBrainRow } from '@/services/backend/chat';
import { fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import { discardMediaById, type PickedImage } from '@/services/backend/media';
import { type ChatApi, realChatApi } from '@/services/chatApi';
import { repo } from '@/services/repository';
import type { User } from '@/types/models';
import { onAccountChange } from './useSession';

export interface ChatMsg {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string;
  body?: string;
  mediaId?: string;
  image?: string;
  aspect?: number;
  type: 'text' | 'photo';
  createdAt: string;
  /** The message this one replies to. */
  replyTo?: string;
  /** Local only: optimistic states. */
  status?: 'sending' | 'failed';
  /** Local only: the photo picked for a message that hasn't uploaded yet. */
  localImage?: PickedImage;
}

export interface Conversation {
  id: string;
  kind: 'direct' | 'group';
  /** 1:1 only. */
  otherId?: string;
  /** Groups only. */
  title?: string;
  avatar?: string;
  memberCount: number;
  myRole?: GroupRole;
  myStatus: MemberStatus;
  otherStatus: MemberStatus;
  lastBody?: string;
  lastType?: 'text' | 'photo';
  lastSender?: string;
  lastAt?: string;
  unread: number;
}

/** Everything else that lives inside one conversation. */
export interface ConvExtras {
  members: MemberRow[];
  reactions: ReactionRow[];
  sameBrain: SameBrainRow[];
  loops: LoopRow[];
  matches: PingMatchRow[];
  /** Only MY Pings (nobody else's hidden intent is ever readable). */
  myPings: PingRow[];
  loaded: boolean;
}

export const EMPTY_EXTRAS: ConvExtras = { members: [], reactions: [], sameBrain: [], loops: [], matches: [], myPings: [], loaded: false };

interface ChatState {
  uid?: string;
  demo: boolean;
  conversations: Record<string, Conversation>;
  byPerson: Record<string, string>;
  messages: Record<string, ChatMsg[]>;
  extras: Record<string, ConvExtras>;
  people: Record<string, User>;
  loaded: boolean;
  live: 'off' | 'connecting' | 'live' | 'error';
  activeId?: string;
  error?: string;
  /** A Same Brain that just happened here (plays once; never replays). */
  flash?: { key: string; conversationId: string; messageId: string; emoji: string };
  /** A fresh Ping match to reveal, per conversation (until dismissed). */
  reveal: Record<string, string | undefined>;

  start: (uid: string, api?: ChatApi) => Promise<void>;
  stop: () => void;
  loadConversations: () => Promise<void>;
  /** Resolve (or create) my conversation with a person. Throws 'not_allowed'. */
  conversationWith: (otherId: string) => Promise<string>;
  open: (conversationId: string) => Promise<void>;
  close: (conversationId: string) => void;
  loadExtras: (conversationId: string) => Promise<void>;
  send: (conversationId: string, body: string, image?: PickedImage, replyTo?: string) => Promise<void>;
  retry: (conversationId: string, clientId: string) => Promise<void>;
  respond: (conversationId: string, accept: boolean) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;

  // Groups
  createGroup: (title: string, memberIds: string[], photo?: PickedImage | null) => Promise<string>;
  renameGroup: (conversationId: string, title: string) => Promise<void>;
  setGroupPhoto: (conversationId: string, photo: PickedImage | null) => Promise<void>;
  addMembers: (conversationId: string, userIds: string[]) => Promise<number>;
  removeMember: (conversationId: string, userId: string) => Promise<void>;
  setRole: (conversationId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  deleteGroup: (conversationId: string) => Promise<void>;

  // Reactions + Same Brain
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>;
  clearFlash: () => void;

  // Mutual Ping
  sendPing: (conversationId: string, kind: PingKind, text?: string) => Promise<'waiting' | 'matched'>;
  cancelPing: (conversationId: string, pingId: string) => Promise<void>;
  dismissReveal: (conversationId: string) => void;

  // Open Loops
  createLoop: (conversationId: string, title: string, sourceMessageId?: string | null, extra?: LoopPatch) => Promise<LoopRow>;
  updateLoop: (conversationId: string, loopId: string, patch: LoopPatch) => Promise<LoopRow>;
  deleteLoop: (conversationId: string, loopId: string) => Promise<void>;
}

const EMPTY = {
  conversations: {},
  byPerson: {},
  messages: {},
  extras: {},
  people: {},
  loaded: false,
  live: 'off' as const,
  activeId: undefined,
  error: undefined,
  uid: undefined,
  demo: false,
  flash: undefined,
  reveal: {},
};

let api: ChatApi = realChatApi;
let unsubscribe: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
/** Per-conversation live channels (only while a conversation is open). */
const convSubs = new Map<string, () => void>();
/** Same Brain moments already played on this device (message|emoji). */
const flashed = new Set<string>();
/** Ping matches already revealed / dismissed on this device. */
const dismissedMatches = new Set<string>();

const DAY = 24 * 3600 * 1000;
const SAME_BRAIN_FRESH_MS = 15 * 1000;

const trace = (step: string, extra?: unknown) => {
  if (__DEV__) console.log(`[chimp:chat] ${step}`, extra ? JSON.stringify(extra) : '');
};

function toMsg(r: MessageRow): ChatMsg {
  return {
    id: r.id,
    clientId: r.client_id ?? undefined,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body ?? undefined,
    mediaId: r.media_id ?? undefined,
    type: r.message_type,
    createdAt: r.created_at,
    replyTo: r.reply_to ?? undefined,
  };
}

function toConversation(r: ConversationRow): Conversation {
  const kind = r.kind ?? 'direct';
  return {
    id: r.conversation_id,
    kind,
    otherId: kind === 'direct' ? r.other_id ?? undefined : undefined,
    title: r.title ?? undefined,
    avatar: api.avatarUrl(r.avatar_url),
    memberCount: r.member_count ?? 2,
    myRole: r.my_role,
    myStatus: r.my_status,
    otherStatus: r.other_status ?? 'active',
    lastBody: r.last_body ?? undefined,
    lastType: r.last_type ?? undefined,
    lastSender: r.last_sender ?? undefined,
    lastAt: r.last_at ?? r.updated_at,
    unread: r.unread,
  };
}

const newClientId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const reactionKey = (r: Pick<ReactionRow, 'message_id' | 'user_id' | 'emoji'>) => `${r.message_id}|${r.user_id}|${r.emoji}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useChat = create<ChatState>((set, get) => {
  /** Fill in names/avatars for people who aren't in the loaded world yet. */
  const ensurePeople = async (ids: (string | null | undefined)[]) => {
    if (api.demo) return; // Demo people are all fixtures (repo.user)
    const missing = [...new Set(ids.filter((x): x is string => !!x))].filter((id) => !repo.user(id) && !get().people[id]);
    if (!missing.length) return;
    try {
      const rows = await fetchPeople(missing);
      set({ people: { ...get().people, ...Object.fromEntries(rows.map((p) => [p.id, toUser(p)])) } });
    } catch (e) {
      trace('people failed', String(e));
    }
  };

  /** Attach URLs to photo messages. */
  const hydrateMedia = async (conversationId: string) => {
    const list = get().messages[conversationId] ?? [];
    const need = list.filter((m) => m.mediaId && !m.image).map((m) => m.mediaId!);
    if (!need.length) return;
    try {
      const urls = await api.mediaUrls(need);
      set({
        messages: {
          ...get().messages,
          [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.mediaId && urls[m.mediaId] ? { ...m, image: urls[m.mediaId].url, aspect: urls[m.mediaId].aspect } : m)),
        },
      });
    } catch (e) {
      trace('media failed', String(e));
    }
  };

  const setExtras = (cid: string, patch: Partial<ConvExtras>) => {
    set({ extras: { ...get().extras, [cid]: { ...(get().extras[cid] ?? EMPTY_EXTRAS), ...patch } } });
  };
  const extrasOf = (cid: string) => get().extras[cid] ?? EMPTY_EXTRAS;

  const upsertMessage = (m: ChatMsg) => {
    const list = get().messages[m.conversationId];
    if (!list) return; // not opened yet: the conversation list is enough
    const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId && x.senderId === m.senderId));
    const next = i >= 0 ? list.map((x, k) => (k === i ? { ...x, ...m, status: undefined, localImage: undefined, image: m.image ?? x.image } : x)) : [...list, m];
    next.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    set({ messages: { ...get().messages, [m.conversationId]: next } });
  };

  const removeMessage = (cid: string, id: string) => {
    const list = get().messages[cid];
    if (list) set({ messages: { ...get().messages, [cid]: list.filter((m) => m.id !== id) } });
  };

  const bumpSummary = (m: ChatMsg, countUnread: boolean) => {
    const c = get().conversations[m.conversationId];
    if (!c) return;
    set({
      conversations: {
        ...get().conversations,
        [c.id]: { ...c, lastBody: m.body, lastType: m.type, lastSender: m.senderId, lastAt: m.createdAt, unread: countUnread ? c.unread + 1 : c.unread },
      },
    });
  };

  /** Several Realtime events can land together (e.g. a group rename + a member change): reload once. */
  const reloadSoon = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().loadConversations();
    }, 250);
  };

  const onRealtime = (row: MessageRow) => {
    const uid = get().uid;
    if (!uid) return;
    const m = toMsg(row);
    const known = !!get().conversations[m.conversationId];
    const mine = m.senderId === uid;
    const viewing = get().activeId === m.conversationId && AppState.currentState === 'active';
    trace('realtime message', { conversation: m.conversationId, mine, viewing });
    upsertMessage(m);
    if (!known) {
      void get().loadConversations(); // a new conversation (a Message Request, or I was added to a group) — fetch it
      return;
    }
    bumpSummary(m, !mine && !viewing);
    if (m.mediaId) void hydrateMedia(m.conversationId);
    if (!mine) void ensurePeople([m.senderId]);
    if (!mine && viewing) void api.markRead(m.conversationId).catch(() => {});
  };

  const onMessageUpdate = (row: MessageRow) => {
    if (row.deleted_at) {
      removeMessage(row.conversation_id, row.id);
      reloadSoon(); // the preview may have moved back to an earlier message
    }
  };

  /** Show a Same Brain once, on this device, if it's happening now. */
  const maybeFlash = (e: Pick<SameBrainRow, 'conversation_id' | 'message_id' | 'emoji' | 'created_at'>, force = false) => {
    const key = `${e.message_id}|${e.emoji}`;
    if (flashed.has(key)) return;
    if (!force && (get().activeId !== e.conversation_id || Date.now() - Date.parse(e.created_at) > SAME_BRAIN_FRESH_MS)) {
      flashed.add(key); // old news: never replay it later
      return;
    }
    flashed.add(key);
    set({ flash: { key, conversationId: e.conversation_id, messageId: e.message_id, emoji: e.emoji } });
  };

  /** A new match to reveal (fresh, not dismissed on this device). */
  const noteMatches = (cid: string, matches: PingMatchRow[]) => {
    const fresh = matches.filter((m) => Date.now() - Date.parse(m.created_at) < DAY && !dismissedMatches.has(m.id)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (fresh && get().reveal[cid] !== fresh.id) set({ reveal: { ...get().reveal, [cid]: fresh.id } });
  };

  const refresh = {
    members: async (cid: string) => {
      const members = await api.fetchMembers(cid);
      setExtras(cid, { members });
      void ensurePeople(members.map((m) => m.user_id));
    },
    reactions: async (cid: string) => setExtras(cid, { reactions: await api.fetchReactions(cid) }),
    sameBrain: async (cid: string) => {
      const sameBrain = await api.fetchSameBrain(cid);
      setExtras(cid, { sameBrain });
      return sameBrain;
    },
    loops: async (cid: string) => setExtras(cid, { loops: await api.fetchLoops(cid) }),
    pings: async (cid: string) => {
      const [myPings, matches] = await Promise.all([api.fetchMyPings(cid), api.fetchPingMatches(cid)]);
      setExtras(cid, { myPings, matches });
      noteMatches(cid, matches);
    },
  };

  const subscribeOpen = (cid: string) => {
    if (convSubs.has(cid)) return;
    const unsub = api.subscribeConversation(cid, {
      onReaction: (r) => {
        const ex = extrasOf(cid);
        const rest = ex.reactions.filter((x) => x.id !== r.id && reactionKey(x) !== reactionKey(r));
        setExtras(cid, { reactions: [r, ...rest] });
      },
      onReactionGone: (id) => {
        const ex = get().extras[cid];
        if (ex?.reactions.some((r) => r.id === id)) setExtras(cid, { reactions: ex.reactions.filter((r) => r.id !== id) });
      },
      onSameBrain: (e) => {
        const ex = extrasOf(cid);
        if (!ex.sameBrain.some((x) => x.id === e.id)) setExtras(cid, { sameBrain: [e, ...ex.sameBrain] });
        maybeFlash(e);
      },
      onLoop: (l) => {
        const ex = extrasOf(cid);
        setExtras(cid, { loops: [l, ...ex.loops.filter((x) => x.id !== l.id)] });
      },
      onLoopGone: (id) => {
        const ex = get().extras[cid];
        if (ex?.loops.some((l) => l.id === id)) setExtras(cid, { loops: ex.loops.filter((l) => l.id !== id) });
      },
      onMatch: (m) => {
        const ex = extrasOf(cid);
        if (!ex.matches.some((x) => x.id === m.id)) setExtras(cid, { matches: [m, ...ex.matches] });
        noteMatches(cid, [m]);
        void refresh.pings(cid).catch(() => {}); // my own Ping may be part of it now
      },
      onMembers: () => {
        void refresh.members(cid).catch(() => {});
        reloadSoon();
      },
    });
    convSubs.set(cid, unsub);
  };

  const unsubscribeOpen = (cid: string) => {
    convSubs.get(cid)?.();
    convSubs.delete(cid);
  };

  /** Forget a conversation I'm no longer in (left, removed, deleted). */
  const forget = (cid: string) => {
    unsubscribeOpen(cid);
    const { [cid]: _c, ...conversations } = get().conversations;
    const { [cid]: _m, ...messages } = get().messages;
    const { [cid]: _e, ...extras } = get().extras;
    set({ conversations, messages, extras, activeId: get().activeId === cid ? undefined : get().activeId });
  };

  const deliver = async (conversationId: string, msg: ChatMsg) => {
    const uid = get().uid;
    if (!uid) throw new Error('You’re signed out.');
    let media: { id: string; url: string; aspect?: number } | null = null;
    if (msg.localImage) media = await api.uploadPhoto(uid, msg.localImage);
    const row = await api.sendMessage(uid, conversationId, msg.clientId!, msg.body ?? null, media, msg.replyTo ?? null);
    const sent = { ...toMsg(row), image: media?.url ?? msg.image, aspect: media?.aspect ?? msg.aspect };
    upsertMessage(sent);
    bumpSummary(sent, false);
    const c = get().conversations[conversationId];
    // Replying to a request accepts it (the database does the same).
    if (c && c.myStatus === 'request') set({ conversations: { ...get().conversations, [c.id]: { ...c, myStatus: 'active' } } });
  };

  return {
    ...EMPTY,

    start: async (uid, which = realChatApi) => {
      if (get().uid === uid && unsubscribe && api === which) return;
      get().stop();
      api = which;
      trace('start', { uid, demo: which.demo });
      set({ uid, demo: which.demo, live: which.demo ? 'live' : 'connecting' });
      unsubscribe = api.subscribeInbox(uid, {
        onMessage: onRealtime,
        onMessageUpdate,
        onConversation: reloadSoon,
        onMembers: reloadSoon,
        onStatus: (s) => {
          trace('channel', s);
          if (get().uid !== uid) return;
          set({ live: s === 'SUBSCRIBED' ? 'live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'error' : get().live });
          // (Re)connected: catch up on anything missed while offline.
          if (s === 'SUBSCRIBED') void get().loadConversations();
        },
      });
      // Coming back to the app: catch up once (Realtime may have been paused in the background). No polling.
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state !== 'active' || get().uid !== uid) return;
        void get().loadConversations();
        const active = get().activeId;
        if (active) void get().open(active);
      });
      await get().loadConversations();
    },

    stop: () => {
      unsubscribe?.();
      unsubscribe = null;
      appStateSub?.remove();
      appStateSub = null;
      for (const cid of [...convSubs.keys()]) unsubscribeOpen(cid);
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = null;
      flashed.clear();
      dismissedMatches.clear();
      if (get().uid) trace('stop');
      api = realChatApi;
      set({ ...EMPTY });
    },

    loadConversations: async () => {
      const uid = get().uid;
      if (!uid) return;
      const using = api;
      try {
        const rows = await using.fetchConversations();
        if (get().uid !== uid || api !== using) return;
        const conversations = Object.fromEntries(rows.map((r) => [r.conversation_id, toConversation(r)]));
        // Keep "I'm reading this right now" at 0 unread.
        const active = get().activeId;
        if (active && conversations[active]) conversations[active] = { ...conversations[active], unread: 0 };
        // Conversations I'm no longer in (left / removed / deleted): drop what we had.
        for (const cid of Object.keys(get().conversations)) if (!conversations[cid]) forget(cid);
        const direct = rows.filter((r) => (r.kind ?? 'direct') === 'direct' && r.other_id);
        set({ conversations, byPerson: Object.fromEntries(direct.map((r) => [r.other_id!, r.conversation_id])), loaded: true, error: undefined });
        void ensurePeople([...direct.map((r) => r.other_id), ...rows.map((r) => r.last_sender)]);
      } catch (e) {
        set({ error: errText(e), loaded: true });
      }
    },

    conversationWith: async (otherId) => {
      const known = get().byPerson[otherId];
      if (known) return known;
      const cid = await api.startConversation(otherId);
      if (!get().conversations[cid]) await get().loadConversations();
      return cid;
    },

    open: async (conversationId) => {
      set({ activeId: conversationId });
      const c = get().conversations[conversationId];
      if (c?.unread) set({ conversations: { ...get().conversations, [c.id]: { ...c, unread: 0 } } });
      subscribeOpen(conversationId);
      void get().loadExtras(conversationId);
      try {
        const rows = await api.fetchMessages(conversationId);
        if (get().activeId !== conversationId && get().messages[conversationId]) return;
        // Keep optimistic bubbles that haven't been confirmed yet.
        const pending = (get().messages[conversationId] ?? []).filter((m) => m.status);
        const confirmed = rows.map(toMsg);
        const merged = [...confirmed, ...pending.filter((p) => !confirmed.some((r) => r.clientId && r.clientId === p.clientId))];
        set({ messages: { ...get().messages, [conversationId]: merged } });
        void hydrateMedia(conversationId);
        void ensurePeople(confirmed.map((m) => m.senderId));
        await api.markRead(conversationId);
      } catch (e) {
        set({ error: errText(e) });
      }
    },

    close: (conversationId) => {
      if (get().activeId === conversationId) set({ activeId: undefined });
      unsubscribeOpen(conversationId);
    },

    loadExtras: async (cid) => {
      try {
        const [, , sameBrain] = await Promise.all([refresh.members(cid), refresh.reactions(cid), refresh.sameBrain(cid), refresh.loops(cid), refresh.pings(cid)]);
        for (const e of sameBrain) maybeFlash(e); // only one that is happening right now plays; older ones are marked played
        setExtras(cid, { loaded: true });
      } catch (e) {
        trace('extras failed', String(e));
        setExtras(cid, { loaded: true });
      }
    },

    send: async (conversationId, body, image, replyTo) => {
      const uid = get().uid;
      const text = body.trim();
      if (!uid || (!text && !image)) return;
      const msg: ChatMsg = {
        id: newClientId(),
        clientId: undefined,
        conversationId,
        senderId: uid,
        body: text || undefined,
        type: image ? 'photo' : 'text',
        image: image?.uri,
        aspect: image && image.width && image.height ? image.width / image.height : undefined,
        localImage: image,
        createdAt: new Date().toISOString(),
        replyTo,
        status: 'sending',
      };
      msg.clientId = msg.id;
      set({ messages: { ...get().messages, [conversationId]: [...(get().messages[conversationId] ?? []), msg] } });
      bumpSummary(msg, false);
      try {
        await deliver(conversationId, msg);
      } catch (e) {
        trace('send failed', String(e));
        set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === msg.clientId ? { ...m, status: 'failed' } : m)) } });
      }
    },

    retry: async (conversationId, clientId) => {
      const msg = (get().messages[conversationId] ?? []).find((m) => m.clientId === clientId);
      if (!msg || msg.status !== 'failed') return;
      set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === clientId ? { ...m, status: 'sending' } : m)) } });
      try {
        await deliver(conversationId, msg); // same clientId → never duplicated
      } catch (e) {
        trace('retry failed', String(e));
        set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === clientId ? { ...m, status: 'failed' } : m)) } });
      }
    },

    respond: async (conversationId, accept) => {
      const c = get().conversations[conversationId];
      if (c) set({ conversations: { ...get().conversations, [c.id]: { ...c, myStatus: accept ? 'active' : 'declined' } } });
      try {
        await api.respondToRequest(conversationId, accept);
      } finally {
        await get().loadConversations();
      }
    },

    deleteMessage: async (conversationId, messageId) => {
      const before = get().messages[conversationId] ?? [];
      const msg = before.find((m) => m.id === messageId);
      if (!msg) return;
      if (msg.status) {
        // Never reached the server: just drop the local bubble.
        removeMessage(conversationId, messageId);
        return;
      }
      removeMessage(conversationId, messageId);
      try {
        await api.deleteMessage(messageId);
        await get().loadConversations();
      } catch (e) {
        set({ messages: { ...get().messages, [conversationId]: before } });
        throw e;
      }
    },

    // ── Groups ────────────────────────────────────────────────────────────
    createGroup: async (title, memberIds, photo) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out.');
      let mediaId: string | null = null;
      if (photo) mediaId = (await api.uploadPhoto(uid, photo)).id;
      try {
        const cid = await api.createGroup(title.trim(), memberIds, mediaId);
        await get().loadConversations();
        return cid;
      } catch (e) {
        if (mediaId && !api.demo) void discardMediaById(mediaId).catch(() => {});
        throw e;
      }
    },

    renameGroup: async (cid, title) => {
      await api.updateGroup(cid, { title: title.trim() });
      const c = get().conversations[cid];
      if (c) set({ conversations: { ...get().conversations, [cid]: { ...c, title: title.trim() } } });
      reloadSoon();
    },

    setGroupPhoto: async (cid, photo) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out.');
      if (!photo) {
        await api.updateGroup(cid, { clearAvatar: true });
      } else {
        const up = await api.uploadPhoto(uid, photo);
        try {
          await api.updateGroup(cid, { avatarMediaId: up.id });
        } catch (e) {
          if (!api.demo) void discardMediaById(up.id).catch(() => {});
          throw e;
        }
      }
      await get().loadConversations();
    },

    addMembers: async (cid, userIds) => {
      const n = await api.addGroupMembers(cid, userIds);
      await Promise.all([refresh.members(cid), get().loadConversations()]);
      return n;
    },

    removeMember: async (cid, userId) => {
      await api.removeGroupMember(cid, userId);
      await Promise.all([refresh.members(cid), get().loadConversations()]);
    },

    setRole: async (cid, userId, role) => {
      await api.setGroupRole(cid, userId, role);
      await refresh.members(cid);
    },

    leaveGroup: async (cid) => {
      await api.leaveGroup(cid);
      forget(cid);
      await get().loadConversations();
    },

    deleteGroup: async (cid) => {
      await api.deleteGroup(cid);
      forget(cid);
      await get().loadConversations();
    },

    // ── Reactions + Same Brain ─────────────────────────────────────────────
    toggleReaction: async (cid, messageId, emoji) => {
      const uid = get().uid;
      if (!uid) return;
      const ex = extrasOf(cid);
      const had = ex.reactions.some((r) => r.message_id === messageId && r.user_id === uid && r.emoji === emoji);
      const optimistic: ReactionRow = { id: `tmp_${newClientId()}`, message_id: messageId, conversation_id: cid, user_id: uid, emoji, created_at: new Date().toISOString() };
      setExtras(cid, {
        reactions: had ? ex.reactions.filter((r) => !(r.message_id === messageId && r.user_id === uid && r.emoji === emoji)) : [optimistic, ...ex.reactions],
      });
      try {
        const res = await api.react(messageId, emoji, !had);
        if (res.same_brain) maybeFlash({ conversation_id: cid, message_id: messageId, emoji, created_at: new Date().toISOString() }, true);
        await Promise.all([refresh.reactions(cid), refresh.sameBrain(cid)]);
      } catch (e) {
        await refresh.reactions(cid).catch(() => setExtras(cid, { reactions: ex.reactions }));
        throw e;
      }
    },

    clearFlash: () => set({ flash: undefined }),

    // ── Mutual Ping ────────────────────────────────────────────────────────
    sendPing: async (cid, kind, text) => {
      const res = await api.sendPing(cid, kind, kind === 'custom' ? text?.trim() : undefined);
      await refresh.pings(cid);
      if (res.status === 'matched' && res.match_id && !dismissedMatches.has(res.match_id)) set({ reveal: { ...get().reveal, [cid]: res.match_id } });
      return res.status;
    },

    cancelPing: async (cid, pingId) => {
      await api.cancelPing(pingId);
      await refresh.pings(cid);
    },

    dismissReveal: (cid) => {
      const id = get().reveal[cid];
      if (id) dismissedMatches.add(id);
      set({ reveal: { ...get().reveal, [cid]: undefined } });
    },

    // ── Open Loops ─────────────────────────────────────────────────────────
    createLoop: async (cid, title, sourceMessageId, extra) => {
      const uid = get().uid;
      if (!uid) throw new Error('You’re signed out.');
      const row = await api.createLoop(uid, cid, title, sourceMessageId ?? null, extra);
      setExtras(cid, { loops: [row, ...extrasOf(cid).loops.filter((l) => l.id !== row.id)] });
      return row;
    },

    updateLoop: async (cid, loopId, patch) => {
      const row = await api.updateLoop(loopId, patch);
      setExtras(cid, { loops: extrasOf(cid).loops.map((l) => (l.id === row.id ? row : l)) });
      return row;
    },

    deleteLoop: async (cid, loopId) => {
      await api.deleteLoop(loopId);
      setExtras(cid, { loops: extrasOf(cid).loops.filter((l) => l.id !== loopId) });
    },
  };
});

/** A chat participant: from the loaded world, or fetched for chat. */
export function chatUser(id: string | null | undefined): User | undefined {
  if (!id) return undefined;
  return repo.user(id) ?? useChat.getState().people[id];
}

/** Unread messages in active chats (Message Requests are counted separately). */
export const selectUnread = (s: ChatState) => Object.values(s.conversations).reduce((n, c) => n + (c.myStatus === 'active' ? c.unread : 0), 0);
export const selectRequests = (s: ChatState) => Object.values(s.conversations).filter((c) => c.myStatus === 'request').length;

// Chat is bound to the signed-in account: tear it down on every account change.
onAccountChange(() => useChat.getState().stop());
