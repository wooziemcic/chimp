import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Bookmark, Calendar, Check, ChevronLeft, ChevronRight, MapPin, Share, Sparkles, Star, Ticket } from 'lucide-react-native';
import { ReactNode, useEffect, useMemo } from 'react';
import { ScrollView, Share as RNShare, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Img } from '@/components/ui/Img';
import { Button, EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useSignals } from '@/hooks/useGraph';
import { moveReasons } from '@/services/recommender';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';
import { compact } from '@/utils/format';

export default function MoveDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const move = repo.move(id);
  const state = useChimp((s) => s.moveState[id]) ?? {};
  const toggleMove = useChimp((s) => s.toggleMove);
  const markSeen = useChimp((s) => s.markSeen);
  const following = useChimp((s) => s.following);
  const connections = useChimp((s) => s.connections);
  const signals = useSignals();

  useEffect(() => {
    if (move) markSeen({ kind: 'move', id: move.id });
  }, [move, markSeen]);

  const reasons = useMemo(() => (move ? moveReasons(signals, move) : []), [signals, move]);

  if (!move) {
    return <EmptyState title="Move not found" action={<Button label="Go back" onPress={() => router.back()} />} />;
  }

  const host = repo.user(move.hostId);
  const board = move.boardId ? repo.board(move.boardId) : undefined;
  const known = move.attendeePreview.filter((u) => following[u] || connections[u]);
  const attendees = move.attendeePreview.map((u) => repo.user(u)!).filter(Boolean);
  const count = move.attendeeCount + (state.rsvp ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ height: 360 + insets.top }}>
          <Img uri={move.image} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
          <View style={[styles.topBar, { top: insets.top + 6 }]}>
            <IconButton label="Back" variant="glass" onPress={() => router.back()}>
              <ChevronLeft size={24} color={colors.ink} />
            </IconButton>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <IconButton label="Share" variant="glass" onPress={() => RNShare.share({ message: `${move.title} · ${move.city} · ${move.dateLabel} — on Chimp` })}>
                <Share size={20} color={colors.ink} />
              </IconButton>
              <IconButton label={state.saved ? 'Unsave' : 'Save'} variant="glass" onPress={() => toggleMove(move.id, 'saved')}>
                <Bookmark size={20} color={state.saved ? colors.accent : colors.ink} fill={state.saved ? colors.accent : 'transparent'} />
              </IconButton>
            </View>
          </View>
          <View style={styles.heroText}>
            <View style={styles.kind}>
              <Ticket size={13} color={colors.accent} />
              <T v="caption" color={colors.ink2} style={{ marginLeft: 5, letterSpacing: 0.8 }}>
                {`MOVE · ${move.kind.toUpperCase()}`}
              </T>
            </View>
            <T v="title1" color={colors.white} style={[styles.shadow, { marginTop: 10 }]}>
              {move.title}
            </T>
            <T v="callout" color="rgba(255,255,255,0.92)" style={styles.shadow}>
              {move.subtitle}
            </T>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.facts}>
            <Fact icon={<MapPin size={18} color={colors.accent} />} label="Where" value={move.city} />
            <Fact icon={<Calendar size={18} color={colors.accent} />} label="When" value={move.dateLabel} />
            <Fact icon={<Ticket size={18} color={colors.accent} />} label="Price" value={move.price ?? '—'} />
          </View>

          {/* Why this is here — explainable recommendation */}
          <View style={styles.why}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Sparkles size={16} color={colors.accent} />
              <T v="footnote" weight="700" color={colors.accent} style={{ marginLeft: 6, letterSpacing: 0.4 }}>
                WHY THIS IS IN YOUR MOVES
              </T>
            </View>
            {reasons.map((r) => (
              <View key={r} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
                <View style={styles.bullet} />
                <T v="subhead" weight="500" color={colors.ink2} style={{ flex: 1 }}>
                  {r}
                </T>
              </View>
            ))}
          </View>

          <T v="headline" style={{ marginTop: 22 }}>
            About
          </T>
          <T v="body" color={colors.ink2} style={{ marginTop: 6, lineHeight: 23 }}>
            {move.description}
          </T>

          {host ? (
            <Tap onPress={() => router.push(`/profile/${host.id}`)} style={styles.host}>
              <Avatar uri={host.avatar} name={host.displayName} size={44} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="caption" color={colors.inkFaint} weight="600">
                  HOSTED BY
                </T>
                <T v="bodyStrong">{host.displayName}</T>
                {host.knownFor?.[0] ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Star size={11} color={colors.warning} fill={colors.warning} />
                    <T v="caption" color={colors.inkMuted} weight="500" style={{ marginLeft: 4 }}>
                      {`Known for ${host.knownFor[0]}`}
                    </T>
                  </View>
                ) : null}
              </View>
              <ChevronRight size={20} color={colors.inkFaint} />
            </Tap>
          ) : null}

          <T v="headline" style={{ marginTop: 22 }}>
            {`${compact(count)} going`}
          </T>
          <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
            {known.length ? `Including ${known.map((u) => repo.user(u)?.displayName.split(' ')[0]).join(', ')}, who you know` : 'People from your graph who are going'}
          </T>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 12 }}>
            {attendees.map((u) => (
              <Tap key={u.id} onPress={() => router.push(`/profile/${u.id}`)} style={{ alignItems: 'center', width: 64 }}>
                <Avatar uri={u.avatar} name={u.displayName} size={54} ring={known.includes(u.id) ? colors.accent : undefined} ringWidth={2.5} />
                <T v="caption" weight="600" numberOfLines={1} style={{ marginTop: 5 }}>
                  {u.displayName.split(' ')[0]}
                </T>
              </Tap>
            ))}
          </View>

          {board ? (
            <Tap onPress={() => router.push(`/board/${board.id}`)} style={styles.board}>
              <Img uri={board.cover} style={{ width: 52, height: 52, borderRadius: 14 }} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="caption" color={colors.inkFaint} weight="600">
                  FROM THE BOARD
                </T>
                <T v="bodyStrong">{board.title}</T>
              </View>
              <ChevronRight size={20} color={colors.inkFaint} />
            </Tap>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky actions */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Tap
          onPress={() => toggleMove(move.id, 'interested')}
          haptic="light"
          accessibilityState={{ selected: !!state.interested }}
          style={[styles.secondary, state.interested && { backgroundColor: colors.accentSoft, borderColor: '#CFE0FF' }]}
        >
          <Star size={18} color={state.interested ? colors.accent : colors.ink} fill={state.interested ? colors.accent : 'transparent'} />
          <T v="bodyStrong" color={state.interested ? colors.accent : colors.ink} style={{ marginLeft: 6 }}>
            Interested
          </T>
        </Tap>
        <Button
          label={state.rsvp ? 'You’re going' : 'Join · RSVP'}
          size="lg"
          color={state.rsvp ? colors.success : colors.accent}
          icon={state.rsvp ? <Check size={18} color={colors.white} strokeWidth={3} /> : undefined}
          onPress={() => toggleMove(move.id, 'rsvp')}
          style={{ flex: 1.3 }}
        />
      </View>
    </View>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      {icon}
      <T v="caption" color={colors.inkFaint} weight="600" style={{ marginTop: 6 }}>
        {label.toUpperCase()}
      </T>
      <T v="subhead" weight="700" numberOfLines={1}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  heroText: { position: 'absolute', left: 20, right: 20, bottom: 40 },
  kind: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.94)' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  body: {
    marginTop: -24,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  facts: { flexDirection: 'row', padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.sm },
  why: { marginTop: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7, marginRight: 10 },
  host: { flexDirection: 'row', alignItems: 'center', marginTop: 18, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  board: { flexDirection: 'row', alignItems: 'center', marginTop: 20, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(245,247,251,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  secondary: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
