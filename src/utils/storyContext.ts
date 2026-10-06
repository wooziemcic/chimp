/**
 * Phase 9: what a Story reply / reaction in a DM shows above the bubble.
 * Pure (unit-tested). The Story itself comes from the dataset, which only
 * ever holds Stories you may see that haven't expired — so a blocked, expired
 * or deleted Story is never shown, only the words around it.
 */
import type { Story } from '@/types/models';

export interface StoryContext {
  label: string;
  /** The Story's picture while it's live and visible to you. */
  image?: string;
  storyId?: string;
  /** "Story expired" / "Story unavailable" when it isn't. */
  gone?: string;
}

const LIFE = 24 * 3_600_000;

/** The server id of a Story frame (a World's copy of a frame is "<id>_w" on the phone). */
export const storyFrameId = (itemId: string) => (itemId.endsWith('_w') ? itemId.slice(0, -2) : itemId);

export function storyContext(
  m: { storyItemId?: string; storyKind?: 'reply' | 'reaction'; createdAt: string },
  mine: boolean,
  stories: readonly Story[],
  now: number,
): StoryContext | null {
  if (!m.storyItemId || !m.storyKind) return null;
  const label = m.storyKind === 'reaction' ? (mine ? 'You reacted to their story' : 'Reacted to your story') : mine ? 'You replied to their story' : 'Replied to your story';
  for (const st of stories) {
    const item = st.items.find((i) => storyFrameId(i.id) === m.storyItemId);
    if (!item) continue;
    const at = item.createdAtMs ?? Date.parse(item.createdAt);
    if (Number.isFinite(at) && now - at >= LIFE) break; // past 24 h
    return { label, image: item.image, storyId: st.id };
  }
  const sentAt = Date.parse(m.createdAt);
  const expired = !Number.isFinite(sentAt) || now - sentAt >= LIFE;
  return { label, gone: expired ? 'Story expired' : 'Story unavailable' };
}
