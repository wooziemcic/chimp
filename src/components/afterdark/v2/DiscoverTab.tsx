/**
 * Phase 7A: Discover — big photo-first cards of adults who opted in. Tap the
 * photo to go through their pictures. Broad location only, never a score:
 * "Why you may vibe" is plain shared context (Worlds, interests, people).
 *
 * Pass (private) · Crush (private, the normal Chimp Crush) · Respond to their
 * Open Loop / Send interest (asks for a Vibe; they decide).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Heart, MapPin, Quote, RotateCcw, Send, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useImpression } from '@/hooks/useImpression';
import { useTabBarSpace } from '@/hooks/useLayout';
import { interestMomentum } from '@/graph/time';
import { rankDiscover, whyYouMayVibe } from '@/graph/vibe';
import type { DiscoverRow } from '@/services/backend/afterDark';
import { ds } from '@/services/dataset';
import { useAfterDark } from '@/store/useAfterDark';
import { useChimp } from '@/store/useChimp';
import { exposureFor } from '@/store/useExposure';
import { intentLabel } from '@/utils/afterDark';
import { layout } from '@/theme';
import { ad } from './adTheme';
import type { AdTab } from './AfterDarkHome';
import { MutualCrushSheet } from './MutualCrushSheet';
import { useMutualCrushes } from './useAdData';
import { DarkButton, DarkSheet, EmptyNote, ErrorLine, interestLabel } from './VibeParts';

export function DiscoverTab({ onGo }: { onGo: (t: AdTab) => void }) {
  const { width, height } = useWindowDimensions();
  const tabSpace = useTabBarSpace();
  const insets = useSafeAreaInsets();
  const rawRows = useAfterDark((s) => s.discover);
  const loaded = useAfterDark((s) => s.discoverLoaded);
  const load = useAfterDark((s) => s.loadDiscover);
  const pass = useAfterDark((s) => s.pass);
  const profile = useAfterDark((s) => s.profile);
  const crushes = useChimp((s) => s.crushes);
  const toggleCrush = useChimp((s) => s.toggleCrush);
  const myOpenTo = useChimp((s) => s.profile.openTo);
  const mutual = useMutualCrushes();
  // Phase 7C: best opportunity first (shared context, intent fit, timing, not
  // already seen). Ranked from the list as loaded (your activity is read, not
  // subscribed to), so it never reshuffles while you browse.
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const activity = useChimp.getState().activity;
    return rankDiscover(rawRows, {
      myInterests: ds().me.interests ?? [],
      myIntent: profile?.intent,
      activity,
      momentum: interestMomentum(activity, now),
      exposure: exposureFor(ds().me.id),
      now,
    });
  }, [rawRows, profile?.intent, now]);
  const [i, setI] = useState(0);
  const [asking, setAsking] = useState<DiscoverRow | null>(null);
  const [justCrushed, setJustCrushed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  // A Crush that turns out to be mutual (now, or once the backend confirms it).
  const showMutual = justCrushed && mutual.includes(justCrushed) ? justCrushed : null;

  const card = rows.length ? rows[i % rows.length] : undefined;
  // Crush is the normal Chimp Crush; offered when you're open to dating/casual (or in Discover yourself).
  const iCanCrush = (myOpenTo ?? []).some((o) => o === 'dating' || o === 'casual') || !!profile?.discoverable;
  // The card and its actions fit above the tab bar on every iPhone (SE to Pro Max).
  const room = height - insets.top - 150 - 76 - tabSpace;
  const photoH = Math.round(Math.max(300, Math.min((width - 2 * layout.gutter) * 1.22, room)));

  if (!loaded) return <ActivityIndicator color={ad.pink} style={{ marginTop: 60 }} />;

  if (!card) {
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: tabSpace }}>
        <EmptyNote
          title="You’re all caught up"
          body={profile?.discoverable ? 'New people appear here as they join After Dark. Your Vibes are waiting.' : 'New people appear here as they join. Turn on “Show me in Discover” on your card so people can find you too.'}
          action={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DarkButton label="Your Vibes" small onPress={() => onGo('vibes')} />
              <DarkButton label="Your card" small tone="ghost" onPress={() => router.push('/after-dark/card')} />
            </View>
          }
        />
        <Tap onPress={() => void load()} style={{ alignSelf: 'center', marginTop: 14, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="Check again">
          <RotateCcw size={14} color={ad.faint} />
          <T v="footnote" color={ad.faint} style={{ marginLeft: 6 }}>
            Check again
          </T>
        </Tap>
      </ScrollView>
    );
  }

  const crushed = !!crushes[card.user_id];
  const next = () => setI((n) => (rows.length ? (n + 1) % rows.length : 0));
  const doPass = async () => {
    setError(null);
    try {
      await pass(card.user_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const doCrush = () => {
    toggleCrush(card.user_id);
    if (!crushed) {
      setJustCrushed(card.user_id);
      // A Crush you already had back shows right away; otherwise move on.
      if (!ds().sparkCandidates.includes(card.user_id)) next();
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: tabSpace }} showsVerticalScrollIndicator={false}>
        <DiscoverCard key={card.user_id} row={card} height={photoH} />
        <View style={styles.actions}>
          <Tap onPress={doPass} haptic="light" style={styles.round} accessibilityLabel={`Pass on ${card.first_name}`} testID="discover-pass">
            <X size={26} color={ad.ink} strokeWidth={2.6} />
          </Tap>
          {iCanCrush ? (
            <Tap onPress={doCrush} haptic="medium" style={[styles.round, crushed && { backgroundColor: ad.pinkSoft, borderColor: ad.pink }]} accessibilityLabel={crushed ? `Remove your private Crush on ${card.first_name}` : `Crush on ${card.first_name}, private`} testID="discover-crush">
              <Heart size={25} color={ad.pink} fill={crushed ? ad.pink : 'transparent'} strokeWidth={2.4} />
            </Tap>
          ) : null}
          <DarkButton
            label={card.prompt ? 'Respond' : 'Send interest'}
            icon={<Send size={16} color="#fff" />}
            onPress={() => setAsking(card)}
            style={{ flex: 1, height: 58, borderRadius: 29 }}
            testID="discover-respond"
            accessibilityLabel={card.prompt ? `Respond to ${card.first_name}’s Open Loop` : `Send ${card.first_name} interest`}
          />
        </View>
        {crushed ? (
          <T v="caption" weight="500" color={ad.faint} align="center" style={{ marginTop: 8 }}>
            {`Crush saved privately. ${card.first_name} is told nothing unless it’s mutual.`}
          </T>
        ) : null}
        <ErrorLine text={error} />
        <WhyYouMayVibe row={card} />
        {card.prompt ? (
          <View style={styles.loop}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Quote size={14} color={ad.pink} />
              <T v="eyebrow" color={ad.pink} style={{ marginLeft: 6 }}>
                {`${card.first_name.toUpperCase()}’S OPEN LOOP`}
              </T>
            </View>
            <T v="title3" color={ad.ink} style={{ marginTop: 8 }}>
              {card.prompt}
            </T>
            <DarkButton label="Respond to this" tone="ghost" small onPress={() => setAsking(card)} style={{ alignSelf: 'flex-start', marginTop: 12 }} />
          </View>
        ) : null}
        <T v="caption" color={ad.faint} align="center" style={{ marginTop: 16 }}>
          {`${(i % rows.length) + 1} of ${rows.length}`}
        </T>
      </ScrollView>
      <AskSheet row={asking} onClose={() => setAsking(null)} />
      <MutualCrushSheet personId={showMutual} onClose={() => setJustCrushed(null)} />
    </>
  );
}

/** One person: photos you tap through, then name, age, broad place, intent, interests. */
function DiscoverCard({ row, height }: { row: DiscoverRow; height: number }) {
  useImpression(`discover:${row.user_id}`);
  const photoUrl = useAfterDark((s) => s.photoUrl);
  const myInterests = ds().me.interests;
  const demo = useAfterDark((s) => s.demo);
  // Their profile photo first, then their After Dark photos. (Demo cards carry a large copy already.)
  const photos = useMemo(() => {
    const extra = row.photo_paths.map((p) => photoUrl(p)).filter((x): x is string => !!x);
    const avatar = row.avatar_url ? photoUrl(row.avatar_url) : undefined;
    return demo || !avatar ? (extra.length ? extra : avatar ? [avatar] : []) : [avatar, ...extra];
  }, [row, photoUrl, demo]);
  const [p, setP] = useState(0);
  const go = (d: number) => setP((n) => Math.max(0, Math.min(photos.length - 1, n + d)));
  const mine = new Set(myInterests ?? []);

  return (
    <View style={[styles.card, { height }]} testID="discover-card" accessibilityLabel={`${row.first_name}, ${row.age}`}>
      {photos[p] ? <Img uri={photos[p]} tint={ad.card2} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: ad.card2 }]} />}
      <LinearGradient colors={['rgba(7,6,10,0.35)', 'rgba(7,6,10,0)', 'rgba(7,6,10,0.15)', 'rgba(7,6,10,0.92)']} locations={[0, 0.18, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {photos.length > 1 ? (
        <View style={styles.bars}>
          {photos.map((_, k) => (
            <View key={k} style={[styles.bar, { backgroundColor: k === p ? '#fff' : 'rgba(255,255,255,0.35)' }]} />
          ))}
        </View>
      ) : null}
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        <Pressable style={{ flex: 1 }} onPress={() => go(-1)} accessibilityLabel="Previous photo" testID="discover-photo-prev" />
        <Pressable style={{ flex: 1 }} onPress={() => go(1)} accessibilityLabel="Next photo" testID="discover-photo-next" />
      </View>
      <View style={[styles.info, { pointerEvents: 'none' }]}>
        <T v="title1" color="#fff" style={{ fontSize: 30, lineHeight: 34 }}>
          {`${row.first_name}, ${row.age}`}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
          {row.city ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MapPin size={13} color={ad.muted} />
              <T v="footnote" color={ad.muted} style={{ marginLeft: 4 }}>
                {row.city}
              </T>
            </View>
          ) : null}
          {intentLabel(row.intent) ? (
            <View style={styles.intent}>
              <T v="caption" weight="800" color="#fff">
                {intentLabel(row.intent)}
              </T>
            </View>
          ) : null}
        </View>
        {row.interests.length ? (
          <View style={styles.chips}>
            {row.interests.slice(0, 5).map((id) => (
              <View key={id} style={[styles.chip, mine.has(id) && { backgroundColor: ad.pinkSoft, borderColor: ad.pinkLine }]}>
                <T v="caption" weight="700" color={mine.has(id) ? '#FFB3D3' : '#fff'}>
                  {interestLabel(id)}
                </T>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Plain shared context (Phase 7C: graph/vibe.ts): at most three reasons, never a number, never a Crush. */
function WhyYouMayVibe({ row }: { row: DiscoverRow }) {
  const intent = useAfterDark((s) => s.profile?.intent);
  const reasons = whyYouMayVibe(row, { interests: ds().me.interests ?? [], intent });
  if (!reasons.length) return null;
  return (
    <View style={styles.why} testID="why-you-may-vibe">
      <T v="subhead" weight="700" color={ad.muted}>
        Why you may vibe
      </T>
      {reasons.map((r) => (
        <View key={r} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={styles.whyDot} />
          <T v="callout" color={ad.ink} style={{ flex: 1 }}>
            {r}
          </T>
        </View>
      ))}
    </View>
  );
}

/** Respond to their Open Loop, or send interest. They decide; nothing unlocks until they accept. */
function AskSheet({ row, onClose }: { row: DiscoverRow | null; onClose: () => void }) {
  const request = useAfterDark((s) => s.requestVibe);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const loop = !!row?.prompt;

  const close = () => {
    setText('');
    setError(null);
    setSent(null);
    onClose();
  };
  const send = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await request(row.user_id, loop ? 'open_loop' : 'interest', text.trim() || null);
      setSent(row.first_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <DarkSheet
      visible={!!row}
      onClose={close}
      title={sent ? 'Sent' : loop ? `Respond to ${row?.first_name}` : `Send ${row?.first_name} interest`}
      subtitle={sent ? `If ${sent} says yes, your Vibe opens. No yes, no access.` : `${row?.first_name} decides whether to open a Vibe. Nothing else unlocks until they say yes.`}
      testID="ask-sheet"
    >
      {sent ? (
        <DarkButton label="Done" onPress={close} testID="ask-done" />
      ) : (
        <>
          {loop ? (
            <T v="callout" color={ad.muted} style={{ fontStyle: 'italic', marginBottom: 10 }}>
              {`“${row?.prompt}”`}
            </T>
          ) : null}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={loop ? 'Your answer (they’ll see it first)' : 'Add a line (optional)'}
            placeholderTextColor={ad.faint}
            maxLength={200}
            multiline
            style={styles.input}
            accessibilityLabel={loop ? 'Your answer' : 'A line with your interest'}
            testID="ask-text"
          />
          <DarkButton label={loop ? 'Send answer' : 'Send interest'} onPress={send} busy={busy} disabled={loop && !text.trim()} style={{ marginTop: 12 }} testID="ask-send" />
          <ErrorLine text={error} />
        </>
      )}
    </DarkSheet>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, overflow: 'hidden', backgroundColor: ad.card2 },
  bars: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  info: { position: 'absolute', left: 18, right: 18, bottom: 18 },
  intent: { height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(255,46,136,0.85)', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  round: { width: 58, height: 58, borderRadius: 29, backgroundColor: ad.card2, borderWidth: 1, borderColor: ad.lineStrong, alignItems: 'center', justifyContent: 'center' },
  why: { marginTop: 16, padding: 16, borderRadius: 22, backgroundColor: ad.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line },
  whyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ad.pink, marginRight: 10 },
  loop: { marginTop: 12, padding: 16, borderRadius: 22, backgroundColor: ad.plum2, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.pinkLine },
  input: { minHeight: 90, maxHeight: 160, borderRadius: 18, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 16, padding: 14, textAlignVertical: 'top' },
});
