import type { OpenLoop, PersonRecommendation } from '@/types/models';

/**
 * People Chimp may suggest, with the intents they're open to. Scores and
 * reasons here are the seed a future ranking service would return; the app
 * now recomputes both from the live graph (services/../graph/relevance).
 */
export const PERSON_RECS: PersonRecommendation[] = [
  {
    id: 'r_zara', personId: 'u_zara', score: 94, intents: ['friend', 'professional'],
    reasons: [
      { kind: 'sameMove', label: 'You’re both in Tokyo Apr 8–15', ref: { kind: 'board', id: 'japan-trip' } },
      { kind: 'sharedBoard', label: 'You both follow Japan Trip', ref: { kind: 'board', id: 'japan-trip' } },
    ],
  },
  {
    id: 'r_daniel', personId: 'u_daniel', score: 92, intents: ['collaborator'],
    reasons: [
      { kind: 'sharedGoal', label: 'You’re both looking for a co-founder', ref: { kind: 'loop', id: 'lp_cofounder' } },
      { kind: 'sharedInterests', label: 'You share Design + Travel' },
    ],
  },
  {
    id: 'r_maya_c', personId: 'u_maya_c', score: 88, intents: ['friend', 'romantic'],
    reasons: [
      { kind: 'sharedInterests', label: 'You share Food + Photography' },
      { kind: 'sharedBoard', label: 'You both saved Food Trails', ref: { kind: 'board', id: 'food-trails' } },
    ],
  },
  {
    id: 'r_alex_r', personId: 'u_alex_r', score: 84, intents: ['friend'],
    reasons: [
      { kind: 'sameMove', label: 'You’ll both be at Rooftop Night', ref: { kind: 'move', id: 'mv_rooftop' } },
      { kind: 'sharedInterests', label: 'You share Music + Culture' },
    ],
  },
  {
    id: 'r_jordan', personId: 'u_jordan', score: 90, intents: ['collaborator', 'professional'],
    reasons: [
      { kind: 'sharedGoal', label: 'Looking for a co-founder in Boston', ref: { kind: 'loop', id: 'lp_cofounder' } },
      { kind: 'sameMove', label: 'You’ll both be at Boston Founders', ref: { kind: 'move', id: 'mv_boston_meetup' } },
    ],
  },
  {
    id: 'r_sofia', personId: 'u_sofia', score: 81, intents: ['friend'],
    reasons: [{ kind: 'sharedInterests', label: 'You share Travel + Photography' }],
  },
  {
    id: 'r_kenji', personId: 'u_kenji', score: 86, intents: ['friend'],
    reasons: [
      { kind: 'samePlace', label: 'You’re both exploring Tokyo', ref: { kind: 'board', id: 'tokyo' } },
      { kind: 'sharedGoal', label: 'Knows Tokyo nightlife (one of your Open Loops)', ref: { kind: 'loop', id: 'lp_tokyo_night' } },
    ],
  },
  {
    id: 'r_ethan_leo', personId: 'u_leo', score: 79, intents: ['friend', 'romantic'],
    reasons: [{ kind: 'sharedGoal', label: 'Also wants to meet photographers', ref: { kind: 'loop', id: 'lp_photo' } }],
  },
  {
    id: 'r_priya', personId: 'u_priya', score: 83, intents: ['professional'],
    reasons: [{ kind: 'sharedBoard', label: 'Organiser of Boston Founders', ref: { kind: 'board', id: 'boston-founders' } }],
  },
  {
    id: 'r_hana', personId: 'u_hana', score: 76, intents: ['collaborator', 'friend'],
    reasons: [{ kind: 'sharedInterests', label: 'You share Creativity + Design' }],
  },
];

/** Loops WollyMc has open at the start of the demo. */
export const SEED_OPEN_LOOPS: OpenLoop[] = [
  { id: 'lp_boston_people', title: 'Find interesting people in Boston', short: 'Boston people loop', icon: 'users', status: 'active', origin: 'seed', interests: ['i_startups', 'i_nightlife', 'i_food'], createdAt: '2026-09-18', related: [{ kind: 'person', id: 'u_zara' }, { kind: 'board', id: 'boston-founders' }, { kind: 'move', id: 'mv_photo_walk' }] },
  { id: 'lp_italy27', title: 'Plan Italy 2027', short: 'Italy 2027 loop', icon: 'map', status: 'active', origin: 'seed', interests: ['i_italy', 'i_travel'], createdAt: '2026-07-19', related: [{ kind: 'board', id: 'italy-2027' }, { kind: 'move', id: 'mv_amalfi' }] },
  { id: 'lp_cofounder', title: 'Meet a possible co-founder', short: 'co-founder loop', icon: 'users', status: 'active', origin: 'seed', interests: ['i_startups', 'i_ai'], createdAt: '2026-08-12', related: [{ kind: 'person', id: 'u_jordan' }, { kind: 'person', id: 'u_daniel' }, { kind: 'move', id: 'mv_boston_meetup' }] },
  { id: 'lp_founder_event', title: 'Attend a founder event', short: 'founder-event loop', icon: 'calendar', status: 'active', origin: 'seed', interests: ['i_startups'], createdAt: '2026-09-10', related: [{ kind: 'move', id: 'mv_boston_meetup' }, { kind: 'move', id: 'mv_ai_creators' }] },
  { id: 'lp_photo', title: 'Meet people interested in photography', short: 'photography loop', icon: 'camera', status: 'active', origin: 'seed', interests: ['i_photo'], createdAt: '2026-09-15', related: [{ kind: 'board', id: 'photo-walks' }, { kind: 'move', id: 'mv_photo_walk' }, { kind: 'person', id: 'u_leo' }] },
];

/**
 * Loops Chimp can suggest once your graph points at them. Opening one is an
 * explicit act ("Open loop"), which is what makes the app reorganise.
 */
export const SUGGESTED_LOOPS: OpenLoop[] = [
  { id: 'lp_japan_buddy', title: 'Find a travel buddy for Japan', short: 'Japan travel loop', icon: 'plane', status: 'active', origin: 'suggested', interests: ['i_japan', 'i_travel'], createdAt: '2026-09-23', related: [{ kind: 'person', id: 'u_zara' }, { kind: 'board', id: 'japan-trip' }, { kind: 'move', id: 'mv_tokyo_food' }] },
  { id: 'lp_tokyo_night', title: 'Explore Tokyo nightlife', short: 'Tokyo nightlife loop', icon: 'moon', status: 'active', origin: 'suggested', interests: ['i_japan', 'i_nightlife'], createdAt: '2026-09-23', related: [{ kind: 'person', id: 'u_kenji' }, { kind: 'board', id: 'tokyo' }] },
];
