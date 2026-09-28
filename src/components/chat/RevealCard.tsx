import { X } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { PingMatchRow } from '@/services/backend/chat';
import { chatUser } from '@/store/useChat';
import { colors, radius } from '@/theme';
import { matchCopy, pingEmoji } from '@/utils/messaging';

interface Props {
  match: PingMatchRow;
  group: boolean;
  onPlan: () => void;
  onChat: () => void;
  onLoop: () => void;
  onDismiss: () => void;
}

/** A Ping match, revealed: only ever shown because the server made one. */
export function RevealCard({ match, group, onPlan, onChat, onLoop, onDismiss }: Props) {
  const copy = matchCopy(match, group);
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [match.id]);
  const emojis = [...new Set(match.kinds.map(pingEmoji))].join(' ');
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.card} testID="ping-reveal">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <T v="caption" color={colors.violet} style={{ letterSpacing: 0.6 }}>{`✨ PING MATCH  ${emojis}`}</T>
          <T v="headline" style={{ marginTop: 4 }}>
            {copy.title}
          </T>
          <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 2 }}>
            {copy.sub}
          </T>
        </View>
        <Tap onPress={onDismiss} style={styles.x} accessibilityLabel="Dismiss">
          <X size={16} color={colors.inkMuted} />
        </Tap>
      </View>
      {group ? (
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          {match.participants.slice(0, 6).map((id, i) => {
            const u = chatUser(id);
            return (
              <View key={id} style={{ marginLeft: i ? -8 : 0, borderRadius: 16, borderWidth: 2, borderColor: colors.violetSoft }}>
                <Avatar uri={u?.avatar} name={u?.displayName} size={28} />
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Tap onPress={onPlan} style={[styles.btn, { backgroundColor: colors.violet }]} accessibilityLabel="Make a plan">
          <T v="footnote" weight="700" color={colors.white}>
            Make a plan
          </T>
        </Tap>
        <Tap onPress={onChat} style={styles.btn} accessibilityLabel="Open chat">
          <T v="footnote" weight="700" color={colors.ink2}>
            Open chat
          </T>
        </Tap>
        <Tap onPress={onLoop} style={styles.btn} accessibilityLabel="Create Open Loop">
          <T v="footnote" weight="700" color={colors.ink2}>
            Create Open Loop
          </T>
        </Tap>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.xl, backgroundColor: colors.violetSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9C9FF' },
  x: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: -4, marginRight: -4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  btn: { height: 34, paddingHorizontal: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
