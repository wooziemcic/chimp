/**
 * Reliability patch — keep ONE post current without reloading the world.
 *
 * Before: any like / comment / reply / World-post event re-ran the full world
 * load (~24 requests, every Buzz/Drift/Story row, every comment, every
 * member's profile), throttled to once a minute — so a count was either
 * expensive or stale. Now:
 *
 *   like event          → that post's like total (1 RPC, batched with others)
 *   comment / reply     → that Buzz's comments (1 small query)
 *   new post in a World → that post (+ its media) if it isn't loaded yet
 *   opening a post      → its like total and comments now (a notification tap
 *                         shows the newest count at once), unless synced
 *                         moments ago
 *
 * Requests for the same post coalesce; several posts' likes go in one call.
 * The full world load still runs on its own schedule (foreground after 10 min,
 * pull to refresh) and stays the authority.
 */
import { fetchComments, fetchLikeTotalsFor, fetchPeople, fetchPostsByIds } from '@/services/backend/content';
import { diag } from '@/services/backend/errors';
import { toReply, toUser } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';

export type PostKind = 'buzz' | 'drift';
export interface SyncWhat {
  likes?: boolean;
  comments?: boolean;
  /** Fetch the post itself if it isn't loaded (a new post, or a notification for an older one). */
  row?: boolean;
}

/** Tunables (exported for tests). */
export const POST_SYNC = {
  /** Events arriving together become one round of requests. */
  batchMs: 400,
  /** Opening a post that was synced this recently (e.g. its like event just landed) doesn't sync again. */
  freshMs: 3_000,
  /** At most this many posts' comments per batch. */
  maxCommentFetches: 6,
};

const queue = new Map<string, { kind: PostKind; id: string; what: SyncWhat }>();
const syncedAt = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
/** Requests made by this module (tests / census). */
export const postSyncStats = { flushes: 0, likeCalls: 0, commentCalls: 0, rowCalls: 0 };

const keyOf = (kind: PostKind, id: string) => `${kind}:${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Queue a targeted refresh (merged with anything already queued for that post). */
export function queuePostSync(kind: PostKind, id: string | null | undefined, what: SyncWhat): void {
  if (!id || !UUID.test(id) || !realData.real.active()) return;
  const k = keyOf(kind, id);
  const cur = queue.get(k);
  queue.set(k, { kind, id, what: { likes: !!(cur?.what.likes || what.likes), comments: !!(cur?.what.comments || what.comments) && kind === 'buzz', row: !!(cur?.what.row || what.row) } });
  if (!timer) timer = setTimeout(() => void flushPostSync(), POST_SYNC.batchMs);
}

/**
 * Opening a post (from a notification, a feed, a profile): its counts and
 * comments now, unless they were synced moments ago. Resolves when applied.
 */
export async function syncPostNow(kind: PostKind, id: string, opts?: { force?: boolean }): Promise<void> {
  if (!id || !realData.real.active()) return;
  const at = syncedAt.get(keyOf(kind, id)) ?? 0;
  if (!opts?.force && Date.now() - at < POST_SYNC.freshMs) return;
  queuePostSync(kind, id, { likes: true, comments: kind === 'buzz', row: !realData.hasPost(kind, id) });
  await flushPostSync();
}

/** Apply everything queued now (one batch). Exported for tests. */
export async function flushPostSync(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (flushing) {
    // Something new was queued during a running batch: run once more after it.
    await flushing;
    if (queue.size) return flushPostSync();
    return;
  }
  if (!queue.size) return;
  const batch = [...queue.values()];
  queue.clear();
  flushing = run(batch).finally(() => {
    flushing = null;
  });
  await flushing;
}

async function run(batch: { kind: PostKind; id: string; what: SyncWhat }[]): Promise<void> {
  postSyncStats.flushes++;
  const uid = realData.real.uid();
  const now = Date.now();
  try {
    // 1. Posts we don't have yet (new in a World, or opened from a notification).
    for (const kind of ['buzz', 'drift'] as const) {
      const missing = batch.filter((b) => b.kind === kind && b.what.row && !realData.hasPost(kind, b.id)).map((b) => b.id);
      if (!missing.length) continue;
      postSyncStats.rowCalls++;
      const got = await fetchPostsByIds(kind, missing);
      if (realData.real.uid() !== uid) return;
      const unknown = got.authors.filter((a) => !repo.user(a));
      if (unknown.length) {
        const people = await fetchPeople(unknown).catch(() => []);
        if (realData.real.uid() !== uid) return;
        if (people.length) realData.addPeople(people.map((p) => toUser(p)));
      }
      for (const b of got.buzz) if (!realData.hasPost('buzz', b.id)) realData.addBuzz(b);
      for (const d of got.drift) if (!realData.hasPost('drift', d.id)) realData.addDrift(d);
    }
    // 2. Like totals: one call per kind for the whole batch. (Your own like is read when applied,
    //    so a heart tapped while the request was out isn't counted twice or missed.)
    const mine = (kind: PostKind, id: string) => {
      const s = useChimp.getState();
      return kind === 'buzz' ? !!s.buzzLikes[id] : !!s.driftLikes[id];
    };
    const likeTasks = (['buzz', 'drift'] as const).map(async (kind) => {
      const ids = batch.filter((b) => b.kind === kind && (b.what.likes || b.what.row) && realData.hasPost(kind, b.id)).map((b) => b.id);
      if (!ids.length) return;
      postSyncStats.likeCalls++;
      const totals = await fetchLikeTotalsFor(kind, ids);
      if (!totals || realData.real.uid() !== uid) return;
      realData.applyLikeTotalsFor(
        ids.map((id) => keyOf(kind, id)),
        totals,
        (k, id) => mine(k, id),
      );
    });
    // 3. Comments: per Buzz (small; shown in the thread right away).
    const commentTasks = batch
      .filter((b) => b.kind === 'buzz' && (b.what.comments || b.what.row) && realData.hasPost('buzz', b.id))
      .slice(0, POST_SYNC.maxCommentFetches) // a burst after a long sleep: the rest wait for the next full load
      .map(async (b) => {
        postSyncStats.commentCalls++;
        const rows = await fetchComments('buzz', b.id);
        if (realData.real.uid() !== uid) return;
        realData.setRepliesFor(b.id, rows.map(toReply));
        const unknown = [...new Set(rows.map((r) => r.author_id))].filter((a) => !repo.user(a));
        if (unknown.length) {
          const people = await fetchPeople(unknown).catch(() => []);
          if (realData.real.uid() === uid && people.length) realData.addPeople(people.map((p) => toUser(p)));
        }
      });
    await Promise.all([...likeTasks, ...commentTasks]);
    for (const b of batch) syncedAt.set(keyOf(b.kind, b.id), now);
  } catch (e) {
    // Offline or refused: what's on screen stays; the next event / open tries again.
    diag('post sync failed', { error: e instanceof Error ? e.name : 'unknown' });
  }
}

/** On sign-out / account switch: nothing carries over. */
export function resetPostSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  queue.clear();
  syncedAt.clear();
}
