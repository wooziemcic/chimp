/**
 * Buzz seed content — conversation that belongs to Worlds.
 *
 * NEWS ITEMS ARE DEMO FIXTURES. They are written for the prototype, carry
 * `demo: true` and the source label "Demo source", and must never be
 * presented as live reporting. Live ingestion is out of scope (Phase 4).
 */
import type { BuzzItem, BuzzReply } from '@/types/models';
import { card } from './media';

const DEMO = 'Demo source';

export const BUZZ: BuzzItem[] = [
  // ── Japan / Tokyo ──────────────────────────────────────────────────────
  {
    id: 'bz_kyoto_early', kind: 'post', boardId: 'japan-trip', authorId: 'u_maya_t', createdAt: '2h', ageHours: 2,
    body: 'Kyoto rule nobody tells you: the city belongs to you until 7:30am. After that it belongs to the tour buses. Set the alarm.',
    likeCount: 612, replyCount: 48, repostCount: 31, layout: 'half',
  },
  {
    id: 'bz_japan_news', kind: 'news', boardId: 'japan-trip', createdAt: '3h', ageHours: 3,
    image: card('kyotoTemple'),
    news: {
      headline: 'Kyoto temple district trials timed morning entry',
      summary: 'A spring pilot spreads visitors across the early hours at two popular temple gardens. Members are comparing notes on which slots are worth it.',
      source: DEMO, category: 'travel', demo: true,
    },
    likeCount: 1180, replyCount: 164, repostCount: 72, layout: 'full',
  },
  {
    id: 'bz_tokyo_poll', kind: 'poll', boardId: 'tokyo', authorId: 'u_kenji', createdAt: '4h', ageHours: 4,
    body: 'First night in Tokyo. Where are you eating?',
    poll: { question: 'First night in Tokyo. Where are you eating?', options: [
      { id: 'yakitori', label: 'Yakitori alley', votes: 842 },
      { id: 'ramen', label: 'Ramen counter', votes: 1210 },
      { id: 'depachika', label: 'Department-store food hall', votes: 406 },
    ] },
    likeCount: 355, replyCount: 97, repostCount: 12, layout: 'half',
  },
  {
    id: 'bz_zara_crew', kind: 'post', boardId: 'japan-trip', authorId: 'u_zara', createdAt: '5h', ageHours: 5,
    body: 'Tokyo April 8–15. Looking for two more people for the food crawl on the 12th. Boston folks get priority, obviously.',
    likeCount: 288, replyCount: 41, repostCount: 9, layout: 'half',
  },
  {
    id: 'bz_japan_note', kind: 'note', boardId: 'japan-trip', authorId: 'u_alex', createdAt: '9h', ageHours: 9,
    title: 'The JR Pass maths, finally',
    body: 'I ran our last three trips through the numbers. If you are doing Tokyo → Kyoto → Osaka and back once, the pass rarely wins anymore. It wins when you add Hiroshima or Kanazawa. Buy point-to-point for the triangle, and spend the difference on one great ryokan night. Luggage forwarding is the real hack: ¥2,000 and your hands are free for the whole Kyoto day.',
    likeCount: 947, replyCount: 132, repostCount: 88, layout: 'full',
  },
  {
    id: 'bz_osaka_meme', kind: 'meme', boardId: 'food-trails', authorId: 'u_aiko', createdAt: '7h', ageHours: 7,
    image: card('osaka'), memeText: 'Me: one more stop\nAlso me: 11 stops later',
    likeCount: 1430, replyCount: 58, repostCount: 211, layout: 'half',
  },

  // ── Boston Founders / AI ───────────────────────────────────────────────
  {
    id: 'bz_ship_weird', kind: 'post', boardId: 'boston-founders', authorId: 'u_priya', createdAt: '2h', ageHours: 2,
    body: 'Building in public is chaotic but underrated. The embarrassment fades, the distribution sticks. Ship the weird version.',
    likeCount: 342, replyCount: 57, repostCount: 18, layout: 'half',
  },
  {
    id: 'bz_bf_news', kind: 'news', boardId: 'boston-founders', createdAt: '6h', ageHours: 6,
    image: card('conference'),
    news: {
      headline: 'Kendall Square demo night adds a co-founder matching table',
      summary: 'Organisers say the table pairs builders by stage and skills. The Boston Founders Board is collecting who is going.',
      source: DEMO, category: 'founders', demo: true,
    },
    likeCount: 402, replyCount: 61, repostCount: 24, layout: 'full',
  },
  {
    id: 'bz_ai_take', kind: 'post', boardId: 'ai-builders', authorId: 'u_marcus', createdAt: '8h', ageHours: 8,
    body: 'Hot take: the best AI products this year feel like a pencil, not a cockpit. Fewer panels, more defaults.',
    likeCount: 520, replyCount: 88, repostCount: 40, layout: 'half',
  },
  {
    id: 'bz_jordan_cofounder', kind: 'post', boardId: 'boston-founders', authorId: 'u_jordan', createdAt: '11h', ageHours: 11,
    body: 'Looking for a design-minded co-founder for robotics x AI. Prototype v2 works. Mostly. Coffee in Somerville on me.',
    likeCount: 219, replyCount: 34, repostCount: 11, layout: 'half',
  },

  // ── Style (includes the demo's "unrelated" item) ───────────────────────
  {
    id: 'bz_same_fit', kind: 'post', boardId: 'street-style', authorId: 'u_lena', createdAt: '5h', ageHours: 5,
    body: 'Same fit, different city. A good outfit travels farther than you think.',
    images: [card('streetStyle'), card('fashion3')],
    likeCount: 476, replyCount: 62, repostCount: 11, layout: 'half',
  },
  {
    id: 'bz_loafers', kind: 'poll', boardId: 'vintage-finds', authorId: 'u_sam', createdAt: '6h', ageHours: 6,
    body: 'Settle it.',
    poll: { question: 'Loafers with socks?', options: [
      { id: 'yes', label: 'Always', votes: 640 },
      { id: 'no', label: 'Never', votes: 588 },
    ] },
    likeCount: 301, replyCount: 190, repostCount: 22, layout: 'half',
  },
  {
    id: 'bz_style_meme', kind: 'meme', boardId: 'founder-fits', authorId: 'u_sam', createdAt: '10h', ageHours: 10,
    image: card('fashion2'), memeText: 'Series A fit\nvs\nSeed round fit',
    likeCount: 870, replyCount: 44, repostCount: 120, layout: 'half',
  },

  // ── Travel / culture ───────────────────────────────────────────────────
  {
    id: 'bz_coastal', kind: 'news', boardId: 'dream-destinations', createdAt: '4h', ageHours: 4,
    image: card('amalfi'),
    news: {
      headline: '5 coastal towns that feel unreal (and aren’t overrun yet)',
      summary: 'A member-built list with ferry times, where to stay, and the one month to avoid.',
      source: DEMO, category: 'travel', demo: true,
    },
    likeCount: 1520, replyCount: 97, repostCount: 140, layout: 'half',
  },
  {
    id: 'bz_rich_life', kind: 'post', boardId: 'creative-spaces', authorId: 'u_theo', createdAt: '8h', ageHours: 8,
    body: 'There’s a real shift happening: people care more about a rich life than a big resume, and I love to see it.',
    likeCount: 891, replyCount: 93, repostCount: 28, layout: 'full',
  },
  {
    id: 'bz_mondays', kind: 'meme', boardId: 'solo-travel', authorId: 'u_sofia', createdAt: '12h', ageHours: 12,
    image: card('beach'), memeText: 'Normalize taking Mondays\nin another country',
    likeCount: 2210, replyCount: 130, repostCount: 402, layout: 'half',
  },
  {
    id: 'bz_food_convo', kind: 'post', boardId: 'food-trails', authorId: 'u_maya_c', createdAt: '9h', ageHours: 9,
    body: 'Good food creates better conversations. Long tables, strangers, one shared bread basket. That’s the whole plan.',
    image: card('restaurant'),
    likeCount: 640, replyCount: 52, repostCount: 33, layout: 'half',
  },
  {
    id: 'bz_photo_walk', kind: 'post', boardId: 'photo-walks', authorId: 'u_leo', createdAt: '14h', ageHours: 14,
    body: 'Beacon Hill, Sunday 8am, film cameras welcome. Blue hour is the whole point, so no latecomers.',
    likeCount: 180, replyCount: 22, repostCount: 6, layout: 'half',
  },
  {
    id: 'bz_lisbon', kind: 'post', boardId: 'lisbon-nomads', authorId: 'u_isabela', createdAt: '16h', ageHours: 16,
    body: 'Lisbon co-working tip: the best desks are the ones with a view of the river and zero Wi-Fi. Go offline, ship more.',
    likeCount: 260, replyCount: 19, repostCount: 14, layout: 'half',
  },

  // ── Phase 5: Living Worlds (Japan edition, Films, Science) ─────────────
  {
    id: 'bz_jp_news_bloom', kind: 'news', boardId: 'japan-trip', createdAt: '5h', ageHours: 5,
    image: card('japanShrine'),
    news: {
      headline: 'Early-bloom watch: members track the first sakura in Kyoto',
      summary: 'A members’ thread is logging daily bloom photos from temple gardens and comparing them with last spring, so April trips can plan around the peak.',
      source: DEMO, category: 'travel', demo: true,
    },
    likeCount: 840, replyCount: 96, repostCount: 41, layout: 'full',
  },
  {
    id: 'bz_jp_news_foodhall', kind: 'news', boardId: 'japan-trip', createdAt: '8h', ageHours: 8,
    image: card('sushi'),
    news: {
      headline: 'Tokyo food-hall guide gets a spring refresh',
      summary: 'The community depachika map adds twelve counters and a “worth the queue” tag, voted by members who ate there this month.',
      source: DEMO, category: 'culture', demo: true,
    },
    likeCount: 710, replyCount: 58, repostCount: 37, layout: 'full',
  },
  {
    id: 'bz_jp_news_osaka', kind: 'news', boardId: 'japan-trip', createdAt: '14h', ageHours: 14,
    image: card('osaka'),
    news: {
      headline: 'Osaka street-food week draws members from across Kansai',
      summary: 'Food Trails and Japan Trip members are pooling a shared route for Dotonbori and Kuromon, with a meetup thread for first-timers.',
      source: DEMO, category: 'culture', demo: true,
    },
    likeCount: 530, replyCount: 44, repostCount: 22, layout: 'full',
  },
  {
    id: 'bz_jp_meme', kind: 'meme', boardId: 'japan-trip', authorId: 'u_kenji', createdAt: '6h', ageHours: 6,
    image: card('shibuya'), memeText: 'Me: packing light for Japan\nMe on day 3: second suitcase',
    likeCount: 1650, replyCount: 71, repostCount: 260, layout: 'half',
  },
  {
    id: 'bz_jp_tokyo_food', kind: 'post', boardId: 'japan-trip', authorId: 'u_aiko', createdAt: '3h', ageHours: 3,
    body: 'Tokyo food plan that actually works: one sit-down dinner a day, everything else standing counters and food halls. You eat twice as much and never queue longer than ten minutes.',
    likeCount: 488, replyCount: 39, repostCount: 26, layout: 'half', interests: ['i_food'],
  },
  {
    id: 'bz_kyoto_poll', kind: 'poll', boardId: 'japan-trip', authorId: 'u_maya_t', createdAt: '5h', ageHours: 5,
    body: 'Kyoto locals’ question for April visitors.',
    poll: { question: 'One Kyoto morning, one alarm. Which is worth it?', options: [
      { id: 'fushimi', label: 'Fushimi Inari at 6am', votes: 918 },
      { id: 'kiyomizu', label: 'Kiyomizu-dera at opening', votes: 604 },
      { id: 'arashiyama', label: 'Arashiyama bamboo at 7am', votes: 772 },
    ] },
    likeCount: 402, replyCount: 88, repostCount: 19, layout: 'half',
  },
  {
    id: 'bz_film_note', kind: 'note', boardId: 'indie-film', authorId: 'u_theo', createdAt: '4h', ageHours: 4,
    title: 'Why small cinemas feel better',
    body: 'Eighty seats, one screen, someone who picked the film on purpose. You arrive early, you stay for the credits, you talk about it outside. The film is the same as at home; the attention is not. Find one near you and go twice this month.',
    likeCount: 530, replyCount: 61, repostCount: 44, layout: 'full',
  },
  {
    id: 'bz_film_news', kind: 'news', boardId: 'indie-film', createdAt: '9h', ageHours: 9,
    image: card('cinema'),
    news: {
      headline: 'Festival season: members post their indie shortlists',
      summary: 'The Indie Film World is collecting one-line reviews from this season’s festival screenings into a shared watchlist.',
      source: DEMO, category: 'culture', demo: true,
    },
    likeCount: 390, replyCount: 52, repostCount: 18, layout: 'full',
  },
  {
    id: 'bz_space_news', kind: 'news', boardId: 'space', createdAt: '6h', ageHours: 6,
    image: card('earth'),
    news: {
      headline: 'Members plan a dark-sky weekend for the meteor shower',
      summary: 'Space members are choosing a low-light spot outside Boston and sharing camera settings for long exposures.',
      source: DEMO, category: 'culture', demo: true,
    },
    likeCount: 460, replyCount: 38, repostCount: 21, layout: 'full',
  },
  {
    id: 'bz_space_post', kind: 'post', boardId: 'space', authorId: 'u_marcus', createdAt: '11h', ageHours: 11,
    body: 'Hot take: the best science communication right now is people posting their backyard telescope photos with the settings underneath.',
    likeCount: 310, replyCount: 27, repostCount: 12, layout: 'half',
  },

  // ── After Dark (NEVER shown in normal Buzz; proves isolation) ─────────
  {
    id: 'bz_ad_rooftop', kind: 'post', boardId: 'after-dark', authorId: 'u_nia', createdAt: '1h', ageHours: 1,
    body: 'Tonight’s rooftop pick is live in After Dark.',
    likeCount: 377, replyCount: 46, repostCount: 5, layout: 'half',
  },
];

export const BUZZ_MAP: Record<string, BuzzItem> = Object.fromEntries(BUZZ.map((b) => [b.id, b]));

export const SEED_BUZZ_REPLIES: BuzzReply[] = [
  { id: 'br1', buzzId: 'bz_kyoto_early', authorId: 'u_alex', body: 'Fushimi Inari at 6am is a different planet.', createdAt: '1h' },
  { id: 'br2', buzzId: 'bz_kyoto_early', authorId: 'u_zara', body: 'Saving this for April.', createdAt: '40m' },
  { id: 'br3', buzzId: 'bz_japan_note', authorId: 'u_kenji', body: 'Luggage forwarding is undefeated.', createdAt: '6h' },
  { id: 'br4', buzzId: 'bz_ship_weird', authorId: 'u_omar', body: 'Distribution sticks is the whole thing.', createdAt: '1h' },
  { id: 'br6', buzzId: 'bz_jp_tokyo_food', authorId: 'u_maya_c', body: 'Food halls at 5pm are the move. Everything is fresh and half the crowd.', createdAt: '2h' },
  { id: 'br5', buzzId: 'bz_zara_crew', authorId: 'u_aiko', body: 'If you do Osaka too, I have a list.', createdAt: '3h' },
];
