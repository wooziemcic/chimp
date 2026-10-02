/**
 * Phase 7A: Inbox — After Dark's own conversations, one per Vibe. Separate
 * from normal Messages (which never lists them); a normal chat with the same
 * person stays where it is and is never copied in here.
 */
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useTabBarSpace } from '@/hooks/useLayout';
import { adUser, firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { whenLabel } from '@/utils/format';
import { layout } from '@/theme';
import { ad } from './adTheme';
import { useDisplayStatus } from './useAdData';
import { EmptyNote, originLine, previewOf, StatusPill } from './VibeParts';

export function InboxTab() {
  const tabSpace = useTabBarSpace();
  const vibes = useAfterDark((s) => s.vibes);
  const uid = useAfterDark((s) => s.uid);
  const status = useDisplayStatus();
  const list = vibes.filter((v) => v.status !== 'closed').sort((a, b) => (b.last_at ?? b.updated_at).localeCompare(a.last_at ?? a.updated_at));

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: tabSpace }} showsVerticalScrollIndicator={false} testID="inbox-tab">
      {list.length ? (
        list.map((v) => {
          const first = firstNameOf(v.other_id);
          const preview =
            previewOf(v, uid) || (v.status === 'pending' ? (v.my_role === 'recipient' ? `${first} wants to take it After Dark` : `Waiting on ${first}. No rush.`) : 'Say hi, or send a Challenge.');
          const st = status(v);
          return (
            <Tap key={v.vibe_id} onPress={() => router.push(`/after-dark/vibe/${v.vibe_id}`)} style={styles.row} scaleTo={0.99} accessibilityLabel={`${first}. ${preview}${v.unread ? `. ${v.unread} unread` : ''}`} testID={`inbox-${v.other_id}`}>
              <Avatar uri={adUser(v.other_id)?.avatar} name={first} size={52} ring={v.unread ? ad.pink : undefined} ringWidth={2} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <T v="headline" color={ad.ink} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {first}
                  </T>
                  {st !== 'active' ? (
                    <View style={{ marginLeft: 8 }}>
                      <StatusPill status={st} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <T v="caption" color={ad.faint}>
                    {whenLabel(v.last_at ?? v.updated_at)}
                  </T>
                </View>
                <T v="footnote" color={v.unread ? ad.ink : ad.muted} weight={v.unread ? '700' : '500'} numberOfLines={1} style={{ marginTop: 3 }}>
                  {preview}
                </T>
                <T v="caption" weight="500" color={ad.faint} numberOfLines={1} style={{ marginTop: 2 }}>
                  {originLine(v, first)}
                </T>
              </View>
              {v.unread ? (
                <View style={styles.unread}>
                  <T v="caption" weight="800" color="#fff">
                    {v.unread > 9 ? '9+' : v.unread}
                  </T>
                </View>
              ) : null}
            </Tap>
          );
        })
      ) : (
        <View style={{ marginTop: 6 }}>
          <EmptyNote title="No conversations yet" body="Each Vibe gets its own private chat here, separate from your normal Messages." />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ad.line },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: ad.pink, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
