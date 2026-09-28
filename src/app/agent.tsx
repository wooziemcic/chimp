import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Plus, Sparkles } from 'lucide-react-native';
import { type ReactNode, useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoardCard } from '@/components/boards/BoardCard';
import { PersonRow } from '@/components/profile/PersonRow';
import { ProgressBar } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { AgentItem } from '@/graph/agent';
import { loopProgress } from '@/graph/loops';
import { isActiveLoop } from '@/graph/relevance';
import { useAgentBrief, useGraphCtx, useSignals, useUnseenChanges } from '@/hooks/useGraph';
import { suggestBoards, topInterests } from '@/services/recommender';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';

/**
 * Your Agent — local and rules-based. Four questions, answered only from
 * real graph state: what changed, who to meet, what to do next, and which
 * loop you could close.
 */
export default function AgentScreen() {
  const signals = useSignals();
  const ctx = useGraphCtx();
  const brief = useAgentBrief();
  const unseen = useUnseenChanges();
  const openLoop = useChimp((s) => s.openLoop);
  const boards = useMemo(() => suggestBoards(signals, 6), [signals]);
  const loops = signals.openLoops.filter(isActiveLoop);
  const interests = topInterests(signals, 3);

  const run = (item: AgentItem) => {
    if (item.action?.kind === 'openLoop') openLoop(item.action.loopId);
    else router.push(item.href as never);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Your Agent" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <LinearGradient colors={['#EAF1FF', '#F6EEFF']} style={[StyleSheet.absoluteFill, { borderRadius: radius.xl }]} />
          <LinearGradient colors={['#3B82FF', '#8B5CF6', '#EC4899']} style={styles.orb}>
            <View style={styles.orbInner}>
              <Sparkles size={26} color={colors.accent} fill="#C7D7FF" />
            </View>
          </LinearGradient>
          <T v="title3" style={{ marginTop: 12 }}>
            {unseen.length ? `${unseen.length} things moved in your world` : 'Here’s where your graph is heading'}
          </T>
          <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 4 }}>
            {`Tuned to ${interests.join(', ') || 'what you do'} and ${loops.length} Open Loops. Every suggestion says why.`}
          </T>
        </View>

        {brief.changed.length ? (
          <Section title="What changed">
            {brief.changed.map((c) => (
              <Line key={c.id} item={c} onPress={() => run(c)} />
            ))}
          </Section>
        ) : null}

        {brief.meet.length ? (
          <Section title="Who you should meet" onSeeAll={() => router.push('/people')}>
            {brief.meet.map((m) => {
              const u = repo.user(m.href.split('/').pop() ?? '');
              return u ? <PersonRow key={m.id} user={u} reason={m.detail} action="connect" /> : null;
            })}
          </Section>
        ) : null}

        {brief.next.length ? (
          <Section title="What you should do next">
            {brief.next.map((n) => (
              <Line key={n.id} item={n} onPress={() => run(n)} actionLabel={n.action ? 'Open loop' : undefined} />
            ))}
          </Section>
        ) : null}

        {brief.close.length ? (
          <Section title="A loop you could close" onSeeAll={() => router.push('/loops')}>
            {brief.close.map((c) => {
              const loop = signals.openLoops.find((l) => `loop_${l.id}` === c.id);
              const p = loop ? loopProgress(ctx, loop) : undefined;
              return (
                <Tap key={c.id} onPress={() => router.push(c.href as never)} style={styles.loopCard}>
                  <T v="bodyStrong">{c.text}</T>
                  {p ? <ProgressBar value={p.progress} style={{ marginTop: 8 }} /> : null}
                  <T v="footnote" color={colors.inkMuted} style={{ marginTop: 6 }}>
                    {c.detail}
                  </T>
                </Tap>
              );
            })}
          </Section>
        ) : null}

        {boards.length ? (
          <View style={{ marginTop: 22 }}>
            <T v="eyebrow" color={colors.inkMuted} style={{ paddingHorizontal: 20, marginBottom: 10 }}>
              BOARDS YOU MAY LIKE
            </T>
            <FlatList
              horizontal
              data={boards}
              keyExtractor={(b) => b.board.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              renderItem={({ item }) => <BoardCard board={item.board} variant="tile" width={160} reason={item.reason} />}
            />
          </View>
        ) : null}

        <T v="caption" color={colors.inkFaint} weight="500" align="center" style={{ marginTop: 22, paddingHorizontal: 30, lineHeight: 16 }}>
          Your agent runs on this device and learns only from what you save, join, follow and act on. Reset it any time in Settings.
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children, onSeeAll }: { title: string; children: ReactNode; onSeeAll?: () => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T v="eyebrow" color={colors.inkMuted} style={{ flex: 1 }}>
          {title.toUpperCase()}
        </T>
        {onSeeAll ? (
          <Tap onPress={onSeeAll} style={{ minHeight: 32, justifyContent: 'center' }}>
            <T v="footnote" color={colors.accent} weight="600">
              See all
            </T>
          </Tap>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Line({ item, onPress, actionLabel }: { item: AgentItem; onPress: () => void; actionLabel?: string }) {
  return (
    <Tap onPress={onPress} scaleTo={0.985} style={styles.line}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <T v="subhead" weight="700">
          {item.text}
        </T>
        {item.detail ? (
          <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 2 }}>
            {item.detail}
          </T>
        ) : null}
      </View>
      {actionLabel ? (
        <View style={styles.action}>
          <Plus size={14} color={colors.white} />
          <T v="caption" weight="700" color={colors.white} style={{ marginLeft: 3 }}>
            {actionLabel}
          </T>
        </View>
      ) : (
        <ChevronRight size={18} color={colors.inkFaint} />
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: 16, padding: 18, borderRadius: radius.xl, overflow: 'hidden' },
  orb: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  orbInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: 20, paddingHorizontal: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginRight: 12 },
  action: { flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: colors.accent, marginLeft: 8 },
  loopCard: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: 8, ...shadow.sm },
});
