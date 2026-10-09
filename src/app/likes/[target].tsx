import { useLocalSearchParams } from 'expo-router';
import { Heart } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { PersonRow } from '@/components/profile/PersonRow';
import { EmptyState } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { T } from '@/components/ui/Text';
import { fetchLikers, fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { colors } from '@/theme';
import { whenLabel } from '@/utils/format';

/**
 * Phase 9.2: who liked one of YOUR posts (`/likes/buzz:<id>` or `/likes/drift:<id>`).
 * Only the author gets here (the like count is only tappable on your own
 * post), and the server answers only the author (post_likers, 0013).
 * Each row shows the person, when they liked it, and Follow / Following;
 * tapping opens their profile.
 */
export default function LikesSheet() {
  const { target } = useLocalSearchParams<{ target: string }>();
  const [kind, id] = (target ?? '').split(':') as ['buzz' | 'drift', string];
  const item = kind === 'drift' ? repo.driftItem(id) : repo.buzzItem(id);
  const mine = !!item && repo.isMe(item.authorId);
  const real = repo.mode() === 'real';
  useDatasetVersion((d) => d.version); // re-render when the likers' profiles arrive
  const [rows, setRows] = useState<{ userId: string; likedAt: string }[] | null>(real && mine ? null : []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!real || !mine || (kind !== 'buzz' && kind !== 'drift')) return;
    let live = true;
    (async () => {
      try {
        const likers = await fetchLikers(kind, id);
        const unknown = likers.map((l) => l.userId).filter((u) => !repo.user(u));
        if (unknown.length) {
          const people = await fetchPeople(unknown);
          if (people.length) realData.addPeople(people.map((p) => toUser(p)));
        }
        if (live) setRows(likers);
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : String(e));
          setRows([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [real, mine, kind, id]);

  const people = (rows ?? []).map((r) => ({ ...r, user: repo.user(r.userId) })).filter((r) => r.user);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="likes-sheet">
      <SheetHeader title="Likes" subtitle={mine ? 'People who liked your post' : undefined} />
      {!mine ? (
        <EmptyState title="Only the person who posted it can see this" />
      ) : rows === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(r) => r.userId}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          ListHeaderComponent={
            error ? (
              <T v="footnote" color={colors.danger} style={{ marginBottom: 8 }}>
                {`Couldn’t load likes. ${error}`}
              </T>
            ) : null
          }
          renderItem={({ item: r }) => (
            <PersonRow user={r.user!} subtitle={[r.user!.username ? `@${r.user!.username}` : null, whenLabel(r.likedAt)].filter(Boolean).join(' · ')} />
          )}
          ListEmptyComponent={error ? null : <EmptyState icon={<Heart size={22} color={colors.accent} />} title="No likes yet" body={real ? 'When people like your post, they’ll show up here.' : 'In the Demo, likes on your posts aren’t from real people.'} />}
        />
      )}
    </View>
  );
}
