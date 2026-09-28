/**
 * Remote photography catalogue (Unsplash, hot-linked under the Unsplash
 * License). Keeping every image behind a key means swapping to your own CDN,
 * Supabase storage or bundled assets later is a one-file change.
 */
const IDS = {
  // Japan
  fujiPagoda: '1490806843957-31f4c9a91c65',
  tokyoNight: '1540959733332-eab4deabeeaf',
  tokyoLanterns: '1554797589-7241bb691973',
  shibuya: '1542051841857-5f90071e7989',
  kyotoStreet: '1545569341-9eb8b30979d9',
  kyotoTemple: '1493976040374-85c8e12f0c0e',
  japanShrine: '1528360983277-13d401cdc186',
  osaka: '1590559899731-a382839e5549',
  ramen: '1557872943-16a5ac26437e',
  ramen2: '1569718212165-3a8278d5f624',
  sushi: '1579871494447-9811cf80d66c',
  matcha: '1515823064-d6e0c04616a7',
  // Style
  streetStyle: '1515886657613-9f3515b0c78f',
  fashion2: '1509631179647-0177331693ae',
  fashion3: '1483985988355-763728e1935b',
  // Night
  nightclub: '1566417713940-fe7c737a9ef2',
  concert: '1514525253161-7a46d19cd819',
  crowd: '1501386761578-eac5c94b800a',
  cocktails: '1470337458703-46ad1756a187',
  bar: '1514933651103-005eec06c04b',
  party: '1519671482749-fd09be7ccebf',
  cityNight: '1477959858617-67f85cf4f1df',
  neon: '1563089145-599997674d42',
  redPortrait: '1496440737103-cd596325d314',
  lights: '1533174072545-7a4b6ad7a6c3',
  disco: '1504509546545-e000b4a62425',
  wine: '1510812431401-41d2bd2722f3',
  // Travel
  soloHiker: '1501555088652-021faa106b9b',
  travelLake: '1476514525535-07fb3b4ae5f1',
  roadtrip: '1469854523086-cc02fe5d8800',
  beach: '1507525428034-b723cf961d3e',
  landscape: '1500530855697-b586d89ba3ee',
  amalfi: '1533105079780-92b9be482077',
  bali: '1537996194471-e657df975ab4',
  surf: '1502680390469-be75c86b636f',
  lisbon: '1555881400-74d7acaacd8b',
  patagonia: '1531761535209-180857e963b9',
  seoul: '1538485399081-7191377e8241',
  rome: '1552832230-c0197dd311b5',
  florence: '1541370976299-4d24ebbc9077',
  santorini: '1570077188670-e3a8d69ac5ff',
  // Work / culture
  workspace: '1497215728101-856f4ea42174',
  interior: '1524758631624-e2822e304c36',
  office: '1497366216548-37526070297c',
  conference: '1540575467063-178a50c2df87',
  team: '1522202176988-66273c2fd55f',
  meeting: '1517245386807-bb43f82c33c4',
  speaker: '1475721027785-f74eccf877e2',
  laptop: '1498050108023-c5249f4df085',
  popup: '1492684223066-81342ee5ff30',
  camera: '1452587925148-ce544e77e70d',
  gallery: '1554907984-15263bfd63bd',
  eventCrowd: '1531058020387-3be344556be6',
  food: '1504674900247-0877df9cc836',
  restaurant: '1414235077428-338989a2e8c0',
  // Films / Science (Phase 5)
  cinema: '1489599849927-2ee91cede3ba',
  filmSet: '1485846234645-a62644f84728',
  movieNight: '1536440136628-849c177e76a1',
  earth: '1446776811953-b23d57bd21aa',
  earthNight: '1451187580459-43490279c0fa',
  galaxy: '1462331940025-496dfbfc7564',
  lab: '1532094349884-543bc11b234d',
  // Phase 6A World catalog
  library: '1481627834876-b7833e8f5570',
  gaming: '1542751371-adc38448a05e',
  gym: '1517836357463-d25dfeac3438',
  running: '1461896836934-ffe607ba8211',
  // Portraits
  p1: '1494790108377-be9c29b29330',
  p2: '1507003211169-0a1dd7228f2d',
  p3: '1438761681033-6461ffad8d80',
  p4: '1500648767791-00dcc994a43e',
  p5: '1534528741775-53994a69daeb',
  p6: '1517841905240-472988babdf9',
  p7: '1539571696357-5a69c17a67c6',
  p8: '1524504388940-b1c1722653e1',
  p9: '1506794778202-cad84cf45f1d',
  p10: '1544005313-94ddf0286df2',
  p11: '1531123897727-8f129e1688ce',
  p12: '1488426862026-3ee34a7d66df',
  p13: '1492562080023-ab3db95bfbce',
  p14: '1519085360753-af0119f7cbe7',
  p15: '1508214751196-bcfd4ca60f91',
  p16: '1529626455594-4ff0802cfb7e',
  p17: '1504257432389-52343af06ae3',
  p18: '1522075469751-3a6694fb2f61',
  p19: '1580489944761-15a19d654956',
  p20: '1463453091185-61582044d556',
} as const;

export type MediaKey = keyof typeof IDS;

/** Width presets tuned for iPhone 12 (3x) without over-fetching. */
export const W = { avatar: 160, thumb: 320, card: 640, hero: 1080 } as const;

export function img(key: MediaKey, width: number = W.card): string {
  return `https://images.unsplash.com/photo-${IDS[key]}?auto=format&fit=crop&w=${width}&q=72`;
}

export const avatar = (key: MediaKey) => img(key, W.avatar);
export const hero = (key: MediaKey) => img(key, W.hero);
export const card = (key: MediaKey) => img(key, W.card);
export const thumb = (key: MediaKey) => img(key, W.thumb);
