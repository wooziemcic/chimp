/**
 * Chimp's public World catalog (Phase 6A).
 *
 * These are the Worlds every REAL account can see, join and post into from
 * day one. They are *places*, not people: no seeded members, posts or
 * activity. The same rows are inserted into Postgres by
 * `supabase/migrations/0001_phase6a.sql` (keep the two in sync); the app
 * falls back to this list if the backend can't be reached.
 *
 * Onboarding interests map to these Worlds, and they anchor the REAL
 * Happening graph.
 */
import type { CategoryId, ID } from '@/types/models';
import { card, hero, type MediaKey } from './media';

export interface CatalogWorld {
  id: ID;
  title: string;
  tagline: string;
  category: CategoryId;
  /** Interests this World pulls on (first = primary). */
  interests: ID[];
  media: MediaKey;
  themeId: string;
  /** Social-proof verb, used only once there are real members. */
  verb: string;
  /** Onboarding chip. */
  emoji: string;
}

export const WORLD_CATALOG: CatalogWorld[] = [
  { id: 'travel', title: 'Travel', tagline: 'Trips, routes and the people you meet on the way.', category: 'travel', interests: ['i_travel', 'i_solo'], media: 'travelLake', themeId: 'lagoon', verb: 'exploring', emoji: '✈️' },
  { id: 'food', title: 'Food', tagline: 'Where to eat, what to cook, who to eat with.', category: 'culture', interests: ['i_food'], media: 'food', themeId: 'terracotta', verb: 'tasting', emoji: '🍜' },
  { id: 'film', title: 'Film', tagline: 'What to watch, where to see it, who to argue with.', category: 'culture', interests: ['i_film', 'i_art'], media: 'cinema', themeId: 'ember', verb: 'watching', emoji: '🎬' },
  { id: 'science', title: 'Science', tagline: 'Big questions, good explanations, curious people.', category: 'culture', interests: ['i_science', 'i_tech'], media: 'earth', themeId: 'violet', verb: 'diving in', emoji: '🔭' },
  { id: 'ai', title: 'AI', tagline: 'Building, testing and thinking about AI.', category: 'founders', interests: ['i_ai', 'i_tech'], media: 'laptop', themeId: 'electric', verb: 'building', emoji: '🤖' },
  { id: 'startups', title: 'Startups', tagline: 'Founders, operators and first customers.', category: 'founders', interests: ['i_startups', 'i_tech'], media: 'team', themeId: 'graphite', verb: 'building', emoji: '🚀' },
  { id: 'photography', title: 'Photography', tagline: 'Light, places and the stories behind the shot.', category: 'culture', interests: ['i_photo', 'i_travel'], media: 'camera', themeId: 'sunlight', verb: 'shooting', emoji: '📷' },
  { id: 'style', title: 'Style', tagline: 'Fits, finds and the way cities dress.', category: 'style', interests: ['i_style', 'i_vintage'], media: 'streetStyle', themeId: 'graphite', verb: 'styling', emoji: '🧥' },
  { id: 'culture', title: 'Culture', tagline: 'Art, design and the scenes worth knowing.', category: 'culture', interests: ['i_art', 'i_design', 'i_creativity'], media: 'gallery', themeId: 'jade', verb: 'creating', emoji: '🎨' },
  { id: 'sports', title: 'Sports', tagline: 'Games to watch, games to play.', category: 'culture', interests: ['i_sports', 'i_fitness'], media: 'running', themeId: 'citrus', verb: 'playing', emoji: '🏀' },
  { id: 'music', title: 'Music', tagline: 'Shows, records and the people behind them.', category: 'culture', interests: ['i_music'], media: 'concert', themeId: 'dusk', verb: 'listening', emoji: '🎧' },
  { id: 'gaming', title: 'Gaming', tagline: 'What you’re playing and who you play with.', category: 'culture', interests: ['i_gaming', 'i_tech'], media: 'gaming', themeId: 'electric', verb: 'playing', emoji: '🎮' },
  { id: 'books', title: 'Books', tagline: 'What you’re reading and what to read next.', category: 'culture', interests: ['i_books', 'i_art'], media: 'library', themeId: 'brass', verb: 'reading', emoji: '📚' },
  { id: 'fitness', title: 'Fitness', tagline: 'Training, routes, and people to move with.', category: 'culture', interests: ['i_fitness', 'i_wellness'], media: 'gym', themeId: 'jade', verb: 'training', emoji: '💪' },
];

export const CATALOG_BY_ID: Record<ID, CatalogWorld> = Object.fromEntries(WORLD_CATALOG.map((w) => [w.id, w]));

export const catalogCover = (w: CatalogWorld) => card(w.media);
export const catalogHero = (w: CatalogWorld) => hero(w.media);

/** Onboarding asks for 3–8. */
export const ONBOARDING_MIN = 3;
export const ONBOARDING_MAX = 8;
