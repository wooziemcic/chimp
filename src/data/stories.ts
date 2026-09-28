import type { Story, StoryItem } from '@/types/models';
import { hero } from './media';
import { USERS } from './users';

const D = 5500;

function items(storyId: string, list: Omit<StoryItem, 'id' | 'storyId' | 'durationMs'>[]): StoryItem[] {
  return list.map((it, i) => ({ ...it, id: `${storyId}_${i + 1}`, storyId, durationMs: D }));
}

export const STORIES: Story[] = [
  // ── Trending across the graph (board / scene / move stories) ────────────
  {
    id: 'st_japan',
    owner: { kind: 'board', id: 'japan-trip' },
    title: 'Japan Trip',
    cover: hero('fujiPagoda'),
    lane: 'trending',
    items: items('st_japan', [
      { authorId: 'u_alex', image: hero('fujiPagoda'), caption: 'Mount Fuji hits different in person.', location: 'Chureito Pagoda', createdAt: '2h', boardId: 'japan-trip' },
      { authorId: 'u_maya_t', image: hero('kyotoStreet'), caption: 'Ninenzaka before the crowds. 6:40am.', location: 'Kyoto', createdAt: '5h', boardId: 'japan-trip' },
      { authorId: 'u_aiko', image: hero('ramen'), caption: 'Solo booth, perfect bowl, zero small talk.', location: 'Ichiran, Shibuya', createdAt: '7h', boardId: 'japan-trip' },
    ]),
  },
  {
    id: 'st_afterdark',
    owner: { kind: 'board', id: 'after-dark' },
    title: 'After Dark',
    cover: hero('nightclub'),
    lane: 'trending',
    items: items('st_afterdark', [
      { authorId: 'u_nia', image: hero('party'), caption: 'Rooftop season is not over. Not yet.', location: 'Lower East Side', createdAt: '1h', boardId: 'after-dark' },
      { authorId: 'u_alex_r', image: hero('concert'), caption: 'Sunrise set. Still going.', location: 'Barcelona', createdAt: '4h', boardId: 'after-dark' },
    ]),
  },
  {
    id: 'st_style',
    owner: { kind: 'board', id: 'street-style' },
    title: 'Street Style',
    cover: hero('streetStyle'),
    lane: 'trending',
    items: items('st_style', [
      { authorId: 'u_lena', image: hero('streetStyle'), caption: 'Leather season has officially started.', location: 'Le Marais, Paris', createdAt: '3h', boardId: 'street-style' },
      { authorId: 'u_sam', image: hero('fashion2'), caption: 'Found this at a Sunday market for £20.', location: 'Brick Lane', createdAt: '6h', boardId: 'street-style' },
    ]),
  },
  {
    id: 'st_founders',
    owner: { kind: 'board', id: 'boston-founders' },
    title: 'Founders',
    cover: hero('conference'),
    lane: 'trending',
    items: items('st_founders', [
      { authorId: 'u_priya', image: hero('conference'), caption: '14 demos tonight. The robotics one got a standing ovation.', location: 'Kendall Square', createdAt: '2h', boardId: 'boston-founders' },
      { authorId: 'u_omar', image: hero('meeting'), caption: 'Office hours are open Thursday. Bring your deck.', location: 'Boston', createdAt: '9h', boardId: 'boston-founders' },
    ]),
  },
  {
    id: 'st_food',
    owner: { kind: 'board', id: 'food-trails' },
    title: 'Food Trails',
    cover: hero('food'),
    lane: 'trending',
    items: items('st_food', [
      { authorId: 'u_maya_c', image: hero('food'), caption: 'Long table, strangers, great bread.', location: 'West Village', createdAt: '3h', boardId: 'food-trails' },
      { authorId: 'u_aiko', image: hero('sushi'), caption: 'Counter seats are the only seats.', location: 'Osaka', createdAt: '8h', boardId: 'food-trails' },
    ]),
  },
  {
    id: 'st_travel',
    owner: { kind: 'board', id: 'solo-travel' },
    title: 'Travel',
    cover: hero('soloHiker'),
    lane: 'trending',
    items: items('st_travel', [
      { authorId: 'u_sofia', image: hero('soloHiker'), caption: 'Nobody told me the view would be this good.', location: 'Dolomites', createdAt: '4h', boardId: 'solo-travel' },
      { authorId: 'u_isabela', image: hero('bali'), caption: 'Surf & Create applications close Friday.', location: 'Uluwatu, Bali', createdAt: '10h', moveId: 'mv_bali' },
    ]),
  },
  {
    id: 'st_tokyo_food_tour',
    owner: { kind: 'move', id: 'mv_tokyo_food' },
    title: 'Tokyo Food Tour',
    cover: hero('tokyoLanterns'),
    lane: 'trending',
    items: items('st_tokyo_food_tour', [
      { authorId: 'u_kenji', image: hero('tokyoLanterns'), caption: 'Scouting the route for Saturday. Six stops, all standing.', location: 'Shinjuku', createdAt: '5h', moveId: 'mv_tokyo_food', boardId: 'tokyo' },
    ]),
  },

  // ── Friends & connections ──────────────────────────────────────────────
  ...([
    ['u_zara', 'shibuya', 'Booked! Tokyo April 8–15.', 'Tokyo', 'japan-trip'],
    ['u_priya', 'speaker', 'Prepping for Thursday. Who is coming?', 'Cambridge, MA', 'boston-founders'],
    ['u_sofia', 'lisbon', 'Back in Lisbon for a month. Coffee?', 'Lisbon', 'lisbon-nomads'],
    ['u_lena', 'fashion3', 'New series dropping this week.', 'Berlin', 'street-style'],
    ['u_kenji', 'tokyoNight', 'Found a jazz bar with 8 seats.', 'Golden Gai', 'tokyo'],
    ['u_maya_t', 'kyotoTemple', 'Leaves are turning early this year.', 'Kyoto', 'japan-trip'],
    ['u_jordan', 'team', 'Prototype v2 works. Mostly.', 'Somerville', 'boston-founders'],
    ['u_hana', 'seoul', 'Pop-up opening tonight in Seongsu.', 'Seoul', 'seoul-creatives'],
    ['u_nia', 'cocktails', 'Tonight’s rooftop pick is up on the board.', 'New York', 'nyc-rooftops'],
  ] as const).map(([uid, img, caption, location, boardId]): Story => ({
    id: `st_f_${uid}`,
    owner: { kind: 'person', id: uid },
    title: USERS[uid].displayName,
    cover: USERS[uid].avatar ?? hero(img),
    lane: 'friend',
    items: items(`st_f_${uid}`, [
      { authorId: uid, image: hero(img), caption, location, createdAt: '3h', boardId },
    ]),
  })),
];

export const STORY_MAP: Record<string, Story> = Object.fromEntries(STORIES.map((s) => [s.id, s]));
