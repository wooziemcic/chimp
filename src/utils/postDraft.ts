/**
 * Posting reliability — pure rules for post drafts (no React, no I/O; unit-tested).
 */
import type { UploadedMedia, UploadedVideo } from '@/services/backend/media';

export type DraftSurface = 'buzz' | 'drift' | 'story';
export type DraftState = 'editing' | 'posting' | 'failed' | 'interrupted' | 'posted';
/** What happened to a captured photo / clip's Photos copy. 'n/a' = picked from Photos (already there). */
export type PhotosCopy = 'saved' | 'saving' | 'denied' | 'unavailable' | 'failed' | 'n/a';

export interface DraftMedia {
  /** Stable within the draft ('m0', 'm1', …): also names its server file. */
  key: string;
  kind: 'image' | 'video';
  /** Chimp's kept copy (Documents/post-drafts/{id}/…), or the original on web. */
  uri: string;
  width: number;
  height: number;
  mimeType?: string;
  fileSize?: number;
  durationMs?: number;
  poster?: { uri: string; width: number; height: number } | null;
  /** Taken with Chimp's camera (photo) or recorder (video). */
  captured: boolean;
  photos: PhotosCopy;
  /** False when Chimp couldn't make its durable copy (e.g. the phone's storage is full). */
  kept?: boolean;
}

export interface PostDraft {
  /** Also the post's id on the server (idempotent retries). */
  id: string;
  /** The account it belongs to (REAL uid, or 'demo'). Never shown to another account. */
  owner: string;
  surface: DraftSurface;
  createdAt: number;
  updatedAt: number;
  body: string;
  poll?: { question: string; options: string[] } | null;
  boardId: string | null;
  /** Story only: also into the World. */
  toWorld?: boolean;
  media: DraftMedia[];
  /** Files already uploaded and recorded (ids / paths / public URLs — no secrets). */
  uploaded: Record<string, UploadedMedia | UploadedVideo>;
  /** Server paths this draft may have created, by media key (cleaned up if it's discarded or the media removed). */
  paths: { key: string; path: string }[];
  state: DraftState;
  attempts: number;
  error?: string;
}

export interface DraftProgress {
  stage: 'preparing' | 'uploading' | 'posting';
  /** File index (0-based) and count, while preparing / uploading. */
  index?: number;
  total?: number;
  /** 0–1 for the current file, when the platform reports it. */
  fraction?: number;
}

/** After the app restarts, a post that was mid-flight is "interrupted" (it may or may not have reached the server). */
export function onRestore(d: PostDraft): PostDraft {
  return d.state === 'posting' ? { ...d, state: 'interrupted' } : d;
}

/** Captured media whose ONLY copy is Chimp's kept file (not in Photos). Discarding it loses it for good. */
export function onlyCopyInChimp(d: Pick<PostDraft, 'media'>): DraftMedia[] {
  return d.media.filter((m) => m.captured && m.photos !== 'saved');
}

/** Captured media with NO safe copy at all yet (not in Photos, and Chimp's copy failed). */
export function notSafeYet(d: Pick<PostDraft, 'media'>): DraftMedia[] {
  return d.media.filter((m) => m.captured && m.photos !== 'saved' && m.photos !== 'saving' && m.kept === false);
}

/** A new media key — never reused within a draft (a removed photo's files can't be mistaken for a new one). */
export function newMediaKey(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Drafts the "unfinished post" card offers, newest first:
 *  - failed / interrupted attempts;
 *  - never-posted drafts that hold captured media (the moment you took).
 * A plain text draft you never tried to post isn't kept (no drafts product).
 */
export function recoverable(drafts: PostDraft[], owner: string | null | undefined): PostDraft[] {
  if (!owner) return [];
  return drafts
    .filter((d) => d.owner === owner && (d.state === 'failed' || d.state === 'interrupted' || (d.state === 'editing' && d.media.some((m) => m.captured))))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type FailKind = 'offline' | 'stalled' | 'server' | 'session' | 'too_large' | 'refused' | 'cancelled' | 'other';

export function failKind(e: unknown): FailKind {
  // Our backend errors already know their kind (services/backend/errors.ts).
  const kind = (e as { kind?: string } | null)?.kind;
  if (kind === 'network') return 'offline';
  if (kind === 'jwt_expired' || kind === 'jwt_invalid' || kind === 'jwt_future') return 'session';
  const m = (e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '')).toLowerCase();
  if (m.includes('cancelled')) return 'cancelled';
  if (m.includes('signed out') || m.includes('jwt')) return 'session';
  if (m.includes('larger than') || m.includes('too large') || m.includes('seconds. for now') || /\d+ mb\b/.test(m)) return 'too_large';
  if (m.includes('row-level security') || m.includes('refused') || m.includes('not allowed') || m.includes('only the person') || m.includes('another account')) return 'refused';
  if (m.includes('uploadstalled') || m.includes('stopped responding') || m.includes('timed out') || m.includes('timeout')) return 'stalled';
  // The request never got an answer at all (no signal, Airplane Mode, a dropped connection).
  if (m.includes('network request failed') || m.includes('failed to fetch') || m.includes('networkerror') || /\bload failed\b/.test(m) || m.includes('offline') || m.includes('no connection') || m.includes('network connection was lost') || m.includes('not connected to the internet')) return 'offline';
  // It got an answer, but the upload or save didn't go through (a server hiccup).
  if (m.includes('upload failed') || m.includes('upload didn’t finish') || m.includes('couldn’t save') || m.includes('http 5')) return 'server';
  return 'other';
}

/** Transient problems worth one quiet automatic retry. */
export const retryable = (k: FailKind) => k === 'offline' || k === 'stalled' || k === 'server';

/** The sentence shown when a post fails. Always says the media is safe when it is. */
const WHY: Record<FailKind, string> = {
  offline: 'You seem to be offline.',
  stalled: 'The connection stopped responding.',
  server: 'The upload didn’t go through.',
  session: 'Your session expired — sign in again, then try again.',
  cancelled: 'Stopped.',
  too_large: '',
  refused: 'It wasn’t accepted — check the World is still open to you.',
  other: '',
};

export function failureMessage(e: unknown, d: Pick<PostDraft, 'media'>): string {
  const k = failKind(e);
  const what = d.media.length === 0 ? 'Your post is saved' : d.media.length === 1 ? `Your ${d.media[0].kind === 'video' ? 'video' : 'photo'} is safe` : 'Your photos are safe';
  // Too large / refused: our own sentence explains what to change.
  const raw = e instanceof Error ? e.message : String(e ?? '');
  // Too large / refused / anything else: our own short sentence explains it (never a raw technical message).
  const ours = raw && raw.length <= 140 && !/jwt|pgrst|postgrest|violates|constraint|relation|syntax|uuid|http \d|\{/i.test(raw);
  const why = k === 'too_large' || k === 'refused' || k === 'other' ? (ours ? raw : WHY[k]) : WHY[k];
  return `Couldn’t post. ${what}.${why ? ` ${why}` : ''}`;
}

/** "Uploading 2 of 4 · 45%", "Preparing…", "Posting…" */
export function progressText(p: DraftProgress | undefined): string {
  if (!p) return '';
  const of = p.total && p.total > 1 && p.index !== undefined ? ` ${p.index + 1} of ${p.total}` : '';
  if (p.stage === 'preparing') return `Preparing${of}…`;
  if (p.stage === 'uploading') return `Uploading${of}…${p.fraction !== undefined && p.fraction > 0 && p.fraction < 1 ? ` ${Math.round(p.fraction * 100)}%` : ''}`;
  return 'Posting…';
}

/** Overall 0–1 across files (for one progress bar). */
export function overallFraction(p: DraftProgress | undefined): number | undefined {
  if (!p) return undefined;
  if (p.stage === 'posting') return 1;
  const total = p.total ?? 1;
  const index = p.index ?? 0;
  const f = p.stage === 'uploading' ? p.fraction ?? 0 : 0;
  return Math.min(1, (index + f) / Math.max(1, total));
}
