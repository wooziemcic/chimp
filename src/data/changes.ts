/**
 * World Delta content: the first-launch changes and the pool of plausible
 * off-session changes. Every pool entry has a condition, so it is only ever
 * released when it is actually relevant to WollyMc's graph (no filler).
 */
import type { ChangeCondition, ChangeEvent, ChangeType, EntityRef } from '@/types/models';

/** What a template can read when composing its text at release time. */
export interface ComposeContext {
  following: Record<string, true>;
  connections: Record<string, unknown>;
  joined: Record<string, true>;
  firstName: (id: string) => string;
  boardMembers: (boardId: string) => string[];
}

export interface ChangeTemplate {
  key: string;
  type: ChangeType;
  ref: EntityRef;
  importance: 1 | 2 | 3;
  message: string;
  detail?: string;
  count?: number;
  reason: string;
  when?: ChangeCondition;
  /** Optional state-dependent text; return null to skip this release. */
  compose?: (ctx: ComposeContext) => Partial<Pick<ChangeEvent, 'message' | 'detail' | 'reason' | 'count'>> | null;
}

const H = 3600 * 1000;

/** Stamped relative to first launch so the prototype opens with a few real changes. */
export function seedChanges(now: number): ChangeEvent[] {
  const base = { seen: false, source: 'seed' as const };
  return [
    { ...base, key: 'seed_zara', id: 'c_seed_zara', type: 'PERSON_BECAME_RELEVANT', ref: { kind: 'person', id: 'u_zara' }, importance: 2, message: 'Zara Ahmed is planning Japan for April', detail: 'Also in Boston. Looking for a small Tokyo food-crawl crew.', reason: 'You’re both in Boston and into Japan', createdAt: now - 2 * H },
    { ...base, key: 'seed_bf_meetup', id: 'c_seed_bf_meetup', type: 'MOVE_OPENED', ref: { kind: 'move', id: 'mv_boston_meetup' }, importance: 3, message: 'Boston Founders Meetup opened RSVPs', detail: 'Co-founder matching table added. 342 going.', reason: 'Open Loop: Meet a possible co-founder', createdAt: now - 3 * H },
    { ...base, key: 'seed_poll', id: 'c_seed_poll', type: 'BOARD_ACTIVITY', ref: { kind: 'post', id: 'p_japan_poll' }, importance: 1, message: 'Tokyo is pulling ahead in Japan Trip', detail: '“Which city are you most excited for?” 1.8K votes so far.', reason: 'Alex, who you follow, started this poll', createdAt: now - 5 * H },
    { ...base, key: 'seed_tokyo', id: 'c_seed_tokyo', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'tokyo' }, importance: 1, message: 'Tokyo scene is busy tonight', detail: '214 people exploring right now. Kenji posted a new alley spot.', count: 214, reason: 'Japan is one of your interests', createdAt: now - 7 * H },
    { ...base, key: 'seed_bf_posts', id: 'c_seed_bf_posts', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'boston-founders' }, importance: 1, message: '5 new posts in Boston Founders', detail: 'Omar opened Thursday office hours for decks.', count: 5, reason: 'You joined this board', createdAt: now - 9 * H },
  ];
}

/**
 * Off-session pool. Released on return (1–3 at a time), strongest first,
 * and only when `when` holds for the current graph.
 */
export const CHANGE_POOL: ChangeTemplate[] = [
  {
    key: 'tokyo_food_closing', type: 'MOVE_CLOSING', ref: { kind: 'move', id: 'mv_tokyo_food' }, importance: 3,
    message: 'Tokyo Food Tour: 2 spots left in the Apr 12 group', detail: 'Groups are matched by arrival dates.', reason: 'You’re interested in this Move',
    when: { any: [{ moveEngaged: 'mv_tokyo_food' }, { loopActive: 'lp_japan_buddy' }] },
  },
  {
    key: 'maya_story_japan', type: 'STORY_UPDATE', ref: { kind: 'story', id: 'st_japan' }, importance: 2,
    message: 'Maya posted a new Story in Japan Trip', detail: 'Ninenzaka before the crowds. 6:40am.', reason: 'You follow Maya',
    when: { any: [{ following: 'u_maya_t' }, { connected: 'u_maya_t' }] },
  },
  {
    key: 'japan_members_follow', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'japan-trip' }, importance: 2,
    message: 'People you know are planning in Japan Trip', reason: 'You joined Japan Trip',
    when: { joined: 'japan-trip' },
    compose: (c) => {
      const known = c.boardMembers('japan-trip').filter((id) => c.following[id] || c.connections[id]);
      if (known.length < 2) return null;
      return { message: `${known.length} people you know are planning in Japan Trip`, detail: known.map(c.firstName).join(', '), count: known.length };
    },
  },
  {
    key: 'zara_dates', type: 'STORY_UPDATE', ref: { kind: 'story', id: 'st_f_u_zara' }, importance: 2,
    message: 'Zara shared her Tokyo dates', detail: '“Booked! Tokyo April 8–15.”', reason: 'You’re both planning Japan',
    when: { all: [{ notBlocked: 'u_zara' }, { any: [{ loopActive: 'lp_japan_buddy' }, { following: 'u_zara' }, { affinityAtLeast: ['i_japan', 0.65] }] }] },
  },
  {
    key: 'zara_crew', type: 'NEW_CONNECTION_ACTIVITY', ref: { kind: 'person', id: 'u_zara' }, importance: 3,
    message: 'Zara is looking for 2 more people for the Tokyo food crawl', detail: 'She asked her connections first.', reason: 'You’re connected with Zara',
    when: { connected: 'u_zara' },
  },
  {
    key: 'kyoto_route_update', type: 'BOARD_ACTIVITY', ref: { kind: 'post', id: 'p_kyoto_route' }, importance: 2,
    message: 'Maya added a sunrise stop to Kyoto Temple Walk', detail: 'Fushimi Inari before 7am, then the walk.', reason: 'You saved this route',
    when: { savedPost: 'p_kyoto_route' },
  },
  {
    key: 'kenji_jazz', type: 'STORY_UPDATE', ref: { kind: 'story', id: 'st_f_u_kenji' }, importance: 1,
    message: 'Kenji found an 8-seat jazz bar in Golden Gai', reason: 'You’re exploring Tokyo',
    when: { any: [{ following: 'u_kenji' }, { loopActive: 'lp_tokyo_night' }, { joined: 'tokyo' }] },
  },
  {
    key: 'jordan_cofounder', type: 'PERSON_BECAME_RELEVANT', ref: { kind: 'person', id: 'u_jordan' }, importance: 3,
    message: 'Jordan Blake posted a co-founder search', detail: 'Robotics x AI, Boston. Mentions design partners.', reason: 'Open Loop: Meet a possible co-founder',
    when: { all: [{ loopActive: 'lp_cofounder' }, { notBlocked: 'u_jordan' }] },
  },
  {
    key: 'photo_walk', type: 'MOVE_OPENED', ref: { kind: 'move', id: 'mv_photo_walk' }, importance: 2,
    message: 'A photo walk opened near you', detail: 'Beacon Hill, Sunday 8am. 6 spots left.', reason: 'Open Loop: Meet people interested in photography',
    when: { any: [{ loopActive: 'lp_photo' }, { joined: 'photo-walks' }] },
  },
  {
    key: 'amalfi_price', type: 'MOVE_OPENED', ref: { kind: 'move', id: 'mv_amalfi' }, importance: 2,
    message: 'Amalfi Escape dropped its price', detail: 'Now €1,450 for 7 days.', reason: 'Open Loop: Plan Italy 2027',
    when: { loopActive: 'lp_italy27' },
  },
  {
    key: 'alex_guide', type: 'NEW_CONNECTION_ACTIVITY', ref: { kind: 'board', id: 'japan-trip' }, importance: 2,
    message: 'Alex pinned a first-timer’s guide in Japan Trip', detail: 'JR Pass maths, luggage forwarding, last trains.', reason: 'Alex is one of your connections',
    when: { all: [{ connected: 'u_alex' }, { joined: 'japan-trip' }] },
  },
  {
    key: 'maya_connection', type: 'NEW_CONNECTION_ACTIVITY', ref: { kind: 'person', id: 'u_maya_t' }, importance: 2,
    message: 'Maya shared her Kyoto morning spots with connections', reason: 'You’re connected with Maya',
    when: { connected: 'u_maya_t' },
  },
  {
    key: 'japan_tips', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'japan-trip' }, importance: 1,
    message: '7 new tips in Japan Trip', detail: 'Luggage forwarding and last-train advice.', count: 7, reason: 'You joined this board',
    when: { joined: 'japan-trip' },
  },
  {
    key: 'bf_office_hours', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'boston-founders' }, importance: 1,
    message: 'Omar opened office hours in Boston Founders', detail: 'Thursday, 30-minute deck reviews.', reason: 'You joined this board',
    when: { joined: 'boston-founders' },
  },
  {
    key: 'priya_checklist', type: 'NEW_CONNECTION_ACTIVITY', ref: { kind: 'person', id: 'u_priya' }, importance: 1,
    message: 'Priya shared a hiring checklist with her connections', reason: 'You’re connected with Priya',
    when: { connected: 'u_priya' },
  },
  {
    key: 'after_dark_pick', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'after-dark' }, importance: 1,
    message: 'After Dark picked tonight’s rooftop', detail: 'Nia’s pick is live. 5.2K in the scene.', reason: 'Nightlife is one of your interests',
    when: { affinityAtLeast: ['i_nightlife', 0.35] },
  },
  {
    key: 'style_poll', type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: 'street-style' }, importance: 1,
    message: 'Street Style has a heated poll', detail: '“Are loafers with socks back?” 1.2K votes.', reason: 'You’ve been looking at style',
    when: { affinityAtLeast: ['i_style', 0.25] },
  },
];
