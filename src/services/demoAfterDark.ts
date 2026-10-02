/**
 * Phase 7A: the Demo account's After Dark — an in-memory stand-in for the
 * Supabase side (0007), seeded with fixture people. It follows the same rules
 * as the server: a Vibe starts pending and only the person who was asked can
 * accept it; photos and voice notes reach you only if you allow them; your
 * challenge answers stay hidden until both of you have answered; a Plan is
 * confirmed by the other person; an ended Vibe never reopens from the side
 * that was ended on. Nothing here is sent anywhere and nothing real is read.
 *
 * A Vibe's chat lives in the Demo chat backend (services/demoChat.ts) as a
 * conversation of kind 'vibe', exactly like REAL.
 *
 * Demo only: the other person answers a challenge you send, or accepts a
 * Vibe you ask for, a few seconds later, so the whole loop can be tried.
 */
import type { AfterDarkApi } from '@/services/afterDarkApi';
import type { AdIntent, AdProfileRow, AnswerRow, ChallengeRow, DiscoverRow, EndReason, ReportReason, VibeOrigin, VibeRow, VibeStatus } from '@/services/backend/afterDark';
import type { LoopRow, MessageRow } from '@/services/backend/chat';
import { challengeDeck, type ChallengeKind } from '@/data/afterDarkChallenges';
import { BOARDS } from '@/data/boards';
import { img } from '@/data/media';
import { CRUSHES_ON_ME, ME_ID, PEOPLE_CONNECTIONS, USERS } from '@/data/users';
import { demoChatVibes } from '@/services/demoChat';

/** Played by the voice-note player (a bundled file, never downloaded). */
export const DEMO_VOICE_URI = 'demo-asset:after-dark-voice';
const DEMO_VOICE_MS = 7158;

/** What the Demo world already knows about you (from the main Demo store). */
export interface DemoAdContext {
  joined: () => string[];
  connections: () => string[];
  crushes: () => string[];
  blocked: () => string[];
}
let ctx: DemoAdContext = { joined: () => [], connections: () => [], crushes: () => [], blocked: () => [] };
export function setDemoAfterDarkContext(c: DemoAdContext) {
  ctx = c;
}
/** How long the Demo's other person takes to answer or accept (ms). */
export const demoAfterDarkTiming = { replyMs: 6000 };

interface Member {
  user_id: string;
  role: 'requester' | 'recipient';
  allows_photos: boolean;
  allows_voice: boolean;
}
interface Vibe {
  id: string;
  conversation_id: string;
  status: VibeStatus;
  requested_by: string;
  origin: VibeOrigin;
  origin_text: string | null;
  paused_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  /** When the person who was asked said yes (null while pending / if never). */
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  members: [Member, Member];
}

interface Db {
  profiles: Record<string, AdProfileRow>;
  passes: Set<string>;
  vibes: Vibe[];
  challenges: ChallengeRow[];
  answers: AnswerRow[];
  closures: { vibe_id: string; user_id: string; reason: string; note: string | null }[];
  reports: { subject_id: string; vibe_id: string | null; context: string; reason: ReportReason; note: string | null }[];
}

let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const H = 3600 * 1000;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const deny = (msg: string): never => {
  throw new Error(msg);
};
const listeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const emit = () => {
  for (const fn of listeners) fn();
};
const later = (fn: () => void) => {
  const t = setTimeout(() => {
    timers.delete(t);
    if (db) {
      fn();
      emit();
    }
  }, demoAfterDarkTiming.replyMs);
  timers.add(t);
};

/** Fixture people with an After Dark card (Discover). Photos are the fixture's own pictures. */
const CARDS: { id: string; age: number; intent: AdIntent; prompt: string; extra: Parameters<typeof img>[0][] }[] = [
  { id: 'u_maya_t', age: 27, intent: 'dating', prompt: 'Teach me your favourite ramen order and I’ll show you the quiet side of Kyoto.', extra: ['kyotoStreet', 'ramen'] },
  { id: 'u_nia', age: 29, intent: 'open', prompt: 'Best rooftop in Manhattan. You pick the drinks, I pick the view.', extra: ['cocktails', 'cityNight'] },
  { id: 'u_theo', age: 31, intent: 'serious', prompt: 'Gallery opening Thursday, then somewhere with good bread?', extra: ['gallery', 'workspace'] },
  { id: 'u_isabela', age: 28, intent: 'dating', prompt: 'Sunrise surf, then coffee. Who’s in?', extra: ['beach', 'travelLake'] },
  { id: 'u_alex_r', age: 30, intent: 'casual', prompt: 'Find me at the front of a tiny gig. Churros after.', extra: ['concert', 'party'] },
  { id: 'u_maya_c', age: 28, intent: 'dating', prompt: 'New dumpling spot every week. Come rate them with me.', extra: ['food', 'gallery'] },
  { id: 'u_leo', age: 29, intent: 'dating', prompt: 'Golden hour, film camera, long walk. That’s the date.', extra: ['camera', 'crowd'] },
  { id: 'u_kenji', age: 32, intent: 'open', prompt: 'There’s an 8-seat jazz bar I’ll tell you about in person.', extra: ['tokyoNight', 'bar'] },
  { id: 'u_sofia', age: 30, intent: 'open', prompt: 'Night train somewhere. Window seat is mine.', extra: ['lisbon', 'soloHiker'] },
];

const MY_PROMPT = 'Rooftop drinks somewhere new this week?';

let db: Db | null = null;

function seed() {
  const profiles: Record<string, AdProfileRow> = {
    [ME_ID]: { user_id: ME_ID, discoverable: true, age: 29, intent: 'dating', prompt: MY_PROMPT, photo_paths: [] },
  };
  for (const c of CARDS) {
    const u = USERS[c.id];
    const hero = typeof u?.heroImage === 'string' ? u.heroImage : undefined;
    profiles[c.id] = { user_id: c.id, discoverable: true, age: c.age, intent: c.intent, prompt: c.prompt, photo_paths: [...(hero ? [hero] : []), ...c.extra.map((k) => img(k, 900))] };
  }
  db = { profiles, passes: new Set(), vibes: [], challenges: [], answers: [], closures: [], reports: [] };

  const mk = (other: string, o: { status: VibeStatus; by: string; origin: VibeOrigin; text: string | null; ago: number; readAgo: number; mePhotos: boolean; themPhotos: boolean }): Vibe => {
    const id = `demo_vibe_${other}`;
    const cid = `demo_v_${other}`;
    const v: Vibe = {
      id,
      conversation_id: cid,
      status: o.status,
      requested_by: o.by,
      origin: o.origin,
      origin_text: o.text,
      paused_by: null,
      closed_by: null,
      closed_at: null,
      accepted_at: o.status === 'pending' ? null : at(o.ago),
      created_at: at(o.ago),
      updated_at: at(o.ago),
      members: [
        { user_id: ME_ID, role: o.by === ME_ID ? 'requester' : 'recipient', allows_photos: o.mePhotos, allows_voice: true },
        { user_id: other, role: o.by === ME_ID ? 'recipient' : 'requester', allows_photos: o.themPhotos, allows_voice: true },
      ],
    };
    db!.vibes.push(v);
    demoChatVibes.addConversation(cid, o.by, [
      { user_id: ME_ID, joined_at: v.created_at, last_read_at: at(o.readAgo) },
      { user_id: other, joined_at: v.created_at, last_read_at: at(0) },
    ], v.created_at);
    return v;
  };
  const say = (v: Vibe, id: string, from: string, body: string | null, ago: number, more: Partial<MessageRow> = {}, media?: { url: string; aspect?: number }) => {
    demoChatVibes.addMessage({ id, conversation_id: v.conversation_id, sender_id: from, body, media_id: null, message_type: 'text', client_id: null, created_at: at(ago), deleted_at: null, ...more }, media);
    if (v.updated_at < at(ago)) v.updated_at = at(ago);
  };
  const loop = (v: Vibe, row: Partial<LoopRow> & { id: string; title: string; created_by: string }, ago: number) =>
    demoChatVibes.addLoop({ conversation_id: v.conversation_id, source_message_id: null, note: null, status: 'open', target_date: null, location_text: null, board_id: null, created_at: at(ago), updated_at: at(ago), resolved_at: null, plan_state: null, plan_at: null, plan_by: null, ...row });
  const challenge = (v: Vibe, id: string, kind: ChallengeKind, deck: string, by: string, note: string | null, ago: number, answers: Record<string, number[]>) => {
    const done = Object.keys(answers).length === 2;
    db!.challenges.unshift({ id, vibe_id: v.id, kind, deck, sent_by: by, note, status: done ? 'completed' : 'waiting', created_at: at(ago), completed_at: done ? at(ago - 0.5 * H) : null });
    for (const [user_id, a] of Object.entries(answers)) db!.answers.push({ challenge_id: id, user_id, answers: a });
  };

  // 1. Maya Chen — answered your Open Loop. Building: a completed Same Brain,
  //    a Choose the Night waiting on you, a proposed Plan, a voice note and a
  //    view-once photo you haven't opened yet. You both allow photos.
  const maya = mk('u_maya_c', { status: 'active', by: 'u_maya_c', origin: 'open_loop', text: 'Rooftop drinks, yes. But I have a counter-offer: dumplings first.', ago: 72 * H, readAgo: 4 * H, mePhotos: true, themPhotos: true });
  say(maya, 'dv_m2', ME_ID, 'Dumplings first is the correct order. Where?', 70 * H);
  say(maya, 'dv_m3', 'u_maya_c', 'There’s a tiny place in Chinatown with a line that’s worth it. I’ll find out if they take bookings.', 69 * H);
  say(maya, 'dv_m4', ME_ID, null, 30 * H, { message_type: 'photo', view_once: true, viewed_at: at(29 * H) });
  say(maya, 'dv_m5', 'u_maya_c', 'Ok that view is unfair 😂', 29 * H);
  say(maya, 'dv_m6', 'u_maya_c', null, 3 * H, { message_type: 'voice', media_id: 'dv_voice', duration_ms: DEMO_VOICE_MS }, { url: DEMO_VOICE_URI });
  say(maya, 'dv_m7', 'u_maya_c', null, 2.5 * H, { message_type: 'photo', media_id: 'dv_once', view_once: true, viewed_at: null }, { url: img('restaurant', 900), aspect: 0.8 });
  say(maya, 'dv_m8', 'u_maya_c', 'Also sent you a Choose the Night. No pressure. Some pressure.', 2 * H);
  challenge(maya, 'dc_m1', 'same_brain', 'sb1', ME_ID, 'Let’s see if we actually think alike.', 48 * H, { [ME_ID]: [1, 1, 1, 0, 2], u_maya_c: [1, 1, 1, 0, 1] });
  challenge(maya, 'dc_m2', 'choose_the_night', 'ctn1', 'u_maya_c', 'Let’s design a night. Then maybe do it.', 2 * H, { u_maya_c: [1, 0, 2, 0] });
  const friday = new Date();
  friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7 || 7));
  friday.setHours(19, 30, 0, 0);
  loop(maya, { id: 'dl_m1', title: 'Dumplings, then a gallery walk', created_by: 'u_maya_c', source_message_id: 'dv_m3', location_text: 'New York', plan_state: 'proposed', plan_at: friday.toISOString(), plan_by: 'u_maya_c' }, 2.2 * H);

  // 2. Leah — you sent interest from Discover (with a note). A Fast Five waiting on her, an
  //    Open Loop that could become a Plan. She hasn't turned on photos.
  const leah = mk('u_leo', { status: 'active', by: ME_ID, origin: 'interest', text: 'Your golden-hour shots are the reason I bought a film camera.', ago: 30 * H, readAgo: 0, mePhotos: false, themPhotos: false });
  say(leah, 'dv_l1', 'u_leo', 'Hi! Your Japan board is the reason I own a rail pass now.', 28 * H);
  say(leah, 'dv_l2', ME_ID, 'Ha, success. Are you shooting film there too?', 27 * H);
  say(leah, 'dv_l3', 'u_leo', 'Always. Golden hour photo walk when I’m in Boston next?', 26 * H);
  say(leah, 'dv_l4', ME_ID, 'Deal. Sending you a Fast Five while we figure out a date.', 5 * H);
  challenge(leah, 'dc_l1', 'fast_five', 'ff1', ME_ID, 'Go fast. First instinct only.', 5 * H, { [ME_ID]: [1, 0, 1, 1, 1] });
  challenge(leah, 'dc_l0', 'would_you_rather', 'wyr1', 'u_leo', 'Answer honestly. I will too.', 20 * H, { [ME_ID]: [1, 0, 0, 1], u_leo: [1, 0, 1, 1] });
  loop(leah, { id: 'dl_l1', title: 'Golden hour photo walk', created_by: 'u_leo', source_message_id: 'dv_l3', location_text: 'Boston' }, 26 * H);

  // 3. Sofía — quiet for a week: Cooling (Keep it going / Close Vibe).
  const sofia = mk('u_sofia', { status: 'active', by: 'u_sofia', origin: 'interest', text: null, ago: 9 * 24 * H, readAgo: 0, mePhotos: false, themPhotos: false });
  say(sofia, 'dv_s1', 'u_sofia', 'You’ve been to Lisbon? Tell me your one tip.', 8.5 * 24 * H);
  say(sofia, 'dv_s2', ME_ID, 'Sunset at the miradouro, then grilled sardines. Every time.', 8 * 24 * H);
  say(sofia, 'dv_s3', 'u_sofia', 'Approved. Next one’s on me.', 7 * 24 * H);

  // 4. Kenji — wants to take it After Dark. Your call (pending, you're the recipient).
  mk('u_kenji', { status: 'pending', by: 'u_kenji', origin: 'open_loop', text: 'If it’s a rooftop, I know one with a jazz trio on Thursdays.', ago: 1 * H, readAgo: 2 * H, mePhotos: false, themPhotos: false });
}

const d = (): Db => {
  if (!db) seed();
  return db!;
};
demoChatVibes.onReset(() => {
  db = null;
  for (const t of timers) clearTimeout(t);
  timers.clear();
});
/** Start the Demo After Dark over (it also starts over with the Demo chats). */
export function resetDemoAfterDark() {
  db = null;
  for (const t of timers) clearTimeout(t);
  timers.clear();
}

const vibe = (id: string) => d().vibes.find((v) => v.id === id && v.members.some((m) => m.user_id === ME_ID)) ?? deny('Vibe not found.');
const meIn = (v: Vibe) => v.members.find((m) => m.user_id === ME_ID)!;
const them = (v: Vibe) => v.members.find((m) => m.user_id !== ME_ID)!;
const blockedWith = (other: string) => ctx.blocked().includes(other);
const myAge = () => d().profiles[ME_ID]?.age ?? null;
const romanticOpen = (u: string) => (USERS[u]?.openTo ?? []).some((x) => x === 'dating' || x === 'casual') || !!d().profiles[u]?.discoverable;
const openVibeWith = (other: string) => d().vibes.find((v) => v.status !== 'closed' && v.members.some((m) => m.user_id === other) && v.members.some((m) => m.user_id === ME_ID));
const touch = (v: Vibe) => {
  v.updated_at = new Date().toISOString();
};

// Who may send what in a Vibe chat (vibe_can_send / can_participate in 0007).
const gate = (cid: string, what: 'text' | 'photo' | 'voice' | 'other', viewOnce: boolean): string | null => {
  const v = d().vibes.find((x) => x.conversation_id === cid);
  if (!v) return 'This Vibe isn’t active.';
  if (v.status === 'closed') return 'This Vibe has ended.';
  if (v.status !== 'active') return v.status === 'paused' ? 'This Vibe is paused.' : 'This Vibe hasn’t started yet.';
  const other = them(v);
  if (blockedWith(other.user_id)) return 'You can’t message this person right now.';
  if (viewOnce && what !== 'photo') return 'Only photos can be view-once.';
  if (what === 'photo' && !other.allows_photos) return 'They aren’t taking photos right now.';
  if (what === 'voice' && !other.allows_voice) return 'They aren’t taking voice notes right now.';
  return null;
};
demoChatVibes.setGate(gate);

function toRow(v: Vibe): VibeRow {
  const me = meIn(v);
  const o = them(v);
  const msgs = demoChatVibes.messages(v.conversation_id);
  const last = msgs[msgs.length - 1];
  const read = demoChatVibes.lastRead(v.conversation_id) ?? v.created_at;
  const chs = d().challenges.filter((c) => c.vibe_id === v.id);
  const answered = (c: ChallengeRow) => d().answers.some((a) => a.challenge_id === c.id && a.user_id === ME_ID);
  const loops = demoChatVibes.loops([v.conversation_id]);
  return {
    vibe_id: v.id,
    conversation_id: v.conversation_id,
    other_id: o.user_id,
    status: v.status,
    my_role: me.role,
    origin: v.origin,
    origin_text: v.origin_text,
    requested_by_me: v.requested_by === ME_ID,
    paused_by_me: v.paused_by === ME_ID,
    closed_by_me: v.closed_by === ME_ID,
    my_allows_photos: me.allows_photos,
    my_allows_voice: me.allows_voice,
    their_allows_photos: o.allows_photos,
    their_allows_voice: o.allows_voice,
    created_at: v.created_at,
    updated_at: v.updated_at,
    last_body: last?.body ?? null,
    last_type: last?.message_type ?? null,
    last_sender: last?.sender_id ?? null,
    last_at: last?.created_at ?? null,
    unread: msgs.filter((m) => m.sender_id !== ME_ID && m.created_at > read).length,
    challenges_completed: chs.filter((c) => c.status === 'completed').length,
    challenges_waiting_on_me: chs.filter((c) => c.status === 'waiting' && !answered(c)).length,
    challenges_waiting_on_them: chs.filter((c) => c.status === 'waiting' && answered(c)).length,
    open_loops: loops.filter((l) => l.plan_state == null && l.status === 'open').length,
    plans_pending: loops.filter((l) => l.plan_state === 'proposed').length,
    plans_confirmed: loops.filter((l) => l.plan_state === 'confirmed').length,
    messages_from_me: msgs.filter((m) => m.sender_id === ME_ID).length,
    messages_from_them: msgs.filter((m) => m.sender_id !== ME_ID).length,
  };
}

/** The Demo's other person answers (deterministically) — Demo only. */
function partnerAnswers(c: ChallengeRow, who: string) {
  const deck = challengeDeck(c.kind, c.deck);
  if (!deck || d().answers.some((a) => a.challenge_id === c.id && a.user_id === who)) return;
  const seedN = [...(who + c.id)].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  // Two Truths: they guess which statement is the lie.
  const answers = c.kind === 'two_truths' ? [seedN % 3] : deck.questions.map((q, i) => (seedN + i * 7) % q.options.length);
  d().answers.push({ challenge_id: c.id, user_id: who, answers });
  if (d().answers.filter((a) => a.challenge_id === c.id).length >= 2) Object.assign(c, { status: 'completed', completed_at: new Date().toISOString() });
}

export const demoAfterDarkApi: AfterDarkApi = {
  demo: true,
  fetchMyProfile: async () => d().profiles[ME_ID] ?? null,
  saveProfile: async (_uid, patch) => {
    const cur: AdProfileRow = d().profiles[ME_ID] ?? { user_id: ME_ID, discoverable: false, age: null, intent: null, prompt: null, photo_paths: [] };
    const next = { ...cur, ...patch };
    if (next.age != null && (next.age < 18 || next.age > 99)) deny('After Dark is for adults (18+).');
    if (next.discoverable && next.age == null) deny('Add your age to appear in Discover.');
    if ((next.prompt ?? '').length > 140) deny('Keep your Open Loop under 140 characters.');
    if (next.photo_paths.length > 6) deny('Up to 6 photos.');
    next.prompt = next.prompt?.trim() || null;
    d().profiles[ME_ID] = next;
    return { ...next };
  },
  discover: async () => {
    const age = myAge();
    if (age == null || age < 18) return [];
    const mine = new Set(USERS[ME_ID]?.interests ?? []);
    const joined = new Set(ctx.joined());
    const conns = new Set(ctx.connections());
    return CARDS.filter((c) => {
      const p = d().profiles[c.id];
      if (!p?.discoverable || (p.age ?? 0) < 18) return false;
      if (d().passes.has(c.id) || blockedWith(c.id) || openVibeWith(c.id)) return false;
      // Nobody who ended a Vibe with you.
      return !d().vibes.some((v) => v.closed_by === c.id && v.members.some((m) => m.user_id === ME_ID));
    }).map((c): DiscoverRow => {
      const u = USERS[c.id];
      const p = d().profiles[c.id];
      return {
        user_id: c.id,
        first_name: (u?.displayName ?? 'Someone').split(' ')[0],
        age: p.age!,
        city: u?.city ?? null,
        interests: u?.interests ?? [],
        intent: p.intent,
        prompt: p.prompt,
        avatar_url: typeof u?.avatar === 'string' ? u.avatar : null,
        photo_paths: p.photo_paths,
        shared_worlds: Object.values(BOARDS).filter((b) => joined.has(b.id) && b.memberPreview.includes(c.id)).map((b) => b.title).sort().slice(0, 4),
        mutual_connections: (PEOPLE_CONNECTIONS[c.id] ?? []).filter((x) => conns.has(x)).length,
      };
    }).sort((a, b) => Number(b.interests.some((i) => mine.has(i))) - Number(a.interests.some((i) => mine.has(i))));
  },
  pass: async (_uid, other) => {
    d().passes.add(other);
  },
  myVibes: async () => {
    // A block ends the Vibe (blocks_close_vibes in 0007).
    for (const v of d().vibes) {
      if (v.status !== 'closed' && blockedWith(them(v).user_id)) {
            Object.assign(v, { status: 'closed', closed_by: ME_ID, closed_at: new Date().toISOString(), paused_by: null });
        d().closures.push({ vibe_id: v.id, user_id: ME_ID, reason: 'blocked', note: null });
        demoChatVibes.closePlans(v.conversation_id);
        touch(v);
      }
    }
    return d().vibes.filter((v) => v.members.some((m) => m.user_id === ME_ID)).map(toRow).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  requestVibe: async (other, origin, originText) => {
    if ((myAge() ?? 0) < 18) deny('Confirm you’re 18+ first.');
    if (other === ME_ID || !USERS[other]) deny('Not available.');
    if (blockedWith(other) || !romanticOpen(ME_ID) || !romanticOpen(other)) deny('Not available.');
    if (origin === 'mutual_crush') {
      if (!(ctx.crushes().includes(other) && CRUSHES_ON_ME.includes(other))) deny('Not available.');
    } else if (!d().profiles[other]?.discoverable) deny('Not available.');
    // Nothing reaches anyone who hasn't confirmed 18+ in After Dark.
    if ((d().profiles[other]?.age ?? 0) < 18) deny('Not available.');
    const open = openVibeWith(other);
    if (open) return open.id;
    // The pair's most recent Vibe decides (request_vibe in 0007).
    const last = d().vibes.filter((v) => v.members.some((m) => m.user_id === other)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last && last.closed_by === other && !(last.requested_by === other && !last.accepted_at)) deny('Not available.');
    if (last && last.closed_by === ME_ID && last.requested_by === ME_ID && !last.accepted_at && Date.now() - Date.parse(last.closed_at ?? '') < 7 * 24 * H) deny('You can ask again later.');
    const now = new Date().toISOString();
    const id = nid('demo_vibe');
    const cid = nid('demo_v');
    const v: Vibe = {
      id,
      conversation_id: cid,
      status: 'pending',
      requested_by: ME_ID,
      origin,
      origin_text: originText?.trim().slice(0, 200) || null,
      paused_by: null,
      closed_by: null,
      closed_at: null,
      accepted_at: null,
      created_at: now,
      updated_at: now,
      members: [
        { user_id: ME_ID, role: 'requester', allows_photos: false, allows_voice: true },
        { user_id: other, role: 'recipient', allows_photos: false, allows_voice: true },
      ],
    };
    d().vibes.push(v);
    demoChatVibes.addConversation(cid, ME_ID, [
      { user_id: ME_ID, joined_at: now, last_read_at: now },
      { user_id: other, joined_at: now, last_read_at: now },
    ], now);
    // Demo only: they say yes a moment later.
    later(() => {
      if (v.status !== 'pending') return;
      Object.assign(v, { status: 'active', accepted_at: new Date().toISOString() });
      touch(v);
    });
    return id;
  },
  respondVibe: async (vibeId, accept) => {
    const v = vibe(vibeId);
    if (meIn(v).role !== 'recipient') deny('Only the person who was asked can answer.');
    if (v.status !== 'pending') deny('This request was already answered.');
    if (accept) {
      if ((myAge() ?? 0) < 18) deny('Confirm you’re 18+ first.');
      Object.assign(v, { status: 'active', accepted_at: new Date().toISOString() });
    } else {
      Object.assign(v, { status: 'closed', closed_by: ME_ID, closed_at: new Date().toISOString() });
      d().closures.push({ vibe_id: v.id, user_id: ME_ID, reason: 'declined', note: null });
      d().passes.add(them(v).user_id);
    }
    touch(v);
  },
  pauseVibe: async (vibeId) => {
    const v = vibe(vibeId);
    if (v.status !== 'active') deny('Only an active Vibe can be paused.');
    Object.assign(v, { status: 'paused', paused_by: ME_ID });
    touch(v);
  },
  resumeVibe: async (vibeId) => {
    const v = vibe(vibeId);
    if (v.status !== 'paused' || v.paused_by !== ME_ID) deny('Only the person who paused it can pick it back up.');
    Object.assign(v, { status: 'active', paused_by: null });
    touch(v);
  },
  endVibe: async (vibeId, reason: EndReason | 'blocked', note) => {
    const v = vibe(vibeId);
    if (v.status === 'closed') return;
    Object.assign(v, { status: 'closed', closed_by: ME_ID, closed_at: new Date().toISOString(), paused_by: null });
    d().closures.push({ vibe_id: v.id, user_id: ME_ID, reason, note: note?.trim() || null });
    d().passes.add(them(v).user_id);
    demoChatVibes.closePlans(v.conversation_id);
    touch(v);
  },
  canSendInVibe: async (cid, type, viewOnce) => gate(cid, type, viewOnce) === null,
  setVibeControls: async (vibeId, photos, voice) => {
    const v = vibe(vibeId);
    const me = meIn(v);
    if (photos != null) me.allows_photos = photos;
    if (voice != null) me.allows_voice = voice;
    touch(v);
  },
  fetchChallenges: async (vibeIds) => d().challenges.filter((c) => vibeIds.includes(c.vibe_id) && d().vibes.some((v) => v.id === c.vibe_id && v.members.some((m) => m.user_id === ME_ID))).map((c) => ({ ...c })),
  // Yours always; theirs only once both have answered (like RLS).
  fetchAnswers: async (ids) =>
    d()
      .answers.filter((a) => ids.includes(a.challenge_id) && (a.user_id === ME_ID || d().challenges.find((c) => c.id === a.challenge_id)?.status === 'completed'))
      .map((a) => ({ ...a, answers: [...a.answers] })),
  sendChallenge: async (vibeId, kind, deck, note) => {
    const v = vibe(vibeId);
    if (v.status !== 'active') deny('Challenges are for active Vibes.');
    if (blockedWith(them(v).user_id)) deny('Not available.');
    if (!challengeDeck(kind, deck) || kind === 'two_truths') deny('Unknown challenge.');
    if (d().challenges.filter((c) => c.vibe_id === v.id && c.sent_by === ME_ID && c.status === 'waiting').length >= 3) deny('Three challenges are already waiting. Let them catch up.');
    const c: ChallengeRow = { id: nid('dc'), vibe_id: v.id, kind, deck, sent_by: ME_ID, note: note?.trim().slice(0, 140) || null, status: 'waiting', created_at: new Date().toISOString(), completed_at: null };
    d().challenges.unshift(c);
    touch(v);
    const other = them(v).user_id;
    later(() => {
      if (v.status === 'active') partnerAnswers(c, other);
    });
    return c.id;
  },
  sendTwoTruths: async (vibeId, statements, lie, note) => {
    const v = vibe(vibeId);
    if (v.status !== 'active') deny('Challenges are for active Vibes.');
    if (blockedWith(them(v).user_id)) deny('Not available.');
    if (d().challenges.filter((c) => c.vibe_id === v.id && c.sent_by === ME_ID && c.status === 'waiting').length >= 3) deny('Wait for them to play the ones you sent.');
    // The same rules as the server (send_two_truths).
    const clean = (t: string) => t.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (statements.length !== 3) deny('Write three statements.');
    const s3 = statements.map(clean);
    if (s3.some((x) => x.length < 1 || x.length > 120)) deny('Each statement needs 1 to 120 characters.');
    if (new Set(s3).size !== 3) deny('Make the three statements different.');
    if (!Number.isInteger(lie) || lie < 0 || lie > 2) deny('Pick which one is the lie.');
    const c: ChallengeRow = { id: nid('dc'), vibe_id: v.id, kind: 'two_truths', deck: 'tt', sent_by: ME_ID, note: clean(note ?? '').slice(0, 140) || null, status: 'waiting', created_at: new Date().toISOString(), completed_at: null, statements: s3 };
    d().challenges.unshift(c);
    d().answers.push({ challenge_id: c.id, user_id: ME_ID, answers: [lie] });
    touch(v);
    const other = them(v).user_id;
    later(() => {
      if (v.status === 'active') partnerAnswers(c, other);
    });
    return c.id;
  },
  answerChallenge: async (challengeId, answers) => {
    const c = d().challenges.find((x) => x.id === challengeId) ?? deny('Challenge not found.');
    const v = vibe(c.vibe_id);
    if (v.status !== 'active' || blockedWith(them(v).user_id)) deny('This Vibe isn’t active.');
    if (c.status !== 'waiting') deny('This challenge is finished.');
    const deck = challengeDeck(c.kind, c.deck);
    if (c.kind === 'two_truths') {
      if (answers.length !== 1 || !Number.isInteger(answers[0]) || answers[0] < 0 || answers[0] > 2) deny('Pick which one is the lie.');
    } else if (!deck || answers.length !== deck.questions.length || answers.some((a, i) => !Number.isInteger(a) || a < 0 || a >= deck.questions[i].options.length)) deny('Answer every question.');
    if (d().answers.some((a) => a.challenge_id === c.id && a.user_id === ME_ID)) deny('You already answered.');
    d().answers.push({ challenge_id: c.id, user_id: ME_ID, answers: [...answers] });
    if (d().answers.filter((a) => a.challenge_id === c.id).length >= 2) Object.assign(c, { status: 'completed', completed_at: new Date().toISOString() });
    touch(v);
    return c.status === 'completed' ? 'completed' : 'waiting';
  },
  fetchVibeLoops: async (cids) => demoChatVibes.loops(cids).map((l) => ({ ...l })),
  report: async (_uid, r) => {
    if (r.subjectId === ME_ID) deny('You can’t report yourself.');
    d().reports.push({ subject_id: r.subjectId, vibe_id: r.vibeId ?? null, context: r.context, reason: r.reason, note: r.note?.trim() || null });
  },
  subscribe: (_uid, onChange, opts) => {
    listeners.add(onChange);
    opts?.onStatus?.('SUBSCRIBED');
    return () => {
      listeners.delete(onChange);
    };
  },
  uploadCardPhoto: async (_uid, picked) => picked.uri,
  photoUrl: (path) => path ?? undefined,
};

/** Test/diagnostic view of what the Demo stored privately (never shown in the app). */
export const demoAfterDarkInternals = {
  /** Tests: the other person in a Vibe changes what you may send them (like their own Controls sheet). */
  setTheirControls: (vibeId: string, photos: boolean) => {
    const v = vibe(vibeId);
    them(v).allows_photos = photos;
    touch(v);
    emit();
  },
  closures: () => d().closures.map((c) => ({ ...c })),
  reports: () => d().reports.map((r) => ({ ...r })),
  passes: () => [...d().passes],
};
