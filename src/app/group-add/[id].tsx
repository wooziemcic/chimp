import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PeoplePicker } from '@/components/chat/PeoplePicker';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { EMPTY_EXTRAS, useChat } from '@/store/useChat';
import { colors } from '@/theme';

/** Add people to a group (owner or admin; the server checks). */
export default function GroupAdd() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const c = useChat((s) => s.conversations[id]);
  const members = useChat((s) => s.extras[id]?.members) ?? EMPTY_EXTRAS.members;
  const addMembers = useChat((s) => s.addMembers);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = members.filter((m) => m.status !== 'left').map((m) => m.user_id);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await addMembers(id, picked);
      router.back();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Add people" subtitle={c?.title} />
      <PeoplePicker selected={picked} onToggle={(uid) => setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]))} exclude={current} footerPad={insets.bottom + 110} />
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {error ? (
          <T v="footnote" color={colors.danger} style={{ marginBottom: 8 }} testID="group-add-error">
            {error}
          </T>
        ) : null}
        <Tap onPress={() => void add()} disabled={!picked.length || busy} style={[styles.primary, (!picked.length || busy) && { opacity: 0.4 }]} accessibilityLabel="Add to group">
          {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>{picked.length ? `Add ${picked.length}` : 'Add'}</T>}
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  primary: { height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
