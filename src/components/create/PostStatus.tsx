import { AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors, radius } from '@/theme';
import { type DraftMedia, type DraftProgress, notSafeYet, overallFraction, progressText } from '@/utils/postDraft';

/**
 * Posting reliability: what the composer shows instead of an endless spinner.
 *   posting  "Uploading 2 of 4… 45%" with a bar · "Keep Chimp open until it's posted."
 *   failed   "Couldn't post. Your photo is safe." · Try again · Keep draft · Discard
 *   cancel   Keep draft · Discard (warns when a photo / video exists only here) · Keep editing
 */
export function PostStatus({
  progress,
  posting,
  failed,
  cancelling,
  atRisk,
  onRetry,
  onKeep,
  onDiscard,
  onBack,
}: {
  progress?: DraftProgress;
  posting: boolean;
  failed: string | null;
  cancelling: boolean;
  atRisk: DraftMedia[];
  onRetry: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  if (posting) {
    const f = overallFraction(progress);
    return (
      <View style={styles.box} testID="post-progress" accessibilityLiveRegion="polite">
        <T v="subhead" weight="700">
          {progressText(progress) || 'Preparing…'}
        </T>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round((f ?? 0.03) * 100)}%` }]} />
        </View>
        <T v="caption" color={colors.inkMuted} style={{ marginTop: 6 }}>
          Keep Chimp open until it’s posted. Tap Stop to save it as a draft.
        </T>
      </View>
    );
  }
  if (cancelling) {
    const risk = atRisk.length ? (atRisk.some((m) => m.kind === 'video') ? 'This video isn’t in your Photos. Discarding deletes it for good.' : `${atRisk.length > 1 ? 'These photos aren’t' : 'This photo isn’t'} in your Photos. Discarding deletes ${atRisk.length > 1 ? 'them' : 'it'} for good.`) : null;
    return (
      <View style={styles.box} testID="cancel-choices">
        <T v="subhead" weight="700">
          Keep this post for later?
        </T>
        {risk ? (
          <T v="footnote" color={colors.danger} style={{ marginTop: 4 }}>
            {risk}
          </T>
        ) : null}
        <View style={styles.row}>
          <Btn label="Keep draft" primary onPress={onKeep} />
          <Btn label="Discard" danger onPress={onDiscard} />
          <Btn label="Keep editing" onPress={onBack} />
        </View>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.box, styles.failed]} testID="post-failed" accessibilityRole="alert">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <AlertCircle size={18} color={colors.danger} style={{ marginTop: 1 }} />
          <T v="subhead" weight="600" color={colors.ink} style={{ marginLeft: 8, flex: 1 }}>
            {failed}
          </T>
        </View>
        <View style={styles.row}>
          <Btn label="Try again" primary onPress={onRetry} />
          <Btn label="Keep draft" onPress={onKeep} />
          <Btn label="Discard" danger onPress={onDiscard} />
        </View>
      </View>
    );
  }
  return null;
}

/** Small, honest status under a captured photo / clip. */
export function PhotosCopyNote({ media }: { media: DraftMedia[] }) {
  const captured = media.filter((m) => m.captured);
  if (!captured.length) return null;
  const unsafe = notSafeYet({ media });
  if (unsafe.length) {
    return (
      <View style={styles.note} testID="photos-copy-note">
        <T v="caption" color={colors.danger}>
          {`Not saved anywhere yet — Chimp couldn’t keep a copy (is your iPhone’s storage full?) and it isn’t in your Photos. Post it now, or allow Photos access in Settings.`}
        </T>
      </View>
    );
  }
  const saved = captured.every((m) => m.photos === 'saved');
  const saving = captured.some((m) => m.photos === 'saving');
  const kind = captured.some((m) => m.kind === 'video') ? 'video' : captured.length > 1 ? 'photos' : 'photo';
  const text = saved ? `Saved to your Photos` : saving ? 'Saving to your Photos…' : `Kept in Chimp until it’s posted (not in your Photos)`;
  return (
    <View style={styles.note} testID="photos-copy-note">
      {saved ? <CheckCircle2 size={14} color={colors.success} /> : null}
      <T v="caption" color={colors.inkMuted} style={{ marginLeft: saved ? 6 : 0 }}>
        {`${text}${saved ? ` · your ${kind} is safe` : ''}`}
      </T>
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
  box: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, marginBottom: 14 },
  failed: { backgroundColor: '#FFF4F4', borderWidth: 1, borderColor: '#F7C9C9' },
  track: { height: 6, borderRadius: 3, marginTop: 10, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
});
