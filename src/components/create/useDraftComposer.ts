/**
 * Posting reliability: what every composer (Buzz, Photos in a World, Story)
 * shares — its durable draft, captured-media preservation, posting with
 * progress, and the failure / cancel choices.
 *
 *   - Opened with `?draft=<id>` it continues that draft (text, World, media).
 *   - Anything TAKEN with Chimp's camera / recorder is kept and saved to
 *     Photos at once, and the draft is saved, before you even tap Post.
 *   - Post saves the whole draft first, then runs it (services/postDrafts).
 *     The composer closes only when the server confirmed the post.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { closeComposer } from '@/components/create/CreateParts';
import type { PickedImage, PickedVideo } from '@/services/backend/media';
import { type DiscardResult, discardDraft, isRunning, newDraft, preserveCaptured, runDraft, stopDraft, toDraftMedia, usePostDrafts } from '@/services/postDrafts';
import { type DraftMedia, type DraftSurface, type PostDraft, onlyCopyInChimp } from '@/utils/postDraft';

export type DraftContent = Pick<PostDraft, 'body' | 'boardId'> & Partial<Pick<PostDraft, 'poll' | 'toWorld'>>;

/** Local media, with what the store learned since (kept URI, Photos status). */
function withStored(local: DraftMedia[], stored: DraftMedia[] | undefined): DraftMedia[] {
  if (!stored?.length) return local;
  return local.map((m) => {
    const s = stored.find((x) => x.key === m.key);
    return s ? { ...m, uri: s.uri, poster: s.poster, photos: s.photos } : m;
  });
}

export function useDraftComposer(surface: DraftSurface, fallback: '/buzz' | '/happening', initial: Partial<PostDraft> = {}) {
  const params = useLocalSearchParams<{ draft?: string }>();
  // Fixed for the composer's lifetime: the draft it continues (or a new one).
  const [{ resumed, base }] = useState(() => {
    const r = params.draft ? usePostDrafts.getState().drafts[params.draft] : undefined;
    return { resumed: r, base: r ?? newDraft(surface, initial) };
  });
  const id = base.id;
  const stored = usePostDrafts((s) => s.drafts[id]);
  const progress = usePostDrafts((s) => s.progress[id]);
  const [media, setMedia] = useState<DraftMedia[]>(resumed?.media ?? []);
  const [cancelling, setCancelling] = useState(false);
  const [busyLocal, setBusyLocal] = useState(false);

  // Back from the recorder (or another screen that added to this draft): pick up its media.
  useFocusEffect(
    useCallback(() => {
      const d = usePostDrafts.getState().drafts[id];
      if (!d) return;
      setMedia((cur) => {
        const merged = withStored(cur, d.media);
        const extra = d.media.filter((m) => !cur.some((c) => c.key === m.key));
        return extra.length ? [...merged.filter((m) => !(extra.some((e) => e.kind === 'video') && m.kind === 'video')), ...extra] : merged;
      });
    }, [id]),
  );

  const current = withStored(media, stored?.media);

  /** Save the draft (content from the screen; upload state from the store is never overwritten). */
  const save = (content: DraftContent, list: DraftMedia[] = current): PostDraft => {
    const latest = usePostDrafts.getState().drafts[id] ?? base;
    const d: PostDraft = { ...latest, ...content, media: withStored(list, latest.media) };
    usePostDrafts.getState().upsert(d);
    return d;
  };

  /** Add photos / a clip. Captured ones are kept + saved to Photos right away. */
  const add = async (content: DraftContent, items: ({ image: PickedImage } | { video: PickedVideo })[], opts: { replace?: boolean } = {}) => {
    if (!items.length) return;
    const baseList = opts.replace ? [] : current;
    const added = toDraftMedia({ media: current }, items);
    let next = [...baseList, ...added];
    setMedia(next);
    if (added.some((m) => m.captured)) {
      const d = save(content, next);
      const kept = await preserveCaptured(d, added.filter((m) => m.captured));
      next = next.map((m) => kept.find((k) => k.key === m.key) ?? m);
      setMedia(next);
    }
  };

  /** Remove a photo / clip (the stored draft forgets it too; its files are tidied when the post finishes or is discarded). */
  const removeMedia = (key: string) => {
    setMedia((cur) => cur.filter((m) => m.key !== key));
    const d = usePostDrafts.getState().drafts[id];
    if (d) usePostDrafts.getState().patch(id, { media: d.media.filter((m) => m.key !== key) });
  };
  const replaceMedia = (list: DraftMedia[]) => setMedia(list);

  const posting = stored?.state === 'posting' || isRunning(id) || busyLocal;
  const failed = !posting && (stored?.state === 'failed' || stored?.state === 'interrupted') ? stored?.error ?? 'Couldn’t post. Your post is saved.' : null;

  /** Post (or Try again). Closes the composer only once the server confirmed it. */
  const post = async (content: DraftContent) => {
    if (posting) return;
    setBusyLocal(true);
    save(content);
    try {
      const r = await runDraft(id);
      if (r === 'posted') closeComposer(fallback);
    } finally {
      setBusyLocal(false);
    }
  };

  /** Keep it for later (the "unfinished post" card offers it again). */
  const keep = (content: DraftContent) => {
    const d = save(content);
    if (d.state === 'editing' && !d.media.some((m) => m.captured) && d.attempts === 0) usePostDrafts.getState().patch(id, { state: 'failed', error: 'Saved as a draft.' });
    closeComposer(fallback);
  };

  const discard = async (): Promise<DiscardResult> => {
    const r = await discardDraft(id);
    closeComposer(fallback);
    return r;
  };

  /** Cancel: nothing worth keeping → just close; otherwise ask (keep / discard). */
  const cancel = () => {
    if (posting) {
      stopDraft(id);
      return;
    }
    const d = usePostDrafts.getState().drafts[id];
    const worth = !!d && (d.attempts > 0 || d.media.some((m) => m.captured) || current.some((m) => m.captured));
    if (!worth) {
      if (d && d.attempts === 0) usePostDrafts.getState().remove(id);
      closeComposer(fallback);
      return;
    }
    setCancelling(true);
  };

  /** Captured media that exists ONLY in this draft (not in Photos): discarding loses it. */
  const atRisk = onlyCopyInChimp({ media: current });

  return {
    id,
    resumed,
    media: current,
    add,
    removeMedia,
    replaceMedia,
    progress,
    posting,
    failed,
    post,
    keep,
    discard,
    cancel,
    cancelling,
    setCancelling,
    atRisk,
    /** Record a video in Chimp: the draft (with what you've typed) is saved first. */
    openRecorder: (content: DraftContent) => {
      save(content);
      router.push(`/create/record?draft=${id}${content.boardId ? `&board=${content.boardId}` : ''}`);
    },
  };
}
