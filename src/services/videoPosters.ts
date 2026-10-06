/**
 * Phase 9 — a poster for every video preview, including older clips that were
 * uploaded without one (the iOS poster bug, see backend/media.ts posterFrom).
 *
 *   1. the stored poster (media.poster_path)            → used as is
 *   2. none stored → this phone makes one from the clip (an early frame, never
 *      autoplaying), keeps it in its cache folder and remembers it; if it's
 *      YOUR clip, it is also uploaded next to the clip so everyone gets it
 *      (set_video_poster, 0012)
 *   3. can't be made (web, offline, an unreadable clip) → the designed video
 *      placeholder (never a plain black box)
 *
 * One clip at a time, each at most once per launch; nothing is played or
 * shown to anyone it isn't already shown to (the clip URL is the same one the
 * player would open).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { backfillVideoPoster, posterFrom } from '@/services/backend/media';
import { isRealMode } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { ImageSrc } from '@/types/models';
import { posterPathFor, storagePathOf } from '@/utils/videoPoster';

const STORE_KEY = 'chimp.videoPosters.v1';
const MAX_REMEMBERED = 80;
/** Waiting jobs: only the latest few (what's on screen now); older ones are dropped and asked again if seen again. */
const MAX_QUEUE = 8;

type Entry = { uri: string | null; at: number };
const made = new Map<string, Entry>();
const listeners = new Map<string, Set<(u: string | null) => void>>();
const queue: { url: string; durationMs?: number; mediaId?: string; ownerId?: string }[] = [];
const queued = new Set<string>();
let running = false;
let loaded: Promise<void> | null = null;

function loadRemembered(): Promise<void> {
  if (!loaded)
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        const saved = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
        const { File } = await import('expo-file-system');
        for (const [url, e] of Object.entries(saved)) {
          if (!e?.uri) continue;
          try {
            if (new File(e.uri).exists) made.set(url, e); // the OS may have cleared the cache folder
          } catch {
            /* skip */
          }
        }
      } catch {
        /* nothing remembered */
      }
    })();
  return loaded;
}

function remember() {
  const list = [...made.entries()].filter(([, e]) => !!e.uri).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_REMEMBERED);
  void AsyncStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(list))).catch(() => undefined);
}

function settle(url: string, uri: string | null) {
  made.set(url, { uri, at: Date.now() });
  listeners.get(url)?.forEach((l) => l(uri));
}

async function pump() {
  if (running) return;
  running = true;
  try {
    await loadRemembered();
    while (queue.length) {
      const job = queue.shift()!;
      if (made.has(job.url)) {
        settle(job.url, made.get(job.url)!.uri);
        continue;
      }
      // Scrolled away (nobody shows it any more): don't download anything for it.
      if (!listeners.get(job.url)?.size) {
        queued.delete(job.url);
        continue;
      }
      const img = await posterFrom(job.url, job.durationMs, 540).catch(() => null);
      settle(job.url, img?.uri ?? null);
      if (img) remember();
      // Your own older clip: share the poster with everyone (best effort).
      if (img && job.mediaId && job.ownerId && isRealMode() && repo.isMe(job.ownerId)) {
        const path = storagePathOf(job.url);
        const posterPath = path ? posterPathFor(path) : null;
        if (posterPath && posterPath.split('/')[1] === job.ownerId) void backfillVideoPoster(job.mediaId, posterPath, img.uri);
      }
    }
  } finally {
    running = false;
  }
}

function request(job: { url: string; durationMs?: number; mediaId?: string; ownerId?: string }) {
  if (queued.has(job.url)) return;
  queued.add(job.url);
  queue.push(job);
  while (queue.length > MAX_QUEUE) queued.delete(queue.shift()!.url);
  void pump();
}

/**
 * The picture to show for a video before it plays: the stored poster, or one
 * this phone made from the clip, or undefined (→ the designed placeholder).
 */
export function useVideoPoster(v: { url?: string | number; poster?: ImageSrc; durationMs?: number; mediaId?: string; ownerId?: string } | undefined): ImageSrc | undefined {
  const url = typeof v?.url === 'string' && /^https?:\/\//.test(v.url) ? v.url : undefined;
  const needs = !!v && !v.poster && !!url && Platform.OS !== 'web';
  const [local, setLocal] = useState<{ url: string; uri: string | null } | null>(() => (needs && made.has(url!) ? { url: url!, uri: made.get(url!)!.uri } : null));
  useEffect(() => {
    if (!needs || !url) return;
    const set = listeners.get(url) ?? new Set();
    const l = (uri: string | null) => setLocal({ url, uri });
    set.add(l);
    listeners.set(url, set);
    if (made.has(url)) l(made.get(url)!.uri);
    else request({ url, durationMs: v?.durationMs, mediaId: v?.mediaId, ownerId: v?.ownerId });
    return () => {
      set.delete(l);
    };
  }, [needs, url, v?.durationMs, v?.mediaId, v?.ownerId]);
  if (v?.poster) return v.poster;
  return local && local.url === url && local.uri ? local.uri : undefined;
}

/**
 * For a player: the stored poster, or one this phone already made for the
 * clip's preview. Never starts any work (the clip itself is loading).
 */
export function useMadePoster(url: string | number | undefined, stored: ImageSrc | undefined): ImageSrc | undefined {
  if (stored) return stored;
  return typeof url === 'string' ? (made.get(url)?.uri ?? undefined) : undefined;
}

/** Tests / sign-out: forget this launch's work (the remembered files stay valid for the same URLs). */
export function resetVideoPosters() {
  queue.length = 0;
  queued.clear();
}
