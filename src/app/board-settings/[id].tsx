import { router, useLocalSearchParams } from 'expo-router';
import { Archive, ArchiveRestore, Camera, ChevronRight, Globe, Lock, LogOut, Pin, PinOff, Trash2, UserPlus, Users } from 'lucide-react-native';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorldOwnerMenu } from '@/components/boards/WorldOwnerMenu';
import { Input } from '@/components/create/CreateParts';
import { Img } from '@/components/ui/Img';
import { Button, EmptyState } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { WORLD_CATALOG, catalogCover } from '@/data/worldCatalog';
import { pickImages } from '@/services/backend/media';
import { changeWorldCover, editWorld } from '@/services/create';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useArchives } from '@/store/useArchives';
import { useChimp } from '@/store/useChimp';
import { usePins } from '@/store/usePins';
import { colors, radius } from '@/theme';
import type { Board } from '@/types/models';
import { ACCESS_ORDER, BOARD_ACCESS, type BoardAccess, accessOf } from '@/utils/boardVisibility';

const ACCESS_ICON: Record<BoardAccess, typeof Lock> = { private: Lock, connections: Users, public: Globe };

/**
 * Phase 9.2: Board Settings — the ••• inside a Board (was: the app's global
 * Settings). What you can change depends on your role:
 *   owner   name, description, category, cover, who can see it, delete
 *   admin   members (as before); the rest is shown, not editable
 *   member  pin / archive / leave
 * Permissions are shown as they are today (they follow the Board's
 * visibility); there are no custom per-Board permissions yet.
 */
export default function BoardSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useDataset();
  const board = data.boardMap[id ?? ''];
  if (!board) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Board settings" />
        <EmptyState title="This Board isn’t available" body="It may have been deleted, or you no longer have access." action={<Button label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/boards'))} />} />
      </SafeAreaView>
    );
  }
  return <Settings key={board.id} board={board} />;
}

function Settings({ board }: { board: Board }) {
  const real = repo.mode() === 'real';
  const meId = repo.meId();
  const joinedFlag = useChimp((s) => !!s.joined[board.id]);
  const createdHere = useChimp((s) => !!s.created?.boards.some((b) => b.id === board.id));
  const toggleJoin = useChimp((s) => s.toggleJoin);
  const role = repo.isMe(board.ownerId) ? 'owner' : board.roles?.[meId] ?? (joinedFlag ? 'member' : undefined);
  const canEdit = repo.isMe(board.ownerId) && (real || createdHere);
  const manages = role === 'owner' || role === 'admin';
  const access = accessOf(board);

  useEffect(() => {
    // The Demo keeps its pins and archive on this phone (REAL: loaded by the live layer).
    if (real) return;
    if (usePins.getState().owner !== 'demo') void usePins.getState().load('demo', false);
    if (useArchives.getState().owner !== 'demo') void useArchives.getState().load('demo', false);
  }, [real]);
  const pinned = usePins((s) => !!s.pins[board.id]);
  const pinsSupported = usePins((s) => s.supported);
  const archived = useArchives((s) => !!s.archived[board.id]);
  const archivesSupported = useArchives((s) => s.supported);

  const catalogId = WORLD_CATALOG.find((w) => w.category === board.category && w.themeId === board.themeId)?.id ?? WORLD_CATALOG.find((w) => w.category === board.category)?.id;
  const [title, setTitle] = useState(board.title);
  const [tagline, setTagline] = useState(board.tagline ?? '');
  const [kindOf, setKindOf] = useState(catalogId);
  const dirty = title.trim() !== board.title || tagline.trim() !== (board.tagline ?? '').trim() || kindOf !== catalogId;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    setError(null);
    setSaved(null);
    try {
      await fn();
      if (done) setSaved(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('details', () => editWorld(board, { title, tagline, kindOf: kindOf !== catalogId ? kindOf : undefined }), 'Saved.');
  // Widening who can see it (Private → Connections → Public) shows everything already
  // posted here to more people, so that asks first; narrowing applies at once.
  const [widen, setWiden] = useState<BoardAccess | null>(null);
  const applyAccess = (v: BoardAccess) => {
    setWiden(null);
    void run('visibility', () => editWorld(board, { visibility: v }), `It’s a ${BOARD_ACCESS[v].label} now.`);
  };
  const setAccess = (v: BoardAccess) => {
    if (v === access || busy) return;
    if (ACCESS_ORDER.indexOf(v) > ACCESS_ORDER.indexOf(access)) setWiden(v);
    else applyAccess(v);
  };
  const cover = () =>
    run('cover', async () => {
      const [img] = await pickImages({ source: 'library' });
      if (img) await changeWorldCover(board, img);
    });
  const leave = () =>
    Alert.alert(`Leave ${board.title}?`, access === 'public' ? 'You can join again later.' : 'You’ll need to be added or approved again to come back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          toggleJoin(board.id);
          router.back();
        },
      },
    ]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }} testID="board-settings">
      {canEdit ? <WorldOwnerMenu board={board} open={deleting} onClose={() => setDeleting(false)} confirmOnly /> : null}
      <ScreenHeader title="Board settings" subtitle={board.title} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {error ? (
            <T v="footnote" color={colors.danger} style={{ marginTop: 6 }} testID="board-settings-error">
              {error}
            </T>
          ) : saved ? (
            <T v="footnote" color={colors.success} style={{ marginTop: 6 }} testID="board-settings-saved">
              {saved}
            </T>
          ) : null}

          {/* Board */}
          <Section title="Board">
            {canEdit ? (
              <>
                <Input value={title} onChangeText={setTitle} placeholder="Name" max={60} accessibilityLabel="Board name" testID="board-name" />
                <Input value={tagline} onChangeText={setTagline} placeholder="What’s it for?" max={200} counter multiline accessibilityLabel="Board description" testID="board-description" />
                <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
                  CATEGORY
                </T>
                <View style={styles.chips}>
                  {WORLD_CATALOG.map((w) => {
                    const on = w.id === kindOf;
                    return (
                      <Tap key={w.id} onPress={() => setKindOf(w.id)} style={[styles.chip, on && styles.chipOn]} accessibilityLabel={w.title} accessibilityState={{ selected: on }}>
                        <Img uri={catalogCover(w)} style={{ width: 26, height: 26, borderRadius: 13 }} />
                        <T v="footnote" weight="700" color={on ? colors.accent : colors.ink2} style={{ marginLeft: 6 }}>
                          {w.title}
                        </T>
                      </Tap>
                    );
                  })}
                </View>
                <Row icon={<Img uri={board.cover} style={styles.coverThumb} />} title="Cover" body="Change the photo on the Board and its card" onPress={() => void cover()} busy={busy === 'cover'} trailing={<Camera size={18} color={colors.inkMuted} />} />
                <Button label={busy === 'details' ? 'Saving…' : 'Save changes'} onPress={() => void save()} disabled={!dirty || !!busy} />
              </>
            ) : (
              <>
                <Row title={board.title} body={board.tagline || undefined} />
                <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
                  Only the person who made this Board can change its name, description and cover.
                </T>
              </>
            )}
          </Section>

          {/* Visibility */}
          <Section title="Visibility">
            {(canEdit ? ACCESS_ORDER : [access]).map((v) => {
              const Icon = ACCESS_ICON[v];
              const on = v === access;
              return (
                <Tap
                  key={v}
                  onPress={canEdit ? () => setAccess(v) : undefined}
                  disabled={!canEdit || !!busy}
                  haptic={canEdit ? 'select' : false}
                  style={[styles.option, on && canEdit && styles.optionOn]}
                  accessibilityLabel={`${BOARD_ACCESS[v].label}${on ? ', current' : ''}`}
                  accessibilityState={{ selected: on }}
                  testID={`visibility-${v}`}
                >
                  <Icon size={18} color={colors.accent} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <T v="bodyStrong">{BOARD_ACCESS[v].label}</T>
                    <T v="footnote" color={colors.inkMuted} weight="400">
                      {BOARD_ACCESS[v].body}
                    </T>
                  </View>
                  {canEdit ? busy === 'visibility' && !on ? <ActivityIndicator color={colors.accent} /> : <View style={[styles.radio, on && styles.radioOn]} /> : null}
                </Tap>
              );
            })}
            {widen ? (
              <View style={styles.confirm} testID="visibility-confirm">
                <T v="subhead" weight="700">{`Make it a ${BOARD_ACCESS[widen].label}?`}</T>
                <T v="footnote" color={colors.ink2} weight="400" style={{ marginTop: 4 }}>
                  {widen === 'public'
                    ? 'Everything already posted here — posts, photos, Stories and who’s a member — becomes visible to anyone on Chimp.'
                    : 'Everything already posted here becomes visible to your connections too.'}
                </T>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Button label={`Make it ${BOARD_ACCESS[widen].short}`} onPress={() => applyAccess(widen)} size="sm" style={{ flex: 1 }} />
                  <Button label="Cancel" variant="secondary" onPress={() => setWiden(null)} size="sm" style={{ flex: 1 }} />
                </View>
              </View>
            ) : null}
            {!canEdit ? (
              <T v="footnote" color={colors.inkMuted}>
                Only the person who made this Board can change who can see it.
              </T>
            ) : null}
          </Section>

          {/* Members */}
          <Section title="Members">
            <Row
              icon={<Users size={18} color={colors.ink} />}
              title={manages ? 'Manage members' : 'Members'}
              body={`${board.memberCount} ${board.memberCount === 1 ? 'member' : 'members'}${manages && board.requests?.length ? ` · ${board.requests.length} waiting to join` : ''}`}
              onPress={() => router.push(`/board/${board.id}?tab=people`)}
              testID="board-members"
            />
            {manages ? <Row icon={<UserPlus size={18} color={colors.ink} />} title="Invite people" body="Add your connections from the People tab" onPress={() => router.push(`/board/${board.id}?tab=people`)} /> : null}
          </Section>

          {/* Permissions: what the data model supports today, shown as-is. */}
          <Section title="Permissions">
            <View style={styles.perm}>
              <Perm label="Post" value={access === 'public' ? 'Anyone who can see it' : 'Members, and anyone who can see it'} />
              <Perm label="Add photos" value="Same as posting" />
              <Perm label="Add to Story" value="Same as posting" />
              <Perm label="Invite people" value="Owner and admins" />
              <Perm label="Approve requests" value="Owner and admins" last />
            </View>
            <T v="footnote" color={colors.inkMuted}>
              These follow the Board’s visibility. Custom permissions aren’t available yet.
            </T>
          </Section>

          {/* Organization */}
          <Section title="Organization">
            {pinsSupported ? (
              <Row
                icon={pinned ? <PinOff size={18} color={colors.ink} /> : <Pin size={18} color={colors.ink} />}
                title={pinned ? 'Unpin Board' : 'Pin Board'}
                body={pinned ? 'It leaves the top of your Boards.' : 'Keeps it at the top of your Boards. Pinning doesn’t change who can see it.'}
                onPress={() => void run('pin', () => usePins.getState().toggle(board.id, real))}
                busy={busy === 'pin'}
                testID="board-pin"
              />
            ) : null}
            {role && archivesSupported ? (
              <Row
                icon={archived ? <ArchiveRestore size={18} color={colors.ink} /> : <Archive size={18} color={colors.ink} />}
                title={archived ? 'Unarchive Board' : 'Archive Board'}
                body={archived ? 'Bring it back to your Boards.' : 'Hide it from your Boards (you stay a member). Only you see this.'}
                onPress={() =>
                  void run('archive', async () => {
                    // (REAL: make sure this account's archive is the one being changed.)
                    if (useArchives.getState().owner !== (real ? meId : 'demo')) await useArchives.getState().load(real ? meId : 'demo', real);
                    const on = await useArchives.getState().toggle(board.id, real);
                    // An archived Board leaves your pins too (best effort: the archive is what you asked for).
                    if (on && usePins.getState().pins[board.id]) await usePins.getState().toggle(board.id, real).catch(() => undefined);
                  })
                }
                busy={busy === 'archive'}
                testID="board-archive"
              />
            ) : null}
          </Section>

          {/* Danger zone */}
          {role ? (
            <Section title="Danger zone">
              {role !== 'owner' ? <Row icon={<LogOut size={18} color={colors.danger} />} title="Leave Board" danger onPress={leave} testID="board-leave" /> : null}
              {canEdit ? <Row icon={<Trash2 size={18} color={colors.danger} />} title="Delete Board" body="Permanently remove it for everyone" danger onPress={() => setDeleting(true)} testID="world-delete" /> : null}
              {role === 'owner' && !canEdit ? (
                <T v="footnote" color={colors.inkMuted}>
                  You own this Board.
                </T>
              ) : null}
            </Section>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 22 }}>
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        {title.toUpperCase()}
      </T>
      {children}
    </View>
  );
}

function Row({ icon, title, body, onPress, trailing, busy, danger, testID }: { icon?: ReactNode; title: string; body?: string; onPress?: () => void; trailing?: ReactNode; busy?: boolean; danger?: boolean; testID?: string }) {
  return (
    <Tap onPress={onPress} disabled={!onPress || busy} scaleTo={onPress ? 0.985 : 1} style={styles.option} accessibilityLabel={title} testID={testID}>
      {icon}
      <View style={{ flex: 1, marginLeft: icon ? 12 : 0 }}>
        <T v="bodyStrong" color={danger ? colors.danger : colors.ink}>
          {title}
        </T>
        {body ? (
          <T v="footnote" color={colors.inkMuted} weight="400">
            {body}
          </T>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={colors.accent} /> : trailing ?? (onPress && !danger ? <ChevronRight size={18} color={colors.inkFaint} /> : null)}
    </Tap>
  );
}

function Perm({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.permRow, !last && styles.permLine]}>
      <T v="subhead" weight="600" style={{ flex: 1 }}>
        {label}
      </T>
      <T v="footnote" color={colors.inkMuted} style={{ flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
  optionOn: { borderColor: colors.accent, backgroundColor: '#F7FAFF' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.lineStrong },
  radioOn: { borderColor: colors.accent, borderWidth: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingLeft: 3, paddingRight: 12, borderRadius: 17, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  coverThumb: { width: 36, height: 36, borderRadius: 8 },
  confirm: { padding: 14, borderRadius: radius.lg, backgroundColor: '#FFF8EC', borderWidth: 1, borderColor: '#F5D9A8', marginBottom: 8 },
  perm: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, marginBottom: 8 },
  permRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46 },
  permLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
});
