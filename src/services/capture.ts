/**
 * Posting reliability: a captured moment must never be lost because a post
 * failed.
 *
 *   keepFile        copies a photo / clip into Chimp's own Documents folder
 *                   (post-drafts/{draftId}/). The picker's copy lives in the
 *                   cache, which iOS may clear and which nothing else points
 *                   to; this one stays until the post is confirmed by the
 *                   server or you discard it.
 *   saveToPhotos    puts something you took WITH CHIMP'S CAMERA into your
 *                   iPhone's Photos library, if you allow it (add-only
 *                   permission: Chimp can add, never read or delete).
 *                   Library picks are already in Photos and are never
 *                   duplicated. Declining never blocks posting.
 *
 * Web (tests) and missing native modules fall back gracefully: the URI is kept
 * as it is, and "saved to Photos" is reported as not done.
 */
import { Platform } from 'react-native';

// Loaded lazily (native only): expo-media-library can't even be imported on web.
const fsMod = () => import('expo-file-system');
const mlMod = () => import('expo-media-library');

const DIR = 'post-drafts';

const trace = (step: string, extra?: unknown) => {
  if (__DEV__) console.log(`[chimp:capture] ${step}`, extra ? JSON.stringify(extra) : '');
};

/** Is this URI already one of Chimp's kept draft files? */
export const isKeptFile = (uri: string) => uri.includes(`/${DIR}/`);

/**
 * Copy `uri` into the draft's folder (once) and return the kept URI. Safe to
 * call again with the kept URI. On web, returns the URI unchanged. The copy is
 * written to a temporary name first and only then renamed, so a crash
 * mid-copy never leaves a half file that looks complete.
 */
export async function keepFile(uri: string, draftId: string, name: string): Promise<string> {
  return (await keepFileResult(uri, draftId, name)).uri;
}

/** keepFile, also saying whether a durable copy exists (false = still only the original, e.g. storage full). */
export async function keepFileResult(uri: string, draftId: string, name: string): Promise<{ uri: string; kept: boolean }> {
  if (!uri) return { uri, kept: false };
  if (Platform.OS === 'web') return { uri, kept: false };
  if (isKeptFile(uri)) return { uri, kept: true };
  try {
    const { Directory, File, Paths } = await fsMod();
    const dir = new Directory(Paths.document, DIR, draftId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const src = new File(uri);
    const ext = (src.extension || '.jpg').replace(/^\.?/, '.');
    const dest = new File(dir, `${name}${ext}`);
    if (!dest.exists) {
      const part = new File(dir, `${name}${ext}.part`);
      if (part.exists) part.delete();
      await src.copy(part);
      await part.move(dest);
    }
    return { uri: dest.uri, kept: true };
  } catch (e) {
    // Couldn't copy (e.g. the phone's storage is full): keep using the original rather than failing,
    // and say so (the composer warns that it isn't safe yet).
    trace('keep failed', String(e));
    return { uri, kept: false };
  }
}

/** Remove a draft's kept files (after the post is confirmed, or when you discard it). */
export async function removeKeptFiles(draftId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { Directory, Paths } = await fsMod();
    const dir = new Directory(Paths.document, DIR, draftId);
    if (dir.exists) dir.delete();
  } catch (e) {
    trace('remove failed', String(e));
  }
}

/** Kept folders on this phone (to tidy up ones whose draft no longer exists). */
export async function keptDraftIds(): Promise<string[]> {
  if (Platform.OS === 'web') return [];
  try {
    const { Directory, Paths } = await fsMod();
    const root = new Directory(Paths.document, DIR);
    if (!root.exists) return [];
    return root.list().map((d) => d.name);
  } catch {
    return [];
  }
}

export type SaveResult = 'saved' | 'denied' | 'unavailable' | 'failed';

/**
 * Save a photo or clip taken with Chimp's camera to Photos. Asks for add-only
 * access the first time (iOS shows Chimp's reason). Never throws.
 */
export async function saveToPhotos(uri: string): Promise<SaveResult> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const ML = await mlMod();
    let perm = await ML.getPermissionsAsync(true);
    if (!perm.granted && perm.canAskAgain) perm = await ML.requestPermissionsAsync(true, ['photo', 'video']);
    if (!perm.granted) return 'denied';
    await ML.Asset.create(uri);
    return 'saved';
  } catch (e) {
    trace('save to Photos failed', String(e));
    return 'failed';
  }
}
