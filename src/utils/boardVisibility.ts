import type { Board } from '@/types/models';

/**
 * Phase 9.2: the three kinds of Board, named the same everywhere
 * ("Private Board", "Connections Board", "Public Board"). Older data with the
 * legacy 'members' value reads as Private (members only).
 */
export type BoardAccess = 'private' | 'connections' | 'public';

export const BOARD_ACCESS: Record<BoardAccess, { label: string; short: string; body: string }> = {
  private: { label: 'Private Board', short: 'Private', body: 'Only you and the people you add can see it.' },
  connections: { label: 'Connections Board', short: 'Connections', body: 'Your connections can find it and ask to join. Nobody else sees it.' },
  public: { label: 'Public Board', short: 'Public', body: 'Anyone on Chimp can find it and follow it. People ask to join; you approve.' },
};

export const ACCESS_ORDER: BoardAccess[] = ['private', 'connections', 'public'];

export function accessOf(board: Pick<Board, 'visibility'> | undefined): BoardAccess {
  const v = board?.visibility;
  return v === 'connections' || v === 'public' ? v : v === 'private' || v === 'members' ? 'private' : 'public';
}
