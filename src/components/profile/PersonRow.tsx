import { router } from 'expo-router';
import { BadgeCheck, Check, Sparkles } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';
import type { User } from '@/types/models';

interface Props {
  user: User;
  reason?: string;
  accent?: string;
  action?: 'follow' | 'connect';
  /** For dark-themed boards. */
  textColor?: string;
}

/** Compact person row with a follow / connect control. */
export const PersonRow = memo(function PersonRow({ user, reason, accent = colors.accent, action = 'follow', textColor = colors.ink }: Props) {
  const following = useChimp((s) => !!s.following[user.id]);
  const connected = useChimp((s) => !!s.connections[user.id]);
  const toggleFollow = useChimp((s) => s.toggleFollow);
  const toggleConnect = useChimp((s) => s.toggleConnect);
  const on = action === 'follow' ? following : connected;
  const label = action === 'follow' ? (on ? 'Following' : 'Follow') : on ? 'Connected' : 'Connect';

  return (
    <Tap onPress={() => router.push(`/profile/${user.id}`)} scaleTo={0.985} style={styles.row}>
      <Avatar uri={user.avatar} name={user.displayName} size={48} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="bodyStrong" color={textColor} numberOfLines={1} style={{ flexShrink: 1 }}>
            {user.displayName}
          </T>
          {user.verified ? <BadgeCheck size={15} color={colors.white} fill={colors.accent} style={{ marginLeft: 4 }} /> : null}
        </View>
        {reason ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Sparkles size={12} color={accent} />
            <T v="footnote" color={accent} weight="500" numberOfLines={1} style={{ marginLeft: 4, flexShrink: 1 }}>
              {reason}
            </T>
          </View>
        ) : (
          <T v="footnote" color={colors.inkMuted} numberOfLines={1} style={{ marginTop: 1 }}>
            {`${user.city}${user.knownFor?.[0] ? ` · ${user.knownFor[0]}` : ''}`}
          </T>
        )}
      </View>
      {repo.isMe(user.id) ? null : (
        <Tap
          onPress={() => (action === 'follow' ? toggleFollow(user.id) : toggleConnect(user.id))}
          haptic="light"
          accessibilityLabel={`${label} ${user.displayName}`}
          style={[styles.btn, on ? styles.btnOn : { backgroundColor: accent }]}
        >
          {on ? <Check size={14} color={colors.ink2} strokeWidth={3} style={{ marginRight: 4 }} /> : null}
          <T v="footnote" weight="700" color={on ? colors.ink2 : colors.white}>
            {label}
          </T>
        </Tap>
      )}
    </Tap>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  btn: { height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  btnOn: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.line },
});
