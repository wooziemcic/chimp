/**
 * Phase 7A: play a Challenge, or see its result. You answer on your own;
 * nothing is shown to either of you until you've both played. The result is
 * the pair's (no leaderboards) and becomes part of the Vibe's history.
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ad } from '@/components/afterdark/v2/adTheme';
import { NewChallengeSheet, resultLine } from '@/components/afterdark/v2/ChallengesTab';
import { PlanSheet } from '@/components/afterdark/v2/PlansTab';
import { DarkButton, ErrorLine, PairAvatars } from '@/components/afterdark/v2/VibeParts';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { challengeDeck, challengeType } from '@/data/afterDarkChallenges';
import { userMessage } from '@/services/backend/errors';
import { challengeView, firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const activate = useAfterDark((s) => s.activate);
  useEffect(() => {
    if (ageConfirmed) activate();
  }, [ageConfirmed, activate]);
  const s = useAfterDark();
  const c = s.challenges.find((x) => x.id === id);
  const v = c ? s.vibes.find((x) => x.vibe_id === c.vibe_id) : undefined;
  const [picks, setPicks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);

  if (!ageConfirmed) return <Redirect href="/after-dark" />;
  if (!c || !v) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 60, alignItems: 'center' }]}>
        {s.loaded ? (
          <>
            <T v="headline" color={ad.ink}>
              This challenge isn’t available
            </T>
            <DarkButton label="Back" small tone="ghost" onPress={() => router.back()} style={{ marginTop: 14 }} />
          </>
        ) : (
          <ActivityIndicator color={ad.pink} />
        )}
      </View>
    );
  }

  const type = challengeType(c.kind);
  const deck = challengeDeck(c.kind, c.deck);
  const first = firstNameOf(v.other_id);
  const view = challengeView(s, c, s.uid);
  const predict = type?.scoring === 'predict';
  const iSent = c.sent_by != null && c.sent_by !== v.other_id;
  const playing = view.bucket === 'incoming' && v.status === 'active' && !!deck;
  const q = deck?.questions[picks.length];

  const choose = async (k: number) => {
    if (!deck) return;
    const next = [...picks, k];
    setPicks(next);
    if (next.length < deck.questions.length) return;
    setBusy(true);
    setError(null);
    try {
      await s.answerChallenge(c.id, next);
    } catch (e) {
      setError(userMessage(e, 'Couldn’t send your answers. Try again.'));
      setPicks([]);
    }
    setBusy(false);
  };

  // "Choose the Night" → a plan from what you both picked (or your picks).
  const planTitle = () => {
    if (!deck || !view.mine) return type?.title ?? 'A night out';
    const picksText = deck.questions.map((qq, i) => (view.theirs && view.theirs[i] === view.mine![i] ? qq.options[view.mine![i]] : null)).filter(Boolean) as string[];
    const list = picksText.length ? picksText : deck.questions.slice(0, 2).map((qq, i) => qq.options[view.mine![i]]);
    return list.slice(0, 3).join(', then ');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="challenge-screen">
      <StatusBar style="light" />
      <View style={styles.head}>
        <Tap onPress={() => router.back()} style={styles.icon} accessibilityLabel="Back" testID="challenge-back">
          <ChevronLeft size={24} color="#fff" />
        </Tap>
        <T v="headline" color={ad.ink} style={{ flex: 1 }} numberOfLines={1}>{`${type?.emoji ?? ''} ${type?.title ?? 'Challenge'}`}</T>
        <PairAvatars otherId={v.other_id} size={30} />
        <View style={{ width: 12 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 30 }}>
        {c.note ? (
          <T v="callout" color={ad.muted} style={{ fontStyle: 'italic', marginBottom: 14 }}>
            {`${iSent ? 'You' : first}: “${c.note}”`}
          </T>
        ) : null}

        {c.kind === 'two_truths' ? (
          <TwoTruths
            statements={c.statements ?? []}
            first={first}
            iSent={iSent}
            mine={view.mine}
            theirs={view.theirs}
            canPlay={view.bucket === 'incoming' && v.status === 'active'}
            busy={busy}
            onGuess={async (k) => {
              setBusy(true);
              setError(null);
              try {
                await s.answerChallenge(c.id, [k]);
              } catch (e) {
                setError(userMessage(e, 'Couldn’t send your guess. Try again.'));
              }
              setBusy(false);
            }}
          />
        ) : playing && q ? (
          <View testID="challenge-play">
            <T v="caption" weight="700" color={ad.pink}>{`${picks.length + 1} OF ${deck!.questions.length}${predict ? (iSent ? ' · ABOUT YOU' : ` · GUESS ${first.toUpperCase()}’S ANSWER`) : ''}`}</T>
            <T v="title2" color={ad.ink} style={{ marginTop: 8 }}>
              {q.q}
            </T>
            <View style={{ marginTop: 18, gap: 10 }}>
              {q.options.map((o, k) => (
                <Tap key={o} onPress={() => void choose(k)} disabled={busy} haptic="select" style={styles.option} accessibilityLabel={o} testID={`opt-${picks.length}-${k}`}>
                  <T v="headline" color={ad.ink}>
                    {o}
                  </T>
                </Tap>
              ))}
            </View>
            {busy ? <ActivityIndicator color={ad.pink} style={{ marginTop: 18 }} /> : null}
            <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 18 }}>
              {`${first} won’t see your answers until they’ve played too.`}
            </T>
          </View>
        ) : view.bucket === 'completed' && deck ? (
          <View testID="challenge-result">
            <T v="title2" color={ad.ink}>
              {resultLine(c, view.mine, view.theirs)}
            </T>
            <T v="footnote" color={ad.muted} style={{ marginTop: 4 }}>
              Just for the two of you. It’s part of your Vibe now.
            </T>
            <View style={{ marginTop: 16, gap: 10 }}>
              {deck.questions.map((qq, i) => {
                const a = view.mine?.[i];
                const b = view.theirs?.[i];
                const same = a != null && a === b;
                return (
                  <View key={i} style={[styles.result, same && { borderColor: ad.pinkLine, backgroundColor: ad.pinkSoft }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <T v="caption" weight="700" color={ad.faint} style={{ flex: 1 }}>
                        {qq.q.toUpperCase()}
                      </T>
                      {same ? <Check size={16} color={ad.pink} strokeWidth={3} /> : null}
                    </View>
                    <T v="callout" color={ad.ink} style={{ marginTop: 6 }}>{`You: ${a != null ? qq.options[a] : '—'}`}</T>
                    <T v="callout" color={ad.muted} style={{ marginTop: 2 }}>{`${first}: ${b != null ? qq.options[b] : '—'}`}</T>
                  </View>
                );
              })}
            </View>
            {v.status === 'active' ? (
              <View style={{ marginTop: 18, gap: 8 }}>
                <DarkButton label={c.kind === 'choose_the_night' ? 'Make this night a plan' : 'Suggest a plan'} onPress={() => setPlan(planTitle())} testID="result-plan" />
                <DarkButton label="Play another" tone="ghost" onPress={() => setAgain(true)} testID="result-again" />
                <DarkButton label="Back to the chat" tone="soft" onPress={() => router.replace(`/after-dark/vibe/${v.vibe_id}`)} testID="result-chat" />
              </View>
            ) : null}
          </View>
        ) : (
          <View testID="challenge-waiting">
            <T v="title2" color={ad.ink}>
              {view.mine ? `Waiting on ${first}` : 'Not playable right now'}
            </T>
            <T v="footnote" color={ad.muted} style={{ marginTop: 6, lineHeight: 19 }}>
              {view.mine ? `Your answers are in. Results show here once ${first} plays — no nudging needed.` : 'This Vibe isn’t active.'}
            </T>
            {view.mine && deck ? (
              <View style={{ marginTop: 16, gap: 8 }}>
                {deck.questions.map((qq, i) => (
                  <View key={i} style={styles.result}>
                    <T v="caption" weight="700" color={ad.faint}>
                      {qq.q.toUpperCase()}
                    </T>
                    <T v="callout" color={ad.ink} style={{ marginTop: 4 }}>{`You: ${qq.options[view.mine![i]] ?? '—'}`}</T>
                  </View>
                ))}
              </View>
            ) : null}
            <DarkButton label="Back to the chat" tone="soft" onPress={() => router.replace(`/after-dark/vibe/${v.vibe_id}`)} style={{ marginTop: 18 }} />
          </View>
        )}
        {c.kind === 'two_truths' && v.status === 'active' && view.bucket === 'completed' ? (
          <View style={{ marginTop: 18, gap: 8 }}>
            <DarkButton label="Play another" tone="ghost" onPress={() => setAgain(true)} testID="result-again" />
            <DarkButton label="Back to the chat" tone="soft" onPress={() => router.replace(`/after-dark/vibe/${v.vibe_id}`)} testID="result-chat" />
          </View>
        ) : c.kind === 'two_truths' && view.bucket !== 'incoming' ? (
          <DarkButton label="Back to the chat" tone="soft" onPress={() => router.replace(`/after-dark/vibe/${v.vibe_id}`)} style={{ marginTop: 18 }} />
        ) : null}
        <ErrorLine text={error} />
      </ScrollView>
      <NewChallengeSheet visible={again} onClose={() => setAgain(false)} vibes={[v]} fixed={v} />
      <PlanSheet target={null} create={plan ? { v, title: plan } : null} onClose={() => setPlan(null)} />
    </View>
  );
}

/**
 * Phase 7B: Two Truths and a Lie. The sender's answer is the lie; the other
 * person's is the guess. Which one was the lie is only shown once they've
 * guessed (the server hides the sender's answer until then).
 */
function TwoTruths({ statements, first, iSent, mine, theirs, canPlay, busy, onGuess }: { statements: string[]; first: string; iSent: boolean; mine?: number[]; theirs?: number[]; canPlay: boolean; busy: boolean; onGuess: (k: number) => void }) {
  const lie = iSent ? mine?.[0] : theirs?.[0];
  const guess = iSent ? theirs?.[0] : mine?.[0];
  const revealed = lie != null && guess != null;
  if (!iSent && canPlay && guess == null) {
    return (
      <View testID="tt-play">
        <T v="caption" weight="700" color={ad.pink}>
          {`WHICH ONE IS ${first.toUpperCase()}’S LIE?`}
        </T>
        <View style={{ marginTop: 14, gap: 10 }}>
          {statements.map((st, k) => (
            <Tap key={k} onPress={() => onGuess(k)} disabled={busy} haptic="select" style={styles.option} accessibilityLabel={`Guess: ${st}`} testID={`tt-guess-${k}`}>
              <T v="headline" color={ad.ink}>
                {st}
              </T>
            </Tap>
          ))}
        </View>
        {busy ? <ActivityIndicator color={ad.pink} style={{ marginTop: 18 }} /> : null}
        <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 18 }}>
          You find out as soon as you guess.
        </T>
      </View>
    );
  }
  return (
    <View testID={revealed ? 'tt-result' : 'tt-waiting'}>
      <T v="title2" color={ad.ink}>
        {revealed ? (lie === guess ? (iSent ? `${first} spotted your lie` : 'You spotted it') : iSent ? `You fooled ${first}` : `${first} fooled you`) : iSent ? `Waiting on ${first}` : 'Not playable right now'}
      </T>
      <T v="footnote" color={ad.muted} style={{ marginTop: 4 }}>
        {revealed ? 'Just for the two of you.' : iSent ? `${first} sees your three statements, not which one is the lie.` : 'This Vibe isn’t active.'}
      </T>
      <View style={{ marginTop: 16, gap: 10 }}>
        {statements.map((st, k) => {
          const isLie = lie === k;
          const picked = guess === k;
          return (
            <View key={k} style={[styles.result, revealed && isLie && { borderColor: ad.pinkLine, backgroundColor: ad.pinkSoft }]}>
              <T v="callout" color={ad.ink}>
                {st}
              </T>
              {isLie || (revealed && picked) ? (
                <T v="caption" weight="700" color={isLie ? ad.pink : ad.faint} style={{ marginTop: 4 }}>
                  {[isLie ? 'THE LIE' : null, revealed && picked ? (iSent ? `${first.toUpperCase()}’S GUESS` : 'YOUR GUESS') : null].filter(Boolean).join(' · ')}
                </T>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ad.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ad.line },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 58, paddingHorizontal: 18, borderRadius: 20, backgroundColor: ad.card2, borderWidth: 1, borderColor: ad.lineStrong, justifyContent: 'center' },
  result: { padding: 14, borderRadius: 18, backgroundColor: ad.card, borderWidth: 1, borderColor: ad.line },
});
