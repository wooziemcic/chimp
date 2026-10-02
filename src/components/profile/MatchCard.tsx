import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Check, MapPin, MessageCircle, Sparkles } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { interestById } from '@/data/interests';
import { useConnection } from '@/hooks/useConnection';
import { useMatch } from '@/hooks/useGraph';
import { colors, radius, shadow } from '@/theme';
import type { User } from '@/types/models';
import { useImpression } from '@/hooks/useImpression';

/**
 * "People You Should Meet" card. The reason leads; the percentage supports
 * it. Photo-forward like a dating profile, but the ask is to connect.
 */
export const MatchCard = memo(function MatchCard({ person, width }: { person: User; width: number }) {
  useImpression(`person:${person.id}`);
  const match = useMatch(person.id);
  const conn = useConnection(person.id, person.displayName);
  const connected = conn.view === 'connected';
  const shared = match?.sharedInterests ?? [];
  const chips = [...shared, ...person.interests.filter((i) => !shared.includes(i))].slice(0, 3);
  const photoH = width * 0.62;

  return (
    <Tap onPress={() => router.push(`/profile/${person.id}`)} scaleTo={0.98} style={[styles.card, { width }]} accessibilityLabel={`${person.displayName}, ${match?.matchReasons[0]?.label ?? ''}`}>
      <View style={{ height: photoH }}>
        <Img uri={person.heroImage ?? person.avatar} contentPosition="top" style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.score}>
          <T v="caption" weight="800" color={colors.accent}>{`${match?.matchScore ?? 0}%`}</T>
          <T v="caption" weight="600" color={colors.inkMuted} style={{ marginLeft: 3 }}>
            match
          </T>
        </View>
        <View style={styles.nameWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="title3" color={colors.white} numberOfLines={1} style={[styles.shadow, { flexShrink: 1 }]}>
              {person.displayName}
            </T>
            {person.verified ? <BadgeCheck size={17} color={colors.accent} fill={colors.white} style={{ marginLeft: 5 }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
            <MapPin size={12} color="rgba(255,255,255,0.9)" />
            <T v="caption" color="rgba(255,255,255,0.92)" weight="500" style={[styles.shadow, { marginLeft: 3 }]}>
              {person.city}
            </T>
          </View>
        </View>
      </View>

      <View style={{ padding: 12 }}>
        <View style={styles.reason}>
          <Sparkles size={14} color={colors.accent} style={{ marginTop: 2 }} />
          <T v="subhead" weight="700" color={colors.ink} numberOfLines={2} style={{ marginLeft: 6, flex: 1, lineHeight: 19 }}>
            {match?.matchReasons[0]?.label ?? 'New in your graph'}
          </T>
        </View>
        <View style={styles.chips}>
          {chips.map((i) => (
            <View key={i} style={[styles.chip, shared.includes(i) && styles.chipShared]}>
              <T v="caption" weight="600" color={shared.includes(i) ? colors.accent : colors.ink2} numberOfLines={1} style={{ fontSize: 11 }}>
                {interestById[i]?.label}
              </T>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Tap
            onPress={conn.press}
            haptic="medium"
            disabled={conn.busy}
            accessibilityLabel={connected ? `Disconnect from ${person.displayName}` : `${conn.label} ${person.displayName}`}
            style={[styles.connect, (connected || conn.view === 'requested_by_me') && styles.connected]}
          >
            {connected ? <Check size={15} color={colors.accent} strokeWidth={3} style={{ marginRight: 4 }} /> : null}
            <T v="subhead" weight="700" color={connected || conn.view === 'requested_by_me' ? colors.accent : colors.white}>
              {conn.label}
            </T>
          </Tap>
          <Tap onPress={() => router.push(`/chat/${person.id}`)} accessibilityLabel={`Chat with ${person.displayName}`} style={styles.chat}>
            <MessageCircle size={18} color={colors.accent} />
          </Tap>
        </View>
      </View>
    </Tap>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...shadow.sm },
  score: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  nameWrap: { position: 'absolute', left: 12, right: 12, bottom: 10 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  reason: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 38 },
  chips: { flexDirection: 'row', gap: 5, marginTop: 8 },
  chip: { height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.surfaceMuted, justifyContent: 'center', maxWidth: 90 },
  chipShared: { backgroundColor: colors.accentSoft },
  connect: { flex: 1, flexDirection: 'row', height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  connected: { backgroundColor: colors.accentSoft },
  chat: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
