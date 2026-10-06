/**
 * Phase 9: video poster rules (pure, unit-tested).
 *
 * Frame 0 is often black (fade-in, the camera warming up), so the poster is
 * taken from an early but meaningful moment: ~10 % in, never before 0.25 s,
 * never after 1 s, and always inside the clip.
 */
export function posterTimeSec(durationMs?: number | null): number {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return 0.5;
  const d = durationMs / 1000;
  const t = Math.min(1, Math.max(0.25, d * 0.1));
  return Math.round(Math.min(t, d / 2) * 1000) / 1000;
}

const PUBLIC_MEDIA = '/storage/v1/object/public/media/';

/** The Storage path of a media URL in the `media` bucket (`posts/<uid>/<name>.mp4`), or null. */
export function storagePathOf(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const i = url.indexOf(PUBLIC_MEDIA);
  if (i < 0) return null;
  const p = decodeURIComponent(url.slice(i + PUBLIC_MEDIA.length).split('?')[0]);
  return /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(p) && !p.includes('..') ? p : null;
}

/** Where a video's poster lives: next to the video, `<name>-poster.jpg` (the rule 0008 / 0012 enforce). */
export function posterPathFor(videoPath: string): string | null {
  const m = /^(posts\/[A-Za-z0-9_-]+\/)([A-Za-z0-9_-]+)\.(mp4|mov)$/i.exec(videoPath);
  return m ? `${m[1]}${m[2]}-poster.jpg` : null;
}
