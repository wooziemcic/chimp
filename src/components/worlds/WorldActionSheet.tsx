/**
 * Phase 9: long-press a World anywhere → Pin World / Unpin World · Open World.
 * One sheet for the whole app (mounted once in the root layout), opened with
 * openWorldActions(boardId). Pinning never changes who can see the World.
 */
import { router } from 'expo-router';
import { ArrowUpRight, Pin, PinOff } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { useDeviceInsets } from '@/components/system/SafeArea';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { isAfterDarkBoard } from '@/graph/surfaces';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { usePins } from '@/store/usePins';
import { colors, radius } from '@/theme';

const useWorldSheet = create<{ boardId: string | null }>(() => ({ boardId: null }));

/** Open the action sheet for a World (no-op for After Dark). */
export function openWorldActions(boardId: string) {
  if (isAfterDarkBoard(repo.board(boardId))) return;
  useWorldSheet.setState({ boardId });
}

export function WorldActionSheet() {
  const boardId = useWorldSheet((s) => s.boardId);
  const insets = useDeviceInsets();
  const board = useDataset().boardMap[boardId ?? ''];
  const pinned = usePins((s) => !!(boardId && s.pins[boardId]));
  const supported = usePins((s) => s.supported);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    useWorldSheet.setState({ boardId: null });
  };
  if (!boardId || !board) return null;
  const owner = board.ownerId ? repo.user(board.ownerId) : undefined;
  const byline = repo.isMe(board.ownerId) ? 'Your World' : owner?.username ? `by @${owner.username}` : board.ownerId ? 'A member’s World' : 'Chimp World';

  const togglePin = async () => {
    setBusy(true);
    setError(null);
    try {
      await usePins.getState().toggle(board.id, repo.mode() === 'real');
      setBusy(false);
      useWorldSheet.setState({ boardId: null });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Couldn’t pin this World. Try again.');
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close menu">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined} testID="world-actions">
          <View style={styles.head}>
            <Img uri={board.cover} style={styles.cover} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <T v="bodyStrong" numberOfLines={1}>
                {board.title}
              </T>
              <T v="footnote" color={colors.inkMuted} weight="400" numberOfLines={1}>
                {byline}
              </T>
            </View>
          </View>
          {supported ? (
            <Tap onPress={() => void togglePin()} disabled={busy} style={styles.row} accessibilityLabel={pinned ? 'Unpin World' : 'Pin World'} testID="world-pin">
              {busy ? <ActivityIndicator color={colors.ink} /> : pinned ? <PinOff size={19} color={colors.ink} /> : <Pin size={19} color={colors.ink} />}
              <View style={{ flex: 1, marginLeft: 14 }}>
                <T v="bodyStrong">{pinned ? 'Unpin World' : 'Pin World'}</T>
                <T v="footnote" color={colors.inkMuted} weight="400">
                  {pinned ? 'It leaves the top of Happening.' : 'Keeps it at the top of Happening. Pinning doesn’t change who can see it.'}
                </T>
              </View>
            </Tap>
          ) : null}
          {error ? (
            <T v="footnote" color={colors.danger} style={{ marginHorizontal: 8, marginTop: 4 }} testID="world-pin-error">
              {error}
            </T>
          ) : null}
          <Tap
            onPress={() => {
              close();
              router.push(`/board/${board.id}`);
            }}
            style={styles.row}
            accessibilityLabel="Open World"
          >
            <ArrowUpRight size={19} color={colors.ink} />
            <T v="bodyStrong" style={{ marginLeft: 14 }}>
              Open World
            </T>
          </Tap>
          <Tap onPress={close} style={[styles.row, styles.cancel]} accessibilityLabel="Cancel">
            <T v="bodyStrong" color={colors.ink2}>
              Cancel
            </T>
          </Tap>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,10,16,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 14, paddingHorizontal: 12 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10 },
  cover: { width: 48, height: 48, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderRadius: radius.md },
  cancel: { justifyContent: 'center', marginTop: 4, backgroundColor: colors.surfaceMuted },
});
