/**
 * Phase 7A: Challenges — short games only between two people in a Vibe.
 * Incoming / Waiting on Them / Completed. Answers are revealed only after
 * both have played; results belong to the pair (no leaderboards).
 */
import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { challengeType, CHALLENGES, type ChallengeKind, resultLine, TWO_TRUTHS } from '@/data/afterDarkChallenges';
import { useTabBarSpace } from '@/hooks/useLayout';
import type { ChallengeRow, VibeRow } from '@/services/backend/afterDark';
import { userMessage } from '@/services/backend/errors';
import { challengeView, firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { whenLabel } from '@/utils/format';
import { layout } from '@/theme';
import { ad } from './adTheme';
import { ChoiceRow, DarkButton, DarkSheet, EmptyNote, ErrorLine, PairAvatars } from './VibeParts';

type Filter = 'incoming' | 'waiting' | 'completed';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'incoming', label: 'Incoming' },
  { id: 'waiting', label: 'Waiting on Them' },
  { id: 'completed', label: 'Completed' },
];

export { resultLine } from '@/data/afterDarkChallenges';

export function ChallengesTab() {
  const tabSpace = useTabBarSpace();
  const s = useAfterDark();
  const [filter, setFilter] = useState<Filter>('incoming');
  const [starting, setStarting] = useState(false);
  const byVibe = new Map(s.vibes.map((v) => [v.vibe_id, v]));
  const items = s.challenges
    .filter((c) => byVibe.has(c.vibe_id))
    .map((c) => ({ c, v: byVibe.get(c.vibe_id)!, ...challengeView(s, c, s.uid) }))
    // Unplayed challenges of a paused or ended Vibe can't be played now.
    .filter((x) => x.bucket === 'completed' || x.v.status === 'active');
  const shown = items.filter((x) => x.bucket === filter);
  const count = (f: Filter) => items.filter((x) => x.bucket === f).length;
  const active = s.vibes.filter((v) => v.status === 'active');

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: tabSpace }} showsVerticalScrollIndicator={false} testID="challenges-tab">
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Tap key={f.id} onPress={() => setFilter(f.id)} style={[styles.filter, filter === f.id && styles.filterOn]} accessibilityRole="tab" accessibilityState={{ selected: filter === f.id }} testID={`ch-filter-${f.id}`}>
              <T v="caption" weight="700" color={filter === f.id ? ad.ink : ad.faint} numberOfLines={1} style={{ fontSize: 11 }}>
                {f.label}
              </T>
              {count(f.id) ? (
                <T v="caption" weight="800" color={ad.pink} style={{ fontSize: 11, marginLeft: 4 }}>
                  {count(f.id)}
                </T>
              ) : null}
            </Tap>
          ))}
        </View>
        {active.length ? <DarkButton label="Start a challenge" small icon={<Plus size={15} color="#fff" />} onPress={() => setStarting(true)} style={{ marginTop: 12, alignSelf: 'flex-start' }} testID="ch-start" /> : null}
        <View style={{ marginTop: 12 }}>
          {shown.length ? (
            shown.map((x) => <ChallengeCard key={x.c.id} c={x.c} v={x.v} mine={x.mine} theirs={x.theirs} bucket={x.bucket} />)
          ) : (
            <EmptyNote
              title={filter === 'incoming' ? 'Nothing to play right now' : filter === 'waiting' ? 'Nobody’s keeping you waiting' : 'No results yet'}
              body={active.length ? 'Challenges are quick games for two. Results show once you’ve both played.' : 'Challenges open up inside a Vibe.'}
            />
          )}
        </View>
      </ScrollView>
      <NewChallengeSheet visible={starting} onClose={() => setStarting(false)} vibes={active} />
    </>
  );
}

export function ChallengeCard({ c, v, mine, theirs, bucket, compact }: { c: ChallengeRow; v: VibeRow; mine?: number[]; theirs?: number[]; bucket: Filter; compact?: boolean }) {
  const type = challengeType(c.kind);
  const first = firstNameOf(v.other_id);
  const fromMe = c.sent_by != null && c.sent_by !== v.other_id;
  const sub = bucket === 'completed' ? `${resultLine(c, mine, theirs)}${compact ? '' : ` · ${first}`}` : bucket === 'waiting' ? `Waiting on ${first}` : fromMe ? `Your turn too · ${first}` : `${first} sent you this`;
  return (
    <Tap onPress={() => router.push(`/after-dark/challenge/${c.id}`)} style={[styles.card, bucket === 'incoming' && { borderColor: ad.pinkLine }]} scaleTo={0.99} accessibilityLabel={`${type?.title ?? 'Challenge'} with ${first}. ${sub}`} testID={`challenge-${c.id}`}>
      <View style={styles.emoji}>
        <T style={{ fontSize: 22 }}>{type?.emoji ?? '✨'}</T>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T v="headline" color={ad.ink} numberOfLines={1}>
          {type?.title ?? 'Challenge'}
        </T>
        <T v="footnote" color={bucket === 'incoming' ? ad.pink : bucket === 'completed' ? ad.ok : ad.muted} weight="600" style={{ marginTop: 2 }}>
          {sub}
        </T>
        {!compact && c.note ? (
          <T v="caption" weight="500" color={ad.faint} numberOfLines={1} style={{ marginTop: 3 }}>
            {`“${c.note}” · ${whenLabel(c.created_at)}`}
          </T>
        ) : null}
      </View>
      {!compact ? <PairAvatars otherId={v.other_id} size={26} ring={ad.card} /> : null}
      <ChevronRight size={18} color={ad.faint} style={{ marginLeft: 6 }} />
    </Tap>
  );
}

/** Pick who and which game. Only between two people in an active Vibe. */
export function NewChallengeSheet({ visible, onClose, vibes, fixed }: { visible: boolean; onClose: () => void; vibes: VibeRow[]; fixed?: VibeRow }) {
  const send = useAfterDark((s) => s.sendChallenge);
  const sendTwoTruths = useAfterDark((s) => s.sendTwoTruths);
  const [vibe, setVibe] = useState<string | null>(null);
  const [kind, setKind] = useState<ChallengeKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two Truths: written here, not drawn from a deck.
  const [writing, setWriting] = useState(false);
  const [lines, setLines] = useState(['', '', '']);
  const [lie, setLie] = useState<number | null>(null);
  const target = fixed ?? vibes.find((v) => v.vibe_id === vibe);
  const close = () => {
    setVibe(null);
    setKind(null);
    setError(null);
    setWriting(false);
    setLines(['', '', '']);
    setLie(null);
    onClose();
  };
  const ready = lines.every((l) => l.trim().length > 0) && lie != null;
  const go = async () => {
    if (!target || !kind) return;
    if (kind === 'two_truths' && !writing) {
      setWriting(true);
      return;
    }
    const type = challengeType(kind)!;
    setBusy(true);
    setError(null);
    try {
      const deck = type.decks[Math.floor(Math.random() * type.decks.length)];
      const id = kind === 'two_truths' ? await sendTwoTruths(target.vibe_id, lines, lie ?? -1, type.invite) : await send(target.vibe_id, kind, deck.id, type.invite);
      close();
      router.push(`/after-dark/challenge/${id}`);
    } catch (e) {
      setError(userMessage(e, 'Couldn’t send the challenge. Try again.'));
    }
    setBusy(false);
  };
  if (writing && target) {
    const first = firstNameOf(target.other_id);
    return (
      <DarkSheet visible={visible} onClose={close} title="Two truths and a lie" subtitle={`Write three things about you. Mark the lie — ${first} only finds out after guessing.`} testID="two-truths-compose">
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {lines.map((l, i) => (
            <View key={i} style={styles.ttRow}>
              <TextInput
                value={l}
                onChangeText={(t) => setLines(lines.map((x, k) => (k === i ? t : x)))}
                placeholder={i === 0 ? 'I’ve been to Tokyo twice' : i === 1 ? 'I can’t whistle' : 'I once met a famous chef'}
                placeholderTextColor={ad.faint}
                maxLength={TWO_TRUTHS.maxLength}
                style={styles.ttInput}
                accessibilityLabel={`Statement ${i + 1}`}
                testID={`tt-line-${i}`}
              />
              <Tap onPress={() => setLie(i)} style={[styles.liePick, lie === i && styles.liePickOn]} accessibilityRole="radio" accessibilityState={{ selected: lie === i }} accessibilityLabel={`Statement ${i + 1} is the lie`} testID={`tt-lie-${i}`}>
                <T v="caption" weight="800" color={lie === i ? '#fff' : ad.muted}>
                  LIE
                </T>
              </Tap>
            </View>
          ))}
          <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 4 }}>
            Up to 120 characters each. Plain text only.
          </T>
        </ScrollView>
        <DarkButton label="Send" onPress={go} busy={busy} disabled={!ready} style={{ marginTop: 12 }} testID="tt-send" />
        <DarkButton label="Back" tone="ghost" small onPress={() => setWriting(false)} style={{ marginTop: 8 }} />
        <ErrorLine text={error} />
      </DarkSheet>
    );
  }
  return (
    <DarkSheet visible={visible} onClose={close} title={target ? `A challenge for ${firstNameOf(target.other_id)}` : 'Start a challenge'} subtitle="You both answer on your own. Nobody sees anything until you’ve both played." testID="new-challenge">
      <ScrollView style={{ maxHeight: 440 }}>
        {!fixed && !target ? (
          vibes.map((v) => <ChoiceRow key={v.vibe_id} label={`You + ${firstNameOf(v.other_id)}`} onPress={() => setVibe(v.vibe_id)} testID={`pick-vibe-${v.other_id}`} />)
        ) : (
          CHALLENGES.map((t) => <ChoiceRow key={t.kind} label={`${t.emoji}  ${t.title}`} sub={t.blurb} selected={kind === t.kind} onPress={() => setKind(t.kind)} testID={`pick-${t.kind}`} />)
        )}
      </ScrollView>
      {target ? <DarkButton label={kind === 'two_truths' ? 'Write them' : 'Play and send'} onPress={go} busy={busy} disabled={!kind} style={{ marginTop: 12 }} testID="challenge-send" /> : null}
      <ErrorLine text={error} />
    </DarkSheet>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 6 },
  filter: { flexGrow: 1, flexDirection: 'row', height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ad.line, paddingHorizontal: 9 },
  filterOn: { backgroundColor: ad.raised, borderColor: ad.lineStrong },
  card: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 20, backgroundColor: ad.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line, marginBottom: 10 },
  ttRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  ttInput: { flex: 1, minHeight: 48, borderRadius: 16, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  liePick: { width: 52, height: 44, borderRadius: 14, borderWidth: 1, borderColor: ad.lineStrong, alignItems: 'center', justifyContent: 'center' },
  liePickOn: { backgroundColor: ad.pink, borderColor: ad.pink },
  emoji: { width: 46, height: 46, borderRadius: 16, backgroundColor: ad.plum2, alignItems: 'center', justifyContent: 'center' },
});
