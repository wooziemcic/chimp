/**
 * Posting reliability: durable post drafts and the one runner that posts them.
 *
 *   A captured photo / clip is kept (Chimp's Documents folder, and Photos if
 *   allowed) the moment it's taken, and its draft is saved on this phone.
 *   Tapping Post saves the whole draft (text, World, media, upload state)
 *   BEFORE any network work, then runs:
 *
 *     Preparing (resize on the phone) → Uploading k of n (progress, stall
 *     timeout, stable paths) → Posting (the post row, with the draft's id)
 *
 *   Success is only reported once the server confirmed the post row. Then the
 *   kept copies are removed (anything in Photos stays) and the draft is gone.
 *   On failure the draft stays: "Couldn't post. Your photo is safe." with
 *   Try again / Keep draft / Discard. If the app closes mid-way, the next
 *   launch offers the unfinished post (Continue / Retry / Discard).
 *
 *   Idempotent: the post id never changes (a retry after a lost response finds
 *   the post instead of making a second one), files go to stable paths (a file
 *   that already arrived is not sent again), and one draft can only run once
 *   at a time (double taps do nothing).
 *
 * Nothing here is a secret: ids, storage paths and public URLs only. Drafts are
 * per account (owner) and never shown to another account on the same phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { keepFileResult, keptDraftIds, removeKeptFiles, saveToPhotos } from '@/services/capture';
import { type PostMedia, newPostJob, postBuzz, postDrift, postStory } from '@/services/create';
import { postExists } from '@/services/backend/content';
import { type PickedImage, type PickedVideo, type UploadProgress, discardMedia, discardPaths, mediaPath, videoPaths } from '@/services/backend/media';
import * as realData from '@/services/backend/realData';
import { isRealMode } from '@/services/dataset';
import { uuid } from '@/utils/id';
import { type DraftMedia, type DraftProgress, type DraftSurface, type PostDraft, failKind, failureMessage, newMediaKey, onRestore, retryable } from '@/utils/postDraft';

const MAX_DRAFTS = 12;
const AUTO_RETRY_MS = 2000;

const trace = (step: string, extra?: unknown) => {
  if (__DEV__) console.log(`[chimp:drafts] ${step}`, extra ? JSON.stringify(extra) : '');
};

/** Server files to remove later (a discard while offline). With `check`, only once that post is confirmed NOT to exist. */
interface Cleanup {
  owner: string;
  paths: string[];
  check?: { table: PostTable; id: string };
}
type PostTable = 'buzz_items' | 'drift_items' | 'story_items';
const tableOf = (d: Pick<PostDraft, 'surface'>): PostTable => (d.surface === 'buzz' ? 'buzz_items' : d.surface === 'drift' ? 'drift_items' : 'story_items');

interface DraftsState {
  drafts: Record<string, PostDraft>;
  cleanup: Cleanup[];
  /** Demo only: kept folders that local Demo posts still show (never tidied away). */
  demoKept: string[];
  /** Live only (not persisted). */
  progress: Record<string, DraftProgress | undefined>;
  upsert: (d: PostDraft) => void;
  patch: (id: string, patch: Partial<PostDraft>) => void;
  remove: (id: string) => void;
}

export const usePostDrafts = create<DraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      cleanup: [],
      demoKept: [],
      progress: {},
      upsert: (d) => {
        const all = { ...get().drafts, [d.id]: { ...d, updatedAt: Date.now() } };
        // Bounded: drop the oldest drafts that are safe to drop (nothing captured that only Chimp has);
        // any server files they may have created are queued for removal (if their post doesn't exist).
        const ids = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
        const cleanup = [...get().cleanup];
        for (const old of ids.slice(MAX_DRAFTS)) {
          if (old.media.some((m) => m.captured && m.photos !== 'saved')) continue;
          delete all[old.id];
          if (old.paths.length) cleanup.push({ owner: old.owner, paths: [...new Set(old.paths.map((x) => x.path))], check: old.attempts > 0 ? { table: tableOf(old), id: old.id } : undefined });
          void removeKeptFiles(old.id);
        }
        set({ drafts: all, cleanup });
      },
      patch: (id, patch) => {
        const cur = get().drafts[id];
        if (cur) set({ drafts: { ...get().drafts, [id]: { ...cur, ...patch, updatedAt: Date.now() } } });
      },
      remove: (id) => {
        const { [id]: _gone, ...drafts } = get().drafts;
        const { [id]: _p, ...progress } = get().progress;
        set({ drafts, progress });
      },
    }),
    {
      name: 'chimp-post-drafts',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ drafts, cleanup, demoKept }) => ({ drafts, cleanup, demoKept }),
      // A post that was mid-flight when the app closed is "interrupted" (it may or may not have reached the
      // server). Anything created in memory before loading finished is kept too (never replaced).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DraftsState>;
        const restored = Object.fromEntries(Object.entries(p.drafts ?? {}).map(([k, d]) => [k, onRestore(d)]));
        return {
          ...current,
          drafts: { ...restored, ...current.drafts },
          cleanup: [...(p.cleanup ?? []), ...current.cleanup],
          demoKept: [...new Set([...(p.demoKept ?? []), ...current.demoKept])],
        };
      },
    },
  ),
);

const S = () => usePostDrafts.getState();

/** Resolves once saved drafts have been loaded from the phone (never tidy or overwrite before that). */
export function draftsReady(): Promise<void> {
  const p = usePostDrafts.persist;
  if (!p || p.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = p.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}

/** Who drafts belong to right now: the signed-in REAL account, or the Demo. */
export function draftOwner(): string | null {
  return isRealMode() ? realData.real.uid() : 'demo';
}

export function newDraft(surface: DraftSurface, init: Partial<PostDraft> = {}): PostDraft {
  const now = Date.now();
  return { id: uuid(), owner: draftOwner() ?? 'unknown', surface, createdAt: now, updatedAt: now, body: '', boardId: null, media: [], uploaded: {}, paths: [], state: 'editing', attempts: 0, ...init };
}


/** Turn picked photos / a clip into draft media (library picks keep their original until Post). */
export function toDraftMedia(d: Pick<PostDraft, 'media'>, items: ({ image: PickedImage } | { video: PickedVideo })[]): DraftMedia[] {
  const out: DraftMedia[] = [];
  const acc = { media: [...d.media] };
  for (const it of items) {
    // Never reused within a draft: a removed photo's kept / uploaded file can't be mistaken for a new one.
    let key = newMediaKey();
    while (acc.media.some((m) => m.key === key)) key = newMediaKey();
    const m: DraftMedia =
      'image' in it
        ? { key, kind: 'image', uri: it.image.uri, width: it.image.width, height: it.image.height, mimeType: it.image.mimeType, fileSize: it.image.fileSize, captured: !!it.image.captured, photos: it.image.captured ? 'saving' : 'n/a' }
        : {
            key,
            kind: 'video',
            uri: it.video.uri,
            width: it.video.width,
            height: it.video.height,
            mimeType: it.video.mimeType,
            fileSize: it.video.fileSize,
            durationMs: it.video.durationMs,
            poster: it.video.poster ?? null,
            captured: !!it.video.captured,
            photos: it.video.captured ? 'saving' : 'n/a',
          };
    acc.media.push(m);
    out.push(m);
  }
  return out;
}

/**
 * The moment something is CAPTURED in Chimp: keep a durable copy and save it
 * to Photos (if allowed), and persist the draft — before anything else.
 * Returns the media with its kept URI. The Photos save finishes in the
 * background and updates the draft; posting never waits on it.
 */
export async function preserveCaptured(d: PostDraft, media: DraftMedia[], opts: { replace?: (m: DraftMedia) => boolean } = {}): Promise<DraftMedia[]> {
  const kept: DraftMedia[] = [];
  for (const m of media) {
    const main = await keepFileResult(m.uri, d.id, m.key);
    const poster = m.poster ? { ...m.poster, uri: (await keepFileResult(m.poster.uri, d.id, `${m.key}-poster`)).uri } : m.poster;
    kept.push({ ...m, uri: main.uri, poster, kept: Platform.OS === 'web' ? undefined : main.kept });
  }
  const latest = S().drafts[d.id] ?? d;
  // `replace`: e.g. a newly recorded clip replaces the previous clip of a Buzz.
  const rest = latest.media.filter((x) => !kept.some((k) => k.key === x.key) && !(opts.replace?.(x) ?? false));
  S().upsert({ ...latest, media: [...rest, ...kept] });
  for (const m of kept) {
    if (!m.captured) continue;
    void saveToPhotos(m.uri).then((res) => {
      const cur = S().drafts[d.id];
      if (cur) S().patch(d.id, { media: cur.media.map((x) => (x.key === m.key ? { ...x, photos: res } : x)) });
      trace('photos', { res });
    });
  }
  return kept;
}

// ─── Running a draft ─────────────────────────────────────────────────────────

const running = new Map<string, AbortController>();
export const isRunning = (id: string) => running.has(id);

function toPostMedia(m: DraftMedia): PostMedia {
  if (m.kind === 'video')
    return {
      key: m.key,
      video: { uri: m.uri, width: m.width, height: m.height, durationMs: m.durationMs, fileSize: m.fileSize, mimeType: m.mimeType ?? 'video/mp4', poster: m.poster ? { ...m.poster, mimeType: 'image/jpeg' } : null },
    };
  return { key: m.key, image: { uri: m.uri, width: m.width, height: m.height, mimeType: m.mimeType, fileSize: m.fileSize } };
}

/** The server paths each media item can create (known before uploading, so a discard can always clean up). */
function plannedPaths(uid: string, d: PostDraft): { key: string; path: string }[] {
  const folder = d.surface === 'buzz' ? 'posts' : d.surface === 'drift' ? 'drift' : 'stories';
  return d.media.flatMap((m) => {
    const name = `${d.id}-${m.key}`;
    if (m.kind === 'video') {
      const v = videoPaths(uid, { mimeType: m.mimeType ?? 'video/mp4' }, name, true);
      return [{ key: m.key, path: v.path }, ...(v.posterPath ? [{ key: m.key, path: v.posterPath }] : [])];
    }
    return [{ key: m.key, path: mediaPath(uid, folder, 'jpg', name) }];
  });
}

function setProgress(id: string, p: UploadProgress | { stage: 'posting' } | undefined) {
  const v: DraftProgress | undefined = !p
    ? undefined
    : p.stage === 'saving' || p.stage === 'posting'
      ? { stage: 'posting' }
      : { stage: p.stage, index: (p as UploadProgress).index, total: (p as UploadProgress).total, fraction: (p as UploadProgress).fraction };
  usePostDrafts.setState({ progress: { ...S().progress, [id]: v } });
}

export type RunResult = 'posted' | 'failed' | 'busy' | 'missing';

/**
 * Post a saved draft. One run per draft at a time (a second call — a double
 * tap, Retry pressed twice — returns 'busy'). Transient failures (connection
 * dropped, stalled, or the app went to the background) get ONE quiet retry.
 */
export async function runDraft(id: string): Promise<RunResult> {
  if (running.has(id)) return 'busy';
  const d0 = S().drafts[id];
  if (!d0) return 'missing';
  const controller = new AbortController();
  running.set(id, controller);
  let backgrounded = false;
  const sub = AppState.addEventListener?.('change', (st) => {
    if (st !== 'active') backgrounded = true;
  });
  try {
    for (let attempt = 0; ; attempt++) {
      const d = S().drafts[id];
      if (!d) return 'missing';
      S().patch(id, { state: 'posting', attempts: d.attempts + 1, error: undefined });
      setProgress(id, { stage: 'preparing', index: 0, total: Math.max(1, d.media.length) });
      try {
        await postOnce(S().drafts[id]!, controller.signal);
        await finishPosted(id);
        return 'posted';
      } catch (e) {
        const kind = failKind(e);
        trace('attempt failed', { attempt, kind });
        const again = attempt === 0 && !controller.signal.aborted && (retryable(kind) || (backgrounded && kind === 'other'));
        if (again) {
          backgrounded = false;
          await new Promise((r) => setTimeout(r, AUTO_RETRY_MS));
          if (!controller.signal.aborted) continue;
        }
        const cur = S().drafts[id];
        if (cur) S().patch(id, { state: 'failed', error: failureMessage(controller.signal.aborted ? new Error('Post cancelled.') : e, cur) });
        setProgress(id, undefined);
        return 'failed';
      }
    }
  } finally {
    sub?.remove?.();
    running.delete(id);
  }
}

async function postOnce(d: PostDraft, signal: AbortSignal): Promise<void> {
  const owner = draftOwner();
  if (!owner || owner !== d.owner) throw new Error('This draft belongs to another account. Sign in to that account to post it.');
  // Make sure every file survives a restart from here on (library picks are copied now).
  const media: DraftMedia[] = [];
  for (const m of d.media) {
    const main = await keepFileResult(m.uri, d.id, m.key);
    media.push({ ...m, uri: main.uri, poster: m.poster ? { ...m.poster, uri: (await keepFileResult(m.poster.uri, d.id, `${m.key}-poster`)).uri } : m.poster });
  }
  const uid = isRealMode() ? realData.real.uid() : null;
  const paths = uid ? [...d.paths, ...plannedPaths(uid, { ...d, media }).filter((p) => !d.paths.some((x) => x.path === p.path))] : d.paths;
  // Only the URIs change here: a Photos status that arrived meanwhile is kept.
  const latest = S().drafts[d.id] ?? d;
  S().patch(d.id, { media: latest.media.map((x) => ({ ...x, ...(media.find((y) => y.key === x.key) ? { uri: media.find((y) => y.key === x.key)!.uri, poster: media.find((y) => y.key === x.key)!.poster } : {}) })), paths });

  const job = {
    ...newPostJob(),
    clientId: d.id,
    uploaded: { ...d.uploaded },
    stableNames: true,
    // A retry may find a file that arrived although the app never recorded it (killed mid-way): look before re-sending.
    probeFirst: d.attempts > 1,
    onUploaded: (key: string, m: (typeof d.uploaded)[string]) => S().patch(d.id, { uploaded: { ...(S().drafts[d.id]?.uploaded ?? {}), [key]: m } }),
  };
  const onProgress = (p: UploadProgress) => setProgress(d.id, p);
  const items = media.map(toPostMedia);
  if (d.surface === 'buzz') {
    const video = items.some((m) => m.video);
    const kind = d.poll ? 'poll' : video ? 'video' : items.length ? 'photo' : d.body.trim().length > 500 ? 'note' : 'post';
    await postBuzz(
      { kind: kind as 'post', boardId: d.boardId, body: d.poll ? undefined : d.body.trim(), poll: d.poll ?? undefined },
      d.poll ? [] : items,
      { job, onProgress, signal },
    );
  } else if (d.surface === 'drift') {
    if (!d.boardId) throw new Error('Pick a World first.');
    await postDrift(d.boardId, d.body, items, { job, onProgress, signal });
  } else {
    if (!items[0]) throw new Error('Add a photo first.');
    await postStory(d.toWorld ? d.boardId : null, d.body, items[0], { job, onProgress, signal });
  }
}

/** Confirmed by the server: tidy up (Photos copies stay) and forget the draft. */
async function finishPosted(id: string): Promise<void> {
  const d = S().drafts[id];
  setProgress(id, { stage: 'posting' });
  if (d) {
    S().patch(id, { state: 'posted' });
    // Files of photos you removed after an earlier attempt uploaded (or started uploading) them.
    const keys = new Set(d.media.map((m) => m.key));
    const stale = Object.entries(d.uploaded).filter(([k]) => !keys.has(k));
    if (stale.length && isRealMode()) void discardMedia(stale.map(([, m]) => ({ id: m.id, path: m.path, posterPath: 'posterPath' in m ? m.posterPath : undefined }))).catch(() => undefined);
    const stalePaths = d.paths.filter((p) => !keys.has(p.key)).map((p) => p.path);
    if (stalePaths.length && isRealMode()) void discardPaths(stalePaths).catch(() => usePostDrafts.setState({ cleanup: [...S().cleanup, { owner: d.owner, paths: stalePaths }] }));
  }
  if (isRealMode()) await removeKeptFiles(id);
  // Demo: the local post shows the kept files themselves, so they stay (and are never tidied away).
  else usePostDrafts.setState({ demoKept: [...new Set([...S().demoKept, id])] });
  S().remove(id);
}

/** Stop a running post. Its draft stays (failed, "Stopped") for later. */
export function stopDraft(id: string): void {
  running.get(id)?.abort();
}

export type DiscardResult = 'discarded' | 'already_posted';

/**
 * Discard a draft. If an earlier attempt may have reached the server, check
 * first: a post that exists is never undone by deleting its files. Otherwise
 * the draft's server files are removed (or queued if offline) and its kept
 * copies deleted. Photos copies are yours and stay.
 */
export async function discardDraft(id: string): Promise<DiscardResult> {
  stopDraft(id);
  const d = S().drafts[id];
  if (!d) return 'discarded';
  const paths = [...new Set(d.paths.map((p) => p.path))];
  if (isRealMode() && d.owner === draftOwner()) {
    // An earlier attempt may have created the post (its answer lost): never delete a live post's files.
    const exists = d.attempts > 0 ? await postExists(tableOf(d), d.id).catch(() => null) : false;
    if (exists) {
      await removeKeptFiles(id);
      S().remove(id);
      return 'already_posted';
    }
    if (paths.length) {
      if (exists === null) {
        // Couldn't tell (offline): queue it, and check again before deleting anything.
        usePostDrafts.setState({ cleanup: [...S().cleanup, { owner: d.owner, paths, check: { table: tableOf(d), id: d.id } }] });
      } else {
        try {
          await discardPaths(paths);
        } catch {
          usePostDrafts.setState({ cleanup: [...S().cleanup, { owner: d.owner, paths, check: d.attempts > 0 ? { table: tableOf(d), id: d.id } : undefined }] });
        }
      }
    }
  } else if (isRealMode() && paths.length) {
    // Another account's draft (signed in as someone else now): queue for when its owner is back.
    usePostDrafts.setState({ cleanup: [...S().cleanup, { owner: d.owner, paths, check: d.attempts > 0 ? { table: tableOf(d), id: d.id } : undefined }] });
  }
  await removeKeptFiles(id);
  S().remove(id);
  return 'discarded';
}

/**
 * On launch / sign-in: retry queued server clean-ups for this account and
 * remove kept folders whose draft no longer exists.
 */
export async function tidyDrafts(): Promise<void> {
  // Never before saved drafts are loaded: an empty list would look like "every kept folder is orphaned".
  await draftsReady();
  const owner = draftOwner();
  if (owner && isRealMode() && S().cleanup.some((c) => c.owner === owner)) {
    const left: Cleanup[] = [];
    const queue = S().cleanup;
    usePostDrafts.setState({ cleanup: [] });
    for (const c of queue) {
      if (c.owner !== owner) {
        left.push(c);
        continue;
      }
      try {
        if (c.check) {
          const exists = await postExists(c.check.table, c.check.id);
          if (exists === null) throw new Error('offline');
          if (exists) continue; // the post is live: its files stay
        }
        await discardPaths(c.paths);
      } catch {
        left.push(c);
      }
    }
    usePostDrafts.setState({ cleanup: [...left, ...S().cleanup] });
  }
  // A draft the server confirmed but the app closed before forgetting it.
  for (const d of Object.values(S().drafts)) {
    if (d.state !== 'posted') continue;
    if (isRealMode()) await removeKeptFiles(d.id);
    S().remove(d.id);
  }
  const known = new Set([...Object.keys(S().drafts), ...S().demoKept]);
  for (const dir of await keptDraftIds()) if (!known.has(dir)) await removeKeptFiles(dir);
}
