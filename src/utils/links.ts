import type { Href } from 'expo-router';

import { repo } from '@/services/repository';
import type { EntityRef } from '@/types/models';

/** Route for any graph node. */
export function hrefFor(ref: EntityRef): Href {
  switch (ref.kind) {
    case 'board':
      return `/board/${ref.id}`;
    case 'move':
      return `/move/${ref.id}`;
    case 'person':
      return `/profile/${ref.id}`;
    case 'post': {
      const p = repo.post(ref.id);
      return p ? `/board/${p.boardId}` : '/boards';
    }
    case 'story':
      return `/story/${ref.id}`;
    case 'buzz':
      return `/buzz/${ref.id}`;
    case 'drift':
      return `/drift/${ref.id}`;
    default:
      return '/loops';
  }
}

