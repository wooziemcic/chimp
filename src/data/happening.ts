/**
 * Happening (Phase 5): the seeded shape of WollyMc's interest graph.
 *
 * Worlds run left → right as a gentle zig-zag; each carries a few
 * branches (sub-Worlds, people, Moves, Buzz). Positions are computed
 * deterministically in `graph/happening.ts`; what's here is the shape.
 * Onboarding will choose these later; for now they're WollyMc's.
 * No nightlife / dating / After Dark branches, by design.
 */
import type { EntityRef, ID } from '@/types/models';

export interface HappeningWorldDef {
  id: ID;
  label: string;
  interests: ID[];
  /** The World (Board) this interest opens; also supplies "8.4K planning". */
  anchor: ID;
  /** Shown when the branch is strong (your graph leans this way). */
  strong?: EntityRef;
  /** Revealed when you open the branch (2–4, strongest first). */
  branches: EntityRef[];
  /** REAL: the anchor IS the World node itself (a catalog World), so it isn't repeated as a branch. */
  anchorIsWorld?: boolean;
}

const b = (id: ID): EntityRef => ({ kind: 'board', id });
const p = (id: ID): EntityRef => ({ kind: 'person', id });
const m = (id: ID): EntityRef => ({ kind: 'move', id });
const z = (id: ID): EntityRef => ({ kind: 'buzz', id });

export const HAPPENING_WORLDS: HappeningWorldDef[] = [
  { id: 'h_photo', label: 'Photography', interests: ['i_photo'], anchor: 'photo-walks', strong: p('u_leo'), branches: [b('photo-walks'), m('mv_photo_walk'), p('u_leo'), z('bz_photo_walk')] },
  { id: 'h_founders', label: 'Founders', interests: ['i_startups'], anchor: 'boston-founders', strong: m('mv_boston_meetup'), branches: [b('boston-founders'), m('mv_boston_meetup'), p('u_priya'), b('lisbon-nomads')] },
  { id: 'h_films', label: 'Films', interests: ['i_film'], anchor: 'indie-film', strong: p('u_theo'), branches: [b('indie-film'), z('bz_film_news'), p('u_theo'), b('creative-spaces')] },
  { id: 'h_travel', label: 'Travel', interests: ['i_travel', 'i_solo'], anchor: 'solo-travel', strong: b('dream-destinations'), branches: [b('solo-travel'), b('dream-destinations'), p('u_sofia'), m('mv_patagonia')] },
  { id: 'h_japan', label: 'Japan', interests: ['i_japan'], anchor: 'japan-trip', strong: b('tokyo'), branches: [b('japan-trip'), b('tokyo'), m('mv_tokyo_food'), p('u_maya_t')] },
  { id: 'h_food', label: 'Food', interests: ['i_food'], anchor: 'food-trails', strong: p('u_aiko'), branches: [b('food-trails'), p('u_aiko'), z('bz_osaka_meme'), m('mv_tokyo_food')] },
  { id: 'h_science', label: 'Science', interests: ['i_science'], anchor: 'space', strong: p('u_marcus'), branches: [b('space'), z('bz_space_news'), p('u_marcus')] },
  { id: 'h_ai', label: 'AI', interests: ['i_ai'], anchor: 'ai-builders', strong: m('mv_ai_creators'), branches: [b('ai-builders'), m('mv_ai_creators'), p('u_daniel')] },
  { id: 'h_culture', label: 'Culture', interests: ['i_art', 'i_design', 'i_creativity'], anchor: 'creative-spaces', strong: b('seoul-creatives'), branches: [b('creative-spaces'), b('seoul-creatives'), p('u_hana'), m('mv_creator_popup')] },
  { id: 'h_style', label: 'Style', interests: ['i_style', 'i_vintage'], anchor: 'street-style', strong: b('vintage-finds'), branches: [b('street-style'), b('vintage-finds'), p('u_lena')] },
];

/** Where the canvas opens: centred between these two Worlds. */
export const HAPPENING_START_BETWEEN: [ID, ID] = ['h_travel', 'h_japan'];
