import { router } from 'expo-router';
import { Check, ChevronRight, GitBranch, Sparkles, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { HNode } from '@/graph/happening';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';
import { hrefFor } from '@/utils/links';

const KIND_LABEL: Record<HNode['kind'], string> = {
  world: 'WORLD',
  board: 'SUB-WORLD',
  person: 'PERSON',
  move: 'MOVE',
  buzz: 'BUZZ',
};

/**
 * The small contextual panel for a selected node: what it is, why it's
 * here (from the graph), and three actions: Open, Join/Follow, Explore.
 */
export function NodePanel({ node, world, focus, onExplore, onClose }: { node: HNode; world?: { id: string; label: string }; focus: string | null; onExplore: (worldId: string) => void; onClose: () => void }) {
  const joined = useChimp((s) => (node.ref.kind === 'board' ? !!s.joined[node.ref.id] : false));
  const following = useChimp((s) => (node.ref.kind === 'person' ? !!s.following[node.ref.id] : false));
  const interested = useChimp((s) => (node.ref.kind === 'move' ? !!s.moveState[node.ref.id]?.interested : false));
  const toggleJoin = useChimp((s) => s.toggleJoin);
  const toggleFollow = useChimp((s) => s.toggleFollow);
  const toggleMove = useChimp((s) => s.toggleMove);

  const open = focus === node.worldId;
  const openLabel = node.ref.kind === 'person' ? 'Profile' : 'Open';
  const second =
    node.ref.kind === 'board'
      ? { label: joined ? 'Joined' : 'Join', on: joined, run: () => toggleJoin(node.ref.id) }
      : node.ref.kind === 'person'
        ? { label: following ? 'Following' : 'Follow', on: following, run: () => toggleFollow(node.ref.id) }
        : node.ref.kind === 'move'
          ? { label: interested ? 'Interested' : 'Interested?', on: interested, run: () => toggleMove(node.ref.id, 'interested') }
          : null;

  return (
    <Animated.View entering={FadeInDown.duration(220)} style={[styles.card, shadow.md]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Img uri={node.image} style={[styles.thumb, node.kind === 'person' && { borderRadius: 26 }]} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="caption" color={colors.accent} weight="800" style={{ letterSpacing: 0.6 }}>
            {node.kind === 'world' ? `WORLD · ${world?.label.toUpperCase() ?? ''}` : `${KIND_LABEL[node.kind]} · ${world?.label.toUpperCase() ?? ''}`}
          </T>
          <T v="headline" numberOfLines={2} style={{ marginTop: 2 }}>
            {node.kind === 'world' ? node.label : node.label}
          </T>
          {node.meta ? (
            <T v="footnote" color={colors.inkMuted} weight="500">
              {node.meta}
            </T>
          ) : null}
        </View>
        <Tap onPress={onClose} style={styles.close} accessibilityLabel="Close">
          <X size={16} color={colors.ink2} />
        </Tap>
      </View>

      {node.why.length ? (
        <View style={styles.why}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Sparkles size={13} color={colors.accent} />
            <T v="caption" color={colors.inkMuted} weight="800" style={{ marginLeft: 6, letterSpacing: 0.6 }}>
              WHY IT’S HERE
            </T>
          </View>
          {node.why.slice(0, 3).map((w) => (
            <T key={w} v="footnote" color={colors.ink2} weight="500" style={{ marginTop: 3 }} numberOfLines={2}>
              {`· ${w}`}
            </T>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Tap onPress={() => router.push(hrefFor(node.ref))} style={[styles.btn, { backgroundColor: colors.accent }]} accessibilityLabel={openLabel}>
          <T v="footnote" weight="700" color={colors.white} numberOfLines={1}>
            {openLabel}
          </T>
          <ChevronRight size={15} color={colors.white} />
        </Tap>
        {second ? (
          <Tap onPress={second.run} haptic="light" style={[styles.btn, styles.ghost, second.on && { borderColor: colors.accent }]} accessibilityLabel={second.label}>
            {second.on ? <Check size={14} color={colors.accent} strokeWidth={3} /> : null}
            <T v="footnote" weight="700" color={second.on ? colors.accent : colors.ink} numberOfLines={1} style={{ marginLeft: second.on ? 4 : 0 }}>
              {second.label}
            </T>
          </Tap>
        ) : null}
        {world ? (
          <Tap onPress={() => onExplore(world.id)} haptic="light" style={[styles.btn, styles.ghost, open && { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }]} accessibilityLabel={open ? 'Close branch' : 'Explore branch'}>
            <GitBranch size={14} color={open ? colors.accent : colors.ink} />
            <T v="footnote" weight="700" color={open ? colors.accent : colors.ink} numberOfLines={1} style={{ marginLeft: 4 }}>
              {open ? 'Close' : 'Explore'}
            </T>
          </Tap>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, padding: 14, borderRadius: radius.xl, backgroundColor: colors.surface },
  thumb: { width: 52, height: 52, borderRadius: 14 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  why: { marginTop: 12, padding: 10, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, height: 40, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  ghost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
});
