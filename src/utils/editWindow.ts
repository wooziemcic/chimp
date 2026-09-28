/** Phase 6D: posts and replies can be edited for this long (the server has the same rule). */
export const EDIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Minutes left to edit, by this phone's clock. A hint for the ••• menu only:
 * the server's clock decides.
 */
export function editMinutesLeft(createdAtMs: number | undefined, now = Date.now()): number {
  if (!createdAtMs) return 0;
  return Math.max(0, Math.ceil((createdAtMs + EDIT_WINDOW_MS - now) / 60_000));
}
