/**
 * Phase 7A: Plans — private to the two people in a Vibe, never public.
 * A Plan is an Open Loop with a plan state: Open → Proposed → Confirmed
 * (only the OTHER person confirms) → Completed; Paused / Closed any time.
 * Accept · Tweak · Pause · Close.
 */
import { CalendarClock, Check, MapPin, Pause, Play, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { T } from '@/components/ui/Text';
import { Tap } from '@/components/ui/Tap';
import { useTabBarSpace } from '@/hooks/useLayout';
import type { VibeRow } from '@/services/backend/afterDark';
import type { LoopPatch, LoopRow } from '@/services/backend/chat';
import { firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { useChat } from '@/store/useChat';
import { PLAN_LABEL, planWhen } from '@/utils/afterDark';
import { layout } from '@/theme';
import { ad } from './adTheme';
import { DarkButton, DarkSheet, EmptyNote, ErrorLine, SectionLabel } from './VibeParts';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PlansTab() {
  const tabSpace = useTabBarSpace();
  const vibes = useAfterDark((s) => s.vibes);
  const loops = useAfterDark((s) => s.loops);
  const [tweak, setTweak] = useState<{ loop: LoopRow; v: VibeRow } | null>(null);
  const byConv = new Map(vibes.map((v) => [v.conversation_id, v]));
  const mine = loops.filter((l) => byConv.has(l.conversation_id));
  const live = (l: LoopRow) => byConv.get(l.conversation_id)?.status === 'active';
  const plans = mine.filter((l) => l.plan_state && ['proposed', 'confirmed', 'paused'].includes(l.plan_state) && live(l));
  const open = mine.filter((l) => !l.plan_state && l.status === 'open' && live(l));
  const done = mine.filter((l) => l.plan_state === 'completed' || l.plan_state === 'closed');

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: tabSpace }} showsVerticalScrollIndicator={false} testID="plans-tab">
        <SectionLabel first>Plans</SectionLabel>
        {plans.length ? (
          plans.map((l) => <PlanCard key={l.id} loop={l} v={byConv.get(l.conversation_id)!} onTweak={(loop, v) => setTweak({ loop, v })} />)
        ) : (
          <EmptyNote title="No plans yet" body="Turn an Open Loop into a private plan you both agree on." testID="plans-empty" />
        )}
        {open.length ? (
          <>
            <SectionLabel>Open Loops</SectionLabel>
            {open.map((l) => (
              <PlanCard key={l.id} loop={l} v={byConv.get(l.conversation_id)!} onTweak={(loop, v) => setTweak({ loop, v })} />
            ))}
          </>
        ) : null}
        {done.length ? (
          <>
            <SectionLabel>Done</SectionLabel>
            {done.map((l) => (
              <PlanCard key={l.id} loop={l} v={byConv.get(l.conversation_id)!} onTweak={() => undefined} />
            ))}
          </>
        ) : null}
      </ScrollView>
      <PlanSheet target={tweak} onClose={() => setTweak(null)} />
    </>
  );
}

/** One Open Loop or Plan, with the actions that are open to me right now. */
export function PlanCard({ loop: l, v, onTweak, compact }: { loop: LoopRow; v: VibeRow; onTweak: (l: LoopRow, v: VibeRow) => void; compact?: boolean }) {
  const update = useChat((s) => s.updateLoop);
  const refreshLoops = useAfterDark((s) => s.refreshLoops);
  const uid = useAfterDark((s) => s.uid);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = firstNameOf(v.other_id);
  const state = l.plan_state;
  const active = v.status === 'active';
  const act = async (key: string, patch: LoopPatch) => {
    setBusy(key);
    setError(null);
    try {
      await update(v.conversation_id, l.id, patch);
      await refreshLoops();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };
  const when = planWhen(l.plan_at);
  const theirs = state === 'proposed' && l.plan_by && l.plan_by !== uid;
  const tone = state === 'confirmed' ? ad.ok : state === 'proposed' ? ad.pink : ad.faint;
  const label = !state ? 'Open Loop' : state === 'proposed' ? (theirs ? `${first} proposed` : `Waiting on ${first}`) : PLAN_LABEL[state];

  return (
    <View style={[styles.card, theirs && { borderColor: ad.pinkLine }]} testID={`plan-${l.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T v="caption" weight="800" color={tone} style={{ flex: 1 }}>
          {label.toUpperCase()}
        </T>
        {!compact ? (
          <T v="caption" weight="600" color={ad.faint}>
            {`You + ${first}`}
          </T>
        ) : null}
      </View>
      <T v="headline" color={ad.ink} style={{ marginTop: 6 }}>
        {l.title}
      </T>
      {when || l.location_text ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {when ? (
            <View style={styles.meta}>
              <CalendarClock size={14} color={ad.muted} />
              <T v="footnote" color={ad.muted} style={{ marginLeft: 5 }}>
                {when}
              </T>
            </View>
          ) : null}
          {l.location_text ? (
            <View style={styles.meta}>
              <MapPin size={14} color={ad.muted} />
              <T v="footnote" color={ad.muted} style={{ marginLeft: 5 }}>
                {l.location_text}
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
      {active && state !== 'completed' && state !== 'closed' ? (
        <View style={styles.actions}>
          {!state ? (
            <>
              <DarkButton label="Make it a plan" small onPress={() => onTweak(l, v)} style={{ flex: 1 }} testID={`plan-make-${l.id}`} />
              <DarkButton label="Close" small tone="ghost" busy={busy === 'close'} onPress={() => void act('close', { status: 'resolved' })} testID={`plan-close-${l.id}`} />
            </>
          ) : null}
          {theirs ? <DarkButton label="Accept" small icon={<Check size={14} color="#fff" />} busy={busy === 'accept'} onPress={() => void act('accept', { plan_state: 'confirmed' })} style={{ flex: 1 }} testID={`plan-accept-${l.id}`} /> : null}
          {state === 'confirmed' ? <DarkButton label="We did it" small icon={<Check size={14} color="#fff" />} busy={busy === 'done'} onPress={() => void act('done', { plan_state: 'completed', status: 'resolved' })} style={{ flex: 1 }} testID={`plan-done-${l.id}`} /> : null}
          {state === 'paused' ? <DarkButton label="Pick it up" small icon={<Play size={14} color="#fff" />} busy={busy === 'resume'} onPress={() => void act('resume', { plan_state: 'proposed' })} style={{ flex: 1 }} testID={`plan-resume-${l.id}`} /> : null}
          {state ? (
            <>
              <DarkButton label="Tweak" small tone="ghost" onPress={() => onTweak(l, v)} testID={`plan-tweak-${l.id}`} />
              {state !== 'paused' ? <IconAction label="Pause plan" onPress={() => void act('pause', { plan_state: 'paused' })} busy={busy === 'pause'} icon={<Pause size={16} color={ad.ink} />} testID={`plan-pause-${l.id}`} /> : null}
              <IconAction label="Close plan" onPress={() => void act('close', { plan_state: 'closed', status: 'resolved' })} busy={busy === 'close'} icon={<X size={16} color={ad.ink} />} testID={`plan-close-${l.id}`} />
            </>
          ) : null}
        </View>
      ) : null}
      <ErrorLine text={error} />
    </View>
  );
}

function IconAction({ label, onPress, icon, busy, testID }: { label: string; onPress: () => void; icon: React.ReactNode; busy?: boolean; testID?: string }) {
  return (
    <Tap onPress={onPress} disabled={busy} style={[styles.icon, busy && { opacity: 0.5 }]} accessibilityLabel={label} testID={testID}>
      {icon}
    </Tap>
  );
}

// ─── Propose / tweak ───────────────────────────────────────────────────────

function at(daysAhead: number, h: number, m: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(h, m, 0, 0);
  return d;
}
function nextWeekday(day: number, h: number, m: number): Date {
  const d = new Date();
  const ahead = (day - d.getDay() + 7) % 7 || 7;
  return at(ahead, h, m);
}
const WHEN_OPTIONS = () => [
  { label: 'Tonight, 8 PM', at: at(0, 20, 0) },
  { label: 'Tomorrow, 7:30 PM', at: at(1, 19, 30) },
  { label: 'Friday, 8 PM', at: nextWeekday(5, 20, 0) },
  { label: 'Saturday, 1 PM', at: nextWeekday(6, 13, 0) },
  { label: 'Sunday, 11 AM', at: nextWeekday(0, 11, 0) },
].filter((o) => o.at.getTime() > Date.now());

/**
 * Propose a plan from an Open Loop, or change one. Whoever proposes or
 * changes it waits for the OTHER person's yes. Place stays broad (a
 * neighbourhood or a venue name), never a live location.
 */
export function PlanSheet({ target, onClose, create }: { target: { loop: LoopRow; v: VibeRow } | null; onClose: () => void; create?: { v: VibeRow; title?: string; sourceMessageId?: string | null } | null }) {
  const update = useChat((s) => s.updateLoop);
  const createLoop = useChat((s) => s.createLoop);
  const refreshLoops = useAfterDark((s) => s.refreshLoops);
  const refresh = useAfterDark((s) => s.refresh);
  const l = target?.loop;
  const v = target?.v ?? create?.v;
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [when, setWhen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = l?.id ?? (create ? `new:${create.title ?? ''}` : null);
  if (key && seeded !== key) {
    setSeeded(key);
    setTitle(l?.title ?? create?.title ?? '');
    setPlace(l?.location_text ?? '');
    setWhen(l?.plan_at ?? null);
  }
  const close = () => {
    setSeeded(null);
    setError(null);
    onClose();
  };
  const options = WHEN_OPTIONS();
  const go = async () => {
    if (!v || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const patch: LoopPatch = { title: title.trim(), location_text: place.trim() || null, plan_at: when, plan_state: 'proposed' };
      if (l) await update(v.conversation_id, l.id, patch);
      else await createLoop(v.conversation_id, title.trim(), create?.sourceMessageId ?? null, patch);
      await Promise.all([refreshLoops(), refresh()]);
      close();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  const first = firstNameOf(v?.other_id);
  return (
    <DarkSheet visible={!!target || !!create} onClose={close} title={l?.plan_state ? 'Tweak the plan' : 'Make it a plan'} subtitle={`Only you and ${first} see it. ${first} confirms it; change anything later and it goes back to ${first} for a yes.`} testID="plan-sheet">
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
        <TextInput value={title} onChangeText={setTitle} placeholder="What’s the plan?" placeholderTextColor={ad.faint} maxLength={120} style={styles.input} accessibilityLabel="Plan" testID="plan-title" />
        <T v="subhead" weight="700" color={ad.muted} style={{ marginTop: 14, marginBottom: 8 }}>
          When
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {when && !options.some((o) => o.at.toISOString() === when) ? <Pill label={planWhen(when) ?? 'Current time'} on onPress={() => undefined} /> : null}
          {options.map((o) => (
            <Pill key={o.label} label={o.label} on={when === o.at.toISOString()} onPress={() => setWhen(o.at.toISOString())} testID={`plan-when-${o.label.split(',')[0].toLowerCase()}`} />
          ))}
        </View>
        <T v="subhead" weight="700" color={ad.muted} style={{ marginTop: 14, marginBottom: 8 }}>
          Where
        </T>
        <TextInput value={place} onChangeText={setPlace} placeholder="A neighbourhood or a place (no exact address)" placeholderTextColor={ad.faint} maxLength={80} style={styles.input} accessibilityLabel="Where" testID="plan-place" />
      </ScrollView>
      <DarkButton label={`Send to ${first}`} onPress={go} busy={busy} disabled={!title.trim()} style={{ marginTop: 14 }} testID="plan-send" />
      <ErrorLine text={error} />
    </DarkSheet>
  );
}

function Pill({ label, on, onPress, testID }: { label: string; on?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Tap onPress={onPress} style={[styles.pill, on && { backgroundColor: ad.pinkSoft, borderColor: ad.pink }]} accessibilityState={{ selected: on }} accessibilityLabel={label} testID={testID}>
      <T v="footnote" weight="700" color={on ? '#FFB3D3' : ad.muted}>
        {label}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 20, backgroundColor: ad.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line, marginBottom: 10 },
  meta: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  icon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: ad.lineStrong, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: 16, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  pill: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: ad.line, justifyContent: 'center' },
});
