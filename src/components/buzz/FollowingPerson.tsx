import { router } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GRID_GAP, PostTile } from '@/components/profile/RecentPosts';
import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { FOLLOWING_PREVIEW, type FollowingPerson as Person } from '@/graph/surfaces';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';
import { whenLabel } from '@/utils/format';

/**
 * Buzz → Following (Phase 9, people-first): one person, then their Buzz from
 * the last 7 days as tiles (photo / video ▶ / text / poll), newest first.
 * Three at first; "View more" shows the rest of THAT person's week only.
 */
export const FollowingPerson = memo(function FollowingPerson({ person, tile }: { person: Person; tile: number }) {
  const [open, setOpen] = useState(false);
  const u = repo.user(person.personId);
  const shown = open ? person.posts : person.posts.slice(0, FOLLOWING_PREVIEW);
  const more = person.posts.length - FOLLOWING_PREVIEW;
  const name = u?.displayName ?? 'Someone';
  const rows: (typeof shown)[] = [];
  for (let i = 0; i < shown.length; i += 3) rows.push(shown.slice(i, i + 3));
  return (
    <View style={styles.card} testID={`following-person-${person.personId}`}>
      <Tap onPress={() => router.push(`/profile/${person.personId}`)} style={styles.head} accessibilityLabel={`Open ${name}’s profile`}>
        <Avatar uri={u?.avatar} name={name} size={40} />
        <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
          <T v="subhead" weight="700" numberOfLines={1}>
            {name}
          </T>
          <T v="caption" color={colors.inkMuted} numberOfLines={1}>
            {`${u?.username ? `@${u.username} · ` : ''}${whenLabel(person.latest)}`}
          </T>
        </View>
        <T v="caption" color={colors.inkFaint} weight="600">
          {`${person.posts.length} this week`}
        </T>
      </Tap>
      <View style={{ gap: GRID_GAP }}>
        {rows.map((row) => (
          <View key={row.map((p) => p.key).join('+')} style={styles.row}>
            {row.map((p) => (
              <PostTile key={p.key} post={p} size={tile} testPrefix="following-tile" />
            ))}
          </View>
        ))}
      </View>
      {more > 0 ? (
        <Tap onPress={() => setOpen((o) => !o)} style={styles.more} accessibilityLabel={open ? `Show less from ${name}` : `View ${more} more from ${name}`} testID="following-more">
          <T v="footnote" weight="700" color={colors.accent}>
            {open ? 'Show less' : `View more · ${more}`}
          </T>
          {open ? <ChevronUp size={15} color={colors.accent} style={{ marginLeft: 4 }} /> : <ChevronDown size={15} color={colors.accent} style={{ marginLeft: 4 }} />}
        </Tap>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, padding: 12, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: 10 },
  row: { flexDirection: 'row', gap: GRID_GAP },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 6 },
});
