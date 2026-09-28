import { repo } from '@/services/repository';
import type { ChangeEvent, EntityRef } from '@/types/models';

/**
 * Does a change concern this entity? Directly, or through containment:
 * a post or Story inside a Board, a Story owned by a person or Move.
 */
export function touches(change: Pick<ChangeEvent, 'ref'>, ref: EntityRef): boolean {
  const c = change.ref;
  if (c.kind === ref.kind && c.id === ref.id) return true;
  if (ref.kind === 'board') {
    if (c.kind === 'post') return repo.post(c.id)?.boardId === ref.id;
    if (c.kind === 'story') {
      const st = repo.story(c.id);
      return !!st && st.owner.kind === 'board' && st.owner.id === ref.id;
    }
  }
  if ((ref.kind === 'person' || ref.kind === 'move') && c.kind === 'story') {
    const st = repo.story(c.id);
    return !!st && st.owner.kind === ref.kind && st.owner.id === ref.id;
  }
  return false;
}

export function unseenChanges(changes: ChangeEvent[]): ChangeEvent[] {
  return changes.filter((c) => !c.seen).sort((a, b) => b.createdAt - a.createdAt);
}

export function freshCount(changes: ChangeEvent[], ref: EntityRef): number {
  let n = 0;
  for (const c of changes) if (!c.seen && touches(c, ref)) n += 1;
  return n;
}

export function freshFor(changes: ChangeEvent[], ref: EntityRef): ChangeEvent[] {
  return changes.filter((c) => !c.seen && touches(c, ref)).sort((a, b) => b.createdAt - a.createdAt);
}
