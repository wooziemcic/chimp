/**
 * Creation (Phase 6A): one API for both account modes.
 *
 *   REAL  upload media to Storage → insert the row → show it immediately
 *         (optimistic, in the REAL dataset) → the next load confirms it.
 *   DEMO  kept locally in the demo bucket (never uploaded), so the seeded
 *         world can be tested end to end without a backend.
 *
 * Every item has an author. Drift and Stories belong to a World; a Buzz may
 * (Phase 6B: "Just Buzz" has no World and its interests come from its words).
 * Creating is a graph signal (`create`: the World's / the Buzz's interests grow).
 */
import { CATALOG_BY_ID } from '@/data/worldCatalog';
import { getBoardTheme } from '@/theme/boardThemes';
import type { Board, BuzzItem, DriftItem, Story } from '@/types/models';
import { createUserBoard } from './boardFactory';
import { type NewBuzz, createBuzz, createDrift, createStoryItem, createWorld, removeOldCover, setWorldCover } from './backend/content';
import { toBoard } from './backend/mappers';
import { MAX_EDGE, type MediaFolder, type PickedImage, type PickedVideo, type UploadedMedia, type UploadedVideo, type UploadProgress, discardMedia, prepareImage, removeTempFile, uploadImage, uploadVideo } from './backend/media';
import * as realData from './backend/realData';
import { isRealMode } from './dataset';
import { repo } from './repository';
import { useChimp } from '@/store/useChimp';
import { uuid } from '@/utils/id';
import { inferInterestsFromText } from '@/utils/inferInterests';

const lid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const uidOrThrow = () => {
  const uid = realData.real.uid();
  if (!uid) throw new Error('You’re signed out. Sign in again to post.');
  return uid;
};

/**
 * One post attempt (Phase 6C), kept across retries. Posting reliability: it
 * is the persisted draft's state (services/postDrafts.ts) — its id is the
 * post's id (a retry after a lost response can never create a second post),
 * files are keyed by the draft's media keys and, with `stableNames`, uploaded
 * to stable paths (a retry — even after the app was killed — finds a file
 * that already arrived instead of sending it again).
 */
export interface PostJob {
  clientId: string;
  uploaded: Record<string, UploadedMedia | UploadedVideo>;
  posted?: boolean;
  stableNames?: boolean;
  /** A retry: before re-sending a file, look whether it already arrived (the app was killed before recording it). */
  probeFirst?: boolean;
  /** Called as each file is uploaded and recorded (the draft persists it). */
  onUploaded?: (key: string, m: UploadedMedia | UploadedVideo) => void;
}
export const newPostJob = (): PostJob => ({ clientId: uuid(), uploaded: {} });

/** One photo or clip in a post, with its stable key within the draft. */
export interface PostMedia {
  key: string;
  image?: PickedImage;
  video?: PickedVideo;
}

/** Remove uploads of a post that was abandoned (composer closed after a failure). */
export async function abandonPostJob(job: PostJob): Promise<void> {
  if (job.posted || !isRealMode()) return;
  const items = Object.values(job.uploaded).map((m) => ({ id: m.id, path: m.path, posterPath: 'posterPath' in m ? m.posterPath : undefined }));
  job.uploaded = {};
  await discardMedia(items);
}

/** Stable file name for a draft's media: `{postId}-{key}`. */
export const stableName = (job: PostJob, key: string) => (job.stableNames ? `${job.clientId}-${key}` : undefined);

const devTiming = (label: string, t0: number, extra?: Record<string, unknown>) => {
  if (__DEV__) console.log(`[chimp:post] ${label} ${Date.now() - t0}ms`, extra ? JSON.stringify(extra) : '');
};

/**
 * Upload (or reuse) every photo / clip of a post, in order, with progress
 * "file k of n". Photos are resized on the phone first; the resized temp file
 * is removed once it has uploaded. Development builds log each stage's time
 * and byte sizes (never contents or URLs).
 */
async function uploadAll(
  uid: string,
  folder: MediaFolder,
  maxEdge: number,
  items: PostMedia[],
  job: PostJob,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
): Promise<(UploadedMedia | UploadedVideo)[]> {
  const out: (UploadedMedia | UploadedVideo)[] = [];
  const total = items.length;
  for (const [i, it] of items.entries()) {
    let m = job.uploaded[it.key];
    if (!m) {
      if (opts.signal?.aborted) throw new Error('Post cancelled.');
      const at = { index: i, total };
      if (it.video) {
        const t0 = Date.now();
        m = await uploadVideo(uid, it.video, (p) => opts.onProgress?.({ ...p, ...at }), opts.signal, stableName(job, it.key), job.probeFirst);
        devTiming('video upload', t0, { bytes: it.video.fileSize, ms: it.video.durationMs });
      } else if (it.image) {
        opts.onProgress?.({ stage: 'preparing', ...at });
        const t0 = Date.now();
        const prepared = await prepareImage(it.image, maxEdge);
        devTiming('resize', t0, { from: `${it.image.width}x${it.image.height}`, to: `${prepared.width}x${prepared.height}`, srcBytes: it.image.fileSize });
        const t1 = Date.now();
        opts.onProgress?.({ stage: 'uploading', fraction: 0, ...at });
        try {
          m = await uploadImage(uid, folder, prepared, { name: stableName(job, it.key), probe: job.probeFirst, signal: opts.signal, onProgress: (f) => opts.onProgress?.({ stage: 'uploading', fraction: f, ...at }) });
        } finally {
          void removeTempFile(prepared.uri === it.image.uri ? undefined : prepared.uri);
        }
        devTiming('photo upload', t1);
      } else continue;
      job.uploaded[it.key] = m;
      job.onUploaded?.(it.key, m);
    }
    out.push(m);
  }
  return out;
}

export async function postBuzz(
  input: NewBuzz,
  items: PostMedia[],
  opts: { job?: PostJob; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<BuzzItem> {
  const job = opts.job ?? newPostJob();
  const video = items.find((m) => m.video)?.video ?? null;
  const images = items.filter((m) => m.image).map((m) => m.image!);
  let item: BuzzItem;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const media = await uploadAll(uid, 'posts', MAX_EDGE.post, items, job, opts);
    if (opts.signal?.aborted) throw new Error('Post cancelled.');
    opts.onProgress?.({ stage: 'saving' });
    const t0 = Date.now();
    item = await createBuzz(uid, { ...input, clientId: job.clientId }, media);
    devTiming('post row', t0);
    job.posted = true;
    realData.addBuzz(item);
  } else {
    const text = [input.title, input.body, input.memeText, input.poll?.question].filter(Boolean).join(' ');
    const now = Date.now();
    item = {
      id: lid('bz_me'),
      kind: video ? 'video' : input.kind,
      boardId: input.boardId || '',
      interests: input.boardId ? undefined : inferInterestsFromText(text),
      imageAspects: video ? (video.width && video.height ? [video.width / video.height] : undefined) : images.length ? images.map((i) => (i.width && i.height ? i.width / i.height : 1)) : undefined,
      video: video ? { url: video.uri, durationMs: video.durationMs, aspect: video.width && video.height ? video.width / video.height : undefined } : undefined,
      authorId: repo.meId(),
      title: input.title?.trim() || undefined,
      body: input.body?.trim() || undefined,
      image: video ? undefined : images[0]?.uri,
      images: !video && images.length > 1 ? images.map((i) => i.uri) : undefined,
      memeText: input.memeText?.trim() || undefined,
      poll: input.poll ? { question: input.poll.question.trim(), options: input.poll.options.map((label, i) => ({ id: `o${i + 1}`, label: label.trim(), votes: 0 })) } : undefined,
      createdAt: 'now',
      ageHours: 0,
      createdAtMs: now,
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
      layout: !video && (input.kind === 'post' || input.kind === 'meme') ? 'half' : 'full',
    };
    job.posted = true;
    useChimp.getState().addCreated('buzz', item);
  }
  useChimp.getState().track('create', input.boardId ? { kind: 'board', id: input.boardId } : { kind: 'buzz', id: item.id });
  return item;
}

export async function postDrift(
  boardId: string,
  caption: string,
  items: PostMedia[],
  opts: { job?: PostJob; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<DriftItem> {
  const job = opts.job ?? newPostJob();
  const images = items.filter((m) => m.image).map((m) => m.image!);
  let item: DriftItem;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const media = (await uploadAll(uid, 'drift', MAX_EDGE.post, items, job, opts)) as UploadedMedia[];
    if (opts.signal?.aborted) throw new Error('Post cancelled.');
    opts.onProgress?.({ stage: 'saving' });
    item = await createDrift(uid, boardId, caption, media, job.clientId);
    job.posted = true;
    realData.addDrift(item);
  } else {
    item = {
      id: lid('dr_me'),
      kind: images.length > 1 ? 'carousel' : 'photo',
      boardId,
      authorId: repo.meId(),
      image: images[0].uri,
      images: images.length > 1 ? images.map((i) => i.uri) : undefined,
      caption: caption.trim(),
      likeCount: 0,
      createdAt: 'now',
      ageHours: 0,
      createdAtMs: Date.now(),
      tall: images[0].height > images[0].width,
    };
    job.posted = true;
    useChimp.getState().addCreated('drift', item);
  }
  useChimp.getState().track('create', { kind: 'board', id: boardId });
  return item;
}

export async function postStory(
  boardId: string | null,
  caption: string,
  item: PostMedia,
  opts: { job?: PostJob; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const job = opts.job ?? newPostJob();
  const image = item.image!;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const [up] = (await uploadAll(uid, 'stories', MAX_EDGE.story, [item], job, opts)) as UploadedMedia[];
    if (opts.signal?.aborted) throw new Error('Post cancelled.');
    opts.onProgress?.({ stage: 'saving' });
    const row = await createStoryItem(uid, boardId, caption, up, job.clientId);
    job.posted = true;
    realData.addStoryRow(row, up.url);
  } else {
    const me = repo.me();
    const id = `st_p_${me.id}`;
    const existing = useChimp.getState().created?.stories.find((s) => s.id === id);
    const frame = { id: lid('si_me'), storyId: id, authorId: me.id, image: image.uri, caption: caption.trim(), createdAt: 'now', durationMs: 5000, boardId: boardId ?? undefined };
    const story: Story = existing
      ? { ...existing, cover: image.uri, items: [...existing.items, frame] }
      : { id, owner: { kind: 'person', id: me.id }, title: me.displayName, cover: image.uri, lane: 'friend', items: [frame] };
    const created = useChimp.getState().created;
    job.posted = true;
    useChimp.setState({ created: { ...created, stories: [story, ...created.stories.filter((s) => s.id !== id)] } });
  }
  if (boardId) useChimp.getState().track('create', { kind: 'board', id: boardId });
}

export interface WorldDraft {
  title: string;
  tagline: string;
  /** A catalog World ("Travel", "Food"…): gives category, interests and theme. */
  kindOf: string;
  visibility: 'public' | 'connections' | 'private';
  cover?: PickedImage | null;
  /** Phase 6B: extra interests (e.g. a Travel World that's also about Food and Photography). */
  alsoAbout?: string[];
}

export async function makeWorld(d: WorldDraft): Promise<Board> {
  const cat = CATALOG_BY_ID[d.kindOf] ?? CATALOG_BY_ID.travel;
  // Category interests first (they drive the theme and the Happening lane), then any extras.
  const interests = [...new Set([...cat.interests, ...(d.alsoAbout ?? [])])].slice(0, 6);
  let board: Board;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const row = await createWorld(uid, { title: d.title, tagline: d.tagline, category: cat.category, interests, themeId: cat.themeId, visibility: d.visibility });
    if (d.cover) {
      // A unique file per cover (no overwrite, no stale CDN copy when it's replaced later).
      const up = await uploadImage(uid, `boards/${row.id}`, await prepareImage(d.cover, MAX_EDGE.cover));
      await setWorldCover(row.id, up);
      row.cover_url = up.url;
      row.hero_url = up.url;
    }
    board = toBoard(row, [uid], 1);
    board.roles = { [uid]: 'owner' };
    board.followerCount = 0;
    realData.addBoard(board);
  } else {
    board = createUserBoard({
      title: d.title,
      ownerId: repo.meId(),
      category: cat.category,
      interests,
      themeId: cat.themeId,
      tagline: d.tagline,
      cover: d.cover?.uri ?? repo.board(cat.id)?.cover ?? '',
      type: d.visibility === 'private' ? 'private' : 'user_created',
      visibility: d.visibility,
    });
    board.theme = getBoardTheme(cat.themeId);
    useChimp.getState().addCreated('boards', board);
  }
  // You're the owner: it counts as joined, and it's a strong graph signal.
  if (!useChimp.getState().joined[board.id]) useChimp.setState({ joined: { ...useChimp.getState().joined, [board.id]: true } });
  useChimp.getState().track('create', { kind: 'board', id: board.id });
  return board;
}

/**
 * Phase 6C: replace a World's cover (owner only). One canonical image: the
 * hero, its card in Boards, pickers and the graph all read the same field.
 * REAL: upload to boards/{id}/ (Storage only accepts that from the owner),
 * update the row (RLS: owner only), then tidy away the previous file.
 */
export async function changeWorldCover(board: Board, img: PickedImage): Promise<void> {
  if (!repo.isMe(board.ownerId)) throw new Error('Only the person who made this World can change its cover.');
  if (isRealMode()) {
    const uid = uidOrThrow();
    const up = await uploadImage(uid, `boards/${board.id}`, await prepareImage(img, MAX_EDGE.cover));
    const ok = await setWorldCover(board.id, up);
    if (!ok) throw new Error('Only the person who made this World can change its cover.');
    const old = board.cover;
    realData.updateBoard(board.id, { cover: up.url, hero: up.url });
    void removeOldCover(board.id, old);
  } else {
    useChimp.getState().updateCreatedBoard(board.id, { cover: img.uri, hero: img.uri });
  }
}

