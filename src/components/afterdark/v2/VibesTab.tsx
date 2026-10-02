/**
 * Phase 7A: Vibes — the pairs you're in. A Vibe card is the PAIR (you + them),
 * with a descriptive stage (Curious → Spark → Building → Strong Vibe, never a
 * number), its status (Active / Pending / Cooling / Paused / Ended) and one
 * contextual next step. Mutual Crushes and requests waiting on you come first.
 */
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, Heart, MessageCircle, Moon } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useTabBarSpace } from '@/hooks/useLayout';
import type { VibeRow } from '@/services/backend/afterDark';
import { userMessage } from '@/services/backend/errors';
import { repo } from '@/services/repository';
import { firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { nudge, vibeStage } from '@/utils/afterDark';
import { layout } from '@/theme';
import { ad } from './adTheme';
import type { AdTab } from './AfterDarkHome';
import { EndVibeSheet } from './DisconnectSheets';
import { MutualCrushSheet } from './MutualCrushSheet';
import { useDisplayStatus, useMutualCrushes } from './useAdData';
import { DarkButton, EmptyNote, ErrorLine, originLine, PairAvatars, SectionLabel, StagePill, StatusPill } from './VibeParts';

export function VibesTab({ onGo }: { onGo: (t: AdTab) => void }) {
  const tabSpace = useTabBarSpace();
  const vibes = useAfterDark((s) => s.vibes);
  const loaded = useAfterDark((s) => s.loaded);
  const mutual = useMutualCrushes();
  const status = useDisplayStatus();
  const [offer, setOffer] = useState<string | null>(null);
  const [ending, setEnding] = useState<VibeRow | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  const incoming = vibes.filter((v) => v.status === 'pending' && v.my_role === 'recipient');
  const live = vibes.filter((v) => v.status !== 'closed' && !(v.status === 'pending' && v.my_role === 'recipient'));
  const ended = vibes.filter((v) => v.status === 'closed');

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: tabSpace }} showsVerticalScrollIndicator={false} testID="vibes-tab">
        {mutual.length ? (
          <>
            <SectionLabel first>It’s mutual</SectionLabel>
            {mutual.map((id) => (
              <MutualCard key={id} personId={id} onOffer={() => setOffer(id)} />
            ))}
          </>
        ) : null}
        {incoming.length ? (
          <>
            <SectionLabel first={!mutual.length}>Waiting on you</SectionLabel>
            {incoming.map((v) => (
              <RequestCard key={v.vibe_id} v={v} />
            ))}
          </>
        ) : null}
        <SectionLabel first={!mutual.length && !incoming.length}>Your Vibes</SectionLabel>
        {live.length ? (
          live.map((v) => <VibeCard key={v.vibe_id} v={v} display={status(v)} onClose={() => setEnding(v)} />)
        ) : loaded ? (
          <EmptyNote title="No Vibes yet" body="Mutual interest becomes a Vibe when both people say yes." action={<DarkButton label="Discover people" small onPress={() => onGo('discover')} />} testID="vibes-empty" />
        ) : null}
        {ended.length ? (
          <>
            <Tap onPress={() => setShowEnded((x) => !x)} style={styles.endedToggle} accessibilityLabel={showEnded ? 'Hide ended Vibes' : 'Show ended Vibes'} testID="ended-toggle">
              <T v="footnote" weight="700" color={ad.faint} style={{ flex: 1 }}>{`Ended (${ended.length})`}</T>
              {showEnded ? <ChevronUp size={16} color={ad.faint} /> : <ChevronDown size={16} color={ad.faint} />}
            </Tap>
            {showEnded ? ended.map((v) => <EndedCard key={v.vibe_id} v={v} />) : null}
          </>
        ) : null}
      </ScrollView>
      <MutualCrushSheet personId={offer} onClose={() => setOffer(null)} />
      <EndVibeSheet vibe={ending} onClose={() => setEnding(null)} />
    </>
  );
}

function MutualCard({ personId, onOffer }: { personId: string; onOffer: () => void }) {
  const first = firstNameOf(personId);
  return (
    <View style={[styles.card, { borderColor: ad.pinkLine }]} testID={`mutual-${personId}`}>
      <View style={styles.row}>
        <PairAvatars otherId={personId} size={42} ring={ad.card} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Heart size={14} color={ad.pink} fill={ad.pink} />
            <T v="headline" color={ad.ink} style={{ marginLeft: 6 }}>{`You + ${first}`}</T>
          </View>
          <T v="footnote" color={ad.muted} style={{ marginTop: 2 }}>
            You both have a Crush. Only you two can see this.
          </T>
        </View>
      </View>
      <View style={styles.btnRow}>
        <DarkButton label="Take it After Dark" small icon={<Moon size={14} color="#fff" />} onPress={onOffer} style={{ flex: 1 }} testID={`mutual-offer-${personId}`} />
        <DarkButton label="Normal chat" small tone="ghost" icon={<MessageCircle size={14} color="#fff" />} onPress={() => router.push(`/chat/${personId}`)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** Someone asked for a Vibe with you: you control the next level of access. */
function RequestCard({ v }: { v: VibeRow }) {
  const respond = useAfterDark((s) => s.respond);
  const first = firstNameOf(v.other_id);
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (accept: boolean) => {
    setBusy(accept ? 'yes' : 'no');
    setError(null);
    try {
      await respond(v.vibe_id, accept);
      if (accept) router.push(`/after-dark/vibe/${v.vibe_id}`);
    } catch (e) {
      setError(userMessage(e, 'Couldn’t answer. Try again.'));
    }
    setBusy(null);
  };
  return (
    <View style={[styles.card, { borderColor: ad.pinkLine }]} testID={`request-${v.other_id}`}>
      <Tap onPress={() => repo.user(v.other_id) && router.push(`/profile/${v.other_id}`)} style={styles.row} accessibilityLabel={`See ${first}’s profile`}>
        <PairAvatars otherId={v.other_id} size={42} ring={ad.card} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="headline" color={ad.ink}>{`${first} wants to take it After Dark`}</T>
          <T v="footnote" color={ad.muted} style={{ marginTop: 2 }}>
            {originLine(v, first)}
          </T>
        </View>
      </Tap>
      {v.origin_text ? (
        <T v="callout" color={ad.ink} style={styles.quote}>
          {`“${v.origin_text}”`}
        </T>
      ) : null}
      <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 10 }}>
        Saying yes opens a private chat. Photos stay off until you turn them on.
      </T>
      <View style={styles.btnRow}>
        <DarkButton label="Accept" small onPress={() => void go(true)} busy={busy === 'yes'} style={{ flex: 1 }} testID={`accept-${v.other_id}`} />
        <DarkButton label="Not for me" small tone="ghost" onPress={() => void go(false)} busy={busy === 'no'} style={{ flex: 1 }} testID={`decline-${v.other_id}`} />
      </View>
      <ErrorLine text={error} />
    </View>
  );
}

export function VibeCard({ v, display, onClose }: { v: VibeRow; display: VibeRow['status'] | 'cooling'; onClose: () => void }) {
  const first = firstNameOf(v.other_id);
  const line = display === 'cooling' ? 'It’s been quiet for a while.' : nudge(v, first);
  const stats = [
    v.challenges_completed ? `${v.challenges_completed} challenge${v.challenges_completed === 1 ? '' : 's'} played` : null,
    v.plans_confirmed ? `${v.plans_confirmed} plan${v.plans_confirmed === 1 ? '' : 's'} on` : null,
  ].filter(Boolean);
  return (
    <Tap onPress={() => router.push(`/after-dark/vibe/${v.vibe_id}`)} style={styles.card} scaleTo={0.99} accessibilityLabel={`You and ${first}, ${display}`} testID={`vibe-${v.other_id}`}>
      <View style={styles.row}>
        <PairAvatars otherId={v.other_id} size={46} ring={ad.card} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="headline" color={ad.ink} numberOfLines={1}>{`You + ${first}`}</T>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <StatusPill status={display} />
            {v.status !== 'pending' ? <StagePill stage={vibeStage(v)} /> : null}
          </View>
        </View>
        {v.unread ? (
          <View style={styles.unread}>
            <T v="caption" weight="800" color="#fff">
              {v.unread > 9 ? '9+' : v.unread}
            </T>
          </View>
        ) : null}
      </View>
      {line ? (
        <T v="callout" color={display === 'cooling' ? ad.warn : ad.muted} style={{ marginTop: 10 }}>
          {line}
        </T>
      ) : null}
      {stats.length ? (
        <T v="caption" weight="600" color={ad.faint} style={{ marginTop: 6 }}>
          {stats.join(' · ')}
        </T>
      ) : null}
      {display === 'cooling' ? (
        <View style={styles.btnRow}>
          <DarkButton label="Keep it going" small onPress={() => router.push({ pathname: '/after-dark/vibe/[id]', params: { id: v.vibe_id, keep: '1' } })} style={{ flex: 1 }} testID={`keep-${v.other_id}`} />
          <DarkButton label="Close Vibe" small tone="ghost" onPress={onClose} style={{ flex: 1 }} testID={`close-${v.other_id}`} />
        </View>
      ) : null}
    </Tap>
  );
}

function EndedCard({ v }: { v: VibeRow }) {
  const first = firstNameOf(v.other_id);
  return (
    <Tap onPress={() => router.push(`/after-dark/vibe/${v.vibe_id}`)} style={[styles.card, { opacity: 0.7 }]} accessibilityLabel={`You and ${first}, ended`} testID={`ended-${v.other_id}`}>
      <View style={styles.row}>
        <PairAvatars otherId={v.other_id} size={36} ring={ad.card} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T v="callout" weight="700" color={ad.ink}>{`You + ${first}`}</T>
          <T v="footnote" color={ad.faint}>
            {v.expired ? 'This request expired.' : 'This Vibe has ended.'}
          </T>
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 22, backgroundColor: ad.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quote: { marginTop: 12, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: ad.pink, fontStyle: 'italic' },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: ad.pink, alignItems: 'center', justifyContent: 'center' },
  endedToggle: { flexDirection: 'row', alignItems: 'center', height: 40, marginTop: 10 },
});
