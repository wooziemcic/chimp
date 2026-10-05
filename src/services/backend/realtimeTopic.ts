/**
 * Phase 8: every Realtime subscription gets its own topic.
 *
 * supabase-js returns the EXISTING channel when asked for a topic it already
 * has — including one that is still being removed. Leaving a chat and opening
 * it again quickly (or a sign-in / reconnect restart) could then attach the new
 * listeners to a channel that is about to close, and live updates for that
 * chat silently stop. A per-subscription suffix makes each one independent.
 * (Topics are only names for postgres_changes; RLS still decides what arrives.)
 */
let seq = 0;
export function topicSeq(): string {
  seq = (seq + 1) % 1_000_000;
  return `${Date.now().toString(36)}${seq.toString(36)}`;
}
