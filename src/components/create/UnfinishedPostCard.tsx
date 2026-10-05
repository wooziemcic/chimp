import { router, usePathname } from 'expo-router';
import { CheckCircle2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { useDatasetVersion } from '@/services/dataset';
import { discardDraft, draftOwner, isRunning, runDraft, tidyDrafts, usePostDrafts } from '@/services/postDrafts';
import { colors, radius } from '@/theme';
import { layout, navBottomInset } from '@/theme/layout';
import { onlyCopyInChimp, progressText, recoverable } from '@/utils/postDraft';

/** Main tabs only: never over a composer, a chat, a viewer or After Dark. */
const SHOW_ON = new Set(['/buzz', '/boards', '/happening', '/you', '/']);

/**
 * Posting reliability: "You have an unfinished post." — a post that failed,
 * was stopped, or was cut off when the app closed, or a photo / video you took
 * in Chimp that you haven't posted yet. Continue (back to its composer), Retry
 * (post it now, with progress) or Discard (warns if it's the only copy).
 * Only the signed-in account's drafts; one at a time, newest first.
 */
export function UnfinishedPostCard() {
  const pathname = usePathname();
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const version = useDatasetVersion((d) => d.version);
  const drafts = usePostDrafts((s) => s.drafts);
  const progress = usePostDrafts((s) => s.progress);
  // Whose drafts: the signed-in account (re-read whenever the dataset / account changes).
  const owner = useMemo(() => {
    void version;
    return draftOwner();
  }, [version]);
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // The account changed (or signed in): its queued clean-ups and leftover files.
  useEffect(() => {
    if (owner) void tidyDrafts();
  }, [owner]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (!SHOW_ON.has(pathname) || keyboard > 0) return null;
  const bottom = layout.navHeight + navBottomInset(insets.bottom) + 10;
  if (done) {
    return (
      <View style={[styles.wrap, { bottom }]} pointerEvents="none" testID="unfinished-posted">
        <View style={[styles.card, styles.row]}>
          <CheckCircle2 size={18} color={colors.success} />
          <T v="subhead" weight="700" style={{ marginLeft: 8 }}>
            {done}
          </T>
        </View>
      </View>
    );
  }
  const list = recoverable(Object.values(drafts), owner).filter((d) => !hidden[d.id]);
  const d = list[0];
  if (!d) return null;
  const running = isRunning(d.id) || d.state === 'posting';
  const p = progress[d.id];
  const thumb = d.media[0] ? (d.media[0].kind === 'video' ? d.media[0].poster?.uri : d.media[0].uri) : undefined;
  const risk = onlyCopyInChimp(d);
  const tried = d.attempts > 0 || d.state === 'failed' || d.state === 'interrupted';
  const what = d.media.some((m) => m.kind === 'video') ? 'video' : d.media.length > 1 ? 'photos' : d.media.length ? 'photo' : 'post';
  const subtitle = running
    ? progressText(p) || 'Preparing…'
    : d.state === 'interrupted'
      ? `Chimp closed before it was posted. Your ${what} ${what === 'photos' ? 'are' : 'is'} safe.`
      : d.error ?? `Your ${what} ${what === 'photos' ? 'are' : 'is'} safe${risk.length ? ' in Chimp' : ''}.`;

  const retry = async () => {
    const r = await runDraft(d.id);
    if (r === 'posted') setDone('Posted');
  };
  const discard = async () => {
    setConfirm(false);
    const r = await discardDraft(d.id);
    if (r === 'already_posted') setDone('It was already posted');
  };
  const cont = () => router.push(`/create/${d.surface}?draft=${d.id}`);

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" testID="unfinished-post">
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.row}>
          {thumb ? <Img uri={thumb} style={styles.thumb} /> : null}
          <View style={{ flex: 1, marginLeft: thumb ? 10 : 0 }}>
            <T v="subhead" weight="700">
              {list.length > 1 ? `You have ${list.length} unfinished posts` : 'You have an unfinished post'}
            </T>
            <T v="caption" color={colors.inkMuted} numberOfLines={2} style={{ marginTop: 2 }}>
              {confirm && risk.length ? `This ${risk[0].kind === 'video' ? 'video' : 'photo'} isn’t in your Photos. Discard deletes it for good.` : subtitle}
            </T>
          </View>
          {!running ? (
            <Tap onPress={() => setHidden({ ...hidden, [d.id]: true })} style={styles.close} accessibilityLabel="Hide for now" hitSlop={6}>
              <X size={16} color={colors.inkMuted} />
            </Tap>
          ) : null}
        </View>
        {running ? null : confirm ? (
          <View style={styles.actions}>
            <Btn label="Discard" danger onPress={() => void discard()} />
            <Btn label="Keep it" onPress={() => setConfirm(false)} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Btn label="Continue" primary={!tried} onPress={cont} />
            {tried ? <Btn label="Retry" primary onPress={() => void retry()} /> : null}
            <Btn label="Discard" onPress={() => setConfirm(true)} />
          </View>
        )}
      </View>
    </View>
  );
}

function Btn({ label, onPress, primary, danger }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <Tap onPress={onPress} style={[styles.btn, primary && { backgroundColor: colors.accent }, danger && { backgroundColor: '#FFE9E9' }]} accessibilityLabel={label}>
      <T v="footnote" weight="700" color={primary ? colors.white : danger ? colors.danger : colors.ink}>
        {label}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: layout.gutter, right: layout.gutter, alignItems: 'center', zIndex: 20 },
  card: { width: '100%', maxWidth: 520, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceMuted },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
});
