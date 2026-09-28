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

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  mimeType?: string;
}

export interface UploadedMedia {
  id: string;
  url: string;
  path: string;
  width: number;
  height: number;
  mimeType: string;
}

export type MediaFolder = 'avatars' | 'posts' | 'drift' | 'stories' | 'chat' | `boards/${string}`;

/** Long-edge caps per use (px). */
export const MAX_EDGE = { avatar: 1200, post: 1600, story: 1600, cover: 1800 } as const;

export async function pickImages(opts: { source: 'camera' | 'library'; multiple?: boolean; limit?: number; square?: boolean }): Promise<PickedImage[]> {
  if (opts.source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off. You can turn it on in Settings.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: !!opts.square, aspect: opts.square ? [4, 5] : undefined });
    return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? undefined }));
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    allowsMultipleSelection: !!opts.multiple,
    selectionLimit: opts.multiple ? opts.limit ?? 6 : 1,
    allowsEditing: !opts.multiple && !!opts.square,
    aspect: opts.square ? [4, 5] : undefined,
  });
  return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? undefined }));
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
export async function uploadImage(userId: string, folder: MediaFolder, img: PickedImage): Promise<UploadedMedia> {
  const sb = supabase();
  const scope = folder.startsWith('boards/') ? folder : `${folder}/${userId}`;
  const path = `${scope}/${rid()}.jpg`;
  const bytes = await readBytes(img.uri);
  const up = await sb.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const row = await sb
    .from('media')
    .insert({ owner_id: userId, bucket: MEDIA_BUCKET, storage_path: path, kind: 'image', mime_type: 'image/jpeg', width: img.width, height: img.height, bytes: bytes.byteLength })
    .select('id')
    .single();
  if (row.error) {
    await sb.storage
      .from(MEDIA_BUCKET)
      .remove([path])
      .catch(() => undefined);
    throw new Error(`Couldn’t save media: ${row.error.message}`);
  }
  return { id: row.data.id as string, url: mediaUrl(path), path, width: img.width, height: img.height, mimeType: 'image/jpeg' };
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

/** A JPEG poster frame from the clip (on device). Optional: null when it can't be made. */
export async function makePoster(v: PickedVideo): Promise<PickedImage | null> {
  if (Platform.OS === 'web') return null;
  try {
    const { createVideoPlayer } = await import('expo-video');
    const player = createVideoPlayer(v.uri);
    try {
      const at = v.durationMs ? Math.min(1, v.durationMs / 2000) : 0.5;
      const thumbs = await Promise.race([
        player.generateThumbnailsAsync([at], { maxWidth: 720 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('poster timeout')), 6000)),
      ]);
      if (!thumbs[0]) return null;
      const rendered = await ImageManipulator.manipulate(thumbs[0]).renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
      return { uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
    } finally {
      player.release();
    }
  } catch {
    return null;
  }
}

export interface UploadProgress {
  stage: 'preparing' | 'uploading' | 'saving';
  /** 0–1 while uploading, when known. */
  fraction?: number;
}

/**
 * Upload bytes to Storage at `path` with progress. Native: streams the file
 * (it is never read into JS memory) with the user's own access token. Web:
 * supabase-js (no progress events).
 */
async function uploadFileWithProgress(path: string, uri: string, contentType: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  const sb = supabase();
  if (Platform.OS === 'web') {
    const bytes = await readBytes(uri);
    const up = await sb.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (up.error) throw new Error(storageMessage(up.error.message));
    onProgress?.(1);
    return;
  }
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You’re signed out. Sign in again to post.');
  const { File, UploadTask, UploadType } = await import('expo-file-system');
  const task = new UploadTask(new File(uri), storageObjectUrl(path), {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${token}`, apikey: publishableKey(), 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': '3600' },
    onProgress: (p) => {
      if (p.totalBytes > 0) onProgress?.(Math.min(1, p.bytesSent / p.totalBytes));
    },
  });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try {
    const res = await task.uploadAsync();
    if (res.status < 200 || res.status >= 300) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = JSON.parse(res.body)?.message ?? msg;
      } catch {
        /* keep the status */
      }
      throw new Error(storageMessage(msg, res.status));
    }
  } finally {
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
export async function uploadVideo(userId: string, v: PickedVideo, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<UploadedVideo> {
  const sb = supabase();
  onProgress?.({ stage: 'preparing' });
  const bytes = v.fileSize ?? (await fileSize(v.uri)) ?? 0;
  const problem = videoProblem({ ...v, fileSize: bytes || v.fileSize });
  if (problem) throw new Error(problem);
  const poster = v.poster ?? (await makePoster(v));
  const id = rid();
  const ext = v.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `posts/${userId}/${id}.${ext}`;
  const posterPath = poster ? `posts/${userId}/${id}-poster.jpg` : undefined;
  const uploaded: string[] = [];
  try {
    if (poster && posterPath) {
      await uploadFileWithProgress(posterPath, poster.uri, 'image/jpeg', undefined, signal);
      uploaded.push(posterPath);
    }
    onProgress?.({ stage: 'uploading', fraction: 0 });
    await uploadFileWithProgress(path, v.uri, v.mimeType, (f) => onProgress?.({ stage: 'uploading', fraction: f }), signal);
    uploaded.push(path);
    onProgress?.({ stage: 'saving' });
    const row = await sb
      .from('media')
      .insert({
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
      })
      .select('id')
      .single();
    if (row.error) throw new Error(`Couldn’t save the video: ${row.error.message}`);
    return {
      id: row.data.id as string,
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
    // Never leave orphaned files behind a failed post.
    if (uploaded.length) await sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => undefined);
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
