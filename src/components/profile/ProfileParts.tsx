import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronRight, Plus, Quote, Sparkles } from 'lucide-react-native';
import { Fragment, memo, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { MatchRing, ProgressBar } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { interestById } from '@/data/interests';
import { OPEN_TO_LABEL } from '@/data/users';
import { loopProgress, suggestedLoops } from '@/graph/loops';
import { isActiveLoop } from '@/graph/relevance';
import { useGraphCtx } from '@/hooks/useGraph';
import type { AgentLine } from '@/services/recommender';
import { interestReach } from '@/services/recommender';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';
import type { MatchExplanation, OpenLoop, OpenTo, ProfilePrompt } from '@/types/models';
import { LoopIcon } from './YouCards';

// ─── Stats: four metrics on one line ────────────────────────────────────────

export interface Stat {
  value: string;
  label: string;
  onPress?: () => void;
}

/**
 * Followers / Following / Connections / Matches. Equal columns, single-line
 * labels that shrink rather than wrap, so all four fit on a 390pt screen.
 */
export function StatsRow({ stats, flat }: { stats: Stat[]; flat?: boolean }) {
  return (
    <View style={[styles.stats, flat && { backgroundColor: 'transparent', marginTop: 6 }]} accessibilityRole="summary">
      {stats.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 ? <View style={styles.statDivider} /> : null}
          <Tap onPress={s.onPress} disabled={!s.onPress} scaleTo={s.onPress ? 0.95 : 1} style={styles.stat} accessibilityLabel={`${s.value} ${s.label}`}>
            <T v="title3" style={{ fontSize: 19, lineHeight: 23 }} numberOfLines={1}>
              {s.value}
            </T>
            <StatLabel text={s.label} />
          </Tap>
        </Fragment>
      ))}
    </View>
  );
}

/**
 * Phase 6B: a stat label that always fits on one line ("Connections" on an
 * iPhone 12 with larger text). The font size comes from the measured cell
 * width instead of adjustsFontSizeToFit, which can break words across lines.
 */
function StatLabel({ text }: { text: string }) {
  const [w, setW] = useState(0);
  // ≈0.56 em per character for the system font at this weight.
  const fit = w ? Math.min(12, Math.max(9.5, (w - 2) / (text.length * 0.56))) : 12;
  return (
    <View style={{ alignSelf: 'stretch', alignItems: 'center' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1} ellipsizeMode="clip" allowFontScaling={false} style={{ fontSize: fit, marginTop: 2, letterSpacing: fit < 11.5 ? -0.1 : 0 }}>
        {text}
      </T>
    </View>
  );
}

// ─── Known for ──────────────────────────────────────────────────────────────

export function KnownFor({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <View style={styles.knownFor}>
      <Sparkles size={14} color={colors.accent} />
      <T v="footnote" color={colors.ink2} style={{ marginLeft: 6, flex: 1 }}>
        <T v="footnote" weight="700" color={colors.ink2}>
          Known for{'  '}
        </T>
        {items.join(' · ')}
      </T>
    </View>
  );
}

// ─── Open To ────────────────────────────────────────────────────────────────

const ALL_OPEN_TO: OpenTo[] = ['friends', 'dating', 'casual', 'networking', 'collaboration', 'travel', 'events', 'not_looking'];

export function OpenToCard({
  value,
  onToggle,
  highlight = [],
  title = 'Open to',
}: {
  value: OpenTo[];
  onToggle?: (v: OpenTo) => void;
  highlight?: OpenTo[];
  title?: string;
}) {
  const options = onToggle ? ALL_OPEN_TO : value;
  return (
    <View style={styles.panel}>
      <T v="label" color={colors.inkFaint} style={{ letterSpacing: 1.6 }}>
        {title.toUpperCase()}
      </T>
      <View style={styles.chipWrap}>
        {options.map((o) => {
          const on = value.includes(o);
          const shared = highlight.includes(o);
          return (
            <Tap
              key={o}
              onPress={onToggle ? () => onToggle(o) : undefined}
              disabled={!onToggle}
              haptic="select"
              scaleTo={onToggle ? 0.95 : 1}
              accessibilityState={{ selected: on }}
              style={[styles.openChip, on ? styles.openOn : styles.openOff, shared && styles.openShared]}
            >
              {on ? <Check size={13} color={shared ? colors.white : colors.accent} strokeWidth={3} style={{ marginRight: 4 }} /> : null}
              <T v="footnote" weight="600" color={shared ? colors.white : on ? colors.accent : colors.inkMuted}>
                {OPEN_TO_LABEL[o]}
              </T>
            </Tap>
          );
        })}
      </View>
      <T v="caption" color={colors.inkFaint} weight="500" style={{ marginTop: 8 }}>
        {onToggle
          ? 'Tap to change. Chimp only introduces people who fit what you’re open to.'
          : highlight.length
            ? 'Highlighted: what you’re both open to.'
            : 'What they’re open to on Chimp.'}
      </T>
    </View>
  );
}

// ─── Prompts ────────────────────────────────────────────────────────────────

const PROMPT_TINTS: [string, string][] = [
  ['#EAF1FF', '#F6F0FF'],
  ['#FFF1EA', '#FFF8F0'],
  ['#EAF8F3', '#F1F7FF'],
];

export const PromptsRow = memo(function PromptsRow({ prompts }: { prompts?: ProfilePrompt[] }) {
  const { width } = useWindowDimensions();
  if (!prompts?.length) return null;
  const w = Math.min(290, width * 0.72);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} snapToInterval={w + 10} decelerationRate="fast">
      {prompts.map((p, i) => (
        <View key={p.id} style={[styles.prompt, { width: w }]}>
          <LinearGradient colors={PROMPT_TINTS[i % PROMPT_TINTS.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Quote size={16} color={colors.accent} fill={colors.accentGlow} />
          <T v="footnote" weight="700" color={colors.accent} style={{ marginTop: 8 }}>
            {p.question}
          </T>
          <T v="bodyStrong" style={{ marginTop: 4, fontSize: 17, lineHeight: 23 }}>
            {p.answer}
          </T>
        </View>
      ))}
    </ScrollView>
  );
});

// ─── Interests as graph inputs ──────────────────────────────────────────────

export function InterestGraph({ interests, highlight = [], title = 'Interests', caption }: { interests: string[]; highlight?: string[]; title?: string; caption?: string }) {
  return (
    <View style={styles.panel}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T v="label" color={colors.inkFaint} style={{ letterSpacing: 1.6, flex: 1 }}>
          {title.toUpperCase()}
        </T>
      </View>
      <View style={styles.chipWrap}>
        {interests.map((id) => {
          const it = interestById[id];
          if (!it) return null;
          const shared = highlight.includes(id);
          return (
            <Tap key={id} onPress={() => router.push('/search')} scaleTo={0.95} style={[styles.interest, shared && styles.interestShared]} accessibilityLabel={`${it.label}, ${interestReach(id)} connected in your graph`}>
              <CategoryIcon id={it.category} size={13} color={shared ? colors.white : colors.accent} />
              <T v="footnote" weight="600" color={shared ? colors.white : colors.ink2} style={{ marginLeft: 5 }}>
                {it.label}
              </T>
              <View style={[styles.reach, shared && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                <T v="caption" weight="700" color={shared ? colors.white : colors.accent} style={{ fontSize: 10.5 }}>
                  {interestReach(id)}
                </T>
              </View>
            </Tap>
          );
        })}
      </View>
      <T v="caption" color={colors.inkFaint} weight="500" style={{ marginTop: 8 }}>
        {caption ?? 'Each interest pulls Boards, Moves and people into your graph. The number is how many.'}
      </T>
    </View>
  );
}

// ─── Why you match ──────────────────────────────────────────────────────────

export function WhyMatchCard({ match, firstName }: { match: MatchExplanation; firstName: string }) {
  return (
    <View style={styles.why}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MatchRing value={match.matchScore} size={58} stroke={4} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="headline">{`Why you and ${firstName} match`}</T>
          <T v="caption" color={colors.inkMuted} weight="500" style={{ marginTop: 2 }}>
            From shared Boards, people, Moves and what you’re both open to.
          </T>
        </View>
      </View>
      <View style={{ marginTop: 10 }}>
        {match.matchReasons.slice(0, 5).map((r) => (
          <View key={r.label} style={styles.reasonRow}>
            <View style={styles.reasonDot}>
              <Check size={11} color={colors.white} strokeWidth={3.5} />
            </View>
            <T v="subhead" weight="500" color={colors.ink2} style={{ flex: 1 }}>
              {r.label}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Your Agent (prominent, not a chatbot) ─────────────────────────────────

export function AgentBriefingCard({ lines, empty = 'Nothing new yet. Your agent keeps watching your graph.' }: { lines: AgentLine[]; empty?: string }) {
  return (
    <View style={styles.agent}>
      <LinearGradient colors={['#EEF3FF', '#F7EFFF', '#FFF3EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* No touchable inside another (Phase 6B): the header opens Your Agent, each line opens its item. */}
      <Tap onPress={() => router.push('/agent')} scaleTo={0.985} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="Open Your Agent">
        <LinearGradient colors={['#3B82FF', '#8B5CF6', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.orb}>
          <View style={styles.orbInner}>
            <Sparkles size={20} color={colors.accent} fill="#C7D7FF" />
          </View>
        </LinearGradient>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="headline" style={{ fontSize: 18 }}>
            Your Agent
          </T>
          <T v="caption" color={colors.inkMuted} weight="500">
            Introducing possibilities that fit what you’re doing
          </T>
        </View>
        <ChevronRight size={20} color={colors.ink2} />
      </Tap>
      <View style={{ marginTop: 10, gap: 6 }}>
        {(lines.length ? lines : [{ id: 'quiet', text: empty, href: '/agent' }]).map((l) => (
          <Tap key={l.id} onPress={() => router.push(l.href as never)} scaleTo={0.98} style={styles.agentLine}>
            <View style={styles.agentDot} />
            <T v="subhead" weight="600" color={colors.ink2} style={{ flex: 1 }} numberOfLines={1}>
              {l.text}
            </T>
            <ChevronRight size={16} color={colors.inkFaint} />
          </Tap>
        ))}
      </View>
    </View>
  );
}

// ─── Open Loops ─────────────────────────────────────────────────────────────

export function OpenLoopsPanel({ loops }: { loops: OpenLoop[] }) {
  const ctx = useGraphCtx();
  const openLoop = useChimp((st) => st.openLoop);
  const open = useMemo(
    () =>
      loops
        .filter(isActiveLoop)
        .map((l) => loopProgress(ctx, l))
        .sort((a, b) => b.progress - a.progress),
    [ctx, loops],
  );
  const suggestion = useMemo(() => suggestedLoops(ctx)[0], [ctx]);
  return (
    <View style={styles.panel}>
      <Tap onPress={() => router.push('/loops')} scaleTo={0.985} accessibilityLabel="Open Loops">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Sparkles size={20} color={colors.accent} fill={colors.accent} />
        <T v="headline" style={{ marginLeft: 8, fontSize: 18 }}>
          Open Loops
        </T>
        <View style={styles.count}>
          <T v="caption" color={colors.accent} weight="800">
            {open.length}
          </T>
        </View>
        <View style={{ flex: 1 }} />
        <T v="footnote" color={colors.inkMuted}>
          All
        </T>
        <ChevronRight size={16} color={colors.inkMuted} />
      </View>
      <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 3 }}>
        Things you want to make happen. They shape Happening, Matches and Moves.
      </T>
      <View style={{ marginTop: 8 }}>
        {!open.length && !suggestion ? (
          <T v="footnote" color={colors.inkFaint} style={{ marginTop: 2 }}>
            No open loops yet. Add one, like “Plan a weekend away”.
          </T>
        ) : null}
        {open.slice(0, 4).map((p) => (
          <View key={p.loop.id} style={styles.loopRow}>
            <LoopIcon icon={p.loop.icon} color={colors.accent} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <T v="subhead" color={colors.ink2} numberOfLines={1}>
                {p.loop.title}
              </T>
              <ProgressBar value={p.progress} height={4} style={{ marginTop: 5 }} />
            </View>
            <T v="caption" color={p.progress ? colors.accent : colors.inkFaint} weight="600" style={{ marginLeft: 10, minWidth: 32, textAlign: 'right' }}>
              {p.progress ? `${p.progress}%` : 'New'}
            </T>
          </View>
        ))}
      </View>
      </Tap>
      {suggestion ? (
        <View style={styles.suggest}>
          <LoopIcon icon={suggestion.icon} color={colors.accent} />
          <T v="footnote" weight="600" color={colors.ink2} numberOfLines={1} style={{ flex: 1, marginLeft: 10 }}>
            {suggestion.title}
          </T>
          <Tap onPress={() => openLoop(suggestion.id)} haptic="medium" style={styles.openBtn} accessibilityLabel={`Open loop ${suggestion.title}`}>
            <Plus size={13} color={colors.white} />
            <T v="caption" weight="700" color={colors.white} style={{ marginLeft: 3 }}>
              Open
            </T>
          </Tap>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  stat: { flex: 1, alignItems: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.lineStrong },
  knownFor: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  panel: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.sm,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  openChip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1 },
  openOn: { backgroundColor: colors.accentSoft, borderColor: '#CFE0FF' },
  openOff: { backgroundColor: colors.surface, borderColor: colors.line },
  openShared: { backgroundColor: colors.accent, borderColor: colors.accent },
  prompt: { borderRadius: radius.xl, padding: 16, overflow: 'hidden', minHeight: 132 },
  interest: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    paddingLeft: 11,
    paddingRight: 5,
    borderRadius: 17,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  interestShared: { backgroundColor: colors.accent, borderColor: colors.accent },
  reach: { marginLeft: 7, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  why: { marginHorizontal: 16, padding: 16, borderRadius: radius.xl, backgroundColor: colors.accentSoft },
  reasonRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  reasonDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  agent: { marginHorizontal: 16, padding: 16, borderRadius: radius.xl, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E3E6FF' },
  orb: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  orbInner: { width: 39, height: 39, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  agentLine: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.75)' },
  agentDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, marginRight: 10 },
  count: { marginLeft: 8, minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  loopRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  suggest: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingLeft: 10, paddingRight: 6, minHeight: 44, borderRadius: 14, backgroundColor: colors.accentSoft },
  openBtn: { flexDirection: 'row', alignItems: 'center', height: 32, paddingHorizontal: 11, borderRadius: 16, backgroundColor: colors.accent },
});
