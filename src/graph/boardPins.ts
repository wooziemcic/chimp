import type { Board } from '@/types/models';
import { isAfterDarkBoard } from './surfaces';

/**
 * Phase 9.2: pinned Boards, newest pin first (the most recently pinned sits
 * at the far left). Only Boards in your world (ones you may still see);
 * pins of anything else simply don't show.
 */
export function pinnedBoards(boardMap: Record<string, Board>, pins: Record<string, number>): Board[] {
  return Object.keys(pins)
    .map((id) => boardMap[id])
    .filter((b): b is Board => !!b && !isAfterDarkBoard(b))
    .sort((a, b) => pins[b.id] - pins[a.id] || (a.id < b.id ? -1 : 1));
}
