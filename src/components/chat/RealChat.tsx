import { router } from 'expo-router';
import { AlertCircle, ChevronLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { type ChatMsg, useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import { pushOnce } from '@/utils/nav';

import type { ComposerHandle } from './ChatComposer';
import { ConversationBody } from './ConversationBody';
import { RelationshipCard } from './RelationshipCard';

const EMPTY: ChatMsg[] = [];

/**
 * Real-time 1:1 chat for REAL accounts (Phase 6B).
 *   - Resolves (or creates) the conversation with this person on Supabase.
 *   - New messages arrive through Realtime — no refresh, no polling.
 *   - Sending is optimistic: your bubble appears at once ("Sending…"), then
 *     confirms; if it fails it says so and you can tap to retry (never duplicated).
 *   - Opening the chat marks it read.
 *   - People who aren't connected meet as a Message Request: accept, decline, or just reply.
 *   - Final messaging patch: reactions + Same Brain, replies, Open Loops,
 *     Mutual Ping (ConversationBody, shared with group chats).
 */
export function RealChat({ personId, draft }: { personId: string; draft?: string }) {
  const fetched = useChat((s) => s.people[personId]);
  const user = repo.user(personId) ?? fetched;
  const blocked = useChimp((s) => !!s.blocked[personId]);
  const connected = useChimp((s) => !!s.connections[personId]);
  const conversationWith = useChat((s) => s.conversationWith);
  const openChat = useChat((s) => s.open);
  const chatReady = useChat((s) => !!s.uid);
  const closeChat = useChat((s) => s.close);
  const respond = useChat((s) => s.respond);
  const [cid, setCid] = useState<string | null>(useChat.getState().byPerson[personId] ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'not_allowed' | 'error'>(cid ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<ComposerHandle>(null);
  const messages = useChat((s) => (cid ? s.messages[cid] : undefined)) ?? EMPTY;
  const conversation = useChat((s) => (cid ? s.conversations[cid] : undefined));
  const live = useChat((s) => s.live);

  // Resolve the conversation, open it (loads messages, marks read), close it on leave.
  // Phase 8: only once chat is bound to this account — if chat (re)starts while
  // this screen is open (sign-in settling, cold start, reconnect restart), the
  // chat is opened again instead of silently losing its live updates.
  useEffect(() => {
    if (!chatReady) return;
    let alive = true;
    let opened: string | null = null;
    (async () => {
      try {
        const id = await conversationWith(personId);
        if (!alive) return;
        setCid(id);
        setState('ready');
        opened = id;
        await openChat(id);
      } catch (e) {
        if (!alive) return;
        const code = (e as { code?: string }).code;
        if (code === 'not_allowed') setState('not_allowed');
        else {
          setState('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      alive = false;
      if (opened) closeChat(opened);
    };
  }, [personId, conversationWith, openChat, closeChat, chatReady]);

  const first = user?.displayName.split(' ')[0] ?? 'them';

  const statusLine = blocked
    ? 'Blocked'
    : conversation?.myStatus === 'request'
      ? 'Message request'
      : connected
        ? 'Connected'
        : conversation?.otherStatus === 'request'
          ? 'Request sent'
          : user?.city ?? '';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
        <Tap onPress={() => pushOnce(`/profile/${personId}`)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginLeft: 10 }} accessibilityLabel={`Open ${user?.displayName ?? 'profile'}`}>
          <Avatar uri={user?.avatar} name={user?.displayName} size={40} />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <T v="bodyStrong" numberOfLines={1}>
              {user?.displayName ?? 'Chimp member'}
            </T>
            <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1}>
              {statusLine}
            </T>
          </View>
        </Tap>
        {live === 'error' ? <AlertCircle size={18} color={colors.inkFaint} accessibilityLabel="Live updates reconnecting" /> : null}
      </View>

      {state === 'loading' ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} /> : null}
      {state === 'not_allowed' ? (
        <View style={styles.notice}>
          <T v="headline" align="center">{`You can’t message ${first} yet`}</T>
          <T v="subhead" color={colors.inkMuted} align="center" style={{ marginTop: 6 }}>
            Chimp messages open up once you’re connected, follow each other, share a World, or they accept message requests.
          </T>
          <Tap onPress={() => pushOnce(`/profile/${personId}`)} style={styles.noticeBtn} accessibilityLabel="Open profile">
            <T v="subhead" weight="700" color={colors.white}>
              {`Connect with ${first}`}
            </T>
          </Tap>
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={styles.notice}>
          <T v="subhead" color={colors.danger} align="center">
            {error ?? 'Couldn’t open this chat.'}
          </T>
        </View>
      ) : null}

      {state === 'ready' && cid ? (
        <ConversationBody
          conversationId={cid}
          group={false}
          otherName={first}
          placeholder={`Message ${first}…`}
          initialText={draft}
          listFooter={messages.length === 0 ? <RelationshipCard personId={personId} firstName={first} empty onStarter={(t) => bodyRef.current?.fill(t)} /> : null}
          aboveComposer={
            conversation?.myStatus === 'request' || conversation?.myStatus === 'declined' ? (
              <View style={styles.request}>
                <T v="subhead" weight="700">
                  {conversation.myStatus === 'declined' ? `You declined ${first}’s request` : `${first} wants to message you`}
                </T>
                <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
                  {conversation.myStatus === 'declined' ? 'Accept to reply.' : 'You’re not connected yet. Replying accepts the request.'}
                </T>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Tap onPress={() => void respond(cid, true)} style={[styles.reqBtn, { backgroundColor: colors.accent }]} accessibilityLabel="Accept request">
                    <T v="subhead" weight="700" color={colors.white}>
                      Accept
                    </T>
                  </Tap>
                  {conversation.myStatus === 'request' ? (
                    <Tap onPress={() => void respond(cid, false)} style={[styles.reqBtn, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Decline request">
                      <T v="subhead" weight="700" color={colors.ink2}>
                        Decline
                      </T>
                    </Tap>
                  ) : null}
                </View>
              </View>
            ) : conversation?.otherStatus === 'request' && messages.some((m) => m.senderId !== personId) ? (
              <T v="caption" color={colors.inkFaint} align="center" style={{ paddingHorizontal: 24, paddingBottom: 6 }}>
                {`Sent as a message request. ${first} sees it in Requests.`}
              </T>
            ) : null
          }
          composerReplacement={
            blocked ? (
              <T v="footnote" color={colors.inkMuted} align="center" style={{ padding: 16 }}>
                {`You blocked ${first}. Unblock from their profile to message again.`}
              </T>
            ) : undefined
          }
          hideComposer={conversation?.myStatus === 'declined'}
          composerRef={bodyRef}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  notice: { margin: 24, padding: 20, borderRadius: radius.xl, backgroundColor: colors.surface },
  noticeBtn: { marginTop: 14, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  failed: { backgroundColor: '#FFF1F1', borderWidth: 1, borderColor: '#F7B4B4' },
  request: { marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  reqBtn: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  attach: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16, color: colors.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  preview: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8 },
  previewX: { position: 'absolute', left: 64, top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
