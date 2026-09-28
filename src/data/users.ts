import type { OpenTo, Persona, ProfileMoment, ProfilePrompt, User } from '@/types/models';
import { avatar, card, hero, thumb } from './media';

export const ME_ID = 'u_wollymc';

/** Bundled, never hosted remotely. Replace the files to change the artwork. */
export const WOLLY_PORTRAIT = require('../../assets/profiles/wollymc.png') as number;
export const WOLLY_AVATAR = require('../../assets/profiles/wollymc-avatar.jpg') as number;

export const ME: User = {
  id: ME_ID,
  username: 'WollyMc',
  displayName: 'WollyMc',
  avatar: WOLLY_AVATAR,
  heroImage: WOLLY_PORTRAIT,
  heroCutout: true,
  cover: hero('santorini'),
  city: 'Boston, MA',
  bio: 'Curious about people, places and what comes next. Building something new, planning Japan, always up for a good rooftop.',
  interests: ['i_travel', 'i_japan', 'i_startups', 'i_food', 'i_film', 'i_creativity', 'i_nightlife', 'i_ai', 'i_photo', 'i_science'],
  verified: true,
  followers: 2184,
  following: 486,
  knownFor: ['Japan planning', 'startups', 'bringing people together'],
  openTo: ['friends', 'dating', 'collaboration', 'travel'],
  prompts: [
    { id: 'pr1', question: 'I’ll always say yes to…', answer: 'A spontaneous trip and somewhere with a good rooftop.' },
    { id: 'pr2', question: 'Currently obsessed with…', answer: 'Japan, AI products and finding great food.' },
    { id: 'pr3', question: 'Looking for…', answer: 'Interesting people who actually want to do things offline.' },
  ],
  moments: [
    { id: 'm1', label: 'Travel', image: card('amalfi'), ref: { kind: 'board', id: 'dream-destinations' } },
    { id: 'm2', label: 'Japan', image: card('kyotoTemple'), ref: { kind: 'board', id: 'japan-trip' } },
    { id: 'm3', label: 'Nightlife', image: card('cocktails'), ref: { kind: 'board', id: 'nyc-rooftops' } },
    { id: 'm4', label: 'Events', image: card('conference'), ref: { kind: 'board', id: 'boston-founders' } },
    { id: 'm5', label: 'Food', image: card('ramen'), ref: { kind: 'board', id: 'food-trails' } },
  ],
  gallery: [card('amalfi'), card('kyotoTemple'), card('cocktails'), card('conference')],
  profilePhrase: 'Good people, better plans',
  profileEmoji: '♡',
};

/** Contextual personas for WollyMc (research §5.4). */
export const MY_PERSONAS: Persona[] = [
  { id: 'pr_public', userId: ME_ID, mode: 'public', displayName: 'WollyMc', contexts: [] },
  { id: 'pr_night', userId: ME_ID, mode: 'pseudonymous', displayName: 'Velvet Otter', contexts: ['after-dark'] },
  { id: 'pr_anon', userId: ME_ID, mode: 'anonymous', displayName: 'Anonymous', contexts: [] },
];

type Seed = Omit<User, 'followers' | 'following'> & { followers?: number; following?: number };

const people: Seed[] = [
  { id: 'u_alex', username: 'alexchen', displayName: 'Alex Chen', avatar: avatar('p2'), city: 'San Francisco, CA', bio: 'Product designer. Built the Japan Trip board after my third trip. Sakura season or bust.', interests: ['i_japan', 'i_design', 'i_photo', 'i_travel'], verified: true, knownFor: ['Japan routes', 'Design'] },
  { id: 'u_maya_t', username: 'mayatanaka', displayName: 'Maya Tanaka', avatar: avatar('p10'), city: 'Kyoto, JP', bio: 'Kyoto local. Early mornings, quiet streets, better ramen.', interests: ['i_japan', 'i_food', 'i_photo'], verified: true, knownFor: ['Kyoto food', 'Temple walks'] },
  { id: 'u_daniel', username: 'danielkim', displayName: 'Daniel Kim', avatar: avatar('p13'), city: 'Los Angeles, CA', bio: 'Designer turning side projects into companies. Always looking for a co-founder who ships.', interests: ['i_design', 'i_travel', 'i_ai', 'i_startups'], verified: true, knownFor: ['AI product design'] },
  { id: 'u_maya_c', username: 'mayachen', displayName: 'Maya Chen', avatar: avatar('p6'), city: 'New York, NY', bio: 'Wellness founder, food obsessive, art on weekends.', interests: ['i_wellness', 'i_food', 'i_art', 'i_photo'], verified: true, knownFor: ['NYC food scene'] },
  { id: 'u_alex_r', username: 'alexrivera', displayName: 'Alex Rivera', avatar: avatar('p9'), city: 'Barcelona, ES', bio: 'Producer and DJ. Culture, tech and late nights.', interests: ['i_music', 'i_nightlife', 'i_tech'], knownFor: ['Barcelona nightlife'] },
  { id: 'u_priya', username: 'priyanair', displayName: 'Priya Nair', avatar: avatar('p11'), city: 'Boston, MA', bio: 'Second-time founder in climate. Organiser of Boston Founders.', interests: ['i_startups', 'i_ai', 'i_tech'], verified: true, knownFor: ['Boston founders', 'Trusted organiser'] },
  { id: 'u_jordan', username: 'jordanblake', displayName: 'Jordan Blake', avatar: avatar('p4'), city: 'Boston, MA', bio: 'Engineer, ex-robotics. Looking for the next hard problem.', interests: ['i_startups', 'i_ai', 'i_photo'], knownFor: ['Robotics', 'Helpful connector'] },
  { id: 'u_sofia', username: 'sofiamarin', displayName: 'Sofía Marín', avatar: avatar('p15'), city: 'Lisbon, PT', bio: 'Solo traveller, 41 countries. Writing the guide I wish I had.', interests: ['i_solo', 'i_travel', 'i_photo'], verified: true, knownFor: ['Solo travel'] },
  { id: 'u_kenji', username: 'kenjiw', displayName: 'Kenji Watanabe', avatar: avatar('p17'), city: 'Tokyo, JP', bio: 'Tokyo after dark. Bars, vinyl and back-alley yakitori.', interests: ['i_japan', 'i_nightlife', 'i_music', 'i_food'], knownFor: ['Tokyo nightlife'] },
  { id: 'u_lena', username: 'lenah', displayName: 'Lena Hoffmann', avatar: avatar('p8'), city: 'Berlin, DE', bio: 'Street style photographer. Documenting how cities dress.', interests: ['i_style', 'i_photo', 'i_vintage'], verified: true, knownFor: ['Street style'] },
  { id: 'u_omar', username: 'omarh', displayName: 'Omar Haddad', avatar: avatar('p18'), city: 'Boston, MA', bio: 'Angel investor and chronic introducer.', interests: ['i_startups', 'i_tech'], knownFor: ['Warm intros'] },
  { id: 'u_nia', username: 'niabrooks', displayName: 'Nia Brooks', avatar: avatar('p19'), city: 'New York, NY', bio: 'Rooftop scout. If there is a view, I have been there.', interests: ['i_nightlife', 'i_food', 'i_music'], knownFor: ['NYC rooftops'] },
  { id: 'u_theo', username: 'theolaurent', displayName: 'Théo Laurent', avatar: avatar('p20'), city: 'Paris, FR', bio: 'Creative director. Spaces, objects, light.', interests: ['i_design', 'i_art', 'i_creativity'], knownFor: ['Creative spaces'] },
  { id: 'u_aiko', username: 'aikomori', displayName: 'Aiko Mori', avatar: avatar('p12'), city: 'Osaka, JP', bio: 'Food writer. Osaka eats more than Tokyo, fight me.', interests: ['i_japan', 'i_food'], knownFor: ['Osaka food'] },
  { id: 'u_marcus', username: 'marcusreed', displayName: 'Marcus Reed', avatar: avatar('p7'), city: 'Austin, TX', bio: 'AI engineer who paints. Teaching creators to build with models.', interests: ['i_ai', 'i_creativity', 'i_art'], knownFor: ['AI for creators'] },
  { id: 'u_isabela', username: 'isabelac', displayName: 'Isabela Costa', avatar: avatar('p16'), city: 'Rio de Janeiro, BR', bio: 'Surf, content, community. Running Bali Surf & Create.', interests: ['i_travel', 'i_creativity', 'i_wellness'], knownFor: ['Creator retreats'] },
  { id: 'u_sam', username: 'samokafor', displayName: 'Sam Okafor', avatar: avatar('p14'), city: 'London, UK', bio: 'Menswear, vintage and the occasional hot take.', interests: ['i_style', 'i_vintage', 'i_music'], knownFor: ['Vintage menswear'] },
  { id: 'u_hana', username: 'hanasato', displayName: 'Hana Sato', avatar: avatar('p3'), city: 'Seoul, KR', bio: 'Illustrator. Seoul cafés are my office.', interests: ['i_art', 'i_design', 'i_creativity'], knownFor: ['Seoul creative scene'] },
  { id: 'u_zara', username: 'zaraa', displayName: 'Zara Ahmed', avatar: avatar('p1'), city: 'Boston, MA', bio: 'Product at a Series A startup. Japan in April — who else?', interests: ['i_japan', 'i_startups', 'i_travel', 'i_photo', 'i_food'], verified: true, knownFor: ['Product strategy'] },
  { id: 'u_leo', username: 'leahg', displayName: 'Leah Grant', avatar: avatar('p5'), city: 'Chicago, IL', bio: 'Musician and photographer. Chasing golden hour.', interests: ['i_music', 'i_photo', 'i_travel'], knownFor: ['Live music'] },
];

const heroFor: Record<string, string> = {
  u_alex: hero('fujiPagoda'),
  u_maya_t: hero('kyotoStreet'),
  u_daniel: hero('workspace'),
  u_maya_c: hero('restaurant'),
  u_alex_r: hero('concert'),
  u_priya: hero('conference'),
  u_sofia: hero('lisbon'),
  u_kenji: hero('tokyoLanterns'),
  u_lena: hero('streetStyle'),
  u_nia: hero('cityNight'),
  u_theo: hero('interior'),
  u_aiko: hero('osaka'),
  u_marcus: hero('laptop'),
  u_isabela: hero('surf'),
  u_hana: hero('seoul'),
  u_zara: hero('shibuya'),
};

// ─── Dating-style profile depth for the people WollyMc is most likely to meet ──

const OPEN_TO: Record<string, OpenTo[]> = {
  u_zara: ['friends', 'travel', 'networking'],
  u_maya_t: ['friends', 'dating', 'travel'],
  u_daniel: ['collaboration', 'networking', 'friends'],
  u_maya_c: ['friends', 'dating', 'events'],
  u_alex_r: ['friends', 'events'],
  u_jordan: ['collaboration', 'networking'],
  u_sofia: ['friends', 'travel'],
  u_kenji: ['friends', 'events', 'travel'],
  u_leo: ['friends', 'dating', 'collaboration'],
  u_priya: ['networking', 'events'],
  u_hana: ['collaboration', 'friends'],
};

const PROMPTS: Record<string, ProfilePrompt[]> = {
  u_zara: [
    { id: 'z1', question: 'This spring I’m…', answer: 'Eating my way from Shibuya to Osaka, April 8–15.' },
    { id: 'z2', question: 'Looking for…', answer: 'A small crew for a Tokyo food crawl. Bonus points for good playlists.' },
  ],
  u_daniel: [
    { id: 'd1', question: 'Looking for…', answer: 'A technical co-founder who ships on Fridays.' },
    { id: 'd2', question: 'Currently obsessed with…', answer: 'Tools that make AI feel like a pencil, not a panel.' },
  ],
  u_maya_c: [
    { id: 'mc1', question: 'Perfect Sunday…', answer: 'Farmers market, long lunch, gallery, early night.' },
    { id: 'mc2', question: 'I’ll always say yes to…', answer: 'A new dumpling spot and a walk after.' },
  ],
  u_alex_r: [
    { id: 'ar1', question: 'Best night out…', answer: 'Sunrise set, then churros.' },
    { id: 'ar2', question: 'Currently obsessed with…', answer: 'Modular synths and Barcelona rooftops.' },
  ],
  u_jordan: [
    { id: 'j1', question: 'Looking for…', answer: 'Someone who wants to build hardware that ships, not demos.' },
    { id: 'j2', question: 'Ask me about…', answer: 'Why most robots fail at doorknobs.' },
  ],
  u_sofia: [
    { id: 's1', question: 'Best trip so far…', answer: 'Three weeks in Patagonia with strangers who became family.' },
    { id: 's2', question: 'I’ll always say yes to…', answer: 'A night train.' },
  ],
  u_kenji: [
    { id: 'k1', question: 'In Tokyo, don’t miss…', answer: 'The 8-seat jazz bar I’ll tell you about in person.' },
    { id: 'k2', question: 'Looking for…', answer: 'People who want the Tokyo that isn’t on lists.' },
  ],
  u_leo: [
    { id: 'l1', question: 'Currently obsessed with…', answer: 'Film cameras and blue hour.' },
    { id: 'l2', question: 'Looking for…', answer: 'People to shoot with on weekends.' },
  ],
  u_priya: [{ id: 'p1', question: 'Ask me about…', answer: 'Hiring your first five engineers.' }],
  u_hana: [{ id: 'h1', question: 'Currently obsessed with…', answer: 'Risograph prints and Seongsu cafés.' }],
};

const MOMENTS: Record<string, [string, string][]> = {
  u_zara: [['Tokyo', 'shibuya'], ['Food', 'sushi'], ['Work', 'meeting']],
  u_daniel: [['Studio', 'workspace'], ['Travel', 'roadtrip'], ['Building', 'laptop']],
  u_maya_c: [['Food', 'food'], ['Art', 'gallery'], ['Weekends', 'restaurant']],
  u_alex_r: [['Music', 'concert'], ['Nights', 'party'], ['City', 'cityNight']],
  u_jordan: [['Building', 'team'], ['Photo', 'camera'], ['Boston', 'conference']],
  u_sofia: [['Travel', 'soloHiker'], ['Lisbon', 'lisbon'], ['Patagonia', 'patagonia']],
  u_kenji: [['Tokyo', 'tokyoLanterns'], ['Nights', 'tokyoNight'], ['Food', 'ramen2']],
  u_leo: [['Photo', 'camera'], ['Music', 'crowd'], ['Travel', 'travelLake']],
};

/**
 * Who each person is connected with — lets us compute mutual connections
 * deterministically ("2 mutual connections").
 */
export const PEOPLE_CONNECTIONS: Record<string, string[]> = {
  u_zara: ['u_priya', 'u_alex', 'u_jordan', 'u_omar'],
  u_daniel: ['u_marcus', 'u_hana', 'u_alex'],
  u_maya_c: ['u_nia', 'u_sofia', 'u_theo'],
  u_alex_r: ['u_nia', 'u_kenji'],
  u_jordan: ['u_priya', 'u_omar', 'u_zara'],
  u_sofia: ['u_isabela', 'u_leo', 'u_maya_c'],
  u_kenji: ['u_alex', 'u_maya_t', 'u_aiko'],
  u_leo: ['u_sofia', 'u_lena'],
  u_priya: ['u_jordan', 'u_omar', 'u_zara'],
  u_hana: ['u_theo', 'u_marcus'],
};

/** People who follow WollyMc (one-way). Used for follower / mutual-follow states. */
export const FOLLOWS_ME = ['u_alex', 'u_priya', 'u_sofia', 'u_lena', 'u_nia', 'u_hana', 'u_omar', 'u_maya_t'];

let n = 0;
export const PEOPLE: User[] = people.map((p) => {
  n += 1;
  return {
    followers: 800 + ((n * 7919) % 14000),
    following: 120 + ((n * 131) % 900),
    cover: heroFor[p.id] ?? hero('landscape'),
    heroImage: typeof p.avatar === 'string' ? p.avatar.replace('w=160', 'w=900') : p.avatar,
    openTo: OPEN_TO[p.id] ?? ['friends'],
    prompts: PROMPTS[p.id],
    moments: (MOMENTS[p.id] ?? []).map(
      ([label, key], i): ProfileMoment => ({ id: `${p.id}_m${i}`, label, image: thumb(key as Parameters<typeof thumb>[0]) }),
    ),
    ...p,
  } as User;
});

export const USERS: Record<string, User> = Object.fromEntries([ME, ...PEOPLE].map((u) => [u.id, u]));

export const OPEN_TO_LABEL: Record<OpenTo, string> = {
  friends: 'Friends',
  dating: 'Dating',
  casual: 'Casual',
  networking: 'Networking',
  collaboration: 'Collaboration',
  not_looking: 'Not looking',
  travel: 'Travel buddies',
  events: 'Events',
};

/**
 * Private Crushes other people have on WollyMc (prototype seed). Never shown
 * unless WollyMc crushes back, which makes it a Spark.
 */
export const CRUSHES_ON_ME = ['u_maya_c', 'u_leo', 'u_maya_t'];
