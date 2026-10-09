/**
 * Phase 6D: edit and delete what you posted (REAL accounts).
 * App Review patch: in the Demo, Buzz you posted on this phone can be edited
 * and deleted too (locally; the Demo never talks to the server).
 *
 * The server enforces every rule (author only; edits within 1 hour of the
 * server's created_at; delete any time). The app shows the change on every
 * surface at once, then reloads the world in the background so this phone's
 * cache matches the server.
 */
import { inferInterestsFromText } from '@/utils/inferInterests';
import { repo } from '@/services/repository';
import { usePins } from '@/store/usePins';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { deleteBuzz, deleteComment, deleteStoryItem, deleteWorld, editBuzz, editComment } from './content';
import type { CommentRow } from './mappers';
import * as realData from './realData';

const resync = () => void useSession.getState().refresh();

/** Demo: a Buzz you posted on this phone (only those can be edited or deleted). */
export function isMyDemoBuzz(id: string): boolean {
  return repo.mode() === 'demo' && (useChimp.getState().created?.buzz ?? []).some((b) => b.id === id);
}

export async function saveBuzzEdit(id: string, body: string, boardId: string): Promise<void> {
  if (isMyDemoBuzz(id)) {
    const created = useChimp.getState().created;
    useChimp.setState({ created: { ...created, buzz: created.buzz.map((b) => (b.id === id ? { ...b, body, boardId, editedAtMs: Date.now() } : b)) } });
    return;
  }
  const row = await editBuzz(id, body, boardId);
  const text = [row.title, row.body, row.meme_text, row.poll?.question].filter(Boolean).join(' ');
  realData.patchBuzz(id, {
    body: row.body ?? undefined,
    boardId: row.board_id ?? '',
    interests: row.board_id ? undefined : inferInterestsFromText(text),
    editedAtMs: row.edited_at ? Date.parse(row.edited_at) : Date.now(),
  });
  resync();
}

function without<T>(m: Record<string, T>, id: string): Record<string, T> {
  if (!(id in m)) return m;
  const next = { ...m };
  delete next[id];
  return next;
}

export async function removeMyBuzz(id: string): Promise<void> {
  const demo = isMyDemoBuzz(id);
  if (demo) {
    const created = useChimp.getState().created;
    useChimp.setState({ created: { ...created, buzz: created.buzz.filter((b) => b.id !== id) } });
  } else {
    await deleteBuzz(id);
    realData.removeBuzz(id);
  }
  // Your own flags on it (the server already removed the rows).
  useChimp.setState((s) => ({
    buzzLikes: without(s.buzzLikes, id),
    buzzDislikes: without(s.buzzDislikes, id),
    buzzSaves: without(s.buzzSaves, id),
    buzzReposts: without(s.buzzReposts, id),
    buzzVotes: without(s.buzzVotes, id),
  }));
  if (!demo) resync();
}

export async function saveReplyEdit(id: string, body: string): Promise<CommentRow> {
  const row = await editComment(id, body);
  realData.patchReply(id, { body: row.body, editedAtMs: row.edited_at ? Date.parse(row.edited_at) : Date.now() });
  return row;
}

export async function removeMyReply(id: string): Promise<void> {
  await deleteComment(id);
  realData.removeReply(id);
}

// ─── Phase 9.2: delete a Story you posted ───────────────────────────────────

/**
 * REAL: the server deletes the frame (author only), then it leaves your Story
 * and any World's Story at once; a background reload keeps the cache in step.
 * DEMO: Story frames you posted on this phone, removed locally.
 * (A reply someone already sent you about it stays in Messages.)
 */
export async function removeMyStoryFrame(frameId: string): Promise<void> {
  if (repo.mode() === 'real') {
    const uid = realData.real.uid();
    if (!uid) throw new Error('You’re signed out.');
    await deleteStoryItem(uid, frameId);
    realData.removeStoryFrame(frameId);
    resync();
    return;
  }
  const created = useChimp.getState().created;
  const stories = (created?.stories ?? [])
    .map((s) => ({ ...s, items: s.items.filter((i) => i.id !== frameId) }))
    .filter((s) => s.items.length)
    .map((s) => ({ ...s, cover: s.items[s.items.length - 1].image }));
  useChimp.setState({ created: { ...created, stories } });
}

// ─── Phase 6D (final): delete a World you own ───────────────────────────────

/**
 * REAL: the server deletes it (owner only; see delete_world in 0005), then it
 * leaves every surface here at once, and this phone forgets its flags.
 * DEMO: only Worlds you made on this phone, removed locally.
 */
export async function deleteMyWorld(boardId: string, mode: 'real' | 'demo'): Promise<void> {
  if (mode === 'real') {
    await deleteWorld(boardId);
    realData.removeBoard(boardId);
    usePins.getState().forget(boardId);
  } else {
    const created = useChimp.getState().created;
    if (created) useChimp.setState({ created: { ...created, boards: created.boards.filter((b) => b.id !== boardId) } });
  }
  useChimp.setState((s) => ({
    joined: without(s.joined, boardId),
    savedBoards: without(s.savedBoards, boardId),
    followedBoards: without(s.followedBoards ?? {}, boardId),
    joinRequested: without(s.joinRequested ?? {}, boardId),
    boardVisits: without(s.boardVisits ?? {}, boardId),
  }));
  if (mode === 'real') resync();
}
