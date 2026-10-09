import { useLocalSearchParams } from 'expo-router';
import { Pencil, Send, VenetianMask, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReplyingTo, ThreadActions, ThreadBody, ThreadIndent, ThreadMenuSlot } from '@/components/comments/Thread';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/misc';
import { OwnerMenu } from '@/components/ui/OwnerMenu';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { MY_PERSONAS } from '@/data/users';
import { useMyAvatar } from '@/hooks/useGraph';
import { deleteComment, editComment, fetchComments, fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import { repo } from '@/services/repository';
import { commentTarget, useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { Comment, IdentityMode, User } from '@/types/models';
import { threadRows, toggleThread } from '@/utils/commentTree';
import { whenLabel } from '@/utils/format';

/**
 * Comment sheet for board posts (`/comments/<postId>`) and Drift items
 * (`/comments/drift:<id>`), with per-context identity (public vs verified
 * pseudonym). DEMO: seeded + local comments. REAL: comments are backend rows
 * (loaded on open, posted optimistically).
 */
export default function CommentsSheet() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const target = commentTarget(postId);
  const post = target.kind === 'post' ? repo.post(target.id) : undefined;
  const drift = target.kind === 'drift' ? repo.driftItem(target.id) : undefined;
  const board = repo.board(post?.boardId ?? drift?.boardId ?? '');
  const real = repo.mode() === 'real';
  const added = useChimp((s) => s.comments[postId]);
  const addComment = useChimp((s) => s.addComment);
  const avatarUri = useMyAvatar();
  const [text, setText] = useState('');
  const canPseudo = !real && !!board?.identityModes.includes('pseudonymous');
  const [mode, setMode] = useState<IdentityMode>('public');
  const me = repo.me();
  const pseudonym = MY_PERSONAS.find((p) => p.mode === 'pseudonymous')!.displayName;

  // REAL: the backend is the source of truth; `sent` holds this session's optimistic posts.
  const [remote, setRemote] = useState<Comment[] | null>(real ? null : []);
  const [sent, setSent] = useState<Comment[]>([]);
  const [people, setPeople] = useState<Record<string, User>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!real) return;
    let live = true;
    (async () => {
      try {
        const rows = await fetchComments(target.kind, target.id);
        const unknown = rows.map((r) => r.author_id).filter((id) => !repo.user(id));
        const profiles = unknown.length ? await fetchPeople(unknown) : [];
        if (!live) return;
        setPeople(Object.fromEntries(profiles.map((p) => [p.id, toUser(p)])));
        setRemote(rows.map((r) => ({ id: r.id, postId, authorId: r.author_id, authorMode: 'public', body: r.body, createdAt: r.created_at, editedAt: r.edited_at ?? undefined, parentId: r.parent_id ?? undefined })));
      } catch (e) {
        if (live) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setRemote([]);
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, real]);

  const comments = useMemo<Comment[]>(
    () => (real ? [...(remote ?? []), ...sent] : [...repo.seedComments(postId), ...(added ?? [])]),
    [postId, added, real, remote, sent],
  );
  // Phase 9.2: threads — replies under the comment they answer; any thread can be collapsed.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const rows = useMemo(() => threadRows(comments, collapsed), [comments, collapsed]);
  const byId = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);
  // Collapse a branch from its thread line; open it again from "N replies" (or the parent's text).
  const collapse = (id: string) => setCollapsed((c) => (c[id] ? c : { ...c, [id]: true }));
  const expand = (id: string) => setCollapsed((c) => (c[id] ? toggleThread(c, id) : c));
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const userFor = (id: string) => repo.user(id) ?? people[id];
  const nameOf = (c: Comment) => {
    const mine = c.authorId === me.id;
    if (c.authorMode !== 'public') return mine ? pseudonym : 'Verified member';
    return mine ? 'yourself' : userFor(c.authorId)?.displayName ?? 'Chimp member';
  };
  const subtitle = post?.title ?? post?.place?.name ?? post?.poll?.question ?? drift?.caption ?? board?.title;

  const [sendError, setSendError] = useState<string | null>(null);
  // Phase 6D: edit / delete your own comments (REAL; the server enforces the rules).
  const [editing, setEditing] = useState<Comment | null>(null);
  const [saving, setSaving] = useState(false);
  const replaceLocal = (id: string, next: Comment | null) => {
    const apply = (xs: Comment[]) => (next ? xs.map((c) => (c.id === id ? next : c)) : xs.filter((c) => c.id !== id));
    setRemote((xs) => (xs ? apply(xs) : xs));
    setSent(apply);
  };
  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      setSaving(true);
      setSendError(null);
      editComment(editing.id, body)
        .then((row) => {
          replaceLocal(editing.id, { ...editing, body: row.body, editedAt: row.edited_at ?? new Date().toISOString() });
          setEditing(null);
          setText('');
        })
        .catch((e: unknown) => setSendError(e instanceof Error ? e.message : String(e)))
        .finally(() => setSaving(false));
      return;
    }
    setText('');
    setSendError(null);
    const parentId = replyTo?.id;
    setReplyTo(null);
    if (parentId) setCollapsed((c) => (c[parentId] ? toggleThread(c, parentId) : c)); // show the reply you just wrote
    if (!real) {
      void addComment(postId, body, mode, parentId);
      return;
    }
    // REAL, optimistic: show it now, swap in the confirmed row, or roll back with an error.
    const tempId = `local_${Date.now()}`;
    setSent((xs) => [...xs, { id: tempId, postId, authorId: me.id, authorMode: 'public', body, createdAt: new Date().toISOString(), status: 'sending', ...(parentId ? { parentId } : {}) }]);
    addComment(postId, body, 'public', parentId)
      .then((row) => setSent((xs) => xs.map((c) => (c.id === tempId && row ? { ...row, status: undefined } : c))))
      .catch((e: unknown) => {
        setSent((xs) => xs.filter((c) => c.id !== tempId));
        setText((cur) => cur || body);
        setSendError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Comments" subtitle={subtitle} />
      {remote === null ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} /> : null}
      {loadError ? (
        <T v="footnote" color={colors.danger} style={{ paddingHorizontal: 20, marginBottom: 8 }}>
          {`Couldn't load comments. ${loadError}`}
        </T>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.item.id}
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}
        ListEmptyComponent={remote === null ? null : <EmptyState title="No comments yet" body="Start the conversation." />}
        renderItem={({ item: row }) => {
          const item = row.item;
          const mine = item.authorId === me.id;
          const u = userFor(item.authorId);
          const masked = item.authorMode !== 'public';
          const settled = !item.status && !item.id.startsWith('local');
          return (
            <ThreadIndent depth={row.depth} onCollapse={item.parentId && byId.has(item.parentId) ? () => collapse(item.parentId!) : undefined} parentName={item.parentId && byId.get(item.parentId) ? nameOf(byId.get(item.parentId)!) : undefined}>
            <View style={{ flexDirection: 'row' }} testID="comment-row">
              {masked ? (
                <View style={styles.mask}>
                  <VenetianMask size={16} color={colors.inkMuted} />
                </View>
              ) : (
                <Avatar uri={mine ? avatarUri : u?.avatar} name={u?.displayName} size={36} />
              )}
              <View style={{ flex: 1, marginLeft: 10 }}>
                {/* Name, time and text: tapping them collapses / expands this comment's own replies. */}
                <ThreadBody replies={row.replies} collapsed={!!collapsed[item.id]} onToggle={() => setCollapsed((c) => toggleThread(c, item.id))} label={item.body}>
                  <T v="footnote" weight="700">
                    {masked ? (mine ? `${pseudonym} (you)` : 'Verified member') : mine ? `${me.username} (you)` : u?.displayName ?? 'Chimp member'}
                    <T v="footnote" color={colors.inkFaint} weight="400">{item.status === 'sending' ? '  Sending…' : `  ${whenLabel(item.createdAt)}${item.editedAt ? ' · Edited' : ''}`}</T>
                  </T>
                  <T v="subhead" weight="400" color={colors.ink2} style={{ marginTop: 2 }}>
                    {item.body}
                  </T>
                </ThreadBody>
                <ThreadActions
                  onReply={
                    settled
                      ? () => {
                          setEditing(null);
                          setReplyTo(item);
                          setSendError(null);
                        }
                      : undefined
                  }
                  replies={row.replies}
                  collapsed={!!collapsed[item.id]}
                  onToggle={() => expand(item.id)}
                  replyTo={row.replyTo ? nameOf(row.replyTo) : undefined}
                />
              </View>
              {real && mine && settled ? (
                <ThreadMenuSlot>
                <OwnerMenu
                  what="reply"
                  size={16}
                  createdAtMs={Date.parse(item.createdAt)}
                  onEdit={() => {
                    setReplyTo(null);
                    setEditing(item);
                    setText(item.body);
                    setSendError(null);
                  }}
                  onDelete={async () => {
                    await deleteComment(item.id);
                    // Replies stay (the server keeps them; they become top-level).
                    replaceLocal(item.id, null);
                    const orphan = (c: Comment) => (c.parentId === item.id ? { ...c, parentId: undefined } : c);
                    setRemote((xs) => (xs ? xs.map(orphan) : xs));
                    setSent((xs) => xs.map(orphan));
                    if (replyTo?.id === item.id) setReplyTo(null);
                    if (editing?.id === item.id) {
                      setEditing(null);
                      setText('');
                    }
                  }}
                />
                </ThreadMenuSlot>
              ) : null}
            </View>
            </ThreadIndent>
          );
        }}
      />
      {sendError ? (
        <T v="footnote" color={colors.danger} style={{ paddingHorizontal: 20, paddingVertical: 6 }}>
          {sendError}
        </T>
      ) : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {editing ? (
          <View style={styles.editing}>
            <Pencil size={14} color={colors.accent} />
            <T v="footnote" weight="700" color={colors.accent} style={{ flex: 1, marginLeft: 6 }}>
              Editing your comment
            </T>
            <Tap
              onPress={() => {
                setEditing(null);
                setText('');
                setSendError(null);
              }}
              style={{ padding: 6 }}
              accessibilityLabel="Cancel editing"
            >
              <X size={16} color={colors.inkMuted} />
            </Tap>
          </View>
        ) : null}
        {replyTo && !editing ? <ReplyingTo name={nameOf(replyTo)} onCancel={() => setReplyTo(null)} /> : null}
        {canPseudo ? (
          <View style={styles.modes}>
            {(['public', 'pseudonymous'] as const).map((m) => (
              <Tap key={m} onPress={() => setMode(m)} haptic="select" style={[styles.mode, mode === m && styles.modeOn]}>
                <T v="caption" color={mode === m ? colors.accent : colors.inkMuted}>
                  {m === 'public' ? `As ${me.username}` : `As ${pseudonym} (pseudonym)`}
                </T>
              </Tap>
            ))}
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={replyTo && !editing ? 'Write a reply…' : 'Add a comment…'}
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            multiline
            maxLength={500}
          />
          <Tap onPress={send} disabled={!text.trim() || saving} haptic="light" style={[styles.send, (!text.trim() || saving) && { opacity: 0.4 }]} accessibilityLabel={editing ? 'Save comment' : 'Send comment'}>
            <Send size={18} color={colors.white} />
          </Tap>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  mask: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 10 },
  modes: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  editing: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  mode: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  modeOn: { backgroundColor: colors.accentSoft },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: colors.ink,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
