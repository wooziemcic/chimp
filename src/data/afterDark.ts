import type { IdentityMode } from '@/types/models';
import { card } from './media';

export interface NightSection {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  count: number;
  people: string[];
  neon?: string;
  icon: 'confessions' | 'rooftops' | 'spicy' | 'guides' | 'private';
  badge?: string;
  /** Full-width card in the grid. */
  wide?: boolean;
}

export const NIGHT_SECTIONS: NightSection[] = [
  { id: 'confessions', icon: 'confessions', badge: '18+', title: 'Confessions', subtitle: 'Real people. Unfiltered thoughts. What happens at night, stays here.', image: card('redPortrait'), count: 2400, people: ['u_nia', 'u_leo', 'u_maya_c'] },
  { id: 'rooftops', icon: 'rooftops', title: 'Best Rooftop Bars', subtitle: 'Drinks, views and better company. Find the night’s best spots.', image: card('cityNight'), count: 1800, people: ['u_nia', 'u_alex_r', 'u_kenji'] },
  { id: 'spicy', icon: 'spicy', title: 'Spicy Stories', subtitle: 'Flirty, anonymous stories from real Chimp members.', image: card('neon'), count: 1100, people: ['u_leo', 'u_nia'] },
  { id: 'guides', icon: 'guides', title: 'Nightlife Guides', subtitle: 'Cities, clubs, events and insider tips. Make it a night to remember.', image: card('concert'), count: 892, people: ['u_kenji', 'u_alex_r'] },
  { id: 'private', icon: 'private', wide: true, title: 'Private Plans', subtitle: 'Discreet meetups, last-minute plans and like-minded people nearby.', image: card('wine'), count: 640, people: ['u_maya_c', 'u_alex_r', 'u_nia'] },
];

export interface NightThread {
  id: string;
  section: string;
  authorName: string;
  authorMode: IdentityMode;
  body: string;
  replies: number;
  reactions: number;
  at: string;
  poll?: { a: string; b: string; aPct: number };
}

/** Mature but non-explicit conversation (research §8.3). */
export const NIGHT_THREADS: NightThread[] = [
  { id: 'n1', section: 'confessions', authorName: 'Midnight Fox', authorMode: 'pseudonymous', body: 'I pretend to love natural wine on dates. I do not love natural wine.', replies: 84, reactions: 612, at: '1h' },
  { id: 'n2', section: 'confessions', authorName: 'Anonymous', authorMode: 'anonymous', body: 'Matched with my coworker on here last week. We have both been very professional about it. Mostly.', replies: 131, reactions: 1204, at: '3h' },
  { id: 'n3', section: 'spicy', authorName: 'Velvet Heron', authorMode: 'pseudonymous', body: 'Best first-date move you have seen?', replies: 212, reactions: 890, at: '2h', poll: { a: 'Plan the whole night', b: 'Let it unfold', aPct: 38 } },
  { id: 'n4', section: 'rooftops', authorName: 'Nia Brooks', authorMode: 'public', body: 'Tonight’s pick: the one above the Ludlow. Sunset at 7:12, arrive by 6:40.', replies: 46, reactions: 377, at: '40m' },
  { id: 'n5', section: 'guides', authorName: 'Kenji Watanabe', authorMode: 'public', body: 'Golden Gai rule of thumb: if there is a cover charge sign in English, keep walking.', replies: 58, reactions: 402, at: '5h' },
  { id: 'n6', section: 'spicy', authorName: 'Anonymous', authorMode: 'anonymous', body: 'Hot take: double-texting is fine if the first text was good.', replies: 167, reactions: 955, at: '6h', poll: { a: 'Agree', b: 'Never', aPct: 61 } },
  { id: 'n8', section: 'private', authorName: 'Copper Lynx', authorMode: 'pseudonymous', body: 'Late dinner in the South End tonight, table for four at 9. Two seats left. Good conversation required.', replies: 22, reactions: 140, at: '30m' },
  { id: 'n9', section: 'private', authorName: 'Anonymous', authorMode: 'anonymous', body: 'Last-minute: anyone going to the jazz set on Tremont after 10? Would rather not go alone.', replies: 17, reactions: 96, at: '2h' },
  { id: 'n7', section: 'confessions', authorName: 'Night Owl', authorMode: 'pseudonymous', body: 'I only go to the gym so I have a reason to say no to Tuesday plans.', replies: 39, reactions: 288, at: '8h' },
];
