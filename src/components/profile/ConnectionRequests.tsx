/**
 * Phase 7B: people who asked to connect with you, on You — so a request is
 * seen without having to find the sender's profile first. Accept / Decline
 * are explicit intents (a double tap is still one Accept); the list follows
 * the server (live events, foreground and reconnect reconcile).
 */
import { router } from 'expo-router';
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useConnection } from '@/hooks/useConnection';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';

export function useIncomingRequests(): string[] {
  const incoming = useChimp((s) => s.incomingConnects);
  return Object.keys(incoming ?? {}).filter((id) => incoming?.[id]);
}

export function ConnectionRequests() {
  const ids = useIncomingRequests();
  if (!ids.length) return null;
  return (
    <View style={styles.card} testID="connection-requests">
      <T v="headline">{ids.length === 1 ? 'Connection request' : `Connection requests · ${ids.length}`}</T>
      <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
        Connecting is mutual and unlocks planning together.
      </T>
      {ids.slice(0, 5).map((id) => (
        <RequestRow key={id} id={id} />
      ))}
      {ids.length > 5 ? (
        <Tap onPress={() => router.push('/people?view=connections')} style={{ marginTop: 6, minHeight: 36, justifyContent: 'center' }} accessibilityLabel="See all requests">
          <T v="footnote" weight="700" color={colors.accent}>{`+${ids.length - 5} more`}</T>
        </Tap>
      ) : null}
    </View>
  );
}

const RequestRow = memo(function RequestRow({ id }: { id: string }) {
  // Re-render when a just-fetched requester's profile arrives (a brand-new account).
  useDatasetVersion((d) => d.version);
  const user = repo.user(id);
  const name = user?.displayName ?? 'Someone new';
  const conn = useConnection(id, name);
  return (
    <View style={styles.row} testID={`request-row-${id}`}>
      <Tap onPress={() => router.push(`/profile/${id}`)} style={styles.who} accessibilityLabel={`See ${name}’s profile`}>
        <Avatar uri={user?.avatar} name={name} size={42} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <T v="bodyStrong" numberOfLines={1}>
            {name}
          </T>
          <T v="footnote" color={conn.error ? colors.danger : colors.inkMuted} numberOfLines={1}>
            {conn.error ?? (user?.username ? `@${user.username}` : 'Wants to connect')}
          </T>
        </View>
      </Tap>
      {conn.busy ? (
        <ActivityIndicator color={colors.accent} style={{ width: 80 }} />
      ) : (
        <>
          <Tap onPress={() => conn.run('decline')} style={[styles.btn, styles.btnOff]} accessibilityLabel={`Decline ${name}`} testID={`request-decline-${id}`}>
            <T v="footnote" weight="700" color={colors.ink2}>
              Decline
            </T>
          </Tap>
          <Tap onPress={() => conn.run('accept')} haptic="medium" style={[styles.btn, { backgroundColor: colors.accent }]} accessibilityLabel={`Accept ${name}`} testID={`request-accept-${id}`}>
            <T v="footnote" weight="700" color={colors.white}>
              Accept
            </T>
          </Tap>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...shadow.sm },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  btn: { height: 36, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  btnOff: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.line },
});
