/**
 * Media pipeline (Phase 6A): pick → resize/compress on device → upload to
 * Supabase Storage → record a `media` row. Expo Go compatible (expo-image-
 * picker, expo-image-manipulator, expo-file-system File API).
 *
 * Phase 6C adds short videos: pick from the camera roll (iOS re-encodes to
 * 960×540 H.264), check the alpha limits (≤ 60 s, ≤ 50 MB), grab a poster
 * frame on device, upload with progress straight to Storage (the user's own
 * session token; never a privileged key), then record the `media` row.
 *
 * Storage layout (one public-read bucket, see the SQL migration):
 *   avatars/{userId}/…   posts/{userId}/…   drift/{userId}/…
 *   stories/{userId}/…   boards/{boardId}/…   chat/{userId}/… (Phase 6B)
 * Large iPhone originals are never uploaded as-is: the long edge is capped
 * and images are re-encoded as JPEG.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { MEDIA_BUCKET, mediaUrl, publishableKey, storageObjectUrl, supabase } from '@/lib/supabase';
import { posterTimeSec } from '@/utils/videoPoster';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  mimeType?: string;
  /** Posting reliability: taken with Chimp's camera (not already in the Photos library). */
  captured?: boolean;
  fileSize?: number;
}

export interface UploadedMedia {
  id: string;
  url: string;
  path: string;
  width: number;
  height: number;
  mimeType: string;
}

export type MediaFolder = 'avatars' | 'posts' | 'drift' | 'stories' | 'chat' | 'afterdark' | `boards/${string}`;

/** Long-edge caps per use (px). */
export const MAX_EDGE = { avatar: 1200, post: 1600, story: 1600, cover: 1800 } as const;

export async function pickImages(opts: { source: 'camera' | 'library'; multiple?: boolean; limit?: number; square?: boolean }): Promise<PickedImage[]> {
  if (opts.source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off. You can turn it on in Settings.');
    // Kept at high quality: this file is the only copy of the moment until it's
    // in Photos (see services/capture.ts). The upload copy is resized separately.
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.92, allowsEditing: !!opts.square, aspect: opts.square ? [4, 5] : undefined });
    return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? undefined, fileSize: a.fileSize ?? undefined, captured: true }));
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Posting reliability: quality 1 + the photo's CURRENT representation lets iOS
    // hand over the original file as-is (the picker's fast path). With 0.9 it
    // decoded every 24–48 MP HEIC to full size and re-encoded it as a full-size
    // JPEG before Chimp resized it again — seconds per photo and a memory spike
    // that could get the app killed. prepareImage() does the one resize.
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    allowsMultipleSelection: !!opts.multiple,
    selectionLimit: opts.multiple ? opts.limit ?? 6 : 1,
    allowsEditing: !opts.multiple && !!opts.square,
    aspect: opts.square ? [4, 5] : undefined,
  });
  return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? undefined, fileSize: a.fileSize ?? undefined }));
}

/** Resize so the long edge is ≤ maxEdge, re-encode as JPEG. */
export async function prepareImage(img: PickedImage, maxEdge: number): Promise<PickedImage> {
  const long = Math.max(img.width || 0, img.height || 0);
  const ctx = ImageManipulator.manipulate(img.uri);
  if (long > maxEdge) {
    if ((img.width || 0) >= (img.height || 0)) ctx.resize({ width: maxEdge });
    else ctx.resize({ height: maxEdge });
  }
  const rendered = await ctx.renderAsync();
  const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
}

// ─── Posting reliability: timeouts, idempotent paths ────────────────────────

/** No progress for this long during an upload = stalled (cancel and say so). */
export const STALL_MS = 30_000;
/** A database write that hasn't answered in this long has failed (it is retried idempotently). */
export const DB_TIMEOUT_MS = 20_000;

export class UploadStalledError extends Error {
  constructor() {
    super('The connection stopped responding. Check your signal and try again.');
    this.name = 'UploadStalledError';
  }
}

/** An AbortSignal that fires after `ms` (or when `parent` aborts). */
export function timeoutSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const onParent = () => c.abort();
  parent?.addEventListener('abort', onParent);
  return {
    signal: c.signal,
    clear: () => {
      clearTimeout(t);
      parent?.removeEventListener('abort', onParent);
    },
  };
}

/** Resolve/reject with `p`, or reject after `ms` (the work itself may finish later; callers are idempotent). */
export function withTimeout<T>(p: Promise<T>, ms: number, error: () => Error = () => new UploadStalledError()): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(error()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Storage said the object already exists: an earlier attempt of THIS post uploaded it. */
const alreadyExists = (msg: string, status?: number) => status === 409 || /already exists|duplicate/i.test(msg);

/** Insert a media row; if this path already has one (an earlier attempt), return that row's id. */
async function recordMedia(row: Record<string, unknown> & { storage_path: string }, signal?: AbortSignal): Promise<string> {
  const sb = supabase();
  const t = timeoutSignal(DB_TIMEOUT_MS, signal);
  try {
    const ins = await sb.from('media').insert(row).select('id').abortSignal(t.signal).single();
    if (!ins.error) return ins.data.id as string;
    if (ins.error.code === '23505') {
      const found = await sb.from('media').select('id').eq('storage_path', row.storage_path).abortSignal(t.signal).maybeSingle();
      if (found.data?.id) return found.data.id as string;
    }
    if (t.signal.aborted && !signal?.aborted) throw new UploadStalledError();
    throw new Error(`Couldn’t save media: ${ins.error.message}`);
  } finally {
    t.clear();
  }
}

/**
 * Is a file already at this (public) path? Native only — a cheap HEAD request
 * that saves re-sending, e.g., a 50 MB clip that arrived before the app was
 * killed. Any doubt (offline, timeout) = no.
 */
async function alreadyUploaded(path: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const t = timeoutSignal(8000);
  try {
    const res = await fetch(mediaUrl(path), { method: 'HEAD', signal: t.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.clear();
  }
}

/** Where a post's file goes. With a `name` (a draft's media key) the path is stable, so a retry finds what already uploaded. */
export function mediaPath(userId: string, folder: MediaFolder, ext: string, name?: string): string {
  const scope = folder.startsWith('boards/') ? folder : `${folder}/${userId}`;
  return `${scope}/${name ?? rid()}.${ext}`;
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  const { File } = await import('expo-file-system');
  return new File(uri).arrayBuffer();
}

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Upload one prepared image and record it. `folder` decides the path;
 * Storage RLS only accepts your own folder (or a World you own).
 *
 * Phase 6D fix: every upload gets its own new file name, so the media row is
 * always a plain INSERT (the media table has no UPDATE policy, by design: a
 * re-upload to a fixed name like avatars/{uid}/avatar.jpg failed with an RLS
 * error). And the row's owner must already have a profile (media.owner_id
 * references profiles.id): callers save the profile first. If the file
 * uploads but the row can't be saved, the file is removed again, so a
 * failure never leaves an orphan in Storage.
 */
export async function uploadImage(
  userId: string,
  folder: MediaFolder,
  img: PickedImage,
  opts: {
    /** Posting reliability: a stable file name (draft media key) → a retry never uploads it twice. */
    name?: string;
    /** Look whether the file already arrived before sending it (a retry after the app was killed). */
    probe?: boolean;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<UploadedMedia> {
  const sb = supabase();
  const path = mediaPath(userId, folder, 'jpg', opts.name);
  let bytes = img.fileSize ?? 0;
  if (Platform.OS === 'web') {
    const data = await readBytes(img.uri);
    bytes = data.byteLength;
    const up = await withTimeout(sb.storage.from(MEDIA_BUCKET).upload(path, data, { contentType: 'image/jpeg', upsert: false }), STALL_MS);
    if (up.error && !(opts.name && alreadyExists(up.error.message, Number((up.error as { statusCode?: string }).statusCode)))) throw new Error(`Upload failed: ${up.error.message}`);
    opts.onProgress?.(1);
  } else if (opts.name && opts.probe && (await alreadyUploaded(path))) {
    opts.onProgress?.(1);
  } else {
    // Native: streamed from the file (never read into JS memory), with progress and a stall timeout.
    await uploadFileWithProgress(path, img.uri, 'image/jpeg', opts.onProgress, opts.signal, { idempotent: !!opts.name });
    bytes = bytes || ((await fileSize(img.uri)) ?? 0);
  }
  let id: string;
  try {
    id = await recordMedia({ owner_id: userId, bucket: MEDIA_BUCKET, storage_path: path, kind: 'image', mime_type: 'image/jpeg', width: img.width, height: img.height, bytes: bytes || null }, opts.signal);
  } catch (e) {
    // A one-off upload removes its file again; a draft's file stays for the retry (the draft cleans it up if discarded).
    if (!opts.name) await sb.storage.from(MEDIA_BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
  return { id, url: mediaUrl(path), path, width: img.width, height: img.height, mimeType: 'image/jpeg' };
}

/**
 * Phase 7B: a view-once photo goes to the PRIVATE bucket `vibe-media`, in
 * your own once/{you}/ folder. Nobody — you included — can read it back from
 * the app: only the view-once server function opens it, once, for the
 * recipient, and deletes it. There is no URL (`url` is empty).
 */
export const PRIVATE_BUCKET = 'vibe-media';
export async function uploadPrivateImage(userId: string, img: PickedImage): Promise<UploadedMedia> {
  const sb = supabase();
  const path = `once/${userId}/${rid()}.jpg`;
  const bytes = await readBytes(img.uri);
  const up = await sb.storage.from(PRIVATE_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(/bucket not found/i.test(up.error.message) ? 'View-once photos aren’t set up on the server yet.' : `Upload failed: ${up.error.message}`);
  const row = await sb
    .from('media')
    .insert({ owner_id: userId, bucket: PRIVATE_BUCKET, storage_path: path, kind: 'image', mime_type: 'image/jpeg', width: img.width, height: img.height, bytes: bytes.byteLength })
    .select('id')
    .single();
  if (row.error) {
    // The file can't be removed by the app (no delete on the private bucket); the server sweep removes it.
    throw new Error(`Couldn’t save media: ${row.error.message}`);
  }
  return { id: row.data.id as string, url: '', path, width: img.width, height: img.height, mimeType: 'image/jpeg' };
}

/**
 * Phase 7A: upload a voice note (After Dark) into your own chat folder and
 * record it as `audio` media. Same rules as photos: a fresh file name, and
 * the file is removed again if its row can't be saved.
 */
export async function uploadAudio(userId: string, uri: string, durationMs: number): Promise<UploadedMedia> {
  const sb = supabase();
  // iOS/Android record AAC in .m4a; the web recorder produces webm.
  const ext = /\.webm($|\?)/.test(uri) || (Platform.OS === 'web' && !/\.m4a($|\?)/.test(uri)) ? 'webm' : 'm4a';
  const mimeType = ext === 'webm' ? 'audio/webm' : 'audio/mp4';
  const path = `chat/${userId}/${rid()}.${ext}`;
  const bytes = await readBytes(uri);
  const up = await sb.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const row = await sb
    .from('media')
    .insert({ owner_id: userId, bucket: MEDIA_BUCKET, storage_path: path, kind: 'audio', mime_type: mimeType, duration_ms: Math.round(durationMs), bytes: bytes.byteLength })
    .select('id')
    .single();
  if (row.error) {
    await sb.storage
      .from(MEDIA_BUCKET)
      .remove([path])
      .catch(() => undefined);
    throw new Error(`Couldn’t save the voice note: ${row.error.message}`);
  }
  return { id: row.data.id as string, url: mediaUrl(path), path, width: 0, height: 0, mimeType };
}

/**
 * Phase 6D: remove one of your media rows and its file (e.g. the avatar you
 * just replaced). Best-effort: a leftover never breaks anything, and RLS only
 * lets you delete your own.
 */
export async function discardMediaById(mediaId: string | null | undefined): Promise<void> {
  if (!mediaId) return;
  const sb = supabase();
  const found = await sb.from('media').select('storage_path, poster_path').eq('id', mediaId).maybeSingle();
  const row = found.data as { storage_path: string; poster_path?: string | null } | null;
  await sb.from('media').delete().eq('id', mediaId).then(
    () => undefined,
    () => undefined,
  );
  const paths = row ? [row.storage_path, row.poster_path].filter((p): p is string => !!p) : [];
  if (paths.length) await sb.storage.from(MEDIA_BUCKET).remove(paths).catch(() => undefined);
}

/**
 * Phase 6D: a new profile photo, retry-safe.
 *
 *   1. The profile row must already exist (save it first; media rows belong
 *      to a profile, see media_owner_id_fkey).
 *   2. `reuse`: an earlier attempt already uploaded this same photo (its file
 *      and media row exist) but saving it on the profile failed → use it, no
 *      second upload, no duplicate row.
 *   3. `link` points the profile at it (avatar_media_id + avatar_url).
 *   4. Only then is the previous photo removed (row + file), so the profile
 *      never points at something that's gone.
 * `onUploaded` hands the new upload back at once so the caller can offer it
 * as `reuse` if step 3 fails.
 */
export async function setProfilePhoto(opts: {
  userId: string;
  photo: PickedImage;
  previousMediaId?: string | null;
  reuse?: UploadedMedia | null;
  onUploaded?: (m: UploadedMedia) => void;
  link: (patch: { avatar_media_id: string; avatar_url: string }) => Promise<unknown>;
}): Promise<UploadedMedia> {
  let media = opts.reuse ?? null;
  if (!media) {
    media = await uploadImage(opts.userId, 'avatars', await prepareImage(opts.photo, MAX_EDGE.avatar));
    opts.onUploaded?.(media);
  }
  await opts.link({ avatar_media_id: media.id, avatar_url: media.url });
  if (opts.previousMediaId && opts.previousMediaId !== media.id) await discardMediaById(opts.previousMediaId);
  return media;
}

/** Convenience: prepare + upload several images (in order). */
export async function uploadImages(userId: string, folder: MediaFolder, imgs: PickedImage[], maxEdge: number): Promise<UploadedMedia[]> {
  const out: UploadedMedia[] = [];
  for (const img of imgs) out.push(await uploadImage(userId, folder, await prepareImage(img, maxEdge)));
  return out;
}

/** Remove a prepared (resized) temporary file once it has uploaded. Never the original. */
export async function removeTempFile(uri: string | undefined): Promise<void> {
  if (!uri || Platform.OS === 'web') return;
  try {
    const { File } = await import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* best effort */
  }
}

// ─── Short video (Phase 6C) ──────────────────────────────────────────────────

export interface PickedVideo {
  uri: string;
  width: number;
  height: number;
  durationMs?: number;
  fileSize?: number;
  mimeType: string;
  /** Poster frame made on the phone right after picking (reused for the upload). */
  poster?: PickedImage | null;
  /** Posting reliability: recorded with Chimp's camera (not already in Photos). */
  captured?: boolean;
}

export interface UploadedVideo extends UploadedMedia {
  durationMs?: number;
  bytes: number;
  posterUrl?: string;
  posterPath?: string;
}

/** Alpha limits for the trip build. The bucket itself accepts 50 MB (0003_phase6c.sql). */
export const VIDEO_LIMITS = { maxSeconds: 60, maxBytes: 50 * 1024 * 1024 } as const;

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
const videoMime = (uri: string, given?: string | null) =>
  given && given.startsWith('video/') ? given : /\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4';

/** Pick one short clip from the camera roll. iOS re-encodes it to 960×540 H.264 on the way out. */
export async function pickVideo(): Promise<PickedVideo | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    // Smaller, predictable files for uploads over hotel / mobile data.
    videoExportPreset: ImagePicker.VideoExportPreset.H264_960x540,
    videoMaxDuration: VIDEO_LIMITS.maxSeconds,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    width: a.width,
    height: a.height,
    durationMs: a.duration ?? undefined,
    fileSize: a.fileSize ?? undefined,
    mimeType: videoMime(a.uri, a.mimeType),
  };
}

/** Plain-language reason a clip can't be posted, or null when it's fine. */
export function videoProblem(v: PickedVideo): string | null {
  if (v.durationMs && v.durationMs > (VIDEO_LIMITS.maxSeconds + 1) * 1000)
    return `That clip is ${Math.round(v.durationMs / 1000)} seconds. For now videos can be up to ${VIDEO_LIMITS.maxSeconds} seconds: pick a shorter one.`;
  if (v.fileSize && v.fileSize > VIDEO_LIMITS.maxBytes) return `That clip is ${mb(v.fileSize)}. Videos can be up to ${mb(VIDEO_LIMITS.maxBytes)}: pick a shorter one.`;
  return null;
}

async function fileSize(uri: string): Promise<number | undefined> {
  try {
    if (Platform.OS === 'web') return (await (await fetch(uri)).blob()).size;
    const { File } = await import('expo-file-system');
    return new File(uri).size ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phase 9 — a JPEG poster frame from a clip (on device; a local file or a URL).
 *
 * Root cause of the black video cards: this used to call
 * generateThumbnailsAsync() right after createVideoPlayer(). On iOS the player
 * loads its source asynchronously, and until the item is attached expo-video
 * returns an EMPTY list (no error) — so no poster was ever made, poster_path
 * stayed null and feeds drew a dark frame. Now: wait until the clip has
 * loaded, then ask for an early frame (not frame 0, often black), retrying
 * briefly. Null when it really can't be made (the post still goes ahead).
 */
export async function posterFrom(uri: string, durationMs?: number, maxWidth = 720): Promise<PickedImage | null> {
  if (Platform.OS === 'web') return null;
  const { createVideoPlayer } = await import('expo-video');
  const player = createVideoPlayer(uri);
  const deadline = Date.now() + 9000;
  try {
    await new Promise<void>((resolve) => {
      if (player.status === 'readyToPlay') return resolve();
      let subs: { remove: () => void }[] = [];
      const done = () => {
        clearTimeout(t);
        subs.forEach((x) => x.remove());
        subs = [];
        resolve();
      };
      const t = setTimeout(done, 6000);
      subs = [
        player.addListener('sourceLoad', done),
        player.addListener('statusChange', ({ status }) => {
          if (status === 'readyToPlay' || status === 'error') done();
        }),
      ];
    });
    const at = posterTimeSec(durationMs ?? (player.duration ? player.duration * 1000 : undefined));
    for (let attempt = 0; attempt < 6 && Date.now() < deadline; attempt++) {
      const thumbs = await Promise.race([
        player.generateThumbnailsAsync([at], { maxWidth }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('poster timeout')), Math.max(500, deadline - Date.now()))),
      ]);
      if (thumbs[0]) {
        const rendered = await ImageManipulator.manipulate(thumbs[0]).renderAsync();
        const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
        return { uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
      }
      // The item isn't attached yet: try again in a moment.
      await new Promise((r) => setTimeout(r, 250));
    }
    if (__DEV__) console.warn('[chimp:video] poster: no frame (the clip never became ready)');
    return null;
  } catch (e) {
    if (__DEV__) console.warn('[chimp:video] poster failed:', e instanceof Error ? e.message.slice(0, 80) : 'error');
    return null;
  } finally {
    player.release();
  }
}

/** A JPEG poster frame from a picked / recorded clip. Optional: null when it can't be made. */
export async function makePoster(v: PickedVideo): Promise<PickedImage | null> {
  try {
    return await posterFrom(v.uri, v.durationMs);
  } catch {
    return null;
  }
}

export interface UploadProgress {
  stage: 'preparing' | 'uploading' | 'saving';
  /** 0–1 while uploading, when known. */
  fraction?: number;
  /** Posting reliability: which file of how many (0-based index). */
  index?: number;
  total?: number;
}

/**
 * Upload bytes to Storage at `path` with progress. Native: streams the file
 * (it is never read into JS memory) with the user's own access token. Web:
 * supabase-js (no progress events).
 */
async function uploadFileWithProgress(
  path: string,
  uri: string,
  contentType: string,
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
  opts: { idempotent?: boolean } = {},
): Promise<'uploaded' | 'exists'> {
  const sb = supabase();
  if (Platform.OS === 'web') {
    const bytes = await readBytes(uri);
    const up = await withTimeout(sb.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: false }), STALL_MS * 4);
    if (up.error) {
      if (opts.idempotent && alreadyExists(up.error.message, Number((up.error as { statusCode?: string }).statusCode))) return 'exists';
      throw new Error(storageMessage(up.error.message));
    }
    onProgress?.(1);
    return 'uploaded';
  }
  for (let attempt = 0; ; attempt++) {
    // A fresh token every time (getSession refreshes an expired one).
    const { data, error } = attempt ? await sb.auth.refreshSession() : await sb.auth.getSession();
    const token = data.session?.access_token;
    // No token because the phone is offline is not "signed out".
    if (!token && error && /fetch|network|timed out|offline/i.test(error.message)) throw new Error('Network request failed');
    if (!token) throw new Error('You’re signed out. Sign in again to post.');
    const res = await streamOnce(path, uri, contentType, token, onProgress, signal);
    if (res.status >= 200 && res.status < 300) return 'uploaded';
    let msg = `HTTP ${res.status}`;
    try {
      msg = JSON.parse(res.body)?.message ?? JSON.parse(res.body)?.error ?? msg;
    } catch {
      /* keep the status */
    }
    if (opts.idempotent && alreadyExists(msg, res.status)) return 'exists';
    // The access token expired mid-way: refresh once and send it again.
    if (attempt === 0 && (res.status === 401 || /jwt|expired|unauthori[sz]ed/i.test(msg))) continue;
    throw new Error(storageMessage(msg, res.status));
  }
}

/**
 * One streamed upload. FOREGROUND session on purpose: an iOS background
 * session waits indefinitely for a lost connection (the "post never finishes"
 * case). Here a stalled upload — no progress for STALL_MS — is cancelled and
 * reported, and the post can be retried; a file that did arrive is found again
 * by its stable path. Chimp does not claim uploads continue after you leave it.
 */
async function streamOnce(path: string, uri: string, contentType: string, token: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  const { File, UploadTask, UploadType } = await import('expo-file-system');
  let stalled = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const task = new UploadTask(new File(uri), storageObjectUrl(path), {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    sessionType: 'foreground',
    headers: { Authorization: `Bearer ${token}`, apikey: publishableKey(), 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': '3600' },
    onProgress: (p) => {
      arm();
      if (p.totalBytes > 0) onProgress?.(Math.min(1, p.bytesSent / p.totalBytes));
    },
  });
  const arm = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      task.cancel();
    }, STALL_MS);
  };
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  arm();
  try {
    return await task.uploadAsync();
  } catch (e) {
    if (stalled) throw new UploadStalledError();
    if (signal?.aborted) throw new Error('Post cancelled.');
    throw e;
  } finally {
    if (watchdog) clearTimeout(watchdog);
    signal?.removeEventListener('abort', abort);
    task.release();
  }
}

function storageMessage(raw: string, status?: number): string {
  if (status === 413 || /too large|exceeded the maximum/i.test(raw)) return `That file is larger than your Chimp storage allows. Pick a shorter clip.`;
  if (/row-level security|unauthori[sz]ed|403/i.test(raw)) return 'Upload was refused. Sign out and back in, then try again.';
  return `Upload didn’t finish (${raw}). Check your connection and try again.`;
}

/**
 * Upload a short clip (+ optional poster) into your own folder and record a
 * `media` row (kind 'video', mime, bytes, duration, width/height, poster).
 * If the row can't be saved, the uploaded files are removed again.
 */
export function videoPaths(userId: string, v: Pick<PickedVideo, 'mimeType'>, name: string, poster: boolean): { path: string; posterPath?: string } {
  const ext = v.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  return { path: `posts/${userId}/${name}.${ext}`, posterPath: poster ? `posts/${userId}/${name}-poster.jpg` : undefined };
}

export async function uploadVideo(
  userId: string,
  v: PickedVideo,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
  /** Posting reliability: a stable name (draft media key): a retry resumes instead of re-uploading. */
  name?: string,
  /** Look whether the files already arrived before sending them (a retry after the app was killed). */
  probe?: boolean,
): Promise<UploadedVideo> {
  const sb = supabase();
  onProgress?.({ stage: 'preparing' });
  const bytes = v.fileSize ?? (await fileSize(v.uri)) ?? 0;
  const problem = videoProblem({ ...v, fileSize: bytes || v.fileSize });
  if (problem) throw new Error(problem);
  const poster = v.poster ?? (await makePoster(v));
  const { path, posterPath } = videoPaths(userId, v, name ?? rid(), !!poster);
  const uploaded: string[] = [];
  try {
    if (poster && posterPath) {
      if (!(name && probe && (await alreadyUploaded(posterPath)))) await uploadFileWithProgress(posterPath, poster.uri, 'image/jpeg', undefined, signal, { idempotent: !!name });
      uploaded.push(posterPath);
    }
    onProgress?.({ stage: 'uploading', fraction: 0 });
    if (name && probe && (await alreadyUploaded(path))) onProgress?.({ stage: 'uploading', fraction: 1 });
    else await uploadFileWithProgress(path, v.uri, v.mimeType, (f) => onProgress?.({ stage: 'uploading', fraction: f }), signal, { idempotent: !!name });
    uploaded.push(path);
    onProgress?.({ stage: 'saving' });
    const id = await recordMedia(
      {
        owner_id: userId,
        bucket: MEDIA_BUCKET,
        storage_path: path,
        kind: 'video',
        mime_type: v.mimeType,
        width: v.width || null,
        height: v.height || null,
        duration_ms: v.durationMs ? Math.round(v.durationMs) : null,
        bytes: bytes || null,
        poster_path: posterPath ?? null,
      },
      signal,
    );
    return {
      id,
      url: mediaUrl(path),
      path,
      width: v.width,
      height: v.height,
      mimeType: v.mimeType,
      durationMs: v.durationMs,
      bytes,
      posterUrl: posterPath ? mediaUrl(posterPath) : undefined,
      posterPath,
    };
  } catch (e) {
    // Never leave orphaned files behind a failed post. (A draft keeps them for
    // its retry — re-sending a 50 MB clip is the slow part — and removes them
    // itself if it's discarded.)
    if (uploaded.length && !name) await sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => undefined);
    throw e;
  }
}

/** Best-effort removal of media that never made it into a post (e.g. the post insert failed and you gave up). */
export async function discardMedia(items: { id: string; path: string; posterPath?: string }[]): Promise<void> {
  if (!items.length) return;
  const sb = supabase();
  await sb.storage
    .from(MEDIA_BUCKET)
    .remove(items.flatMap((m) => [m.path, ...(m.posterPath ? [m.posterPath] : [])]))
    .catch(() => undefined);
  await sb.from('media').delete().in('id', items.map((m) => m.id)).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Posting reliability: remove a discarded draft's server files by PATH (its
 * stable paths are known before anything uploads, so nothing is orphaned even
 * if the app was killed between the upload and saving the media row). Throws
 * when offline, so the caller can keep it queued and try again later.
 */
export async function discardPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const sb = supabase();
  const t = timeoutSignal(DB_TIMEOUT_MS);
  try {
    // Media rows first (they reference the files), then the files.
    const del = await sb.from('media').delete().in('storage_path', paths).abortSignal(t.signal);
    if (del.error && kindOfMessage(del.error.message) === 'network') throw new Error(del.error.message);
    const rm = await withTimeout(sb.storage.from(MEDIA_BUCKET).remove(paths), DB_TIMEOUT_MS);
    if (rm.error && kindOfMessage(rm.error.message) === 'network') throw new Error(rm.error.message);
  } finally {
    t.clear();
  }
}

const kindOfMessage = (m: string) => (/network|fetch|timed out|load failed|abort/i.test(m) ? 'network' : 'other');

/**
 * Phase 9 — lazy poster backfill for one of YOUR older videos that has none:
 * upload the poster next to the clip (`<name>-poster.jpg`, the folder rule
 * 0008 enforces) and record it (set_video_poster, 0012: owner only, only when
 * the clip has no poster yet). Best effort; returns the poster URL or null.
 */
export async function backfillVideoPoster(mediaId: string, posterPath: string, localPoster: string): Promise<string | null> {
  try {
    if (!(await alreadyUploaded(posterPath))) await uploadFileWithProgress(posterPath, localPoster, 'image/jpeg', undefined, undefined, { idempotent: true });
    const { error } = await supabase().rpc('set_video_poster', { p_media_id: mediaId, p_poster_path: posterPath });
    if (error) {
      // A server without 0012: don't leave the uploaded poster behind.
      if (error.code === 'PGRST202') await supabase().storage.from(MEDIA_BUCKET).remove([posterPath]).catch(() => undefined);
      if (__DEV__) console.warn('[chimp:video] poster backfill not saved:', error.code ?? 'error');
      return null;
    }
    return mediaUrl(posterPath);
  } catch (e) {
    if (__DEV__) console.warn('[chimp:video] poster backfill failed:', e instanceof Error ? e.message.slice(0, 80) : 'error');
    return null;
  }
}
