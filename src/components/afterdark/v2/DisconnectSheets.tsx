/**
 * Phase 7A: leaving well. Every Vibe offers Pause / End / Block / Report.
 * Your reason for ending is private; the other person only ever sees
 * "This Vibe has ended." Nothing can be sent after that.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, Switch, TextInput, View } from 'react-native';

import { T } from '@/components/ui/Text';
import type { EndReason, ReportReason, VibeRow } from '@/services/backend/afterDark';
import { userMessage } from '@/services/backend/errors';
import { firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { END_REASONS, REPORT_REASONS } from '@/utils/afterDark';
import { ad } from './adTheme';
import { ChoiceRow, DarkButton, DarkSheet, ErrorLine } from './VibeParts';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function EndVibeSheet({ vibe, onClose, onEnded }: { vibe: VibeRow | null; onClose: () => void; onEnded?: () => void }) {
  const end = useAfterDark((s) => s.end);
  const [reason, setReason] = useState<EndReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = firstNameOf(vibe?.other_id);
  const close = () => {
    setReason(null);
    setNote('');
    setError(null);
    onClose();
  };
  const go = async () => {
    if (!vibe || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await end(vibe.vibe_id, reason, note);
      close();
      onEnded?.();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  return (
    <DarkSheet visible={!!vibe} onClose={close} title={`End your Vibe with ${first}?`} subtitle={`${first} will only see “This Vibe has ended.” Your reason stays private. Neither of you can message here after this.`} testID="end-sheet">
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        <T v="eyebrow" color={ad.faint} style={{ marginBottom: 8 }}>
          WHY? (ONLY YOU SEE THIS)
        </T>
        {END_REASONS.map((r) => (
          <ChoiceRow key={r.id} label={r.label} selected={reason === r.id} onPress={() => setReason(r.id)} testID={`end-reason-${r.id}`} />
        ))}
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="A note for yourself (optional)"
          placeholderTextColor={ad.faint}
          maxLength={280}
          style={{ minHeight: 48, borderRadius: 16, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginTop: 4 }}
          accessibilityLabel="Private note"
        />
      </ScrollView>
      <DarkButton label="End Vibe" tone="danger" onPress={go} busy={busy} disabled={!reason} style={{ marginTop: 14 }} testID="end-confirm" />
      <ErrorLine text={error} />
    </DarkSheet>
  );
}

export function ReportSheet({ personId, vibeId, onClose }: { personId: string | null; vibeId?: string; onClose: () => void }) {
  const report = useAfterDark((s) => s.report);
  const block = useAfterDark((s) => s.block);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const first = firstNameOf(personId);
  const close = () => {
    setReason(null);
    setNote('');
    setDone(false);
    setError(null);
    onClose();
  };
  const go = async () => {
    if (!personId || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await report(personId, reason, note, vibeId);
      if (alsoBlock && vibeId) await block(vibeId);
      setDone(true);
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  return (
    <DarkSheet visible={!!personId} onClose={close} title={done ? 'Thanks for telling us' : `Report ${first}`} subtitle={done ? 'We’ll review it. Reports are confidential: they aren’t told who reported them.' : `${first} isn’t told you reported them.`} testID="report-sheet">
      {done ? (
        <DarkButton
          label="Done"
          onPress={() => {
            close();
            if (alsoBlock && vibeId) router.back();
          }}
          testID="report-done"
        />
      ) : (
        <>
          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            {REPORT_REASONS.map((r) => (
              <ChoiceRow key={r.id} label={r.label} selected={reason === r.id} onPress={() => setReason(r.id)} testID={`report-reason-${r.id}`} />
            ))}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What happened? (optional)"
              placeholderTextColor={ad.faint}
              maxLength={500}
              multiline
              style={{ minHeight: 70, borderRadius: 16, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 15, padding: 14, textAlignVertical: 'top' }}
              accessibilityLabel="Details"
            />
            {vibeId ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <T v="callout" color={ad.ink} style={{ flex: 1 }}>{`Also block ${first} and end this Vibe`}</T>
                <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: ad.pink, false: ad.raised }} thumbColor={Platform.OS === 'android' ? '#fff' : undefined} accessibilityLabel="Also block" />
              </View>
            ) : null}
          </ScrollView>
          <DarkButton label="Send report" onPress={go} busy={busy} disabled={!reason} style={{ marginTop: 14 }} testID="report-send" />
          <ErrorLine text={error} />
        </>
      )}
    </DarkSheet>
  );
}

/** Block from a Vibe: ends it and blocks them everywhere in Chimp. */
export function confirmBlock(vibe: VibeRow, onDone: () => void, onError: (m: string) => void) {
  const first = firstNameOf(vibe.other_id);
  const run = () => {
    void useAfterDark
      .getState()
      .block(vibe.vibe_id)
      .then(onDone)
      .catch((e) => onError(errText(e)));
  };
  if (Platform.OS === 'web') {
    run();
    return;
  }
  Alert.alert(`Block ${first}?`, `This ends your Vibe and blocks ${first} everywhere in Chimp. They aren’t told.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block', style: 'destructive', onPress: run },
  ]);
}

/** What the other person may send YOU in this Vibe. Yours to change any time. */
export function ControlsSheet({ vibe, onClose }: { vibe: VibeRow | null; onClose: () => void }) {
  const setControls = useAfterDark((s) => s.setControls);
  const [error, setError] = useState<string | null>(null);
  const first = firstNameOf(vibe?.other_id);
  const flip = (patch: { photos?: boolean; voice?: boolean }) => {
    if (!vibe) return;
    setError(null);
    void setControls(vibe.vibe_id, patch).catch((e) => setError(userMessage(e, 'Couldn’t save that. Try again.')));
  };
  return (
    <DarkSheet visible={!!vibe} onClose={onClose} title={`What ${first} can send you`} subtitle="Your call, any time. Turning something off stops new ones; nothing already sent changes." testID="controls-sheet">
      {vibe ? (
        <>
          <ControlRow label="Photos" sub="Including view-once photos" value={vibe.my_allows_photos} onChange={(v) => flip({ photos: v })} testID="allow-photos" />
          <ControlRow label="Voice notes" value={vibe.my_allows_voice} onChange={(v) => flip({ voice: v })} testID="allow-voice" />
          <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 8 }}>
            {`Each of you decides what you receive. ${first} ${vibe.their_allows_photos ? 'lets you send photos' : 'hasn’t enabled photos from you yet'}${vibe.their_allows_voice ? ' and voice notes' : vibe.their_allows_photos ? ', not voice notes' : ' or voice notes'}.`}
          </T>
          <ErrorLine text={error} />
          <DarkButton label="Done" tone="soft" onPress={onClose} style={{ marginTop: 14 }} />
        </>
      ) : null}
    </DarkSheet>
  );
}

function ControlRow({ label, sub, value, onChange, testID }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: ad.line }}>
      <View style={{ flex: 1 }}>
        <T v="callout" weight="600" color={ad.ink}>
          {label}
        </T>
        {sub ? (
          <T v="caption" weight="500" color={ad.faint}>
            {sub}
          </T>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: ad.pink, false: ad.raised }} thumbColor={Platform.OS === 'android' ? '#fff' : undefined} accessibilityLabel={`Allow ${label.toLowerCase()}`} testID={testID} />
    </View>
  );
}
