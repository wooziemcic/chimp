import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { User } from '@/types/models';

/**
 * Start a chat: recent chats, then connections, people you follow, and
 * (REAL, Phase 6B) people in Worlds you share — the same order the chat rules
 * use (anyone else becomes a Message Request, or isn't reachable).
 */
export default function NewChat() {
  const insets = useSafeAreaInsets();
  const connections = useChimp((s) => s.connections);
  const following = useChimp((s) => s.following);
  const joined = useChimp((s) => s.joined);
  const blocked = useChimp((s) => s.blocked);
  const demoChats = useChimp((s) => s.chats);
  const realChats = useChat((s) => s.byPerson);
  const real = repo.mode() === 'real';
  const chats: Record<string, unknown> = real ? realChats : demoChats;

  const sections = useMemo(() => {
    const ok = (u: User | undefined): u is User => !!u && !blocked[u.id] && !repo.isMe(u.id);
    const recent = Object.keys(chats).map((id) => repo.user(id)).filter(ok);
    const conn = Object.keys(connections).map((id) => repo.user(id)).filter((u): u is User => ok(u) && !chats[u.id]);
    const fol = Object.keys(following).map((id) => repo.user(id)).filter((u): u is User => ok(u) && !connections[u.id] && !chats[u.id]);
    const taken = new Set([...recent, ...conn, ...fol].map((u) => u.id));
    const worlds = real
      ? [...new Set(repo.boards().filter((b) => joined[b.id] || repo.isMe(b.ownerId)).flatMap((b) => b.memberPreview))]
          .map((id) => repo.user(id))
          .filter((u): u is User => ok(u) && !taken.has(u.id))
      : [];
    return [
      { title: 'Recent', data: recent },
      { title: 'Connections', data: conn },
      { title: 'Following', data: fol },
      { title: 'In your Worlds', data: worlds },
    ].filter((s) => s.data.length);
  }, [chats, connections, following, joined, blocked, real]);

  const open = (id: string) => {
    router.back();
    setTimeout(() => router.push(`/chat/${id}`), 220);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Start a chat" subtitle="Connections are mutual, so they’re listed first" />
      <SectionList
        sections={sections}
        keyExtractor={(u) => u.id}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<EmptyState title="No one to message yet" body="Connect with people, follow each other, or join a World together — they’ll show up here." />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
        renderSectionHeader={({ section }) => (
          <T v="label" color={colors.inkFaint} style={{ marginTop: 14, marginBottom: 4 }}>
            {section.title.toUpperCase()}
          </T>
        )}
        renderItem={({ item }) => (
          <Tap onPress={() => open(item.id)} scaleTo={0.985} style={styles.row}>
            <Avatar uri={item.avatar} name={item.displayName} size={44} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <T v="bodyStrong">{item.displayName}</T>
              <T v="footnote" color={colors.inkMuted} numberOfLines={1}>
                {(real ? undefined : demoChats[item.id]?.slice(-1)[0]?.body) ?? item.city}
              </T>
            </View>
            <ChevronRight size={18} color={colors.inkFaint} />
          </Tap>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
