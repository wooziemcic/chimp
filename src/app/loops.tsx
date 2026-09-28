import { router } from 'expo-router';
import { Check, Circle, CircleCheck, Plus, RotateCcw, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoopIcon } from '@/components/profile/YouCards';
import { Img } from '@/components/ui/Img';
import { EmptyState, ProgressBar } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { loopProgress, suggestedLoops } from '@/graph/loops';
import { isActiveLoop } from '@/graph/relevance';
import { useGraphCtx } from '@/hooks/useGraph';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius, shadow } from '@/theme';
import type { EntityRef, OpenLoop } from '@/types/models';
import { hrefFor } from '@/utils/links';

type Row = { kind: 'loop'; loop: OpenLoop } | { kind: 'suggested'; loop: OpenLoop } | { kind: 'label'; text: string };

/**
 * Open Loops: unresolved things in your possibility space. Progress is
 * derived from what you actually do (connect, chat, join, RSVP), and each
 * active loop reshapes People, Moves, Boards and Stories.
 */
export default function LoopsScreen() {
  const ctx = useGraphCtx();
  const loops = useChimp((s) => s.openLoops);
  const addLoop = useChimp((s) => s.addLoop);
  const [text, setText] = useState('');
  const active = loops.filter(isActiveLoop);
  const closed = loops.filter((l) => !isActiveLoop(l));
  const suggested = useMemo(() => suggestedLoops(ctx), [ctx]);

  const rows: Row[] = [
    ...active.map((loop) => ({ kind: 'loop' as const, loop })),
    ...(suggested.length ? [{ kind: 'label' as const, text: 'SUGGESTED FROM YOUR GRAPH' }, ...suggested.map((loop) => ({ kind: 'suggested' as const, loop }))] : []),
    ...(closed.length ? [{ kind: 'label' as const, text: 'CLOSED' }, ...closed.map((loop) => ({ kind: 'loop' as const, loop }))] : []),
  ];

  const add = () => {
    if (!text.trim()) return;
    addLoop(text);
    setText('');
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScreenHeader title="Open Loops" subtitle={`${active.length} open · ${closed.filter((l) => l.status === 'resolved').length} resolved`} />
        <FlatList
          data={rows}
          keyExtractor={(r, i) => (r.kind === 'label' ? `label${i}` : `${r.kind}${r.loop.id}`)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
          ListHeaderComponent={
            <View style={styles.add}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Something you want to make happen…"
                placeholderTextColor={colors.inkFaint}
                onSubmitEditing={add}
                returnKeyType="done"
                style={styles.input}
              />
              <Tap onPress={add} disabled={!text.trim()} style={[styles.addBtn, !text.trim() && { opacity: 0.4 }]} accessibilityLabel="Add loop">
                <Plus size={20} color={colors.white} />
              </Tap>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'label' ? (
              <T v="eyebrow" color={colors.inkMuted} style={{ marginTop: 10 }}>
                {item.text}
              </T>
            ) : item.kind === 'suggested' ? (
              <SuggestedCard loop={item.loop} />
            ) : (
              <LoopCard loop={item.loop} />
            )
          }
          ListEmptyComponent={<EmptyState title="No loops yet" body="Add something you want to explore, meet or do." />}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const STATUS_LABEL = { active: 'Not started', progress: 'In progress', resolved: 'Resolved', dismissed: 'Dismissed' } as const;

function LoopCard({ loop }: { loop: OpenLoop }) {
  const ctx = useGraphCtx();
  const resolve = useChimp((s) => s.resolveLoop);
  const reopen = useChimp((s) => s.reopenLoop);
  const dismiss = useChimp((s) => s.dismissLoop);
  const p = useMemo(() => loopProgress(ctx, loop), [ctx, loop]);
  const closed = p.status === 'resolved' || p.status === 'dismissed';
  const helpers: EntityRef[] = [
    ...p.candidates.people.slice(0, 2).map((id) => ({ kind: 'person' as const, id })),
    ...p.candidates.moves.slice(0, 1).map((id) => ({ kind: 'move' as const, id })),
    ...p.candidates.boards.slice(0, 1).map((id) => ({ kind: 'board' as const, id })),
  ];

  return (
    <View style={[styles.card, closed && { opacity: 0.6 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={styles.icon}>
          <LoopIcon icon={loop.icon} color={colors.accent} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="bodyStrong" style={{ textDecorationLine: p.status === 'resolved' ? 'line-through' : 'none' }}>
            {loop.title}
          </T>
          <T v="caption" color={p.status === 'progress' ? colors.accent : colors.inkFaint} weight="600" style={{ marginTop: 1 }}>
            {p.status === 'progress' ? `${STATUS_LABEL.progress} · ${p.progress}%` : STATUS_LABEL[p.status]}
          </T>
        </View>
        {closed ? (
          <Tap onPress={() => reopen(loop.id)} haptic="light" accessibilityLabel="Reopen loop" style={styles.check}>
            <RotateCcw size={18} color={colors.inkMuted} />
          </Tap>
        ) : (
          <>
            <Tap onPress={() => dismiss(loop.id)} haptic="light" accessibilityLabel="Dismiss loop" style={styles.check}>
              <X size={18} color={colors.inkFaint} />
            </Tap>
            <Tap onPress={() => resolve(loop.id)} haptic="medium" accessibilityLabel="Mark loop resolved" style={styles.check}>
              {p.progress >= 50 ? <CircleCheck size={24} color={colors.accent} /> : <Circle size={22} color={colors.lineStrong} />}
            </Tap>
          </>
        )}
      </View>

      {!closed ? (
        <>
          <ProgressBar value={p.progress} style={{ marginTop: 12 }} />
          {p.steps.length ? (
            <View style={{ marginTop: 10, gap: 2 }}>
              {p.steps.map((st) => (
                <Tap key={st.id} onPress={() => st.ref && router.push(hrefFor(st.ref))} style={styles.step} disabled={!st.ref}>
                  <View style={[styles.stepDot, st.done && styles.stepDone]}>{st.done ? <Check size={10} color={colors.white} strokeWidth={3.5} /> : null}</View>
                  <T v="footnote" weight={st.done ? '500' : '600'} color={st.done ? colors.inkMuted : colors.ink2} style={{ flex: 1 }} numberOfLines={1}>
                    {st.label}
                  </T>
                </Tap>
              ))}
            </View>
          ) : (
            <T v="footnote" color={colors.inkMuted} style={{ marginTop: 8 }}>
              Mark it resolved when it happens. Add a place or interest to the title and Chimp will find leads.
            </T>
          )}
          {helpers.length ? (
            <View style={{ marginTop: 10 }}>
              <T v="caption" color={colors.inkFaint} style={{ marginBottom: 6 }}>
                COULD HELP CLOSE THIS
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {helpers.map((r) => (
                  <Tap key={`${r.kind}${r.id}`} onPress={() => router.push(hrefFor(r))} style={styles.related}>
                    <Img uri={repo.imageFor(r)} style={[styles.relImg, r.kind === 'person' && { borderRadius: 11 }]} />
                    <T v="footnote" weight="600" numberOfLines={1} style={{ marginLeft: 6, maxWidth: 140 }}>
                      {r.kind === 'person' ? repo.labelFor(r).split(' ')[0] : repo.labelFor(r)}
                    </T>
                  </Tap>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SuggestedCard({ loop }: { loop: OpenLoop }) {
  const openLoop = useChimp((s) => s.openLoop);
  return (
    <View style={[styles.card, styles.suggested]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={[styles.icon, { backgroundColor: colors.surface }]}>
          <LoopIcon icon={loop.icon} color={colors.accent} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="bodyStrong">{loop.title}</T>
          <T v="caption" color={colors.inkMuted} weight="500" style={{ marginTop: 1 }}>
            Opening it reorganises People, Moves and Boards around it
          </T>
        </View>
      </View>
      <Tap onPress={() => openLoop(loop.id)} haptic="medium" style={styles.openBtn} accessibilityLabel={`Open loop ${loop.title}`}>
        <Plus size={16} color={colors.white} />
        <T v="subhead" weight="700" color={colors.white} style={{ marginLeft: 6 }}>
          Open this loop
        </T>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  input: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 18,
    fontSize: 16,
    color: colors.ink,
  },
  addBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  card: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.sm },
  suggested: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: '#CFE0FF', shadowOpacity: 0 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  check: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  stepDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.lineStrong, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  related: { flexDirection: 'row', alignItems: 'center', height: 34, paddingLeft: 5, paddingRight: 10, borderRadius: 17, backgroundColor: colors.surfaceMuted },
  relImg: { width: 22, height: 22, borderRadius: 6 },
  openBtn: { marginTop: 12, height: 44, borderRadius: 22, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
