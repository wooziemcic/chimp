import type { CategoryId, Interest } from '@/types/models';

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'travel', label: 'Travel' },
  { id: 'culture', label: 'Culture' },
  { id: 'style', label: 'Style' },
  { id: 'founders', label: 'Founders' },
  { id: 'afterDark', label: 'After Dark' },
];

export const INTERESTS: Interest[] = [
  { id: 'i_travel', label: 'Travel', category: 'travel' },
  { id: 'i_japan', label: 'Japan', category: 'travel' },
  { id: 'i_solo', label: 'Solo travel', category: 'travel' },
  { id: 'i_italy', label: 'Italy', category: 'travel' },
  { id: 'i_food', label: 'Food', category: 'culture' },
  { id: 'i_photo', label: 'Photography', category: 'culture' },
  { id: 'i_art', label: 'Art', category: 'culture' },
  { id: 'i_music', label: 'Music', category: 'culture' },
  { id: 'i_design', label: 'Design', category: 'culture' },
  { id: 'i_creativity', label: 'Creativity', category: 'culture' },
  { id: 'i_wellness', label: 'Wellness', category: 'culture' },
  { id: 'i_film', label: 'Films', category: 'culture' },
  { id: 'i_science', label: 'Science', category: 'culture' },
  // Phase 6A onboarding interests
  { id: 'i_sports', label: 'Sports', category: 'culture' },
  { id: 'i_gaming', label: 'Gaming', category: 'culture' },
  { id: 'i_books', label: 'Books', category: 'culture' },
  { id: 'i_fitness', label: 'Fitness', category: 'culture' },
  { id: 'i_style', label: 'Style', category: 'style' },
  { id: 'i_vintage', label: 'Vintage', category: 'style' },
  { id: 'i_startups', label: 'Startups', category: 'founders' },
  { id: 'i_ai', label: 'AI', category: 'founders' },
  { id: 'i_tech', label: 'Tech', category: 'founders' },
  { id: 'i_nightlife', label: 'Nightlife', category: 'afterDark' },
  { id: 'i_dating', label: 'Dating', category: 'afterDark' },
];

export const interestById = Object.fromEntries(INTERESTS.map((i) => [i.id, i])) as Record<
  string,
  Interest
>;
