import { type ReactNode, type RefObject, useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui/Text';
import type { PingKind } from '@/services/backend/chat';
import { type ChatMsg, chatUser, EMPTY_EXTRAS, useChat } from '@/store/useChat';
import { colors } from '@/theme';
import { whenLabel } from '@/utils/format';
import { type ChemistryLine, loopTitleForMatch, loopTitleFrom, pingLabel, summarizeReactions } from '@/utils/messaging';

import { ChatBubble } from './ChatBubble';
import { type ComposerHandle, ChatComposer } from './ChatComposer';
import { ChemistryStrip, OpenLoopsEntry, SameBrainBurst } from './ChatStrips';
import { LoopsSheet, type LoopsView } from './LoopsSheet';
import { MessageMenu } from './MessageMenu';
import { PingSheet } from './PingSheet';
import { RevealCard } from './RevealCard';
import { useMinuteClock } from './useGroupChemistry';

/** "Today" / "Yesterday" / "Sep 24" separators between days. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return whenLabel(iso);
}

const EMPTY: ChatMsg[] = [];

interface Props {
  conversationId: string;
  group: boolean;
  /** 1:1: the other person's first name. */
  otherName?: string;
  placeholder: string;
  /** Shown above the oldest message (e.g. the relationship card on an empty 1:1). */
  listFooter?: ReactNode;
  /** Between the list and the composer (e.g. a Message Request banner). */
  aboveComposer?: ReactNode;
  /** Replaces the composer (e.g. "You blocked …"). */
  composerReplacement?: ReactNode;
  hideComposer?: boolean;
  chemistry?: { strip: string; lines: ChemistryLine[] };
  /** Group owner/admin (may delete anyone's Open Loop). */
  moderator?: boolean;
  initialText?: string;
  /** Lets the screen put text in the box (e.g. a conversation starter). */
  composerRef?: RefObject<ComposerHandle | null>;
}

/**
 * The inside of a chat, 1:1 or group: messages (reactions, replies, Same
 * Brain), the long-press menu, Open Loops, Mutual Ping and its reveal, and
 * the composer. Headers and 1:1-only banners stay with their screens.
 */
export function ConversationBody({ conversationId: cid, group, otherName, placeholder, listFooter, aboveComposer, composerReplacement, hideComposer, chemistry, moderator = false, initialText, composerRef }: Props) {
  const uid = useChat((s) => s.uid);
  const messages = useChat((s) => s.messages[cid]) ?? EMPTY;
  const extras = useChat((s) => s.extras[cid]) ?? EMPTY_EXTRAS;
  useChat((s) => s.people); // re-render when names arrive
  const revealId = useChat((s) => s.reveal[cid]);
  const send = useChat((s) => s.send);
  const retry = useChat((s) => s.retry);
  const toggleReaction = useChat((s) => s.toggleReaction);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const sendPing = useChat((s) => s.sendPing);
  const cancelPing = useChat((s) => s.cancelPing);
  const dismissReveal = useChat((s) => s.dismissReveal);

  const [menuFor, setMenuFor] = useState<ChatMsg | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [loops, setLoops] = useState<LoopsView | null>(null);
  const [pingOpen, setPingOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inner = useRef<ComposerHandle>(null);
  const composer = composerRef ?? inner;

  const data = useMemo(() => [...messages].reverse(), [messages]); // inverted list: newest first
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const reactions = extras.reactions;
  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, typeof reactions>();
    for (const r of reactions) {
      if (!map.has(r.message_id)) map.set(r.message_id, []);
      map.get(r.message_id)!.push(r);
    }
    return map;
  }, [reactions]);
  const now = useMinuteClock();

  const nameOf = useCallback((id: string) => (id === uid ? 'You' : chatUser(id)?.displayName.split(' ')[0] ?? 'Someone'), [uid]);
  const myPing = extras.myPings.find((p) => !p.match_id && Date.parse(p.expires_at) > now);
  const reveal = revealId ? extras.matches.find((m) => m.id === revealId) : undefined;
  const openLoops = extras.loops.filter((l) => l.status === 'open').length;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const react = (messageId: string, emoji: string) => {
    setError(null);
    void toggleReaction(cid, messageId, emoji).catch(fail);
  };

  const planText = (kinds: PingKind[]) => (kinds.includes('food') ? 'Food tonight? I’m thinking ' : kinds.includes('call') || kinds.includes('need_advice') || kinds.includes('thinking_of_you') ? 'Call later? I’m free at ' : 'Tonight? How about ');

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {openLoops || extras.loops.length || chemistry ? (
        <View style={styles.top}>
          <OpenLoopsEntry open={openLoops} total={extras.loops.length} onPress={() => setLoops({ mode: 'list' })} />
          {chemistry ? <ChemistryStrip strip={chemistry.strip} lines={chemistry.lines} /> : null}
        </View>
      ) : null}
      <SameBrainBurst conversationId={cid} />
      <FlatList
        data={data}
        inverted
        keyExtractor={(m) => m.clientId ?? m.id}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 6, flexGrow: 1 }}
        ListFooterComponent={<View style={{ marginBottom: 8 }}>{listFooter}</View>}
        renderItem={({ item, index }) => {
          const mine = item.senderId === uid;
          const older = data[index + 1];
          const newer = data[index - 1];
          const newDay = !older || new Date(older.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
          const quoted = item.replyTo ? byId.get(item.replyTo) : undefined;
          const u = group && !mine ? chatUser(item.senderId) : undefined;
          return (
            <View>
              {newDay ? (
                <T v="caption" color={colors.inkFaint} weight="600" align="center" style={{ marginVertical: 8 }}>
                  {dayLabel(item.createdAt)}
                </T>
              ) : null}
              <ChatBubble
                m={item}
                mine={mine}
                sender={group ? { name: u?.displayName ?? 'Chimp member', avatar: u?.avatar, first: newDay || older?.senderId !== item.senderId, last: !newer || newer.senderId !== item.senderId } : undefined}
                quote={item.replyTo ? { name: quoted ? nameOf(quoted.senderId) : 'Earlier', text: quoted ? quoted.body ?? '📷 Photo' : 'an earlier message' } : null}
                reactions={summarizeReactions(reactionsByMsg.get(item.id) ?? [], extras.sameBrain, item.id, uid)}
                onLongPress={setMenuFor}
                onRetry={() => item.clientId && void retry(cid, item.clientId)}
                onToggleReaction={(e) => react(item.id, e)}
              />
            </View>
          );
        }}
      />

      {error ? (
        <T v="footnote" color={colors.danger} align="center" style={{ paddingHorizontal: 20, paddingBottom: 6 }} testID="chat-error">
          {error}
        </T>
      ) : null}
      {reveal ? (
        <RevealCard
          match={reveal}
          group={group}
          onDismiss={() => dismissReveal(cid)}
          onPlan={() => {
            dismissReveal(cid);
            composer.current?.fill(planText(reveal.kinds));
          }}
          onChat={() => {
            dismissReveal(cid);
            composer.current?.focus();
          }}
          onLoop={() => {
            dismissReveal(cid);
            setLoops({ mode: 'new', title: loopTitleForMatch(reveal), note: `From a Ping match (${[...new Set(reveal.kinds)].map(pingLabel).join(', ')})` });
          }}
        />
      ) : null}
      {aboveComposer}
      {composerReplacement ??
        (hideComposer ? null : (
          <ChatComposer
            ref={composer}
            placeholder={placeholder}
            initialText={initialText}
            replying={replyTo ? { name: nameOf(replyTo.senderId), text: replyTo.body ?? '📷 Photo' } : null}
            onCancelReply={() => setReplyTo(null)}
            onSend={(text, photo) => {
              setError(null);
              void send(cid, text, photo, replyTo?.id);
              setReplyTo(null);
            }}
            onPing={() => setPingOpen(true)}
            pingWaiting={!!myPing}
            onError={setError}
          />
        ))}

      <MessageMenu
        m={menuFor}
        mine={!!menuFor && menuFor.senderId === uid}
        myReactions={menuFor ? (reactionsByMsg.get(menuFor.id) ?? []).filter((r) => r.user_id === uid).map((r) => r.emoji) : []}
        onClose={() => setMenuFor(null)}
        onReact={(e) => menuFor && react(menuFor.id, e)}
        onReply={() => {
          if (!menuFor) return;
          setReplyTo(menuFor);
          composer.current?.focus();
        }}
        onLoop={() => menuFor && setLoops({ mode: 'new', title: loopTitleFrom(menuFor.body), sourceMessageId: menuFor.id })}
        onDelete={() => (menuFor ? deleteMessage(cid, menuFor.id) : Promise.resolve())}
      />
      <LoopsSheet conversationId={cid} view={loops} onView={setLoops} moderator={moderator} />
      <PingSheet
        visible={pingOpen}
        group={group}
        otherName={otherName}
        mine={myPing}
        onClose={() => setPingOpen(false)}
        onSend={(kind, text) => sendPing(cid, kind, text)}
        onCancel={(id) => cancelPing(cid, id)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
});
