import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { editMinutesLeft } from '@/utils/editWindow';
import { T } from '@/components/ui/Text';
import { colors, radius } from '@/theme';

interface Props {
  /** 'post' or 'reply': used in the wording. */
  what: 'post' | 'reply';
  /** When it was posted (the 1-hour edit window starts here). */
  createdAtMs?: number;
  /** Some things can never be edited (e.g. polls). */
  editable?: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  /** Light icon for dark surfaces. */
  onDark?: boolean;
  size?: number;
}

/**
 * Phase 6D: the ••• menu on something you posted: Edit (for 1 hour) and
 * Delete (any time, after a confirmation). The server has the final say on
 * both; this only offers what it will allow.
 */
export function OwnerMenu({ what, createdAtMs, editable = true, onEdit, onDelete, onDark, size = 18 }: Props) {
  const insets = useDeviceInsets(); // Phase 8: a Modal sheet covers the whole phone → its real insets
  const [open, setOpen] = useState(false);
  const [editMinutes, setEditMinutes] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirm(false);
    setError(null);
  };
  const canEdit = editable && editMinutes > 0;
  const noun = what === 'post' ? 'post' : 'reply';

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setBusy(false);
      setOpen(false);
      setConfirm(false);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Tap
        onPress={() => {
          setEditMinutes(editMinutesLeft(createdAtMs));
          setOpen(true);
        }}
        hitSlop={8} style={styles.trigger} accessibilityLabel={`Options for your ${noun}`} testID={`owner-menu-${what}`}>
        <MoreHorizontal size={size} color={onDark ? colors.white : colors.inkMuted} />
      </Tap>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close menu">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
            {!confirm ? (
              <>
                <Tap onPress={() => { if (canEdit) { close(); onEdit(); } }} disabled={!canEdit} style={[styles.row, !canEdit && { opacity: 0.5 }]} accessibilityLabel={`Edit ${noun}`} testID="owner-edit">
                  <Pencil size={19} color={colors.ink} />
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <T v="bodyStrong">{`Edit ${noun}`}</T>
                    <T v="footnote" color={colors.inkMuted} weight="400">
                      {!editable
                        ? `This kind of ${noun} can’t be edited. You can delete it.`
                        : canEdit
                          ? `You can edit for ${editMinutes} more ${editMinutes === 1 ? 'minute' : 'minutes'}.`
                          : `${what === 'post' ? 'Posts' : 'Replies'} can be edited for 1 hour after posting.`}
                    </T>
                  </View>
                </Tap>
                <Tap onPress={() => setConfirm(true)} style={styles.row} accessibilityLabel={`Delete ${noun}`} testID="owner-delete">
                  <Trash2 size={19} color={colors.danger} />
                  <T v="bodyStrong" color={colors.danger} style={{ marginLeft: 14 }}>
                    {`Delete ${noun}`}
                  </T>
                </Tap>
                <Tap onPress={close} style={[styles.row, styles.cancel]} accessibilityLabel="Cancel">
                  <T v="bodyStrong" color={colors.ink2}>
                    Cancel
                  </T>
                </Tap>
              </>
            ) : (
              <View style={{ paddingHorizontal: 6 }}>
                <T v="title3">{`Delete this ${noun}?`}</T>
                <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 6 }}>
                  {what === 'post'
                    ? 'It’s removed everywhere: Buzz, Worlds, your profile, Drift and anyone’s saves. Its replies and likes go too. This can’t be undone.'
                    : 'It’s removed for everyone. This can’t be undone.'}
                </T>
                {error ? (
                  <T v="footnote" color={colors.danger} style={{ marginTop: 10 }} testID="owner-error">
                    {error}
                  </T>
                ) : null}
                <Tap onPress={() => void del()} disabled={busy} style={[styles.big, { backgroundColor: colors.danger }]} accessibilityLabel={`Confirm delete ${noun}`} testID="owner-confirm-delete">
                  {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>{`Delete ${noun}`}</T>}
                </Tap>
                <Tap onPress={close} disabled={busy} style={[styles.big, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Keep it">
                  <T v="bodyStrong" color={colors.ink2}>
                    Keep it
                  </T>
                </Tap>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderRadius: radius.lg },
  cancel: { justifyContent: 'center', marginTop: 4, backgroundColor: colors.surfaceMuted },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
