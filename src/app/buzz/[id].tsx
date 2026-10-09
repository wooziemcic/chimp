import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, Send, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BuzzCard, useReplyCount } from '@/components/buzz/BuzzCard';
import { ReplyingTo, ThreadActions, ThreadIndent } from '@/components/comments/Thread';
import { Avatar } from '@/components/ui/Avatar';
import { Button, EmptyState } from '@/components/ui/misc';
import { OwnerMenu } from '@/components/ui/OwnerMenu';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { scoreBuzz } from '@/graph/surfaces';
import { useGraphCtx, useMyAvatar } from '@/hooks/useGraph';
import { removeMyReply, saveReplyEdit } from '@/services/backend/ownContent';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { BuzzItem, BuzzReply } from '@/types/models';
import { threadRows, toggleThread } from '@/utils/commentTree';
import { whenLabel } from '@/utils/format';

const EMPTY: BuzzReply[] = [];

/**
 * A Buzz thread: the item, why it's in your Buzz, and replies.
 * Phase 6B: replies are optimistic — yours appears (and counts) the moment
 * you send it, then is confirmed by Supabase or rolled back with an error.
 */
export default function BuzzThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useDataset(); // REAL replies live in the dataset
  const item = repo.buzzItem(id);
  const { width } = useWindowDimensions();
  const ctx = useGraphCtx();
  const mine = useChimp((s) => s.buzzReplies[id]) ?? EMPTY;
  const addReply = useChimp((s) => s.addBuzzReply);
  const markSeen = useChimp((s) => s.markSeen);
  const myAvatar = useMyAvatar();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Phase 6D: editing one of your replies (the composer becomes the editor).
  const [editing, setEditing] = useState<BuzzReply | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) markSeen({ kind: 'buzz', id: item.id });
  }, [item, markSeen]);

  const why = useMemo(() => (item ? scoreBuzz(ctx, item).reasons.filter((r) => r.kind !== 'editorial').slice(0, 3) : []), [ctx, item]);
  const replies = useMemo(() => [...data.buzzReplies.filter((r) => r.buzzId === id), ...mine], [data.buzzReplies, id, mine]);
  // Phase 9.2: threads — a reply sits under the reply it answers; any thread can be collapsed.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<BuzzReply | null>(null);
  const rows = useMemo(() => threadRows(replies, collapsed), [replies, collapsed]);
  const nameOf = (r: BuzzReply) => (repo.isMe(r.authorId) ? 'yourself' : repo.user(r.authorId)?.displayName ?? 'Someone');

  if (!item) return <EmptyState title="This post isn’t available" body="It may have been deleted, or you no longer have access." action={<Button label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/buzz'))} />} />;
  const board = repo.board(item.boardId);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      setSaving(true);
      setError(null);
      saveReplyEdit(editing.id, body)
        .then(() => {
          setEditing(null);
          setText('');
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setSaving(false));
      return;
    }
    setText('');
    setError(null);
    const parentId = replyTo?.id;
    setReplyTo(null);
    if (parentId) setCollapsed((c) => (c[parentId] ? toggleThread(c, parentId) : c)); // show the reply you just wrote
    addReply(item.id, body, parentId).catch((e: unknown) => {
      // Rolled back: give the words back so nothing is lost.
      setText((cur) => cur || body);
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScreenHeader title="Buzz" subtitle={board?.title} />
        <FlatList
          data={rows}
          keyExtractor={(row) => row.item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 6 }}>
              <BuzzCard item={item} width={width - 32} expanded />
              {why.length ? (
                <View style={styles.why}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Sparkles size={14} color={colors.accent} />
                    <T v="caption" color={colors.accent} weight="800" style={{ marginLeft: 6, letterSpacing: 0.6 }}>
                      WHY THIS IS IN YOUR BUZZ
                    </T>
                  </View>
                  {why.map((r) => (
                    <T key={r.text} v="footnote" color={colors.ink2} style={{ marginTop: 4 }}>
                      {`· ${r.text}`}
                    </T>
                  ))}
                </View>
              ) : null}
              <ReplyCount item={item} />
            </View>
          }
          renderItem={({ item: row }) => {
            const r = row.item;
            const u = repo.user(r.authorId);
            const settled = !r.status && !r.id.startsWith('local') && !r.id.startsWith('br_');
            return (
              <ThreadIndent depth={row.depth}>
              <View style={styles.reply} testID="reply-row">
                <Avatar uri={repo.isMe(r.authorId) ? myAvatar : u?.avatar} name={u?.displayName} size={32} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <T v="footnote" weight="700">
                    {repo.isMe(r.authorId) ? repo.me().displayName || 'You' : u?.displayName ?? 'Someone'}
                    <T v="footnote" color={colors.inkFaint} weight="400">
                      {r.status === 'sending' ? '  ·  Sending…' : `  ·  ${whenLabel(r.createdAtMs ?? r.createdAt)}${r.editedAtMs ? ' · Edited' : ''}`}
                    </T>
                  </T>
                  <T v="subhead" weight="400" color={colors.ink2} style={{ marginTop: 2 }}>
                    {r.body}
                  </T>
                  <ThreadActions
                    onReply={
                      settled || repo.mode() !== 'real'
                        ? () => {
                            setEditing(null);
                            setReplyTo(r);
                            setError(null);
                          }
                        : undefined
                    }
                    replies={row.replies}
                    collapsed={!!collapsed[r.id]}
                    onToggle={() => setCollapsed((c) => toggleThread(c, r.id))}
                    replyTo={row.replyTo ? nameOf(row.replyTo) : undefined}
                  />
                </View>
                {repo.mode() === 'real' && repo.isMe(r.authorId) && !r.status && !r.id.startsWith('local') ? (
                  <OwnerMenu
                    what="reply"
                    size={16}
                    createdAtMs={r.createdAtMs}
                    onEdit={() => {
                      setReplyTo(null);
                      setEditing(r);
                      setText(r.body);
                      setError(null);
                    }}
                    onDelete={async () => {
                      await removeMyReply(r.id);
                      if (replyTo?.id === r.id) setReplyTo(null);
                      if (editing?.id === r.id) {
                        setEditing(null);
                        setText('');
                      }
                    }}
                  />
                ) : null}
              </View>
              </ThreadIndent>
            );
          }}
          ListEmptyComponent={
            <T v="footnote" color={colors.inkMuted}>
              Be the first to reply.
            </T>
          }
        />
        {error ? (
          <T v="footnote" color={colors.danger} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            {error}
          </T>
        ) : null}
        {editing ? (
          <View style={styles.editing}>
            <Pencil size={14} color={colors.accent} />
            <T v="footnote" weight="700" color={colors.accent} style={{ flex: 1, marginLeft: 6 }}>
              Editing your reply
            </T>
            <Tap
              onPress={() => {
                setEditing(null);
                setText('');
                setError(null);
              }}
              style={{ padding: 6 }}
              accessibilityLabel="Cancel editing"
            >
              <X size={16} color={colors.inkMuted} />
            </Tap>
          </View>
        ) : null}
        {replyTo && !editing ? (
          <View style={styles.replying}>
            <ReplyingTo name={nameOf(replyTo)} onCancel={() => setReplyTo(null)} />
          </View>
        ) : null}
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={replyTo && !editing ? 'Write a reply…' : board ? `Reply in ${board.title}…` : 'Reply…'}
            placeholderTextColor={colors.inkFaint}
            onSubmitEditing={send}
            returnKeyType="send"
            style={styles.input}
          />
          <Tap onPress={send} disabled={!text.trim() || saving} style={[styles.send, (!text.trim() || saving) && { opacity: 0.4 }]} accessibilityLabel={editing ? 'Save reply' : 'Send reply'}>
            <Send size={18} color={colors.white} />
          </Tap>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  why: { padding: 12, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  reply: { flexDirection: 'row', padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  editing: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 6, backgroundColor: colors.bg },
  replying: { paddingHorizontal: 14, paddingTop: 6, backgroundColor: colors.bg },
  composer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  input: { flex: 1, height: 46, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, fontSize: 16, color: colors.ink },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});

function ReplyCount({ item }: { item: BuzzItem }) {
  const n = useReplyCount(item);
  return (
    <T v="eyebrow" color={colors.inkMuted} style={{ marginTop: 6 }}>
      {n === 1 ? '1 REPLY' : `${n} REPLIES`}
    </T>
  );
}
