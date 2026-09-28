import { router, useLocalSearchParams } from 'expo-router';
import { AlertCircle, ChevronLeft, Users } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationBody } from '@/components/chat/ConversationBody';
import { useGroupChemistry } from '@/components/chat/useGroupChemistry';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Button, EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useChat } from '@/store/useChat';
import { colors, radius } from '@/theme';
import { pushOnce } from '@/utils/nav';

/**
 * Group chat (final messaging patch). Members only: the database decides
 * who can read or send (RLS), this screen just shows what it's given.
 * Header → Group Info. Chemistry and Open Loops sit quietly at the top.
 */
export default function GroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useChat((s) => s.conversations[id]);
  const loaded = useChat((s) => s.loaded);
  const live = useChat((s) => s.live);
  const open = useChat((s) => s.open);
  const respond = useChat((s) => s.respond);
  const leave = useChat((s) => s.leaveGroup);
  const close = useChat((s) => s.close);
  const chemistry = useGroupChemistry(id);

  const present = !!c;
  useEffect(() => {
    if (!present) return;
    void open(id);
    return () => close(id);
  }, [id, present, open, close]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/messages'));

  if (!c) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.header}>
          <IconButton label="Back" onPress={back}>
            <ChevronLeft size={24} color={colors.ink} />
          </IconButton>
        </View>
        {loaded ? (
          <EmptyState title="You’re not in this group" body="You left, were removed, or it was deleted." action={<Button label="Messages" onPress={() => router.replace('/messages')} />} />
        ) : (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
        )}
      </SafeAreaView>
    );
  }

  const moderator = c.myRole === 'owner' || c.myRole === 'admin';
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={back}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
        <Tap onPress={() => pushOnce(`/group-info/${id}`)} style={styles.who} accessibilityLabel={`${c.title ?? 'Group'}, ${c.memberCount} members. Group info`} testID="group-header">
          {c.avatar ? (
            <Avatar uri={c.avatar} name={c.title} size={40} />
          ) : (
            <View style={styles.groupAvatar}>
              <Users size={19} color={colors.accent} />
            </View>
          )}
          <View style={{ marginLeft: 10, flex: 1 }}>
            <T v="bodyStrong" numberOfLines={1}>
              {c.title ?? 'Group'}
            </T>
            <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1}>
              {`${c.memberCount} members`}
            </T>
          </View>
        </Tap>
        {live === 'error' ? <AlertCircle size={18} color={colors.inkFaint} accessibilityLabel="Live updates reconnecting" /> : null}
      </View>
      <ConversationBody
        conversationId={id}
        group
        placeholder={`Message ${c.title ?? 'the group'}…`}
        chemistry={chemistry}
        moderator={moderator}
        hideComposer={c.myStatus === 'declined'}
        aboveComposer={
          c.myStatus === 'request' || c.myStatus === 'declined' ? (
            <View style={styles.request}>
              <T v="subhead" weight="700">
                {c.myStatus === 'declined' ? 'You declined this group' : 'You were added to this group'}
              </T>
              <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
                {c.myStatus === 'declined' ? 'Accept to join the conversation.' : 'Replying accepts. Declining leaves the group.'}
              </T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Tap onPress={() => void respond(id, true)} style={[styles.reqBtn, { backgroundColor: colors.accent }]} accessibilityLabel="Accept group">
                  <T v="subhead" weight="700" color={colors.white}>
                    Accept
                  </T>
                </Tap>
                {c.myStatus === 'request' ? (
                  <Tap onPress={() => void leave(id).then(back).catch(() => undefined)} style={[styles.reqBtn, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Decline group">
                    <T v="subhead" weight="700" color={colors.ink2}>
                      Decline
                    </T>
                  </Tap>
                ) : null}
              </View>
            </View>
          ) : null
        }
        listFooter={
          <T v="footnote" color={colors.inkFaint} align="center" style={{ marginVertical: 12, paddingHorizontal: 24 }}>
            {`${c.title ?? 'This group'} · ${c.memberCount} members. Only members can read it.`}
          </T>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  who: { flexDirection: 'row', alignItems: 'center', flex: 1, marginLeft: 10 },
  request: { marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  reqBtn: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  groupAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
