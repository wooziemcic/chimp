import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonRow } from '@/components/profile/PersonRow';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { T } from '@/components/ui/Text';
import { useSignals } from '@/hooks/useGraph';
import { intentsFor, rankPeople } from '@/services/recommender';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { MatchIntent } from '@/types/models';

type Filter = 'all' | MatchIntent | 'connections';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All matches' },
  { id: 'friend', label: 'Friends' },
  { id: 'collaborator', label: 'Collaborators' },
  { id: 'professional', label: 'Professional' },
  { id: 'romantic', label: 'Dating' },
  { id: 'connections', label: 'Connections' },
];

/** People you should meet — every suggestion states why. */
export default function PeopleScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [filter, setFilter] = useState<Filter>(view === 'connections' ? 'connections' : 'all');
  const signals = useSignals();
  const connections = useChimp((s) => s.connections);

  const ranked = useMemo(() => rankPeople(signals), [signals]);
  const rows = useMemo(() => {
    if (filter === 'connections') {
      const byId = new Map(ranked.map((r) => [r.person.id, r]));
      return Object.keys(connections)
        .map((id) => ({ user: repo.user(id)!, reason: byId.get(id)?.match.matchReasons[0]?.label ?? 'Connected' }))
        .filter((r) => r.user);
    }
    return ranked
      .filter((r) => !connections[r.person.id])
      .filter((r) => (filter === 'all' ? true : intentsFor(r.person).includes(filter)))
      .filter((r) => (filter === 'romantic' ? (r.person.openTo ?? []).includes('dating') : true))
      .slice(0, 16)
      .map((r) => ({ user: r.person, reason: `${r.match.matchScore}% · ${r.match.matchReasons[0]?.label ?? 'New in your graph'}` }));
  }, [filter, ranked, connections]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="People" subtitle="Matches include friends, collaborators, professional and dating" />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => (
            <Chip key={f.id} label={f.label} size="sm" active={filter === f.id} onPress={() => setFilter(f.id)} />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.user.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        renderItem={({ item }) => <PersonRow user={item.user} reason={item.reason} action="connect" />}
        ListHeaderComponent={
          filter === 'romantic' ? (
            <T v="footnote" color={colors.inkMuted} style={{ marginBottom: 6 }}>
              Only people who opted into dating appear here, and only to others who did too.
            </T>
          ) : null
        }
        ListEmptyComponent={<EmptyState title="No one here yet" body="As your graph grows, your agent will suggest more people." />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 20, gap: 8, paddingBottom: 8 },
});
