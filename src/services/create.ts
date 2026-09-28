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
import { MAX_EDGE, type PickedImage, type PickedVideo, type UploadedMedia, type UploadedVideo, type UploadProgress, discardMedia, prepareImage, uploadImage, uploadImages, uploadVideo } from './backend/media';
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
 * Phase 6C: one post attempt. The composer keeps it across retries, so files
 * that already uploaded aren't uploaded again and the post keeps the same id
 * (a retry after a lost response can never create a second Buzz).
 */
export interface PostJob {
  clientId: string;
  uploaded: Record<string, UploadedMedia | UploadedVideo>;
  posted?: boolean;
}
export const newPostJob = (): PostJob => ({ clientId: uuid(), uploaded: {} });

/** Remove uploads of a post that was abandoned (composer closed after a failure). */
export async function abandonPostJob(job: PostJob): Promise<void> {
  if (job.posted || !isRealMode()) return;
  const items = Object.values(job.uploaded).map((m) => ({ id: m.id, path: m.path, posterPath: 'posterPath' in m ? m.posterPath : undefined }));
  job.uploaded = {};
  await discardMedia(items);
}

export async function postBuzz(
  input: NewBuzz,
  images: PickedImage[],
  opts: { video?: PickedVideo | null; job?: PostJob; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<BuzzItem> {
  const job = opts.job ?? newPostJob();
  const video = opts.video ?? null;
  let item: BuzzItem;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const media: (UploadedMedia | UploadedVideo)[] = [];
    for (const [k, img] of images.entries()) {
      let m = job.uploaded[img.uri];
      if (!m) {
        opts.onProgress?.({ stage: 'uploading', fraction: k / images.length });
        m = await uploadImage(uid, 'posts', await prepareImage(img, MAX_EDGE.post));
        job.uploaded[img.uri] = m;
      }
      media.push(m);
    }
    if (video) {
      let m = job.uploaded[video.uri];
      if (!m) {
        m = await uploadVideo(uid, video, opts.onProgress, opts.signal);
        job.uploaded[video.uri] = m;
      }
      media.push(m);
    }
    if (opts.signal?.aborted) {
      // You left the composer while it uploaded: nothing is posted, and nothing is left behind.
      await abandonPostJob(job);
      throw new Error('Post cancelled.');
    }
    opts.onProgress?.({ stage: 'saving' });
    item = await createBuzz(uid, { ...input, clientId: job.clientId }, media);
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

export async function postDrift(boardId: string, caption: string, images: PickedImage[]): Promise<DriftItem> {
  let item: DriftItem;
  if (isRealMode()) {
    const uid = uidOrThrow();
    const media = await uploadImages(uid, 'drift', images, MAX_EDGE.post);
    item = await createDrift(uid, boardId, caption, media);
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
    useChimp.getState().addCreated('drift', item);
  }
  useChimp.getState().track('create', { kind: 'board', id: boardId });
  return item;
}

export async function postStory(boardId: string | null, caption: string, image: PickedImage): Promise<void> {
  if (isRealMode()) {
    const uid = uidOrThrow();
    const up = await uploadImage(uid, 'stories', await prepareImage(image, MAX_EDGE.story));
    const row = await createStoryItem(uid, boardId, caption, up);
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

