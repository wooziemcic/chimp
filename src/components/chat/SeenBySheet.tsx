import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MIN_TAP, useDeviceInsets } from '@/components/system/SafeArea';
import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { chatUser } from '@/store/useChat';
import { colors } from '@/theme';

/**
 * Phase 8: who has seen my latest group message. Opened by tapping
 * "Seen by N" — names are never listed under messages. The list comes from
 * the server (chat_receipts), which already leaves out anyone across a block.
 */
export function SeenBySheet({ ids, of, onClose }: { ids: string[] | null; of: number; onClose: () => void }) {
  const insets = useDeviceInsets();
  return (
    <Modal visible={!!ids} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined} testID="seen-by-sheet">
          <T v="headline" style={{ paddingHorizontal: 4 }}>
            {ids && ids.length >= of ? 'Seen by everyone' : `Seen by ${ids?.length ?? 0} of ${of}`}
          </T>
          <ScrollView style={{ maxHeight: 360, marginTop: 10 }}>
            {(ids ?? []).map((id) => {
              const u = chatUser(id);
              return (
                <View key={id} style={styles.row} testID={`seen-by-${id}`}>
                  <Avatar uri={u?.avatar} name={u?.displayName ?? 'Chimp member'} size={32} />
                  <T v="subhead" style={{ marginLeft: 10, flexShrink: 1 }} numberOfLines={1}>
                    {u?.displayName ?? 'Chimp member'}
                  </T>
                </View>
              );
            })}
          </ScrollView>
          <Tap onPress={onClose} style={styles.done} accessibilityLabel="Done">
            <T v="subhead" weight="700" color={colors.accent}>
              Done
            </T>
          </Tap>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, paddingHorizontal: 4 },
  done: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
