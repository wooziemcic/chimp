import { StatusBar } from 'expo-status-bar';
import { Activity, CalendarDays, ChevronRight, Heart, Link2, Sparkles, Target, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddStoryBubble } from '@/components/create/CreateButton';
import { HappeningGraph } from '@/components/happening/HappeningGraph';
import { NodePanel } from '@/components/happening/NodePanel';
import { MoveCard } from '@/components/moves/MoveCard';
import { StoryBubble } from '@/components/stories/StoryBubble';
import { Avatar } from '@/components/ui/Avatar';
import { AvatarStack } from '@/components/ui/AvatarStack';
import { Img } from '@/components/ui/Img';
import { EmptyState, SectionHeader } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { rankMoves } from '@/graph/relevance';
import { buildHappeningGraph, type HNode } from '@/graph/happening';
import { type LiveItem, buildLiveActivity } from '@/graph/live';
import { buildHappening, driftStories, isNightRef } from '@/graph/surfaces';
import { freshCount } from '@/graph/touch';
import { useGraphCtx } from '@/hooks/useGraph';
import { useImpression } from '@/hooks/useImpression';
import { useTabBarSpace } from '@/hooks/useLayout';
import { useNow } from '@/hooks/useNow';
import { ds, useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { useExposure } from '@/store/useExposure';
import { colors, radius, shadow } from '@/theme';
import type { HappeningItem, HappeningKind } from '@/types/models';
import { hrefFor } from '@/utils/links';
import { pushOnce } from '@/utils/nav';

const KIND: Record<HappeningKind, { label: string; Icon: typeof Sparkles }> = {
  move: { label: 'MOVE', Icon: CalendarDays },
  plan: { label: 'YOUR PLAN', Icon: CalendarDays },
  people: { label: 'PEOPLE', Icon: Users },
  match: { label: 'SUGGESTED MATCH', Icon: Link2 },
  spark: { label: 'MUTUAL CRUSH', Icon: Heart },
  loop: { label: 'OPEN LOOP', Icon: Target },
  change: { label: 'WHAT CHANGED', Icon: Sparkles },
};

/**
 * Happening — "What is moving across your world right now?"
 * Chimp's Opportunity Graph / situational-awareness surface. Not a feed
 * (Phase 6C: the visual stream moved to Buzz → Drift):
 *   1. the Opportunity Graph — endless, cyclic, collision-free lanes
 *   2. Friends & Connections — your story, friends' stories, Worlds' stories
 *   3. Live across your graph — what's moving (real events only)
 *   4. Changed in your world — the few deltas that matter most now, each with its
 *      reason (Phase 7C: ranked by decomposed signals; the selection and its
 *      signals are kept for Graph Debug)
 *   5. Moves tied to your Worlds
 * Never After Dark.
 */
export default function HappeningScreen() {
  const ctx = useGraphCtx();
  const seen = useChimp((s) => s.seenStoryItems);
  const bottom = useTabBarSpace();
  const focus = useChimp((st) => st.happeningFocus);
  const exploreBranch = useChimp((st) => st.exploreBranch);
  const collapseBranch = useChimp((st) => st.collapseBranch);
  const [selected, setSelected] = useState<string | null>(null);

  const items = useMemo(() => buildHappening(ctx).slice(0, 3), [ctx]);
  // Phase 7C: keep why each change was selected (signals, reasons) — local, for Graph Debug.
  useEffect(() => {
    useExposure.getState().logSelections(
      ds().me.id,
      items.filter((it) => it.selection).map((it) => ({
        key: `${it.ref.kind}:${it.ref.id}`,
        at: ctx.now,
        total: it.selection!.total,
        signals: it.selection!.signals,
        penalties: it.selection!.penalties,
        why: it.why,
      })),
    );
  }, [items, ctx.now]);
  const now = useNow();
  const live = useMemo(() => buildLiveActivity(ctx, seen, now), [ctx, seen, now]);
  const stories = useMemo(() => driftStories(ctx, seen), [ctx, seen]);
  const data = useDataset();
  const myStory = useMemo(() => data.stories.find((st) => st.owner.kind === 'person' && st.owner.id === data.me.id), [data]);
  const graph = useMemo(() => buildHappeningGraph(ctx, focus), [ctx, focus]);
  const selectedNode = graph.nodes.find((n) => n.id === selected);

  const toggleBranch = useCallback(
    (worldId: string) => {
      const w = graph.nodes.find((n) => n.id === worldId);
      if (!w) return;
      if (focus === worldId) collapseBranch();
      else exploreBranch(worldId, { kind: 'interest', id: w.interests[0] });
    },
    [graph.nodes, focus, collapseBranch, exploreBranch],
  );
  const onSelect = useCallback(
    (n: HNode) => {
      if (n.tier === 'major') {
        // Tap a World: it grows, its links light up and its branch opens. Tap again to close.
        if (selected === n.id) {
          setSelected(null);
          if (focus === n.id) collapseBranch();
          return;
        }
        setSelected(n.id);
        if (focus !== n.id) exploreBranch(n.id, { kind: 'interest', id: n.interests[0] });
        return;
      }
      setSelected(selected === n.id ? null : n.id);
    },
    [selected, focus, collapseBranch, exploreBranch],
  );
  // Moves live here now, but only ones tied to your Worlds, plans or loops.
  const moves = useMemo(
    () =>
      rankMoves(ctx, (m) => !isNightRef({ kind: 'move', id: m.id }))
        .filter((x) => x.reasons.some((r) => r.kind === 'board' || r.kind === 'saved' || r.kind === 'loop' || r.kind === 'people' || r.kind === 'plan'))
        .map((x) => x.item),
    [ctx],
  );

  // Friends & connections, those with something new first (blue dot).
  const friends = useMemo(() => {
    const ids = [...new Set([...Object.keys(ctx.s.connections), ...Object.keys(ctx.s.following)])].filter((id) => !ctx.s.blocked[id] && repo.user(id));
    const fresh = (id: string) => {
      const story = repo.storiesFor({ kind: 'person', id })[0];
      const unseenStory = story && !isNightRef({ kind: 'story', id: story.id }) && story.items.some((i) => !seen[i.id]);
      return unseenStory || freshCount(ctx.s.changes, { kind: 'person', id }) > 0;
    };
    const withStory = new Set(stories.friends.map((st) => st.owner.id));
    return ids
      .filter((id) => !withStory.has(id))
      .map((id) => ({ id, fresh: fresh(id) }))
      .sort((a, b) => Number(b.fresh) - Number(a.fresh) || Number(!!ctx.s.connections[b.id]) - Number(!!ctx.s.connections[a.id]))
      .slice(0, 7);
  }, [ctx, seen, stories.friends]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottom }}>
        <PageHeader title="Happening" subtitle="What’s moving across your world right now" />

        <HappeningGraph graph={graph} selected={selected} onSelect={onSelect} />
        {selectedNode ? (
          <NodePanel node={selectedNode} world={graph.nodes.filter((n) => n.id === selectedNode.worldId).map((n) => ({ id: n.id, label: n.label }))[0]} focus={graph.focus} onExplore={toggleBranch} onClose={() => setSelected(null)} />
        ) : (
          <T v="caption" color={colors.inkFaint} weight="500" align="center" style={{ marginTop: 2 }}>
            Swipe across your graph · tap a World to open its branch
          </T>
        )}

        {/* Friends & Connections: your story, friends' stories, then people without one, then your Worlds' stories. */}
        <View style={styles.friends}>
          <Tap onPress={() => pushOnce('/people?view=connections')} style={styles.friendsHead} accessibilityLabel="All connections">
            <T v="subhead" weight="700" style={{ flex: 1 }}>
              Friends & Connections
            </T>
            <ChevronRight size={16} color={colors.inkMuted} />
          </Tap>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, alignItems: 'flex-start' }}>
            <AddStoryBubble />
            {myStory ? <StoryBubble story={myStory} size={60} lane="friend" label="You" /> : null}
            {stories.friends.map((st) => (
              <StoryBubble key={st.id} story={st} size={60} lane="friend" label={st.title.split(' ')[0]} />
            ))}
            {friends.map((item) => {
              const u = repo.user(item.id);
              if (!u) return null;
              return (
                <Tap key={u.id} onPress={() => pushOnce(`/profile/${u.id}`)} scaleTo={0.94} style={styles.friend} accessibilityLabel={`${u.displayName}${item.fresh ? ', something new' : ''}`}>
                  <View>
                    <Avatar uri={u.avatar} name={u.displayName} size={52} />
                    {item.fresh ? <View style={styles.freshDot} /> : null}
                  </View>
                  <T v="caption" weight="600" numberOfLines={1} style={{ marginTop: 6, fontSize: 11.5 }}>
                    {u.displayName.split(' ')[0]}
                  </T>
                </Tap>
              );
            })}
            {stories.trending.slice(0, 8).map((st) => (
              <StoryBubble key={st.id} story={st} size={60} lane="trending" label={st.title} />
            ))}
          </ScrollView>
          {!stories.friends.length && !friends.length ? (
            <T v="footnote" color={colors.inkMuted} style={{ marginTop: 6 }}>
              Follow or connect with people and their stories show up here.
            </T>
          ) : null}
        </View>

        {/* Live across your graph: what's moving (the media itself lives in Buzz → Drift). */}
        <View style={styles.listHead}>
          <Activity size={16} color={colors.accent} />
          <T v="eyebrow" color={colors.inkMuted} style={{ marginLeft: 8 }}>
            LIVE ACROSS YOUR GRAPH
          </T>
        </View>
        {live.length ? (
          <View style={[styles.liveCard, shadow.sm]}>
            {live.map((it, k) => (
              <LiveRow key={it.id} item={it} first={k === 0} />
            ))}
          </View>
        ) : (
          <T v="footnote" color={colors.inkMuted} style={{ paddingHorizontal: 20 }}>
            Quiet right now. When people post in your Worlds, join them or add Stories, it shows up here.
          </T>
        )}

        <View style={styles.listHead}>
          <Sparkles size={16} color={colors.accent} />
          <T v="eyebrow" color={colors.inkMuted} style={{ marginLeft: 8 }}>
            CHANGED IN YOUR WORLD
          </T>
        </View>
        {items.length ? (
          <View style={{ paddingHorizontal: 16, gap: 10 }} testID="happening-changed">
            {items.map((it) => (
              <HappeningCard key={it.id} item={it} />
            ))}
          </View>
        ) : (
          <EmptyState title="Nothing specific yet" body="Join Worlds, open a loop or follow people. Happening only shows things with real context." />
        )}

        {moves.length ? (
          <View style={{ marginTop: 24 }}>
            <SectionHeader title="Moves in your Worlds" subtitle="Each one says why it’s here" style={{ paddingHorizontal: 20, marginBottom: 8 }} />
            <FlatList
              horizontal
              data={moves}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
              renderItem={({ item }) => <MoveCard move={item} width={136} height={198} />}
            />
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

function LiveRow({ item, first }: { item: LiveItem; first: boolean }) {
  return (
    <Tap onPress={() => pushOnce(hrefFor(item.ref))} scaleTo={0.985} style={[styles.liveRow, !first && styles.liveDivider]} accessibilityLabel={`${item.title}${item.body ? `. ${item.body}` : ''}`}>
      <Img uri={item.image} style={[styles.liveImg, item.round && { borderRadius: 22 }]} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T v="subhead" weight="700" numberOfLines={2}>
          {item.title}
        </T>
        {item.body ? (
          <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1} style={{ marginTop: 1 }}>
            {item.body}
          </T>
        ) : null}
      </View>
      {item.people && item.people.length > 1 ? <AvatarStack userIds={item.people} size={22} max={3} /> : null}
      <ChevronRight size={16} color={colors.inkFaint} style={{ marginLeft: 6 }} />
    </Tap>
  );
}

function HappeningCard({ item }: { item: HappeningItem }) {
  useImpression(`happening:${item.ref.kind}:${item.ref.id}`);
  const k = KIND[item.kind];
  const round = item.ref.kind === 'person';
  return (
    <Tap onPress={() => pushOnce(hrefFor(item.ref))} scaleTo={0.985} style={[styles.card, shadow.sm]} accessibilityLabel={`${item.title}. ${item.why.join('. ')}`}>
      <View style={{ flexDirection: 'row' }}>
        {item.image ? (
          <Img uri={item.image} style={[styles.thumb, round && { borderRadius: 29 }]} />
        ) : (
          <View style={[styles.thumb, styles.iconThumb]}>
            <k.Icon size={24} color={colors.accent} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <k.Icon size={12} color={item.kind === 'spark' ? '#FF3D6E' : colors.accent} />
            <T v="caption" color={item.kind === 'spark' ? '#FF3D6E' : colors.accent} weight="800" style={{ marginLeft: 5, letterSpacing: 0.6 }}>
              {k.label}
            </T>
          </View>
          <T v="bodyStrong" style={{ marginTop: 3, lineHeight: 21 }}>
            {item.title}
          </T>
          {item.body ? (
            <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 2 }} numberOfLines={2}>
              {item.body}
            </T>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.inkFaint} style={{ marginLeft: 6, marginTop: 20 }} />
      </View>
      <View style={styles.why}>
        {item.why.map((w) => (
          <T key={w} v="footnote" color={colors.ink2} weight="500" numberOfLines={2} style={{ marginTop: 2 }}>
            {`· ${w}`}
          </T>
        ))}
        {item.people && item.people.length > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <AvatarStack userIds={item.people} size={22} max={4} />
          </View>
        ) : null}
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  friends: { marginHorizontal: 16, marginTop: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.xl, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  friendsHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, minHeight: 28 },
  friend: { width: 72, alignItems: 'center', paddingTop: 4 },
  freshDot: { position: 'absolute', right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.white },
  listHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 24, marginBottom: 10 },
  card: { padding: 14, borderRadius: radius.xl, backgroundColor: colors.surface },
  liveCard: { marginHorizontal: 16, paddingHorizontal: 12, borderRadius: radius.xl, backgroundColor: colors.surface },
  liveRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: 10 },
  liveDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  liveImg: { width: 44, height: 44, borderRadius: 12 },
  thumb: { width: 58, height: 58, borderRadius: 16 },
  iconThumb: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  why: { marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
