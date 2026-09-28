import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, ZoomIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type CanvasNode, LABEL_W, cyclicCanvas, type HappeningGraph as Graph, type HEdge, type HNode, recenterX } from '@/graph/happening';
import { repo } from '@/services/repository';
import { colors, shadow } from '@/theme';

const LAYOUT = LinearTransition.duration(280);

/** Soft colour per node kind for the ring (pastel, never loud). */
const RING: Record<HNode['kind'], string> = {
  world: '#C9B8FF',
  board: '#B9CCFF',
  person: '#FFC4DA',
  move: '#FFD2B5',
  buzz: '#BFE6F2',
};
const DOTS = ['#8FB2FF', '#F4A8C8', '#B7A6FF'];

/**
 * Happening's interest graph: a canvas wider than the screen that you pan
 * left and right. No centre object. Worlds zig-zag across; tapping one
 * opens its branch in place (deterministic, see graph/happening.ts).
 *
 * Phase 6C: it's endless. Past the last World it carries on into the first
 * again (cyclicCanvas); when a scroll settles in a copy the view moves by one
 * cycle to the identical spot, so there's no visible jump. Every copy of a
 * World is the same logical World: tapping any of them opens that one branch.
 */
export const HappeningGraph = memo(function HappeningGraph({
  graph,
  selected,
  onSelect,
}: {
  graph: Graph;
  selected: string | null;
  onSelect: (n: HNode) => void;
}) {
  const { width: viewW } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const canvas = useMemo(() => cyclicCanvas(graph, viewW), [graph, viewW]);
  const snaps = canvas.snaps;
  const maxX = Math.max(0, canvas.width - viewW);
  const want = Math.max(0, Math.min(maxX, graph.centreX + canvas.shift - viewW / 2));
  const startX = snaps.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best), 0);
  const byKey = useMemo(() => new Map(canvas.nodes.map((n) => [n.key, n])), [canvas.nodes]);
  const worldOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.worldId])), [graph.nodes]);
  const lit = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(canvas.edges.filter((e) => e.from === selected || e.to === selected || worldOf.get(e.to) === selected).map((e) => e.key));
  }, [canvas.edges, selected, worldOf]);

  // Where the view is (content x), kept for recentering and for "open branch near where I am".
  const pos = useRef(startX);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recenter = useCallback(() => {
    const next = recenterX(canvas, pos.current, viewW);
    if (next === null) return;
    pos.current = next;
    scroller.current?.scrollTo({ x: next, animated: false });
  }, [canvas, viewW]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      pos.current = x;
      // A long, fast swipe: recenter right away before it can reach either end.
      if (canvas.cyclic && (x < viewW * 0.25 || x > canvas.width - viewW * 1.25)) {
        recenter();
        return;
      }
      // Web has no momentum-end event: recenter once scrolling has been still for a moment.
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(recenter, 160);
    },
    [recenter, canvas, viewW],
  );
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  // Keep the open branch in view when it changes (not on every render) — the
  // copy of it nearest to where you are, so opening a World after cycling
  // never swings the view across the whole graph.
  const lastFocus = useRef(graph.focus);
  useEffect(() => {
    if (lastFocus.current === graph.focus) return;
    lastFocus.current = graph.focus;
    const options = canvas.cyclic ? [startX - canvas.cycle, startX, startX + canvas.cycle].filter((x) => x >= 0 && x <= maxX) : [startX];
    const target = options.reduce((best, x) => (Math.abs(x - pos.current) < Math.abs(best - pos.current) ? x : best), options[0] ?? startX);
    pos.current = target;
    scroller.current?.scrollTo({ x: target, animated: true });
  }, [graph.focus, startX, canvas, maxX]);

  const dimFor = (n: CanvasNode) => !!selected && selected !== n.id && n.worldId !== selected && worldOf.get(selected) !== n.worldId;

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: startX, y: 0 }}
      onLayout={() => scroller.current?.scrollTo({ x: pos.current, animated: false })}
      onScroll={onScroll}
      scrollEventThrottle={32}
      onMomentumScrollEnd={recenter}
      decelerationRate="fast"
      snapToOffsets={snaps}
      style={{ height: graph.height }}
      contentContainerStyle={{ width: canvas.width, height: graph.height }}
      accessibilityLabel="Your Opportunity Graph"
    >
      {/* Soft atmosphere so the canvas never feels empty or busy. */}
      {Array.from({ length: Math.max(4, Math.ceil(canvas.width / 360)) }, (_, i) => (
        <LinearGradient
          key={i}
          colors={[i % 2 ? '#F3E9FF' : '#E6EEFF', 'rgba(255,255,255,0)']}
          style={[styles.blob, { left: 60 + i * 360, top: i % 2 ? 150 : 10, width: 300, height: 300 }]}
          pointerEvents="none"
        />
      ))}

      <Svg width={canvas.width} height={graph.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {canvas.edges.map((e, k) => (
          <Edge key={e.key} e={e} from={byKey.get(e.fromKey)} to={byKey.get(e.toKey)} lit={lit.has(e.key)} dim={!!selected && !lit.has(e.key)} dot={DOTS[k % DOTS.length]} />
        ))}
      </Svg>

      {canvas.nodes.map((n) => (
        <Node key={n.key} n={n} selected={selected === n.id} dim={dimFor(n)} onPress={onSelect} />
      ))}
    </ScrollView>
  );
});

function Edge({ e, from, to, lit, dim, dot }: { e: HEdge; from?: HNode; to?: HNode; lit: boolean; dim: boolean; dot: string }) {
  if (!from || !to) return null;
  const r1 = from.d / 2 + 2;
  const r2 = to.d / 2 + 2;
  let x1: number, y1: number, x2: number, y2: number;
  if (to.x - from.x > r1 + r2 * 0.5) {
    // Left → right: leave from the right side, arrive on the left side, so
    // links never cut through a node or the label beneath it.
    x1 = from.x + r1;
    y1 = from.y;
    x2 = to.x - r2;
    y2 = to.y;
  } else {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;
    x1 = from.x + ux * r1;
    y1 = from.y + uy * r1;
    x2 = to.x - ux * r2;
    y2 = to.y - uy * r2;
  }
  // Horizontal S-curve: reads left → right like a skill tree.
  const dx = Math.max(18, Math.abs(x2 - x1) * 0.5);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  const stroke = lit ? colors.accent : e.kind === 'branch' ? '#D8CCF6' : '#C9D6F5';
  return (
    <>
      <Path d={d} stroke={stroke} strokeWidth={lit ? 2.2 : 1.6} fill="none" opacity={dim ? 0.3 : 1} />
      {e.kind === 'chain' && from.tier === 'major' ? <Circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r={lit ? 5 : 4.5} fill={lit ? colors.accent : dot} opacity={dim ? 0.35 : 1} /> : null}
    </>
  );
}

const Node = memo(function Node({ n, selected, dim, onPress }: { n: HNode; selected: boolean; dim: boolean; onPress: (n: HNode) => void }) {
  const d = n.d * (selected ? 1.1 : 1);
  // Label widths are the same boxes the lane layout reserved (graph/happening.ts), so labels can't collide.
  const labelW = LABEL_W[n.tier];
  const showLabel = true;
  const round = n.kind !== 'move';
  const inner = d - 8;
  const person = n.avatarOf ? repo.user(n.avatarOf) : undefined;
  return (
    <Animated.View
      layout={LAYOUT}
      entering={n.tier === 'child' ? ZoomIn.duration(260) : FadeIn.duration(200)}
      style={{ position: 'absolute', left: n.x - labelW / 2, top: n.y - d / 2, width: labelW }}
    >
      <View style={{ alignItems: 'center', opacity: dim ? 0.55 : 1 }}>
      <Tap
        onPress={() => onPress(n)}
        scaleTo={0.94}
        haptic="light"
        accessibilityLabel={`${n.label}${n.meta ? `, ${n.meta}` : ''}${n.badge ? `, ${n.badge} new` : ''}`}
        style={{ width: d, height: d }}
      >
        <View
          style={[
            styles.ring,
            n.tier === 'major' ? shadow.md : shadow.sm,
            { width: d, height: d, borderRadius: round ? d / 2 : 22, borderColor: selected ? colors.accent : RING[n.kind], borderWidth: n.tier === 'major' ? 4 : 3 },
          ]}
        >
          <Img uri={n.image} style={{ width: inner, height: inner, borderRadius: round ? inner / 2 : 18 }} />
        </View>
        {n.badge > 0 && n.tier === 'major' ? (
          <View style={styles.badge}>
            <T v="caption" color={colors.white} weight="800" style={{ fontSize: 12 }}>
              {n.badge}
            </T>
          </View>
        ) : null}
        {person && n.tier === 'major' ? (
          <View style={styles.chip}>
            <Avatar uri={person.avatar} name={person.displayName} size={Math.round(d * 0.3)} />
          </View>
        ) : null}
      </Tap>
      {showLabel ? (
        <View style={[styles.label, { marginTop: n.tier === 'major' ? 5 : 3 }]} pointerEvents="none">
          <T v="subhead" weight="700" numberOfLines={1} align="center" style={{ fontSize: n.tier === 'major' ? 16 : 12.5, lineHeight: n.tier === 'major' ? 20 : 16, maxWidth: labelW - 8 }}>
            {n.label}
          </T>
          {n.meta && n.tier !== 'minor' ? (
            <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1} align="center" style={{ fontSize: n.tier === 'major' ? 12.5 : 11 }}>
              {n.meta}
            </T>
          ) : null}
        </View>
      ) : null}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  blob: { position: 'absolute', borderRadius: 150 },
  // Links pass under labels; a soft backing keeps the text clean where they cross.
  label: { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, backgroundColor: 'rgba(246,247,251,0.88)' },
  ring: { backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: colors.danger,
    borderWidth: 2.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: { position: 'absolute', right: -4, bottom: -2, borderRadius: 999, borderWidth: 2.5, borderColor: colors.white, backgroundColor: colors.white },
});
