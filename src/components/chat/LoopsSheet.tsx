import { router } from 'expo-router';
import { Calendar, ChevronLeft, Globe2, MapPin, Repeat } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segmented } from '@/components/ui/Segmented';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { LoopPatch, LoopRow } from '@/services/backend/chat';
import { repo } from '@/services/repository';
import { chatUser, useChat } from '@/store/useChat';
import { colors, radius } from '@/theme';
import { dayText, isoDay } from '@/utils/messaging';
import { pushOnce } from '@/utils/nav';

const NO_LOOPS: LoopRow[] = [];

/** What the sheet is showing: the list, one loop, or a new one (from a message or a Ping match). */
export type LoopsView = { mode: 'list' } | { mode: 'edit'; id: string } | { mode: 'new'; title: string; sourceMessageId?: string | null; note?: string };

interface Props {
  conversationId: string;
  view: LoopsView | null;
  onView: (v: LoopsView | null) => void;
  /** Can I delete anyone's loop here (group owner/admin)? */
  moderator: boolean;
}

/**
 * Open Loops in a chat: things someone wants to come back to (a dinner, a
 * trip, a call). Everyone in the chat can see, edit, date, place and resolve
 * them. Deliberately not a task manager: a title, a note, a day, a place.
 */
export function LoopsSheet({ conversationId, view, onView, moderator }: Props) {
  const insets = useSafeAreaInsets();
  const loops = useChat((s) => s.extras[conversationId]?.loops) ?? NO_LOOPS;
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const list = useMemo(() => loops.filter((l) => l.status === tab).sort((a, b) => (tab === 'open' ? b.created_at.localeCompare(a.created_at) : (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))), [loops, tab]);
  const open = loops.filter((l) => l.status === 'open').length;
  const close = () => onView(null);

  return (
    <Modal visible={!!view} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close Open Loops">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
            <View style={styles.grabber} />
            {view?.mode === 'list' ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <Repeat size={18} color={colors.accent} />
                  <T v="title3" style={{ marginLeft: 8, flex: 1 }}>
                    Open Loops
                  </T>
                </View>
                <Segmented
                  value={tab}
                  onChange={setTab}
                  options={[
                    { id: 'open', label: `Open (${open})` },
                    { id: 'resolved', label: `Resolved (${loops.length - open})` },
                  ]}
                />
                <ScrollView style={{ maxHeight: 420, marginTop: 8 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  {list.length === 0 ? (
                    <T v="subhead" color={colors.inkMuted} weight="400" align="center" style={{ paddingVertical: 28, paddingHorizontal: 20 }}>
                      {tab === 'open' ? 'Nothing open. Long-press any message and choose “Turn into Open Loop”.' : 'Nothing resolved yet.'}
                    </T>
                  ) : (
                    list.map((l) => <LoopRowView key={l.id} l={l} onPress={() => onView({ mode: 'edit', id: l.id })} />)
                  )}
                </ScrollView>
              </>
            ) : view ? (
              // Keyed on the loop's version: if someone else edits it while it's open, you see theirs.
              <LoopEditor key={view.mode === 'edit' ? `${view.id}:${loops.find((l) => l.id === view.id)?.updated_at ?? ''}` : 'new'} conversationId={conversationId} view={view} moderator={moderator} onBack={() => onView({ mode: 'list' })} onClose={close} />
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LoopRowView({ l, onPress }: { l: LoopRow; onPress: () => void }) {
  const meta = [dayText(l.target_date), l.location_text, l.board_id ? 'World' : undefined].filter(Boolean).join(' · ');
  return (
    <Tap onPress={onPress} scaleTo={0.985} style={styles.loopRow} accessibilityLabel={`Open Loop ${l.title}`}>
      <View style={[styles.loopDot, l.status === 'resolved' && { backgroundColor: colors.success }]} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <T v="bodyStrong" numberOfLines={1} style={l.status === 'resolved' ? { color: colors.inkMuted } : null}>
          {l.title}
        </T>
        {meta || l.note ? (
          <T v="footnote" color={colors.inkMuted} weight="400" numberOfLines={1}>
            {meta || l.note}
          </T>
        ) : null}
      </View>
    </Tap>
  );
}

const nextSaturday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d;
};
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

function LoopEditor({ conversationId, view, moderator, onBack, onClose }: { conversationId: string; view: Exclude<LoopsView, { mode: 'list' }>; moderator: boolean; onBack: () => void; onClose: () => void }) {
  const uid = useChat((s) => s.uid);
  const existing = useChat((s) => (view.mode === 'edit' ? s.extras[conversationId]?.loops.find((l) => l.id === view.id) : undefined));
  const createLoop = useChat((s) => s.createLoop);
  const updateLoop = useChat((s) => s.updateLoop);
  const deleteLoop = useChat((s) => s.deleteLoop);
  const [title, setTitle] = useState(view.mode === 'new' ? view.title : existing?.title ?? '');
  const [note, setNote] = useState(view.mode === 'new' ? view.note ?? '' : existing?.note ?? '');
  const [date, setDate] = useState<string | null>(existing?.target_date ?? null);
  const [place, setPlace] = useState(existing?.location_text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (view.mode === 'edit' && !existing) {
    return (
      <View style={{ paddingVertical: 30 }}>
        <T v="subhead" color={colors.inkMuted} align="center">
          This Open Loop was deleted.
        </T>
        <Tap onPress={onBack} style={[styles.big, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Back to Open Loops">
          <T v="bodyStrong" color={colors.ink2}>
            Back
          </T>
        </Tap>
      </View>
    );
  }

  const patch: LoopPatch = { title: title.trim(), note: note.trim() || null, target_date: date, location_text: place.trim() || null };
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBusy(false);
      after?.();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = () =>
    run(async () => {
      if (view.mode === 'new') await createLoop(conversationId, patch.title!, view.sourceMessageId ?? null, { note: patch.note, target_date: patch.target_date, location_text: patch.location_text });
      else await updateLoop(conversationId, existing!.id, patch);
    }, onBack);
  const canDelete = !!existing && (existing.created_by === uid || moderator);
  const board = existing?.board_id ? repo.board(existing.board_id) : undefined;
  const creator = existing?.created_by ? (existing.created_by === uid ? 'you' : chatUser(existing.created_by)?.displayName.split(' ')[0]) : undefined;

  const createWorld = () => {
    if (!existing) return;
    const q = `title=${encodeURIComponent(existing.title)}&visibility=private&loop=${existing.id}&cid=${conversationId}`;
    onClose();
    setTimeout(() => pushOnce(`/create/world?${q}`), 250);
  };

  const chips: { label: string; value: string | null }[] = [
    { label: 'Today', value: isoDay(new Date()) },
    { label: 'Tomorrow', value: isoDay(plusDays(1)) },
    { label: 'Weekend', value: isoDay(nextSaturday()) },
    { label: 'Next week', value: isoDay(plusDays(7)) },
  ];

  return (
    <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Tap onPress={onBack} style={styles.back} accessibilityLabel="Back to Open Loops">
          <ChevronLeft size={20} color={colors.ink} />
        </Tap>
        <T v="title3" style={{ flex: 1 }}>
          {view.mode === 'new' ? 'New Open Loop' : existing?.status === 'resolved' ? 'Resolved' : 'Open Loop'}
        </T>
      </View>
      {creator ? (
        <T v="caption" color={colors.inkFaint} style={{ marginBottom: 6 }}>{`Started by ${creator}`}</T>
      ) : null}
      <TextInput value={title} onChangeText={setTitle} placeholder="What’s the loop? (e.g. Boston dinner)" placeholderTextColor={colors.inkFaint} maxLength={120} style={styles.input} accessibilityLabel="Loop title" />
      <TextInput value={note} onChangeText={setNote} placeholder="A note (optional)" placeholderTextColor={colors.inkFaint} maxLength={1000} multiline style={[styles.input, { height: 70, paddingTop: 12 }]} accessibilityLabel="Loop note" />
      <View style={styles.fieldHead}>
        <Calendar size={14} color={colors.inkFaint} />
        <T v="label" color={colors.inkFaint} style={{ marginLeft: 6 }}>
          {date ? `WHEN · ${dayText(date)?.toUpperCase()}` : 'WHEN'}
        </T>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chips.map((c) => {
          const on = c.value === date;
          return (
            <Tap key={c.label} onPress={() => setDate(on ? null : c.value)} style={[styles.chip, on && styles.chipOn]} accessibilityLabel={`${c.label}${on ? ', selected' : ''}`}>
              <T v="footnote" weight="700" color={on ? colors.accent : colors.ink2}>
                {c.label}
              </T>
            </Tap>
          );
        })}
      </View>
      <View style={styles.fieldHead}>
        <MapPin size={14} color={colors.inkFaint} />
        <T v="label" color={colors.inkFaint} style={{ marginLeft: 6 }}>
          WHERE
        </T>
      </View>
      <TextInput value={place} onChangeText={setPlace} placeholder="A place (optional)" placeholderTextColor={colors.inkFaint} maxLength={120} style={styles.input} accessibilityLabel="Loop location" />
      {error ? (
        <T v="footnote" color={colors.danger} style={{ marginTop: 8 }}>
          {error}
        </T>
      ) : null}
      <Tap onPress={() => void save()} disabled={busy || !title.trim()} style={[styles.big, { backgroundColor: colors.accent }, (busy || !title.trim()) && { opacity: 0.45 }]} accessibilityLabel={view.mode === 'new' ? 'Create Open Loop' : 'Save Open Loop'}>
        {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>{view.mode === 'new' ? 'Create Open Loop' : 'Save'}</T>}
      </Tap>
      {existing ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Tap
            onPress={() => void run(() => updateLoop(conversationId, existing.id, { ...patch, status: existing.status === 'open' ? 'resolved' : 'open' }), onBack)}
            disabled={busy}
            style={[styles.half, { backgroundColor: existing.status === 'open' ? '#E7F8EF' : colors.surfaceMuted }]}
            accessibilityLabel={existing.status === 'open' ? 'Resolve' : 'Reopen'}
          >
            <T v="subhead" weight="700" color={existing.status === 'open' ? colors.success : colors.ink2}>
              {existing.status === 'open' ? '✓ Resolve' : 'Reopen'}
            </T>
          </Tap>
          <Tap
            onPress={() => (existing.board_id ? (onClose(), setTimeout(() => pushOnce(`/board/${existing.board_id}`), 250)) : createWorld())}
            disabled={busy}
            style={[styles.half, { backgroundColor: colors.accentSoft }]}
            accessibilityLabel={existing.board_id ? 'Open World' : 'Create World'}
          >
            <Globe2 size={15} color={colors.accent} />
            <T v="subhead" weight="700" color={colors.accent} style={{ marginLeft: 6 }} numberOfLines={1}>
              {existing.board_id ? board?.title ?? 'Open World' : 'Create World'}
            </T>
          </Tap>
        </View>
      ) : null}
      {canDelete ? (
        confirmDelete ? (
          <View style={{ marginTop: 10 }}>
            <T v="footnote" color={colors.inkMuted} weight="400">
              Delete it for everyone in this chat?
            </T>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Tap onPress={() => void run(() => deleteLoop(conversationId, existing!.id), onBack)} style={[styles.half, { backgroundColor: colors.danger }]} accessibilityLabel="Confirm delete Open Loop">
                <T v="subhead" weight="700" color={colors.white}>
                  Delete
                </T>
              </Tap>
              <Tap onPress={() => setConfirmDelete(false)} style={[styles.half, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Keep it">
                <T v="subhead" weight="700" color={colors.ink2}>
                  Keep it
                </T>
              </Tap>
            </View>
          </View>
        ) : (
          <Tap onPress={() => setConfirmDelete(true)} style={{ alignSelf: 'center', marginTop: 12, padding: 8 }} accessibilityLabel="Delete Open Loop">
            <T v="footnote" weight="700" color={colors.danger}>
              Delete Open Loop
            </T>
          </Tap>
        )
      ) : null}
      {existing && !existing.board_id ? (
        <T v="caption" color={colors.inkFaint} align="center" style={{ marginTop: 8 }}>
          Create World makes a private World you own. You choose who to add.
        </T>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8, width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: 12 },
  loopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  loopDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  back: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 6, backgroundColor: colors.surfaceMuted },
  input: { height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, fontSize: 16, color: colors.ink, marginTop: 8 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  half: { flex: 1, flexDirection: 'row', height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});

/** Where "Create World" goes after the World exists: link it, then add people. */
export async function linkLoopToWorld(conversationId: string, loopId: string, boardId: string) {
  try {
    await useChat.getState().updateLoop(conversationId, loopId, { board_id: boardId });
  } catch {
    // The World exists either way; the link is a convenience.
  }
  router.replace(`/board/${boardId}?tab=people`);
}
