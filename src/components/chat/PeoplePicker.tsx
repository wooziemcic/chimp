import { Check, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { User } from '@/types/models';

/**
 * Choose people for a group: connections first, then people you follow, then
 * (REAL) people in Worlds you share — the people Chimp lets you message. The
 * server checks again when the group is made (and anyone who isn't connected
 * to you joins as a request they can accept).
 */
export function PeoplePicker({ selected, onToggle, exclude = [], footerPad = 20 }: { selected: string[]; onToggle: (id: string) => void; exclude?: string[]; footerPad?: number }) {
  const connections = useChimp((s) => s.connections);
  const following = useChimp((s) => s.following);
  const joined = useChimp((s) => s.joined);
  const blocked = useChimp((s) => s.blocked);
  const [q, setQ] = useState('');
  const real = repo.mode() === 'real';

  const sections = useMemo(() => {
    const skip = new Set(exclude);
    const ok = (u: User | undefined): u is User => !!u && !blocked[u.id] && !repo.isMe(u.id) && !skip.has(u.id);
    const match = (u: User) => !q.trim() || u.displayName.toLowerCase().includes(q.trim().toLowerCase()) || u.username.toLowerCase().includes(q.trim().toLowerCase());
    const conn = Object.keys(connections).map((id) => repo.user(id)).filter(ok);
    const fol = Object.keys(following).map((id) => repo.user(id)).filter((u): u is User => ok(u) && !connections[u.id]);
    const taken = new Set([...conn, ...fol].map((u) => u.id));
    const worlds = real
      ? [...new Set(repo.boards().filter((b) => joined[b.id] || repo.isMe(b.ownerId)).flatMap((b) => b.memberPreview))]
          .map((id) => repo.user(id))
          .filter((u): u is User => ok(u) && !taken.has(u.id))
      : [];
    return [
      { title: 'Connections', data: conn.filter(match) },
      { title: 'Following', data: fol.filter(match) },
      { title: 'In your Worlds', data: worlds.filter(match) },
    ].filter((s) => s.data.length);
  }, [connections, following, joined, blocked, real, q, exclude]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(u) => u.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.search}>
          <Search size={16} color={colors.inkFaint} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search people" placeholderTextColor={colors.inkFaint} style={styles.searchInput} accessibilityLabel="Search people" autoCorrect={false} />
        </View>
      }
      ListEmptyComponent={<EmptyState title={q ? 'No one by that name' : 'No one to add yet'} body={q ? undefined : 'Connect with people, follow each other, or join a World together — they’ll show up here.'} />}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: footerPad }}
      renderSectionHeader={({ section }) => (
        <T v="label" color={colors.inkFaint} style={{ marginTop: 14, marginBottom: 4 }}>
          {section.title.toUpperCase()}
        </T>
      )}
      renderItem={({ item }) => {
        const on = selected.includes(item.id);
        return (
          <Tap onPress={() => onToggle(item.id)} scaleTo={0.985} haptic="select" style={styles.row} accessibilityLabel={`${item.displayName}${on ? ', selected' : ''}`} accessibilityState={{ selected: on }}>
            <Avatar uri={item.avatar} name={item.displayName} size={44} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <T v="bodyStrong">{item.displayName}</T>
              {item.city ? (
                <T v="footnote" color={colors.inkMuted} numberOfLines={1}>
                  {item.city}
                </T>
              ) : null}
            </View>
            <View style={[styles.check, on && styles.checkOn]}>{on ? <Check size={15} color={colors.white} strokeWidth={3} /> : null}</View>
          </Tap>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, marginTop: 4 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, color: colors.ink, height: 42 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
