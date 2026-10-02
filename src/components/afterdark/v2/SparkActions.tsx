/**
 * Phase 7A: on a profile with a mutual Crush (Spark): the two ways forward.
 * "Start normal chat" stays in normal Messages; "Take it After Dark" asks
 * for a Vibe (they decide). A normal chat is never copied into After Dark.
 */
import { router } from 'expo-router';
import { MessageCircle, Moon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';
import { colors } from '@/theme';

export function SparkActions({ personId, first }: { personId: string; first: string }) {
  const all = useAfterDark((s) => s.vibes);
  const vibes = all.filter((v) => v.other_id === personId);
  const ready = useAfterDark((s) => (s.profile?.age ?? 0) >= 18);
  const request = useAfterDark((s) => s.requestVibe);
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const activate = useAfterDark((s) => s.activate);
  // A mutual Crush is a way into After Dark: load your Vibes (to know if one exists).
  useEffect(() => {
    activate();
  }, [activate]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = vibes.find((v) => v.status !== 'closed');
  const ended = !open && vibes.length > 0;

  const afterDark = async () => {
    if (open) return router.push(`/after-dark/vibe/${open.vibe_id}`);
    if (!ageConfirmed || !ready) return router.navigate({ pathname: '/after-dark', params: { tab: 'vibes' } });
    setBusy(true);
    setError(null);
    try {
      const id = await request(personId, 'mutual_crush');
      router.push(`/after-dark/vibe/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const label = open ? (open.status === 'pending' ? (open.my_role === 'recipient' ? `${first} asked · See it` : `Waiting on ${first}`) : 'Open your Vibe') : 'Take it After Dark';

  return (
    <View style={{ marginTop: 10 }}>
      <View style={styles.row}>
        <Tap onPress={() => router.push(`/chat/${personId}`)} haptic="light" style={[styles.btn, styles.ghost]} accessibilityLabel={`Start a normal chat with ${first}`} testID="spark-normal-chat">
          <MessageCircle size={16} color={colors.ink} />
          <T v="subhead" weight="700" style={{ marginLeft: 6 }} numberOfLines={1}>
            Normal chat
          </T>
        </Tap>
        {!ended ? (
          <Tap onPress={() => void afterDark()} disabled={busy} haptic="medium" style={[styles.btn, styles.night, busy && { opacity: 0.6 }]} accessibilityLabel={open ? label : `Take it After Dark with ${first}`} testID="spark-after-dark">
            <Moon size={16} color="#fff" />
            <T v="subhead" weight="700" color="#fff" style={{ marginLeft: 6 }} numberOfLines={1}>
              {label}
            </T>
          </Tap>
        ) : null}
      </View>
      {!open && !ended ? (
        <T v="caption" weight="500" color={colors.inkMuted} style={{ marginTop: 6 }}>
          {`After Dark is opt-in for both of you: ${first} decides whether to open a Vibe.`}
        </T>
      ) : null}
      {error ? (
        <T v="caption" color={colors.danger} style={{ marginTop: 6 }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, height: 42, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  ghost: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#FFD1DC' },
  night: { backgroundColor: '#140B18' },
});
