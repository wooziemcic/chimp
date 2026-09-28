/**
 * Board factory — the one place a Board object is assembled.
 *
 * Seed Boards, and later user-created ones, are described by a small
 * `BoardSeed`. The factory derives the slug, resolves the theme from its id
 * and fills safe defaults, so creating a Board never means new layout code.
 * (Phase 3 prepares the model only; there is no creation UI yet.)
 */
import { getBoardTheme } from '@/theme/boardThemes';
import type { Board, BoardTemplate, BoardType, BoardVisibility, CategoryId, IdentityMode } from '@/types/models';

export type BoardSeed = Omit<Board, 'slug' | 'theme' | 'type' | 'visibility' | 'relatedBoardIds'> &
  Partial<Pick<Board, 'slug' | 'type' | 'visibility' | 'relatedBoardIds'>>;

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function makeBoard(seed: BoardSeed): Board {
  return {
    ...seed,
    slug: seed.slug ?? slugify(seed.title),
    type: seed.type ?? 'curated',
    visibility: seed.visibility ?? (seed.type === 'private' ? 'private' : 'public'),
    theme: getBoardTheme(seed.themeId),
    relatedBoardIds: seed.relatedBoardIds ?? [],
  };
}

/** Applies RELATED_TO pairs symmetrically (A↔B), without duplicates. */
export function linkBoards(boards: Board[], relations: Record<string, string[]>): Board[] {
  const map = new Map<string, Set<string>>(boards.map((b) => [b.id, new Set(b.relatedBoardIds)]));
  for (const [a, list] of Object.entries(relations)) {
    for (const b of list) {
      if (!map.has(a) || !map.has(b) || a === b) continue;
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
  }
  return boards.map((b) => ({ ...b, relatedBoardIds: [...map.get(b.id)!] }));
}

/** Input a future "Create Board" flow would collect. */
export interface NewBoardInput {
  title: string;
  ownerId: string;
  category: CategoryId;
  interests: string[];
  themeId: string;
  cover: string;
  tagline?: string;
  type?: Extract<BoardType, 'user_created' | 'private'>;
  visibility?: BoardVisibility;
  location?: string;
  canonicalParentId?: string;
  template?: BoardTemplate;
  identityModes?: IdentityMode[];
}

/**
 * Builds a user-created Board. Chimp controls the recipe: only a known
 * template and a theme id are accepted, so no Board can bring its own layout.
 */
export function createUserBoard(input: NewBoardInput, now = new Date()): Board {
  const slug = slugify(input.title);
  return makeBoard({
    id: `ub_${slug}_${now.getTime().toString(36)}`,
    slug,
    title: input.title.trim(),
    tagline: input.tagline ?? '',
    type: input.type ?? 'user_created',
    visibility: input.visibility ?? (input.type === 'private' ? 'private' : 'public'),
    category: input.category,
    interests: input.interests,
    cover: input.cover,
    hero: input.cover,
    memberCount: 1,
    ideaCount: 0,
    activityVerb: 'planning',
    ownerId: input.ownerId,
    createdAt: now.toISOString(),
    memberPreview: [input.ownerId],
    themeId: input.themeId,
    template: input.template === 'nightlife' ? 'nightlife' : 'standard',
    pulseShape: 'card',
    editorial: 50,
    identityModes: input.identityModes ?? ['public'],
    relatedBoardIds: input.canonicalParentId ? [input.canonicalParentId] : [],
    location: input.location,
    canonicalParentId: input.canonicalParentId,
  });
}
