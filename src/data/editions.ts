/**
 * Living Worlds (Phase 5): editorial metadata that lets the existing graph
 * personalise a Board's edition. Nothing here is ranked — `graph/worlds.ts`
 * orders it with the same relevance engine as every other surface.
 */
import type { EntityRef, ID } from '@/types/models';

export interface WorldTopic {
  id: ID;
  label: string;
  /** Interests the topic pulls on; its order follows your affinity. */
  interests: ID[];
  /** Where tapping the topic goes (a sub-World), if anywhere. */
  ref?: EntityRef;
}

/**
 * Topics per World. Same data for everyone; the order is personal:
 * WollyMc (food, travel) sees Tokyo · Food · Travel planning first,
 * someone into style and art sees Fashion · Culture · Kyoto first.
 */
export const WORLD_TOPICS: Record<ID, WorldTopic[]> = {
  'japan-trip': [
    { id: 'jp_tokyo', label: 'Tokyo', interests: ['i_japan', 'i_travel', 'i_food'], ref: { kind: 'board', id: 'tokyo' } },
    { id: 'jp_food', label: 'Food', interests: ['i_food', 'i_japan'], ref: { kind: 'board', id: 'food-trails' } },
    { id: 'jp_planning', label: 'Travel planning', interests: ['i_travel'], ref: { kind: 'board', id: 'solo-travel' } },
    { id: 'jp_kyoto', label: 'Kyoto', interests: ['i_japan', 'i_photo'] },
    { id: 'jp_night', label: 'Nightlife', interests: ['i_nightlife'] },
    { id: 'jp_culture', label: 'Culture', interests: ['i_art', 'i_design'] },
    { id: 'jp_fashion', label: 'Fashion', interests: ['i_style', 'i_vintage'], ref: { kind: 'board', id: 'street-style' } },
    { id: 'jp_anime', label: 'Anime', interests: ['i_art', 'i_film'] },
  ],
  tokyo: [
    { id: 'tk_food', label: 'Food', interests: ['i_food'] },
    { id: 'tk_neighbourhoods', label: 'Neighbourhoods', interests: ['i_travel', 'i_photo'] },
    { id: 'tk_design', label: 'Design', interests: ['i_design', 'i_art'] },
    { id: 'tk_style', label: 'Street style', interests: ['i_style'], ref: { kind: 'board', id: 'street-style' } },
  ],
  'indie-film': [
    { id: 'fm_festivals', label: 'Festivals', interests: ['i_film', 'i_travel'] },
    { id: 'fm_cinemas', label: 'Small cinemas', interests: ['i_film'] },
    { id: 'fm_making', label: 'Filmmaking', interests: ['i_creativity', 'i_photo'], ref: { kind: 'board', id: 'creative-spaces' } },
  ],
  space: [
    { id: 'sp_night_sky', label: 'Night-sky photos', interests: ['i_photo', 'i_science'], ref: { kind: 'board', id: 'photo-walks' } },
    { id: 'sp_launches', label: 'Launches', interests: ['i_science', 'i_tech'] },
    { id: 'sp_ai', label: 'AI for science', interests: ['i_ai', 'i_science'], ref: { kind: 'board', id: 'ai-builders' } },
  ],
  'boston-founders': [
    { id: 'bf_cofounders', label: 'Co-founders', interests: ['i_startups'] },
    { id: 'bf_ai', label: 'AI', interests: ['i_ai'], ref: { kind: 'board', id: 'ai-builders' } },
    { id: 'bf_events', label: 'Events', interests: ['i_startups', 'i_tech'] },
  ],
  'food-trails': [
    { id: 'ft_japan', label: 'Japan', interests: ['i_japan', 'i_food'], ref: { kind: 'board', id: 'japan-trip' } },
    { id: 'ft_markets', label: 'Markets', interests: ['i_food', 'i_travel'] },
    { id: 'ft_tables', label: 'Long tables', interests: ['i_food'] },
  ],
};

/** Which topics an item touches (Posts, Buzz, Drift, Tips by id). */
export const ITEM_TOPICS: Record<ID, ID[]> = {
  // Japan Trip
  p_kyoto_morning: ['jp_kyoto'],
  p_japan_poll: ['jp_planning', 'jp_tokyo'],
  p_kyoto_route: ['jp_kyoto', 'jp_planning'],
  p_ichiran: ['jp_food', 'jp_tokyo'],
  p_shibuya: ['jp_tokyo'],
  p_osaka: ['jp_food'],
  t1: ['jp_planning'],
  t2: ['jp_kyoto'],
  t3: ['jp_planning'],
  t4: ['jp_planning'],
  bz_kyoto_early: ['jp_kyoto'],
  bz_japan_news: ['jp_kyoto'],
  bz_japan_note: ['jp_planning'],
  bz_kyoto_poll: ['jp_kyoto'],
  bz_jp_news_bloom: ['jp_kyoto'],
  bz_jp_news_foodhall: ['jp_food', 'jp_tokyo'],
  bz_jp_news_osaka: ['jp_food'],
  bz_jp_meme: ['jp_tokyo', 'jp_fashion'],
  bz_jp_tokyo_food: ['jp_food', 'jp_tokyo'],
  dr_ninenzaka: ['jp_kyoto'],
  dr_fuji: ['jp_planning', 'jp_culture'],
  dr_shibuya: ['jp_tokyo'],
  dr_depachika: ['jp_food', 'jp_tokyo'],
  // Films / Science
  bz_film_note: ['fm_cinemas'],
  bz_film_news: ['fm_festivals'],
  dr_film_set: ['fm_making'],
  bz_space_news: ['sp_night_sky'],
  bz_space_post: ['sp_night_sky'],
  dr_space_earth: ['sp_night_sky'],
};

/**
 * Seeded poll votes by other people (Buzz and Board polls). Used for
 * conversation starters like "You disagreed on Maya's Kyoto poll".
 */
export const OTHER_VOTES: Record<ID, Record<ID, ID>> = {
  bz_kyoto_poll: { u_maya_t: 'arashiyama', u_zara: 'fushimi', u_alex: 'kiyomizu', u_leo: 'fushimi' },
  bz_tokyo_poll: { u_maya_c: 'yakitori', u_kenji: 'yakitori', u_maya_t: 'ramen', u_zara: 'ramen' },
  p_japan_poll: { u_maya_t: 'kyoto', u_zara: 'tokyo', u_kenji: 'tokyo', u_alex: 'kyoto' },
};

/** Short names for polls in conversation context ("Maya’s Kyoto poll"). */
export const POLL_NAMES: Record<ID, string> = {
  bz_kyoto_poll: 'Kyoto poll',
  bz_tokyo_poll: 'Tokyo food poll',
  p_japan_poll: 'Japan city poll',
};
