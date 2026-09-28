/**
 * Phase 6B: the one full-screen media viewer. It is a global modal, NOT a
 * route: opening it only sets this state, so tapping an image 10 times opens
 * one viewer and never stacks screens; closing it returns you exactly where
 * you were (the screen underneath was never navigated away from).
 */
import { create } from 'zustand';

import { onAccountChange } from './useSession';

export interface ViewerItem {
  /** The image, or (Phase 6C) the video file. */
  uri: string;
  /** width / height, when known (keeps the original aspect ratio). */
  aspect?: number;
  /** Phase 6C: set when this item is a video (tap to play/pause, mute, progress). */
  video?: { poster?: string };
}

export interface ViewerMeta {
  caption?: string;
  authorName?: string;
  /** e.g. "Films" — the World the post is in, if any. */
  context?: string;
}

interface MediaViewerState {
  items: ViewerItem[];
  index: number;
  meta: ViewerMeta;
  open: (items: ViewerItem[], index?: number, meta?: ViewerMeta) => void;
  close: () => void;
}

export const useMediaViewer = create<MediaViewerState>((set, get) => ({
  items: [],
  index: 0,
  meta: {},
  open: (items, index = 0, meta = {}) => {
    const list = items.filter((i) => !!i.uri);
    if (!list.length) return;
    // Already open (e.g. a second tap landed): just move to the requested image.
    if (get().items.length) return set({ index: Math.min(index, list.length - 1) });
    set({ items: list, index: Math.min(index, list.length - 1), meta });
  },
  close: () => set({ items: [], index: 0, meta: {} }),
}));

/** Phase 6C: open a clip in the viewer (it plays there, with sound you control). */
export function openVideo(video: { url: string; poster?: string; aspect?: number }, meta?: ViewerMeta) {
  useMediaViewer.getState().open([{ uri: video.url, aspect: video.aspect, video: { poster: video.poster } }], 0, meta);
}

/** Convenience for Buzz / Drift items. */
export function openMedia(images: string[], aspects: number[] | undefined, index: number, meta?: ViewerMeta) {
  useMediaViewer.getState().open(
    images.map((uri, i) => ({ uri, aspect: aspects?.[i] })),
    index,
    meta,
  );
}

// Never carry an open viewer across an account change.
onAccountChange(() => useMediaViewer.getState().close());
