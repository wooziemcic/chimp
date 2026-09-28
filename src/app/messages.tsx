import { PenSquare, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { type Conversation, chatUser, selectRequests, useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { ImageSrc } from '@/types/models';
import { whenLabel } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

type Tab = 'chats' | 'requests';

/** One row in the list: a real conversation, or (Demo) a local practice chat. */
type Item = { key: string; at?: string; c?: Conversation; demoPersonId?: string };

/**
 * Messages: your conversations, newest first, with unread counts. 1:1 chats
 * and group chats sit together. Message Requests (people you're not
 * connected with yet) wait in their own tab until you reply or accept.
 * Demo: the seeded Demo group (in memory) plus the local practice chats.
 */
export default function MessagesScreen() {
  const [tab, setTab] = useState<Tab>('chats');
  const conversations = useChat((s) => s.conversations);
  useChat((s) => s.people); // names arriving re-render rows
  const loaded = useChat((s) => s.loaded);
  const error = useChat((s) => s.error);
  const requests = useChat(selectRequests);
  const reload = useChat((s) => s.loadConversations);
  const demoChats = useChimp((s) => s.chats);
  const [refreshing, setRefreshing] = useState(false);
  const demo = repo.mode() !== 'real';

  const list = useMemo(() => {
    const rows: Item[] = Object.values(conversations)
      .filter((c) => (tab === 'requests' ? c.myStatus === 'request' : c.myStatus === 'active' || c.myStatus === 'declined'))
      .filter((c) => tab === 'requests' || c.kind === 'group' || c.lastAt) // hide 1:1 chats nobody has written in yet
      .map((c) => ({ key: c.id, at: c.lastAt, c }));
    if (demo && tab === 'chats') {
      for (const [id, msgs] of Object.entries(demoChats)) {
        const last = msgs[msgs.length - 1];
        if (last && repo.user(id)) rows.push({ key: `demo:${id}`, at: new Date(last.at).toISOString(), demoPersonId: id });
      }
    }
    return rows.sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0'));
  }, [conversations, tab, demo, demoChats]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Messages"
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton label="New group" onPress={() => pushOnce('/new-group')}>
              <Users size={21} color={colors.ink} />
            </IconButton>
            <IconButton label="New message" onPress={() => pushOnce('/new-chat')}>
              <PenSquare size={22} color={colors.ink} />
            </IconButton>
          </View>
        }
      />
      {!demo ? (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'chats', label: 'Chats' },
            { id: 'requests', label: requests ? `Requests (${requests})` : 'Requests' },
          ]}
        />
      ) : (
        <T v="footnote" color={colors.inkFaint} style={{ paddingHorizontal: 20 }}>
          Demo chats are practice: nothing is sent to anyone.
        </T>
      )}
      {!loaded ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.accent} /> : null}
      {error ? (
        <T v="footnote" color={colors.danger} style={{ paddingHorizontal: 20, marginTop: 8 }}>
          {error}
        </T>
      ) : null}
      <FlatList
        data={list}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          loaded ? (
            tab === 'requests' ? (
              <EmptyState title="No requests" body="When someone you’re not connected with messages you, it waits here until you reply or accept." />
            ) : (
              <EmptyState title="No messages yet" body="Message a connection, someone you follow, or a member of a World you share. Or start a group." />
            )
          ) : null
        }
        renderItem={({ item }) => (item.c ? <Row c={item.c} /> : <DemoRow personId={item.demoPersonId!} />)}
      />
    </SafeAreaView>
  );
}

function Row({ c }: { c: Conversation }) {
  const group = c.kind === 'group';
  const other = group ? undefined : chatUser(c.otherId);
  const name = group ? c.title ?? 'Group' : other?.displayName;
  const avatar: ImageSrc | undefined = group ? c.avatar : other?.avatar;
  const mine = !!c.lastSender && c.lastSender === useChat.getState().uid;
  const who = group && c.lastSender && !mine ? `${chatUser(c.lastSender)?.displayName.split(' ')[0] ?? 'Someone'}: ` : mine ? 'You: ' : '';
  const preview = !c.lastAt || (!c.lastBody && !c.lastType) ? (group ? `${c.memberCount} members` : 'Say hi') : c.lastType === 'photo' && !c.lastBody ? '📷 Photo' : c.lastBody ?? 'Message unsent';
  const unread = c.myStatus === 'active' && c.unread > 0;
  const href = group ? `/group/${c.id}` : `/chat/${c.otherId}`;
  return (
    <Tap onPress={() => pushOnce(href)} scaleTo={0.985} style={styles.row} accessibilityLabel={`${name ?? 'Chat'}${group ? ', group' : ''}${unread ? `, ${c.unread} unread` : ''}`}>
      {group && !avatar ? (
        <View style={styles.groupAvatar}>
          <Users size={22} color={colors.accent} />
        </View>
      ) : (
        <Avatar uri={avatar} name={name} size={50} />
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {name ?? 'Chimp member'}
          </T>
          <T v="caption" color={unread ? colors.accent : colors.inkFaint} weight={unread ? '700' : '500'}>
            {c.lastAt ? whenLabel(c.lastAt) : ''}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <T v="subhead" weight={unread ? '700' : '400'} color={unread ? colors.ink : colors.inkMuted} numberOfLines={1} style={{ flex: 1 }}>
            {`${c.lastAt && (c.lastBody || c.lastType) ? who : ''}${preview}`}
          </T>
          {unread ? (
            <View style={styles.badge}>
              <T v="caption" weight="800" color={colors.white} style={{ fontSize: 12 }}>
                {c.unread > 99 ? '99+' : c.unread}
              </T>
            </View>
          ) : null}
        </View>
      </View>
    </Tap>
  );
}

function DemoRow({ personId }: { personId: string }) {
  const u = repo.user(personId);
  const last = useChimp((s) => s.chats[personId]?.slice(-1)[0]);
  return (
    <Tap onPress={() => pushOnce(`/chat/${personId}`)} scaleTo={0.985} style={styles.row} accessibilityLabel={u?.displayName ?? 'Chat'}>
      <Avatar uri={u?.avatar} name={u?.displayName} size={50} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {u?.displayName ?? 'Chimp member'}
          </T>
          <T v="caption" color={colors.inkFaint}>
            {last ? whenLabel(new Date(last.at).toISOString()) : ''}
          </T>
        </View>
        <T v="subhead" weight="400" color={colors.inkMuted} numberOfLines={1} style={{ marginTop: 2 }}>
          {last ? `${last.fromMe ? 'You: ' : ''}${last.body}` : ''}
        </T>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  groupAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
