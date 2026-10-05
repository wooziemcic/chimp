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
 *
 * Phase 8 receipts (0011), all in SERVER time:
 *   Seen       mark_read_upto(newest message on screen) — only while the chat is
 *              open AND the app is in the foreground (debounced per chat)
 *   Delivered  mark_delivered() after the inbox syncs or a message arrives live
 *              (only when something new from someone else came in; never on render)
 *   Receipts   chat_receipts(cid) while a chat is open; refreshed when a member's
 *              cursor changes (Realtime), on open, on reconnect / foreground
 *   stop()          → on sign-out / account switch (nothing leaks between accounts)
 *
 * Final messaging patch: one store, two backends (services/chatApi.ts).
 * REAL accounts use Supabase; the Demo account uses an in-memory seeded
 * stand-in (services/demoChat.ts). Which one is fixed at start(), so REAL
 * and Demo data can never mix. (Demo 1:1 practice chats stay in useChimp.)
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { ConversationRow, GroupRole, LoopPatch, LoopRow, MemberChange, MemberRow, MemberStatus, MessageRow, PingKind, PingMatchRow, PingRow, ReactionRow, ReceiptRow, SameBrainRow } from '@/services/backend/chat';
import { fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import { kindOf } from '@/services/backend/errors';
import { discardMediaById, type PickedImage } from '@/services/backend/media';
import { type ChatApi, realChatApi } from '@/services/chatApi';
import { repo } from '@/services/repository';
import type { User } from '@/types/models';
import { onAccountChange } from './useSession';
import { logEvent } from '@/services/analytics';
import { serverMicros } from '@/utils/receipts';

export interface ChatMsg {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string;
  body?: string;
  mediaId?: string;
  image?: string;
  aspect?: number;
  type: 'text' | 'photo' | 'voice';
  createdAt: string;
  /** The message this one replies to. */
  replyTo?: string;
  /** Phase 7A (After Dark): a view-once photo, and when it was opened. */
  viewOnce?: boolean;
  viewedAt?: string;
  /** Phase 7A: a voice note's URL and length. */
  audio?: string;
  durationMs?: number;
  /** Local only: optimistic states. */
  status?: 'sending' | 'failed';
  /**
   * Local only (Phase 7B patch): why a send failed — offline, refused by the
   * server (consent / the Vibe isn't active / a block), or something else.
   */
  failKind?: SendFailKind;
  /** Local only: the file already uploaded for this message (a retry doesn't upload it again). */
  uploaded?: { id: string; url: string; aspect?: number };
  /** Local only: the photo picked for a message that hasn't uploaded yet. */
  localImage?: PickedImage;
  /** Local only: a voice note recorded but not uploaded yet. */
  localAudio?: { uri: string; durationMs: number };
}

export type SendFailKind = 'offline' | 'refused' | 'other';

/** Why a send failed, in three buckets the screens can explain. */
export function sendFailKind(e: unknown): SendFailKind {
  if (kindOf(e) === 'network') return 'offline';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (kindOf(e) === 'denied' || /aren’t taking|can’t message|row-level|isn’t active|has ended|is paused|hasn’t started/i.test(msg)) return 'refused';
  return 'other';
}

/** Phase 7A: how to send (view-once photo, voice note). */
export interface SendOptions {
  viewOnce?: boolean;
  voice?: { uri: string; durationMs: number };
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
  lastType?: 'text' | 'photo' | 'voice';
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
  /**
   * Phase 8: receipts for open conversations (server-filtered). Missing =
   * not loaded yet; null = this server has no receipts (show "Sent" only).
   */
  receipts: Record<string, ReceiptRow[] | null>;

  start: (uid: string, api?: ChatApi) => Promise<void>;
  stop: () => void;
  loadConversations: () => Promise<void>;
  /** Resolve (or create) my conversation with a person. Throws 'not_allowed'. */
  conversationWith: (otherId: string) => Promise<string>;
  open: (conversationId: string) => Promise<void>;
  close: (conversationId: string) => void;
  loadExtras: (conversationId: string) => Promise<void>;
  send: (conversationId: string, body: string, image?: PickedImage, replyTo?: string, opts?: SendOptions) => Promise<void>;
  /** Phase 7A: open a view-once photo you were sent (once). Returns its URL for this one viewing. */
  openViewOnce: (conversationId: string, messageId: string) => Promise<string | null>;
  /** Phase 7B: can view-once photos be sent on this account's server? (null = couldn't tell) */
  viewOnceAvailable: () => Promise<boolean | null>;
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
  receipts: {},
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

/** Phase 8: receipt bookkeeping (all cleared on stop(), so nothing crosses accounts). */
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
const receiptTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Newest "from someone else" time (server µs) per conversation that we've already acknowledged as delivered. */
const deliveredAck = new Map<string, number>();
let deliverTimer: ReturnType<typeof setTimeout> | null = null;
/** status|role|joined per member, to tell a cursor-only change from a real membership change. */
const memberSig = new Map<string, string>();
const READ_DEBOUNCE_MS = 300;
const DELIVER_DEBOUNCE_MS = 600;
const RECEIPTS_DEBOUNCE_MS = 250;

const sigOf = (r: Partial<MemberRow> | undefined) => (r ? `${r.status ?? '?'}|${r.role ?? '?'}|${r.joined_at ?? '?'}` : '');

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
    viewOnce: r.view_once || undefined,
    viewedAt: r.viewed_at ?? undefined,
    durationMs: r.duration_ms ?? undefined,
  };
}

/**
 * Phase 7A: conversations that belong to another surface (After Dark Vibes).
 * Normal Messages never lists them; their owner claims their live messages so
 * the chat list isn't reloaded for every romantic message.
 */
const foreignClaims = new Set<(row: MessageRow) => boolean>();
export function claimConversations(fn: (row: MessageRow) => boolean): () => void {
  foreignClaims.add(fn);
  return () => foreignClaims.delete(fn);
}
const isForeign = (row: MessageRow) => [...foreignClaims].some((fn) => fn(row));

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

  /** Attach URLs to photo messages and voice notes (never to an unopened view-once photo). */
  const hydrateMedia = async (conversationId: string) => {
    const list = get().messages[conversationId] ?? [];
    const need = list.filter((m) => m.mediaId && !m.viewOnce && !(m.type === 'voice' ? m.audio : m.image)).map((m) => m.mediaId!);
    if (!need.length) return;
    try {
      const urls = await api.mediaUrls(need);
      set({
        messages: {
          ...get().messages,
          [conversationId]: (get().messages[conversationId] ?? []).map((m) =>
            m.mediaId && !m.viewOnce && urls[m.mediaId] ? (m.type === 'voice' ? { ...m, audio: urls[m.mediaId].url } : { ...m, image: urls[m.mediaId].url, aspect: urls[m.mediaId].aspect }) : m,
          ),
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
    const next = i >= 0 ? list.map((x, k) => (k === i ? { ...x, ...m, status: undefined, failKind: undefined, uploaded: undefined, localImage: undefined, localAudio: undefined, image: m.image ?? x.image, audio: m.audio ?? x.audio } : x)) : [...list, m];
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

  // ── Phase 8: Seen / Delivered / receipts ──────────────────────────────
  /** I can SEE this chat right now: it's the open one and the app is in the foreground. */
  const canSee = (cid: string) => get().activeId === cid && AppState.currentState === 'active';

  /** The newest message the server has confirmed in this chat (what's on screen at the bottom). */
  const newestServerId = (cid: string) => {
    const list = get().messages[cid] ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].status) return list[i].id;
    return undefined;
  };

  const flushSeen = (cid: string) => {
    const t = readTimers.get(cid);
    if (t) clearTimeout(t);
    readTimers.delete(cid);
    if (!canSee(cid) || !get().uid) return;
    const upto = newestServerId(cid);
    if (!upto) return;
    const using = api;
    void using.markReadUpto(cid, upto).catch((e) => trace('mark seen failed', String(e)));
  };

  /** Mark seen up to the newest message on screen — debounced, and only if I can see it. */
  const markSeen = (cid: string) => {
    if (!canSee(cid)) return;
    const t = readTimers.get(cid);
    if (t) clearTimeout(t);
    readTimers.set(cid, setTimeout(() => flushSeen(cid), READ_DEBOUNCE_MS));
  };

  /**
   * Tell the server this app has received what's in the inbox. One call for
   * all chats, and only when a chat has something newer from someone else
   * than we last acknowledged — so reloads and renders never write.
   */
  const ackDelivered = () => {
    const uid = get().uid;
    if (!uid) return;
    const fresh = Object.values(get().conversations).filter((c) => c.lastSender && c.lastSender !== uid && c.lastAt && serverMicros(c.lastAt) > (deliveredAck.get(c.id) ?? 0));
    if (!fresh.length) return;
    if (deliverTimer) clearTimeout(deliverTimer);
    deliverTimer = setTimeout(() => {
      deliverTimer = null;
      if (get().uid !== uid) return;
      const using = api;
      void using
        .markDelivered(null)
        .then(() => {
          if (get().uid !== uid || api !== using) return;
          for (const c of fresh) deliveredAck.set(c.id, serverMicros(c.lastAt));
        })
        .catch((e) => trace('mark delivered failed', String(e)));
    }, DELIVER_DEBOUNCE_MS);
  };

  /** Load receipts for an open Messages chat (never a Vibe: those aren't in `conversations`). */
  const loadReceipts = (cid: string, delay = RECEIPTS_DEBOUNCE_MS) => {
    if (!get().conversations[cid]) return;
    const t = receiptTimers.get(cid);
    if (t) clearTimeout(t);
    const uid = get().uid;
    receiptTimers.set(
      cid,
      setTimeout(() => {
        receiptTimers.delete(cid);
        if (get().uid !== uid || !convSubs.has(cid)) return;
        const using = api;
        void using
          .fetchReceipts(cid)
          .then((rows) => {
            if (get().uid !== uid || api !== using) return;
            set({ receipts: { ...get().receipts, [cid]: rows } });
          })
          .catch((e) => trace('receipts failed', String(e)));
      }, delay),
    );
  };

  /** Did this member event change membership (status / role / joined), or only a cursor? */
  const membershipChanged = (cid: string | undefined, change: MemberChange) => {
    const r = change.row;
    if (change.event !== 'UPDATE' || !r?.user_id || !(cid ?? r.conversation_id)) return true;
    const key = `${cid ?? r.conversation_id}|${r.user_id}`;
    const before = memberSig.get(key);
    memberSig.set(key, sigOf(r));
    return before !== sigOf(r);
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
      // Phase 7A: a Vibe's message belongs to After Dark (it tracks its own unread).
      if (isForeign(row)) {
        if (m.mediaId) void hydrateMedia(m.conversationId);
        if (!mine && viewing) markSeen(m.conversationId); // my own unread cursor only: Vibes have no receipts
        return;
      }
      void get().loadConversations(); // a new conversation (a Message Request, or I was added to a group) — fetch it
      return;
    }
    bumpSummary(m, !mine && !viewing);
    if (m.mediaId) void hydrateMedia(m.conversationId);
    if (!mine) void ensurePeople([m.senderId]);
    if (!mine && viewing) markSeen(m.conversationId);
    else if (!mine) ackDelivered(); // it reached this app: Delivered (not Seen)
  };

  const onMessageUpdate = (row: MessageRow) => {
    if (row.deleted_at) {
      removeMessage(row.conversation_id, row.id);
      if (!isForeign(row)) reloadSoon(); // the preview may have moved back to an earlier message
    } else if (row.viewed_at) {
      // Phase 7A: a view-once photo was opened (the sender sees "Opened").
      const list = get().messages[row.conversation_id];
      if (list) set({ messages: { ...get().messages, [row.conversation_id]: list.map((m) => (m.id === row.id ? { ...m, viewedAt: row.viewed_at ?? undefined, mediaId: undefined, image: undefined } : m)) } });
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
      for (const m of members) memberSig.set(`${cid}|${m.user_id}`, sigOf(m));
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
      onMembers: (change) => {
        // Phase 8: a read / delivery cursor moved → just the receipts. Only a
        // real membership change (joined, left, accepted, role) reloads more.
        const known = extrasOf(cid).members.find((x) => x.user_id === change.row?.user_id);
        const r = change.row;
        const cursorOnly = change.event === 'UPDATE' && !!known && !!r && r.status === known.status && r.role === known.role && r.joined_at === known.joined_at;
        if (!cursorOnly) {
          void refresh.members(cid).catch(() => {});
          reloadSoon();
        }
        loadReceipts(cid);
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

  const patchMessage = (conversationId: string, clientId: string | undefined, patch: Partial<ChatMsg>) => {
    if (!clientId) return;
    const list = get().messages[conversationId];
    if (list) set({ messages: { ...get().messages, [conversationId]: list.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)) } });
  };

  const deliver = async (conversationId: string, msg: ChatMsg) => {
    const uid = get().uid;
    if (!uid) throw new Error('You’re signed out.');
    // A retry reuses the file an earlier attempt already uploaded.
    let media: { id: string; url: string; aspect?: number } | null = msg.uploaded ?? null;
    if (!media && msg.localImage) media = await api.uploadPhoto(uid, msg.localImage, msg.viewOnce ? { private: true } : undefined);
    if (!media && msg.localAudio) media = await api.uploadAudio(uid, msg.localAudio.uri, msg.localAudio.durationMs);
    if (media && !msg.uploaded) {
      msg.uploaded = media;
      patchMessage(conversationId, msg.clientId, { uploaded: media });
    }
    const extra = msg.localAudio ? { kind: 'voice' as const, durationMs: msg.localAudio.durationMs } : msg.viewOnce ? { viewOnce: true } : undefined;
    let row: MessageRow;
    try {
      row = await api.sendMessage(uid, conversationId, msg.clientId!, msg.body ?? null, media, msg.replyTo ?? null, extra);
    } catch (e) {
      // Refused (consent changed, the Vibe ended, a block): the uploaded file
      // was never delivered — remove it rather than leave it behind.
      if (media && sendFailKind(e) === 'refused') {
        if (!api.demo) void discardMediaById(media.id).catch(() => {});
        msg.uploaded = undefined;
        patchMessage(conversationId, msg.clientId, { uploaded: undefined });
      }
      throw e;
    }
    const sent: ChatMsg =
      msg.type === 'voice'
        ? { ...toMsg(row), audio: media?.url ?? msg.audio }
        : { ...toMsg(row), image: media?.url || msg.image, aspect: media?.aspect ?? msg.aspect };
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
        onMembers: (change) => {
          // Phase 8: someone reading (a cursor-only change) doesn't reload my
          // whole chat list. My own cursor moving while I'm not in that chat
          // (another device read it) does: my unread count changed.
          const r = change.row;
          const changed = membershipChanged(undefined, change);
          if (changed) return reloadSoon();
          if (r?.user_id === uid && r.conversation_id && r.conversation_id !== get().activeId) reloadSoon();
        },
        onStatus: (s) => {
          trace('channel', s);
          if (get().uid !== uid) return;
          set({ live: s === 'SUBSCRIBED' ? 'live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'error' : get().live });
          // (Re)connected: catch up on anything missed while offline — the list,
          // and the open chat (its messages, Seen and receipts).
          if (s === 'SUBSCRIBED') {
            void get().loadConversations();
            const active = get().activeId;
            if (active) void get().open(active);
          }
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
      for (const t of readTimers.values()) clearTimeout(t);
      readTimers.clear();
      for (const t of receiptTimers.values()) clearTimeout(t);
      receiptTimers.clear();
      if (deliverTimer) clearTimeout(deliverTimer);
      deliverTimer = null;
      deliveredAck.clear();
      memberSig.clear();
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
        // Keep "I'm reading this right now" at 0 unread — only while I can actually see it
        // (Phase 8: a chat left open in the background still counts what arrives).
        const active = get().activeId;
        if (active && conversations[active] && canSee(active)) conversations[active] = { ...conversations[active], unread: 0 };
        // Conversations I'm no longer in (left / removed / deleted): drop what we had.
        for (const cid of Object.keys(get().conversations)) if (!conversations[cid]) forget(cid);
        const direct = rows.filter((r) => (r.kind ?? 'direct') === 'direct' && r.other_id);
        set({ conversations, byPerson: Object.fromEntries(direct.map((r) => [r.other_id!, r.conversation_id])), loaded: true, error: undefined });
        void ensurePeople([...direct.map((r) => r.other_id), ...rows.map((r) => r.last_sender)]);
        ackDelivered(); // the inbox reached this app: Delivered for anything new from others
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
      if (c?.unread && canSee(conversationId)) set({ conversations: { ...get().conversations, [c.id]: { ...c, unread: 0 } } });
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
        // Phase 8: Seen only if I'm actually looking (foreground), up to what's on screen.
        markSeen(conversationId);
        loadReceipts(conversationId, 0);
      } catch (e) {
        set({ error: errText(e) });
      }
    },

    close: (conversationId) => {
      // It was on screen until now: don't lose a pending Seen by leaving quickly.
      if (readTimers.has(conversationId)) flushSeen(conversationId);
      if (get().activeId === conversationId) set({ activeId: undefined });
      unsubscribeOpen(conversationId);
      const t = receiptTimers.get(conversationId);
      if (t) clearTimeout(t);
      receiptTimers.delete(conversationId);
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

    send: async (conversationId, body, image, replyTo, opts) => {
      const uid = get().uid;
      const text = body.trim();
      const voice = opts?.voice;
      if (!uid || (!text && !image && !voice)) return;
      const msg: ChatMsg = {
        id: newClientId(),
        clientId: undefined,
        conversationId,
        senderId: uid,
        body: voice ? undefined : text || undefined,
        type: voice ? 'voice' : image ? 'photo' : 'text',
        image: voice ? undefined : image?.uri,
        aspect: !voice && image && image.width && image.height ? image.width / image.height : undefined,
        localImage: voice ? undefined : image,
        audio: voice?.uri,
        durationMs: voice?.durationMs,
        localAudio: voice,
        viewOnce: !voice && !!image && opts?.viewOnce ? true : undefined,
        createdAt: new Date().toISOString(),
        replyTo,
        status: 'sending',
      };
      msg.clientId = msg.id;
      set({ messages: { ...get().messages, [conversationId]: [...(get().messages[conversationId] ?? []), msg] } });
      // Phase 7C: that a message was sent and its kind — never its text, file or recipient.
      logEvent('message_sent', { targetType: 'message', context: { kind: msg.type, view_once: !!msg.viewOnce } });
      bumpSummary(msg, false);
      try {
        await deliver(conversationId, msg);
      } catch (e) {
        trace('send failed', String(e));
        set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === msg.clientId ? { ...m, status: 'failed', failKind: sendFailKind(e) } : m)) } });
      }
    },

    viewOnceAvailable: () => api.viewOnceAvailable().catch(() => null),

    openViewOnce: async (conversationId, messageId) => {
      const url = await api.openViewOnce(messageId);
      const list = get().messages[conversationId];
      if (list) set({ messages: { ...get().messages, [conversationId]: list.map((m) => (m.id === messageId ? { ...m, viewedAt: new Date().toISOString(), mediaId: undefined } : m)) } });
      return url;
    },

    retry: async (conversationId, clientId) => {
      const msg = (get().messages[conversationId] ?? []).find((m) => m.clientId === clientId);
      if (!msg || msg.status !== 'failed') return;
      set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === clientId ? { ...m, status: 'sending', failKind: undefined } : m)) } });
      try {
        await deliver(conversationId, msg); // same clientId → never duplicated
      } catch (e) {
        trace('retry failed', String(e));
        set({ messages: { ...get().messages, [conversationId]: (get().messages[conversationId] ?? []).map((m) => (m.clientId === clientId ? { ...m, status: 'failed', failKind: sendFailKind(e) } : m)) } });
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
