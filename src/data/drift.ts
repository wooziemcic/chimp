/**
 * Drift seed media — the visual layer. Every item belongs to a World
 * (Board) and a creator; nothing is an isolated media object.
 * Video items are static previews in the prototype (no streaming yet).
 */
import type { DriftItem } from '@/types/models';
import { card } from './media';

export const DRIFT: DriftItem[] = [
  // Japan / Tokyo
  { id: 'dr_ninenzaka', kind: 'video', boardId: 'japan-trip', authorId: 'u_maya_t', image: card('kyotoStreet'), caption: 'Ninenzaka at 6:40am, before the crowds.', durationSec: 24, likeCount: 4200, createdAt: '2h', ageHours: 2, tall: true },
  { id: 'dr_fuji', kind: 'carousel', boardId: 'japan-trip', authorId: 'u_alex', image: card('fujiPagoda'), images: [card('fujiPagoda'), card('japanShrine'), card('kyotoTemple')], caption: 'Chureito Pagoda: three angles, one very early train.', likeCount: 3100, createdAt: '5h', ageHours: 5 },
  { id: 'dr_golden_gai', kind: 'video', boardId: 'tokyo', authorId: 'u_kenji', image: card('tokyoLanterns'), caption: 'Scouting Saturday’s food-tour route. Six stops, all standing.', durationSec: 38, likeCount: 2800, createdAt: '4h', ageHours: 4, tall: true },
  { id: 'dr_ramen', kind: 'photo', boardId: 'food-trails', authorId: 'u_aiko', image: card('ramen'), caption: 'Solo booth, perfect bowl, zero small talk.', likeCount: 1900, createdAt: '7h', ageHours: 7, interests: ['i_japan'] },
  { id: 'dr_shibuya', kind: 'photo', boardId: 'japan-trip', authorId: 'u_zara', image: card('shibuya'), caption: 'Dates booked. Shibuya, see you April 8.', likeCount: 860, createdAt: '9h', ageHours: 9 },

  // Founders / AI
  { id: 'dr_demo_night', kind: 'video', boardId: 'boston-founders', authorId: 'u_priya', image: card('conference'), caption: '14 demos, one standing ovation. Last night in 40 seconds.', durationSec: 40, likeCount: 1300, createdAt: '6h', ageHours: 6, tall: true },
  { id: 'dr_desk', kind: 'photo', boardId: 'ai-builders', authorId: 'u_marcus', image: card('laptop'), caption: 'Today’s office: one model, one notebook, too much coffee.', likeCount: 720, createdAt: '10h', ageHours: 10 },

  // Style
  { id: 'dr_marais', kind: 'photo', boardId: 'street-style', authorId: 'u_lena', image: card('streetStyle'), caption: 'Leather season has officially started in Le Marais.', likeCount: 2600, createdAt: '3h', ageHours: 3, tall: true },
  { id: 'dr_market', kind: 'meme', boardId: 'vintage-finds', authorId: 'u_sam', image: card('fashion3'), memeText: 'Sunday market\n£20 budget\n£140 spent', caption: 'Every single time.', likeCount: 3300, createdAt: '8h', ageHours: 8 },
  { id: 'dr_depachika', kind: 'video', boardId: 'japan-trip', authorId: 'u_aiko', image: card('sushi'), caption: 'Ten minutes in a Tokyo food hall, no talking.', durationSec: 32, likeCount: 2300, createdAt: '6h', ageHours: 6, interests: ['i_food'] },

  // Films / Science (Phase 5)
  { id: 'dr_film_set', kind: 'video', boardId: 'indie-film', authorId: 'u_theo', image: card('filmSet'), caption: 'Day 3 on set. Forty people, one tiny street.', durationSec: 28, likeCount: 1700, createdAt: '5h', ageHours: 5, tall: true },
  { id: 'dr_space_earth', kind: 'photo', boardId: 'space', authorId: 'u_marcus', image: card('earthNight'), caption: 'Every city light is someone’s evening.', likeCount: 2100, createdAt: '8h', ageHours: 8 },

  // Travel / culture
  { id: 'dr_dolomites', kind: 'video', boardId: 'solo-travel', authorId: 'u_sofia', image: card('soloHiker'), caption: 'Nobody told me the view would be this good.', durationSec: 19, likeCount: 5100, createdAt: '5h', ageHours: 5, tall: true },
  { id: 'dr_mondays', kind: 'meme', boardId: 'solo-travel', authorId: 'u_isabela', image: card('beach'), memeText: 'Normalize taking Mondays\nin another country', caption: 'Asking for everyone.', likeCount: 6400, createdAt: '11h', ageHours: 11 },
  { id: 'dr_amalfi', kind: 'carousel', boardId: 'dream-destinations', authorId: 'u_isabela', image: card('amalfi'), images: [card('amalfi'), card('santorini')], caption: 'Two coasts worth rearranging a calendar for.', likeCount: 4800, createdAt: '12h', ageHours: 12 },
  { id: 'dr_long_table', kind: 'photo', boardId: 'food-trails', authorId: 'u_maya_c', image: card('food'), caption: 'Long table, strangers, great bread.', likeCount: 1500, createdAt: '6h', ageHours: 6 },
  { id: 'dr_film', kind: 'photo', boardId: 'photo-walks', authorId: 'u_leo', image: card('camera'), caption: 'Blue hour on Beacon Hill. Film, obviously.', likeCount: 690, createdAt: '13h', ageHours: 13 },
  { id: 'dr_seoul', kind: 'video', boardId: 'seoul-creatives', authorId: 'u_hana', image: card('seoul'), caption: 'Pop-up opening tonight in Seongsu.', durationSec: 27, likeCount: 1100, createdAt: '9h', ageHours: 9, tall: true },
  { id: 'dr_studio', kind: 'photo', boardId: 'creative-spaces', authorId: 'u_theo', image: card('interior'), caption: 'North light, one long desk, nothing else.', likeCount: 980, createdAt: '15h', ageHours: 15 },
  { id: 'dr_lisbon', kind: 'photo', boardId: 'lisbon-nomads', authorId: 'u_sofia', image: card('lisbon'), caption: 'Back in Lisbon for a month. Coffee?', likeCount: 830, createdAt: '14h', ageHours: 14 },

  // After Dark (NEVER shown in normal Drift; proves isolation)
  { id: 'dr_ad_night', kind: 'video', boardId: 'after-dark', authorId: 'u_nia', image: card('nightclub'), caption: 'Tonight in the scene.', durationSec: 15, likeCount: 900, createdAt: '1h', ageHours: 1 },
];

export const DRIFT_MAP: Record<string, DriftItem> = Object.fromEntries(DRIFT.map((d) => [d.id, d]));
