import { router } from 'expo-router';
import { Settings, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { WORLD_DELETE_FAILED, WORLD_DELETE_NOT_OWNER } from '@/services/backend/content';
import { deleteMyWorld } from '@/services/backend/ownContent';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';
import type { Board } from '@/types/models';

/**
 * Phase 6D (final): the ••• menu on a World YOU OWN. Delete World (after a
 * confirmation) and the usual Settings. Only the owner ever sees it (admins,
 * members and followers keep the plain ••• → Settings), and the server checks
 * ownership again before anything is deleted.
 */
export function WorldOwnerMenu({ board, open, onClose }: { board: Board; open: boolean; onClose: () => void }) {
  const insets = useDeviceInsets(); // Phase 8: a Modal sheet covers the whole phone → its real insets
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setConfirm(false);
    setError(null);
    onClose();
  };

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyWorld(board.id, repo.mode() === 'real' ? 'real' : 'demo');
      setBusy(false);
      setConfirm(false);
      onClose();
      router.replace('/boards');
    } catch (e) {
      setBusy(false);
      // Only our own, readable messages reach the person; anything else (a raw
      // platform / network error) becomes the plain retry message.
      const msg = e instanceof Error ? e.message : '';
      if (__DEV__ && msg !== WORLD_DELETE_FAILED && msg !== WORLD_DELETE_NOT_OWNER) console.warn('[chimp:world] delete failed', msg.slice(0, 160));
      setError(msg === WORLD_DELETE_NOT_OWNER ? msg : WORLD_DELETE_FAILED);
    }
  };

  // What happens to posts depends on who could see them (see 0005_delete_world.sql).
  const detail =
    board.visibility === 'public'
      ? 'Its Drift, Stories, members, followers and join requests are removed. Buzz posts in it stay on their authors’ profiles, without the World.'
      : 'Its posts, Drift and Stories are deleted for everyone, along with its members, followers and join requests.';

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close menu">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
          {!confirm ? (
            <>
              <Tap onPress={() => setConfirm(true)} style={styles.row} accessibilityLabel="Delete World" testID="world-delete">
                <Trash2 size={19} color={colors.danger} />
                <T v="bodyStrong" color={colors.danger} style={{ marginLeft: 14 }}>
                  Delete World
                </T>
              </Tap>
              <Tap
                onPress={() => {
                  close();
                  router.push('/settings');
                }}
                style={styles.row}
                accessibilityLabel="Settings"
              >
                <Settings size={19} color={colors.ink} />
                <T v="bodyStrong" style={{ marginLeft: 14 }}>
                  Settings
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
              <T v="title3">Delete this World?</T>
              <T v="subhead" color={colors.ink2} weight="500" style={{ marginTop: 6 }}>
                This will permanently remove the World and its World-specific content.
              </T>
              <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 6 }}>
                {`${detail} This can’t be undone.`}
              </T>
              {error ? (
                <T v="footnote" color={colors.danger} style={{ marginTop: 10 }} testID="world-delete-error">
                  {error}
                </T>
              ) : null}
              <Tap onPress={() => void del()} disabled={busy} style={[styles.big, { backgroundColor: colors.danger }]} accessibilityLabel={`Confirm delete ${board.title}`} testID="world-delete-confirm">
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <T v="bodyStrong" color={colors.white}>
                    Delete World
                  </T>
                )}
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
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderRadius: radius.lg },
  cancel: { justifyContent: 'center', marginTop: 4, backgroundColor: colors.surfaceMuted },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
