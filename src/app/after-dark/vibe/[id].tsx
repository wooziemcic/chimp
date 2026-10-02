/**
 * Phase 7A: one Vibe — "You + Maya". Its private chat, how it started, its
 * stage and status, and the ways out (Pause / End / Block / Report) are
 * always one tap away. The person who was asked controls what opens.
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft, Ellipsis } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ad } from '@/components/afterdark/v2/adTheme';
import { confirmBlock, ControlsSheet, EndVibeSheet, ReportSheet } from '@/components/afterdark/v2/DisconnectSheets';
import { useDisplayStatus } from '@/components/afterdark/v2/useAdData';
import { VibeChat, type VibeChatHandle } from '@/components/afterdark/v2/VibeChat';
import { ChoiceRow, DarkButton, DarkSheet, ErrorLine, originLine, PairAvatars, StagePill, StatusPill } from '@/components/afterdark/v2/VibeParts';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { firstNameOf, useAfterDark, vibeById } from '@/store/useAfterDark';
import { useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { nudge, vibeStage } from '@/utils/afterDark';

export default function VibeScreen() {
  const { id, keep } = useLocalSearchParams<{ id: string; keep?: string }>();
  const insets = useSafeAreaInsets();
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const activate = useAfterDark((s) => s.activate);
  useEffect(() => {
    if (ageConfirmed) activate();
  }, [ageConfirmed, activate]);
  const v = useAfterDark((s) => vibeById(s, id));
  const loaded = useAfterDark((s) => s.loaded);
  const refresh = useAfterDark((s) => s.refresh);
  const resume = useAfterDark((s) => s.resume);
  const pause = useAfterDark((s) => s.pause);
  const respond = useAfterDark((s) => s.respond);
  const chatReady = useChat((s) => !!s.uid);
  const open = useChat((s) => s.open);
  const close = useChat((s) => s.close);
  const status = useDisplayStatus();
  const chat = useRef<VibeChatHandle>(null);
  const [menu, setMenu] = useState(false);
  const [controls, setControls] = useState(false);
  const [ending, setEnding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cid = v?.conversation_id;

  useEffect(() => {
    if (!cid || !chatReady) return;
    void open(cid).then(() => refresh());
    return () => close(cid);
  }, [cid, chatReady, open, close, refresh]);
  useEffect(() => {
    if (keep && v?.status === 'active') setTimeout(() => chat.current?.openChallenge(), 400);
  }, [keep, v?.status]);

  if (!ageConfirmed) return <Redirect href="/after-dark" />;
  if (!v) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 60, alignItems: 'center' }]}>
        {loaded ? (
          <>
            <T v="headline" color={ad.ink}>
              This Vibe isn’t available
            </T>
            <DarkButton label="Back" small tone="ghost" onPress={() => router.back()} style={{ marginTop: 14 }} />
          </>
        ) : (
          <ActivityIndicator color={ad.pink} />
        )}
      </View>
    );
  }

  const first = firstNameOf(v.other_id);
  const display = status(v);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  // What sits above (or instead of) the composer.
  let banner: React.ReactNode = null;
  if (v.status === 'pending' && v.my_role === 'recipient') {
    banner = (
      <View style={styles.banner} testID="vibe-banner-request">
        <T v="callout" weight="700" color={ad.ink}>{`${first} wants to take it After Dark`}</T>
        <T v="footnote" color={ad.muted} style={{ marginTop: 4 }}>
          Saying yes opens this chat. Photos stay off until you turn them on.
        </T>
        <View style={styles.row}>
          <DarkButton label="Accept" small busy={busy === 'yes'} onPress={() => void run('yes', () => respond(v.vibe_id, true))} style={{ flex: 1 }} testID="vibe-accept" />
          <DarkButton label="Not for me" small tone="ghost" busy={busy === 'no'} onPress={() => void run('no', () => respond(v.vibe_id, false))} style={{ flex: 1 }} testID="vibe-decline" />
        </View>
      </View>
    );
  } else if (v.status === 'pending') {
    banner = <Note text={`Waiting on ${first}. No rush — nothing opens until they say yes.`} testID="vibe-banner-waiting" />;
  } else if (v.status === 'paused') {
    banner = v.paused_by_me ? (
      <View style={styles.banner} testID="vibe-banner-paused">
        <T v="callout" weight="700" color={ad.ink}>
          You paused this Vibe
        </T>
        <T v="footnote" color={ad.muted} style={{ marginTop: 4 }}>{`${first} can’t message here until you pick it back up.`}</T>
        <DarkButton label="Pick it back up" small busy={busy === 'resume'} onPress={() => void run('resume', () => resume(v.vibe_id))} style={{ marginTop: 10 }} testID="vibe-resume" />
      </View>
    ) : (
      <Note text={`${first} paused this Vibe for now.`} testID="vibe-banner-paused" />
    );
  } else if (v.status === 'closed') {
    banner = <Note text={v.expired ? 'This request expired.' : 'This Vibe has ended.'} testID={v.expired ? 'vibe-banner-expired' : 'vibe-banner-ended'} />;
  } else if (display === 'cooling') {
    banner = (
      <View style={styles.banner} testID="vibe-banner-cooling">
        <T v="callout" weight="700" color={ad.warn}>
          It’s been quiet for a while
        </T>
        <View style={styles.row}>
          <DarkButton label="Keep it going" small onPress={() => chat.current?.openChallenge()} style={{ flex: 1 }} testID="vibe-keep" />
          <DarkButton label="Close Vibe" small tone="ghost" onPress={() => setEnding(true)} style={{ flex: 1 }} testID="vibe-close" />
        </View>
      </View>
    );
  }

  const hint = v.status === 'active' && display !== 'cooling' ? nudge(v, first) : undefined;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="vibe-screen">
      <StatusBar style="light" />
      <View style={styles.head}>
        <Tap onPress={() => router.back()} style={styles.icon} accessibilityLabel="Back" testID="vibe-back">
          <ChevronLeft size={24} color="#fff" />
        </Tap>
        <Tap onPress={() => repo.user(v.other_id) && router.push(`/profile/${v.other_id}`)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`You and ${first}`}>
          <PairAvatars otherId={v.other_id} size={34} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T v="headline" color={ad.ink} numberOfLines={1}>{`You + ${first}`}</T>
            <T v="caption" weight="500" color={ad.faint} numberOfLines={1}>
              {originLine(v, first)}
            </T>
          </View>
        </Tap>
        <Tap onPress={() => setMenu(true)} style={styles.icon} accessibilityLabel="Vibe options" testID="vibe-menu">
          <Ellipsis size={22} color="#fff" />
        </Tap>
      </View>
      <View style={styles.pills}>
        <StatusPill status={display} />
        {v.status !== 'pending' ? <StagePill stage={vibeStage(v)} /> : null}
        {hint ? (
          <T v="caption" weight="600" color={ad.muted} numberOfLines={1} style={{ flex: 1, marginLeft: 4 }}>
            {hint}
          </T>
        ) : null}
      </View>
      <ErrorLine text={error} />
      <VibeChat ref={chat} v={v} canSend={v.status === 'active'} banner={banner} />

      <DarkSheet visible={menu} onClose={() => setMenu(false)} title={`You + ${first}`} subtitle="Leaving is always one tap away. You don’t owe anyone an explanation." testID="vibe-options">
        {v.status === 'active' || v.status === 'paused' ? <ChoiceRow label="What they can send you" sub="Photos, view-once photos, voice notes" onPress={() => { setMenu(false); setControls(true); }} testID="opt-controls" /> : null}
        {v.status === 'active' ? <ChoiceRow label="Pause this Vibe" sub={`No messages until you pick it back up. ${first} sees it’s paused.`} onPress={() => { setMenu(false); void run('pause', () => pause(v.vibe_id)); }} testID="opt-pause" /> : null}
        {v.status === 'paused' && v.paused_by_me ? <ChoiceRow label="Pick it back up" onPress={() => { setMenu(false); void run('resume', () => resume(v.vibe_id)); }} testID="opt-resume" /> : null}
        {v.status !== 'closed' ? <ChoiceRow label="End this Vibe" sub="Your reason stays private." onPress={() => { setMenu(false); setEnding(true); }} testID="opt-end" danger /> : null}
        <ChoiceRow label={`Block ${first}`} sub="Ends the Vibe and blocks them everywhere in Chimp." onPress={() => { setMenu(false); confirmBlock(v, () => router.back(), setError); }} testID="opt-block" danger />
        <ChoiceRow label={`Report ${first}`} onPress={() => { setMenu(false); setReporting(true); }} testID="opt-report" danger />
      </DarkSheet>
      <ControlsSheet vibe={controls ? v : null} onClose={() => setControls(false)} />
      <EndVibeSheet vibe={ending ? v : null} onClose={() => setEnding(false)} />
      <ReportSheet personId={reporting ? v.other_id : null} vibeId={v.vibe_id} onClose={() => setReporting(false)} />
    </View>
  );
}

function Note({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.note} testID={testID}>
      <T v="callout" weight="600" color={ad.muted} align="center">
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ad.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingTop: 4, paddingBottom: 6 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ad.line },
  banner: { marginHorizontal: 12, marginBottom: 10, padding: 14, borderRadius: 20, backgroundColor: ad.plum2, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.pinkLine },
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  note: { paddingTop: 14, paddingBottom: 6, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ad.line },
});
