import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronRight, Globe2, LogOut, Pencil, Repeat, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoopsSheet, type LoopsView } from '@/components/chat/LoopsSheet';
import { useSharedWorlds } from '@/components/chat/useGroupChemistry';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Button, EmptyState } from '@/components/ui/misc';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { MemberRow } from '@/services/backend/chat';
import { pickImages } from '@/services/backend/media';
import { chatUser, EMPTY_EXTRAS, useChat } from '@/store/useChat';
import { colors, radius } from '@/theme';
import { pushOnce } from '@/utils/nav';

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 } as const;

/** Who takes over if the owner leaves: the longest-standing admin, else the longest-standing member (same rule as the server). */
function nextOwner(members: MemberRow[], me: string | undefined) {
  const others = members.filter((m) => m.user_id !== me && m.status === 'active');
  return [...others].sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || a.joined_at.localeCompare(b.joined_at))[0];
}

/**
 * Group Info: name, photo, members and roles, shared Worlds, Open Loops,
 * leave. Owner: rename, photo, add/remove people, make/unmake admins, delete.
 * Admins: rename, photo, add people, remove members. Everyone: view + leave.
 * Every change is checked by the server; this only offers what it allows.
 */
export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const uid = useChat((s) => s.uid);
  const c = useChat((s) => s.conversations[id]);
  const extras = useChat((s) => s.extras[id]) ?? EMPTY_EXTRAS;
  useChat((s) => s.people);
  const loadExtras = useChat((s) => s.loadExtras);
  const renameGroup = useChat((s) => s.renameGroup);
  const setGroupPhoto = useChat((s) => s.setGroupPhoto);
  const removeMember = useChat((s) => s.removeMember);
  const setRole = useChat((s) => s.setRole);
  const leaveGroup = useChat((s) => s.leaveGroup);
  const deleteGroup = useChat((s) => s.deleteGroup);
  const worlds = useSharedWorlds(id);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c?.title ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberSheet, setMemberSheet] = useState<MemberRow | null>(null);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | 'remove' | null>(null);
  const [loops, setLoops] = useState<LoopsView | null>(null);

  useEffect(() => {
    void loadExtras(id);
  }, [id, loadExtras]);

  const members = useMemo(
    () => extras.members.filter((m) => m.status !== 'left').sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joined_at.localeCompare(b.joined_at)),
    [extras.members],
  );

  if (!c) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Group info" />
        <EmptyState title="You’re not in this group" body="You left, were removed, or it was deleted." action={<Button label="Messages" onPress={() => router.replace('/messages')} />} />
      </SafeAreaView>
    );
  }

  const owner = c.myRole === 'owner';
  const moderator = owner || c.myRole === 'admin';
  const openLoops = extras.loops.filter((l) => l.status === 'open').length;
  const heir = owner ? nextOwner(extras.members, uid) : undefined;

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setBusy(null);
      after?.();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const changePhoto = async () => {
    try {
      const [img] = await pickImages({ source: 'library' });
      if (img) await run('photo', () => setGroupPhoto(id, img));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const toMessages = () => {
    router.dismissTo('/messages');
  };
  const sheetUser = memberSheet ? chatUser(memberSheet.user_id) : undefined;
  const canRemove = (m: MemberRow) => m.user_id !== uid && m.role !== 'owner' && (owner || (c.myRole === 'admin' && m.role === 'member'));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Group info" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <Tap onPress={moderator ? changePhoto : undefined} disabled={!moderator || !!busy} style={styles.photo} accessibilityLabel={moderator ? 'Change group photo' : 'Group photo'}>
            {c.avatar ? <Img uri={c.avatar} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Users size={34} color={colors.accent} />}
            {busy === 'photo' ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator color={colors.white} />
              </View>
            ) : null}
            {moderator ? (
              <View style={styles.cam}>
                <Camera size={14} color={colors.white} />
              </View>
            ) : null}
          </Tap>
          {moderator && c.avatar ? (
            <Tap onPress={() => void run('photo', () => setGroupPhoto(id, null))} style={{ marginTop: 6 }} accessibilityLabel="Remove group photo">
              <T v="caption" color={colors.inkMuted}>
                Remove photo
              </T>
            </Tap>
          ) : null}
          {editing ? (
            <View style={styles.renameRow}>
              <TextInput value={title} onChangeText={setTitle} maxLength={60} autoFocus style={styles.renameInput} accessibilityLabel="Group name" />
              <Tap
                onPress={() => void run('rename', () => renameGroup(id, title), () => setEditing(false))}
                disabled={!title.trim() || busy === 'rename'}
                style={[styles.save, !title.trim() && { opacity: 0.4 }]}
                accessibilityLabel="Save name"
              >
                {busy === 'rename' ? <ActivityIndicator color={colors.white} /> : <T v="subhead" weight="700" color={colors.white}>Save</T>}
              </Tap>
            </View>
          ) : (
            <Tap onPress={moderator ? () => { setTitle(c.title ?? ''); setEditing(true); } : undefined} disabled={!moderator} style={styles.nameRow} accessibilityLabel={moderator ? `Rename ${c.title}` : c.title}>
              <T v="title2" align="center" numberOfLines={2}>
                {c.title}
              </T>
              {moderator ? <Pencil size={16} color={colors.inkFaint} style={{ marginLeft: 8 }} /> : null}
            </Tap>
          )}
          <T v="footnote" color={colors.inkMuted}>{`Group · ${c.memberCount} members`}</T>
        </View>

        {error ? (
          <T v="footnote" color={colors.danger} align="center" style={{ marginTop: 10 }} testID="group-info-error">
            {error}
          </T>
        ) : null}

        <T v="label" color={colors.inkFaint} style={styles.section}>
          {`MEMBERS · ${members.length}`}
        </T>
        <View style={styles.card}>
          {moderator ? (
            <Tap onPress={() => pushOnce(`/group-add/${id}`)} style={styles.row} accessibilityLabel="Add people">
              <View style={styles.iconDot}>
                <UserPlus size={18} color={colors.accent} />
              </View>
              <T v="bodyStrong" color={colors.accent} style={{ marginLeft: 12 }}>
                Add people
              </T>
            </Tap>
          ) : null}
          {!extras.loaded && !members.length ? <ActivityIndicator style={{ margin: 16 }} color={colors.accent} /> : null}
          {members.map((m) => {
            const u = chatUser(m.user_id);
            const me = m.user_id === uid;
            return (
              <Tap key={m.user_id} onPress={me ? undefined : () => setMemberSheet(m)} disabled={me} style={styles.row} accessibilityLabel={`${me ? 'You' : u?.displayName ?? 'Member'}${m.role !== 'member' ? `, ${m.role}` : ''}`} testID={`member-${u?.displayName ?? m.user_id}`}>
                <Avatar uri={u?.avatar} name={u?.displayName} size={40} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <T v="bodyStrong" numberOfLines={1}>
                    {me ? 'You' : u?.displayName ?? 'Chimp member'}
                  </T>
                  {m.status === 'request' ? (
                    <T v="caption" color={colors.inkFaint}>
                      Added · hasn’t replied yet
                    </T>
                  ) : null}
                </View>
                {m.role !== 'member' ? (
                  <View style={[styles.badge, m.role === 'owner' && { backgroundColor: colors.accentSoft }]}>
                    <T v="caption" color={m.role === 'owner' ? colors.accent : colors.ink2}>
                      {m.role === 'owner' ? 'Owner' : 'Admin'}
                    </T>
                  </View>
                ) : null}
              </Tap>
            );
          })}
        </View>

        <T v="label" color={colors.inkFaint} style={styles.section}>
          OPEN LOOPS
        </T>
        <View style={styles.card}>
          <Tap onPress={() => setLoops({ mode: 'list' })} style={styles.row} accessibilityLabel="Open Loops">
            <View style={styles.iconDot}>
              <Repeat size={17} color={colors.accent} />
            </View>
            <T v="bodyStrong" style={{ marginLeft: 12, flex: 1 }}>
              {extras.loops.length ? `${openLoops} open · ${extras.loops.length - openLoops} resolved` : 'None yet'}
            </T>
            <ChevronRight size={18} color={colors.inkFaint} />
          </Tap>
        </View>

        <T v="label" color={colors.inkFaint} style={styles.section}>
          SHARED WORLDS
        </T>
        <View style={styles.card}>
          {worlds.length ? (
            worlds.slice(0, 8).map((w) => (
              <Tap key={w.id} onPress={() => pushOnce(`/board/${w.id}`)} style={styles.row} accessibilityLabel={`World ${w.title}`}>
                <View style={styles.iconDot}>
                  <Globe2 size={17} color={colors.accent} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <T v="bodyStrong" numberOfLines={1}>
                    {w.title}
                  </T>
                  <T v="caption" color={colors.inkFaint}>{`${w.members} of you are in it`}</T>
                </View>
                <ChevronRight size={18} color={colors.inkFaint} />
              </Tap>
            ))
          ) : (
            <T v="subhead" color={colors.inkMuted} weight="400" style={{ padding: 14 }}>
              No Worlds in common yet.
            </T>
          )}
        </View>

        <View style={[styles.card, { marginTop: 24 }]}>
          <Tap onPress={() => setConfirm('leave')} style={styles.row} accessibilityLabel="Leave group">
            <LogOut size={19} color={colors.danger} />
            <T v="bodyStrong" color={colors.danger} style={{ marginLeft: 12 }}>
              Leave group
            </T>
          </Tap>
          {owner ? (
            <Tap onPress={() => setConfirm('delete')} style={styles.row} accessibilityLabel="Delete group">
              <Trash2 size={19} color={colors.danger} />
              <T v="bodyStrong" color={colors.danger} style={{ marginLeft: 12 }}>
                Delete group
              </T>
            </Tap>
          ) : null}
        </View>
      </ScrollView>

      {/* A member: profile, admin, remove. */}
      <Modal visible={!!memberSheet && confirm !== 'remove'} transparent animationType="fade" onRequestClose={() => setMemberSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => setMemberSheet(null)} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
            {memberSheet ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 8 }}>
                  <Avatar uri={sheetUser?.avatar} name={sheetUser?.displayName} size={40} />
                  <T v="headline" style={{ marginLeft: 12, flex: 1 }} numberOfLines={1}>
                    {sheetUser?.displayName ?? 'Chimp member'}
                  </T>
                </View>
                <SheetRow label="View profile" onPress={() => { const who = memberSheet.user_id; setMemberSheet(null); pushOnce(`/profile/${who}`); }} />
                {owner && memberSheet.role !== 'owner' ? (
                  <SheetRow
                    label={memberSheet.role === 'admin' ? 'Remove as admin' : 'Make admin'}
                    busy={busy === 'role'}
                    onPress={() => void run('role', () => setRole(id, memberSheet.user_id, memberSheet.role === 'admin' ? 'member' : 'admin'), () => setMemberSheet(null))}
                  />
                ) : null}
                {canRemove(memberSheet) ? <SheetRow label="Remove from group" danger onPress={() => setConfirm('remove')} /> : null}
                <SheetRow label="Cancel" muted onPress={() => setMemberSheet(null)} />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Confirmations: leave, delete, remove. */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <Pressable style={styles.scrim} onPress={() => !busy && setConfirm(null)} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), paddingHorizontal: 20 }]} onPress={() => undefined}>
            <T v="title3">{confirm === 'leave' ? 'Leave this group?' : confirm === 'delete' ? 'Delete this group?' : `Remove ${sheetUser?.displayName.split(' ')[0] ?? 'them'}?`}</T>
            <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 6 }}>
              {confirm === 'leave'
                ? owner && heir
                  ? `You won’t see new messages. ${chatUser(heir.user_id)?.displayName.split(' ')[0] ?? 'The next member'} becomes the owner.`
                  : owner
                    ? 'You’re the last one here, so the group will be deleted.'
                    : 'You won’t see its messages any more. Someone can add you again later.'
                : confirm === 'delete'
                  ? 'The group, its messages, reactions, Pings and Open Loops are deleted for everyone. This can’t be undone.'
                  : 'They lose access to the group straight away. You can add them again later.'}
            </T>
            {error ? (
              <T v="footnote" color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </T>
            ) : null}
            <Tap
              onPress={() =>
                void (confirm === 'leave'
                  ? run('confirm', () => leaveGroup(id), toMessages)
                  : confirm === 'delete'
                    ? run('confirm', () => deleteGroup(id), toMessages)
                    : run('confirm', () => removeMember(id, memberSheet!.user_id), () => { setConfirm(null); setMemberSheet(null); }))
              }
              disabled={busy === 'confirm'}
              style={[styles.big, { backgroundColor: colors.danger }]}
              accessibilityLabel={confirm === 'leave' ? 'Confirm leave group' : confirm === 'delete' ? 'Confirm delete group' : 'Confirm remove member'}
            >
              {busy === 'confirm' ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>{confirm === 'leave' ? 'Leave' : confirm === 'delete' ? 'Delete group' : 'Remove'}</T>}
            </Tap>
            <Tap onPress={() => setConfirm(null)} disabled={busy === 'confirm'} style={[styles.big, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Cancel">
              <T v="bodyStrong" color={colors.ink2}>
                Cancel
              </T>
            </Tap>
          </Pressable>
        </Pressable>
      </Modal>

      <LoopsSheet conversationId={id} view={loops} onView={setLoops} moderator={moderator} />
    </SafeAreaView>
  );
}

function SheetRow({ label, onPress, danger, muted, busy }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean; busy?: boolean }) {
  return (
    <Tap onPress={onPress} disabled={busy} style={[styles.sheetRow, muted && { backgroundColor: colors.surfaceMuted, justifyContent: 'center', marginTop: 4 }]} accessibilityLabel={label}>
      {busy ? <ActivityIndicator color={colors.accent} /> : <T v="bodyStrong" color={danger ? colors.danger : muted ? colors.ink2 : colors.ink}>{label}</T>}
    </Tap>
  );
}

const styles = StyleSheet.create({
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  photoBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 48, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  cam: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 20 },
  renameRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 12 },
  renameInput: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 17, color: colors.ink, borderWidth: 1, borderColor: colors.line },
  save: { height: 46, paddingHorizontal: 18, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  section: { marginTop: 22, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingVertical: 8 },
  iconDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetRow: { minHeight: 52, paddingHorizontal: 8, borderRadius: radius.lg, justifyContent: 'center' },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
