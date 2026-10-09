import { useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonRow } from '@/components/profile/PersonRow';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { T } from '@/components/ui/Text';
import { fetchMyFollowLists, fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';

type List = 'followers' | 'following' | 'connections';

const LISTS: { id: List; label: string }[] = [
  { id: 'followers', label: 'Followers' },
  { id: 'following', label: 'Following' },
  { id: 'connections', label: 'Connections' },
];

/**
 * Phase 9.2: YOUR Followers / Following / Connections, from You.
 *
 * Private to you: this screen only ever shows the signed-in account's own
 * lists (it takes no person id), other people's profiles show totals only,
 * and the server lets nobody read someone else's follows (0013) or
 * connections (0001).
 */
export default function RelationsScreen() {
  const params = useLocalSearchParams<{ list?: string }>();
  const [list, setList] = useState<List>(params.list === 'following' || params.list === 'connections' ? params.list : 'followers');
  const data = useDataset();
  const real = data.mode === 'real';
  const following = useChimp((s) => s.following);
  const connections = useChimp((s) => s.connections);
  const [remote, setRemote] = useState<{ followers: string[]; following: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!real) return;
    let live = true;
    (async () => {
      try {
        const lists = await fetchMyFollowLists(data.me.id);
        const unknown = [...new Set([...lists.followers, ...lists.following, ...Object.keys(useChimp.getState().connections)])].filter((id) => !repo.user(id));
        if (unknown.length) {
          const people = await fetchPeople(unknown);
          if (people.length) realData.addPeople(people.map((p) => toUser(p)));
        }
        if (live) setRemote(lists);
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : String(e));
          setRemote({ followers: [], following: [] });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [real, data.me.id]);

  const ids = useMemo(() => {
    if (list === 'connections') return Object.keys(connections);
    if (real) {
      if (!remote) return null;
      // Following: the server's list, kept in step with taps made here (Follow / Following).
      return list === 'followers' ? remote.followers : [...new Set([...remote.following.filter((id) => following[id]), ...Object.keys(following)])];
    }
    return list === 'followers' ? data.followsMe : Object.keys(following);
  }, [list, connections, real, remote, following, data.followsMe]);

  const users = (ids ?? []).map((id) => repo.user(id)).filter((u): u is NonNullable<typeof u> => !!u && !repo.isMe(u.id));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }} testID="relations">
      <ScreenHeader title="Your people" subtitle="Only you can see these lists" />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {LISTS.map((l) => (
            <Chip key={l.id} label={l.label} size="sm" active={list === l.id} onPress={() => setList(l.id)} />
          ))}
        </ScrollView>
      </View>
      {ids === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item }) => <PersonRow user={item} subtitle={item.username ? `@${item.username}` : item.city} action={list === 'connections' ? 'connect' : 'follow'} />}
          ListHeaderComponent={
            <View style={styles.note}>
              <Lock size={12} color={colors.inkFaint} />
              <T v="caption" color={colors.inkFaint} style={{ marginLeft: 6, flex: 1 }}>
                {error ? `Couldn’t load this list. ${error}` : real ? 'Other people see your totals, never who is on these lists.' : 'Demo: shows the people modelled in this preview.'}
              </T>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={list === 'followers' ? 'No followers yet' : list === 'following' ? 'You’re not following anyone yet' : 'No connections yet'}
              body={list === 'connections' ? 'Connect with people to plan things together.' : undefined}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 20, gap: 8, paddingBottom: 8 },
  note: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 },
});
