/**
 * Phase 7A: a Vibe's private conversation — After Dark's own chat UX (dark),
 * on the ordinary chat store. Text, voice notes, photos and view-once photos
 * (each only if the other person allows them), reactions, replies, and the
 * pair's Challenges, Open Loops and Plans in the same timeline.
 */
import { CornerUpLeft, Eye, EyeOff, Mic, Plus, Send, Trash2, X } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { REACTIONS } from '@/services/backend/chat';
import { userMessage } from '@/services/backend/errors';
import type { ChallengeRow, VibeRow } from '@/services/backend/afterDark';
import type { LoopRow } from '@/services/backend/chat';
import { pickImages, type PickedImage } from '@/services/backend/media';
import { challengeView, firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { type ChatMsg, EMPTY_EXTRAS, useChat } from '@/store/useChat';
import { openMedia } from '@/store/useMediaViewer';
import { clockLabel, whenLabel } from '@/utils/format';
import { loopTitleFrom, summarizeReactions } from '@/utils/messaging';
import { ad } from './adTheme';
import { ChallengeCard, NewChallengeSheet } from './ChallengesTab';
import { PlanCard, PlanSheet } from './PlansTab';
import { ChoiceRow, DarkSheet, originLine } from './VibeParts';
import { durationText, MAX_VOICE_MS, useVoiceRecorder, VoiceBubble } from './VoiceNote';
import { FullscreenTopBar, MIN_TAP } from '@/components/system/SafeArea';

const EMPTY: ChatMsg[] = [];

/** "Today" / "Yesterday" / "Sep 24" between days. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
type Item = { key: string; at: string } & ({ kind: 'msg'; m: ChatMsg } | { kind: 'challenge'; c: ChallengeRow } | { kind: 'loop'; l: LoopRow });

export interface VibeChatHandle {
  openChallenge: () => void;
  focus: () => void;
}

export const VibeChat = forwardRef<VibeChatHandle, { v: VibeRow; canSend: boolean; banner?: React.ReactNode }>(function VibeChat({ v, canSend, banner }, ref) {
  const cid = v.conversation_id;
  const uid = useChat((s) => s.uid);
  const messages = useChat((s) => s.messages[cid]) ?? EMPTY;
  const extras = useChat((s) => s.extras[cid]) ?? EMPTY_EXTRAS;
  const send = useChat((s) => s.send);
  const retry = useChat((s) => s.retry);
  const toggleReaction = useChat((s) => s.toggleReaction);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const createLoop = useChat((s) => s.createLoop);
  const openViewOnce = useChat((s) => s.openViewOnce);
  const ads = useAfterDark();
  const first = firstNameOf(v.other_id);

  const [error, setError] = useState<string | null>(null);
  // A calm note (not an error): e.g. photos aren't enabled for this Vibe.
  const [notice, setNotice] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMsg | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [tray, setTray] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [plan, setPlan] = useState<{ title?: string; sourceMessageId?: string | null } | null>(null);
  const [tweak, setTweak] = useState<{ loop: LoopRow; v: VibeRow } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  // Phase 7B: view-once needs the server function; say so instead of failing after the pick.
  const [onceReady, setOnceReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (tray && onceReady !== true) void useChat.getState().viewOnceAvailable().then(setOnceReady);
  }, [tray, onceReady]);
  const composer = useRef<ComposerHandle>(null);

  useImperativeHandle(ref, () => ({ openChallenge: () => setChallenge(true), focus: () => composer.current?.focus() }));

  const fail = useCallback((e: unknown) => setError(userMessage(e, 'That didn’t work. Try again.')), []);
  const afterChange = () => void ads.refresh();

  // One timeline: messages, the pair's challenges, their Open Loops and Plans.
  const items = useMemo(() => {
    const list: Item[] = [
      ...messages.map((m): Item => ({ key: m.clientId ?? m.id, at: m.createdAt, kind: 'msg', m })),
      ...ads.challenges.filter((c) => c.vibe_id === v.vibe_id).map((c): Item => ({ key: `c_${c.id}`, at: c.created_at, kind: 'challenge', c })),
      ...extras.loops.map((l): Item => ({ key: `l_${l.id}`, at: l.created_at, kind: 'loop', l })),
    ];
    return list.sort((a, b) => b.at.localeCompare(a.at)); // inverted list: newest first
  }, [messages, ads.challenges, extras.loops, v.vibe_id]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const sendText = (text: string) => {
    setError(null);
    void send(cid, text, undefined, replyTo?.id).then(afterChange);
    setReplyTo(null);
  };
  // Photos (normal and view-once) reach someone only if THEY allow them. The
  // server enforces it (vibe_can_send in the "messages send" policy); the app
  // shows it (locked rows) and checks again just before picking.
  const photosLocked = !v.their_allows_photos;
  const photosOffNote = `${first} hasn’t enabled photos yet.`;
  const notAllowedReason = () => (useAfterDark.getState().vibes.find((x) => x.vibe_id === v.vibe_id)?.status ?? v.status) !== 'active' ? 'This Vibe is no longer active.' : 'Photos aren’t enabled for this Vibe yet.';

  const sendPhoto = async (viewOnce: boolean) => {
    setError(null);
    setNotice(null);
    try {
      const allowed = await ads.canSend(cid, 'photo', viewOnce);
      if (allowed === false) {
        await ads.refresh(); // show what the server now says (locked rows, Vibe state)
        return setNotice(notAllowedReason());
      }
      const [img] = await pickImages({ source: 'library' });
      if (!img) return; // cancelled: nothing to say
      await send(cid, '', img as PickedImage, undefined, { viewOnce });
      afterChange();
    } catch (e) {
      setError(userMessage(e, 'Couldn’t send the photo. Try again.'));
    }
  };
  // iOS can't present the photo picker while the sheet is still sliding away:
  // pick once it's fully dismissed (onDismiss), or after the animation elsewhere.
  const pendingPick = useRef<boolean | null>(null);
  const runPendingPick = () => {
    const viewOnce = pendingPick.current;
    if (viewOnce === null) return; // already started (onDismiss and the timer both call this)
    pendingPick.current = null;
    void sendPhoto(viewOnce);
  };
  const choosePhoto = (viewOnce: boolean) => {
    if (photosLocked) return;
    pendingPick.current = viewOnce;
    setTray(false);
    setTimeout(runPendingPick, Platform.OS === 'ios' ? 650 : 350);
  };
  /** Why a message didn't send, in plain words (never a raw server error). */
  const failText = (m: ChatMsg): string | null => {
    if (m.status !== 'failed') return null;
    if (m.failKind === 'offline') return 'You’re offline. Try again when you’re connected.';
    if (v.status !== 'active') return 'This Vibe is no longer active.';
    if (m.type === 'photo' && photosLocked) return 'Photos aren’t enabled for this Vibe yet.';
    if (m.type === 'photo') return 'Couldn’t send the photo. Try again.';
    return null;
  };
  const sendVoice = async (voice: { uri: string; durationMs: number }) => {
    setError(null);
    await send(cid, '', undefined, undefined, { voice });
    afterChange();
  };
  const openOnce = async (m: ChatMsg) => {
    try {
      const url = await openViewOnce(cid, m.id);
      if (url) setViewing(url);
      afterChange();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList
        data={items}
        inverted
        keyExtractor={(i) => i.key}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 14, gap: 8, flexGrow: 1 }}
        ListFooterComponent={<HowItStarted v={v} />}
        renderItem={({ item, index }) => {
          const older = items[index + 1];
          const newDay = !older || new Date(older.at).toDateString() !== new Date(item.at).toDateString();
          return (
            <View>
              {newDay ? (
                <T v="caption" color={ad.faint} weight="600" align="center" style={{ marginVertical: 8 }}>
                  {dayLabel(item.at)}
                </T>
              ) : null}
              {item.kind === 'challenge' ? (
                <ChallengeCard c={item.c} v={v} {...challengeView(ads, item.c, uid)} compact />
              ) : item.kind === 'loop' ? (
                <PlanCard loop={item.l} v={v} compact onTweak={(loop, vv) => setTweak({ loop, v: vv })} />
              ) : (
                <Bubble
                  m={item.m}
                  mine={item.m.senderId === uid}
                  quote={item.m.replyTo ? byId.get(item.m.replyTo) : undefined}
                  first={first}
                  reactions={summarizeReactions(extras.reactions, extras.sameBrain, item.m.id, uid)}
                  onLongPress={canSend ? setMenuFor : undefined}
                  onRetry={() => item.m.clientId && void retry(cid, item.m.clientId)}
                  failText={failText(item.m)}
                  onOpenOnce={() => void openOnce(item.m)}
                  onReact={(e) => canSend && void toggleReaction(cid, item.m.id, e).catch(fail)}
                />
              )}
            </View>
          );
        }}
      />
      {error ? (
        <T v="footnote" color={ad.danger} align="center" style={{ paddingHorizontal: 20, paddingBottom: 6 }} testID="vibe-error">
          {error}
        </T>
      ) : notice ? (
        <T v="footnote" color={ad.muted} align="center" style={{ paddingHorizontal: 20, paddingBottom: 6 }} testID="vibe-notice">
          {notice}
        </T>
      ) : null}
      {banner}
      {!canSend ? <BottomSpace /> : null}
      {canSend ? (
        <Composer
          ref={composer}
          first={first}
          voiceAllowed={v.their_allows_voice}
          replying={replyTo ? { name: replyTo.senderId === uid ? 'You' : first, text: replyTo.body ?? (replyTo.type === 'voice' ? 'Voice note' : 'Photo') } : null}
          onCancelReply={() => setReplyTo(null)}
          onSend={sendText}
          onVoice={sendVoice}
          onPlus={() => {
            setTray(true);
            setNotice(null);
            void ads.refresh(); // the sheet shows current consent, not what this screen loaded earlier
          }}
          onError={setError}
        />
      ) : null}

      <DarkSheet visible={tray} onClose={() => setTray(false)} onDismissed={runPendingPick} title={`Add to your Vibe with ${first}`} testID="vibe-tray">
        <ChoiceRow label="⚡  Challenge" style={styles.trayRow} sub="A quick game for two. Results show when you’ve both played." onPress={() => { setTray(false); setChallenge(true); }} testID="tray-challenge" />
        <ChoiceRow label="📅  Plan" style={styles.trayRow} sub={`Suggest a time and place. ${first} says yes.`} onPress={() => { setTray(false); setPlan({}); }} testID="tray-plan" />
        <ChoiceRow label="🖼  Photo" style={styles.trayRow} locked={photosLocked} sub={photosLocked ? undefined : 'From your library, into this chat.'} onPress={() => choosePhoto(false)} testID="tray-photo" />
        <ChoiceRow
          label="👁  View-once photo"
          style={styles.trayRow}
          locked={photosLocked || onceReady === false}
          sub={photosLocked ? undefined : onceReady === false ? 'View-once isn’t set up on the server yet.' : `${first} can open it one time. Screenshots can’t be blocked.`}
          onPress={() => choosePhoto(true)}
          testID="tray-view-once"
        />
        {photosLocked ? (
          <T v="footnote" color={ad.muted} style={{ marginTop: 2, marginBottom: 4, lineHeight: 18 }} testID="tray-photos-note">
            {`${photosOffNote} ${first} decides whether photos can be sent to them.`}
          </T>
        ) : null}
      </DarkSheet>
      <NewChallengeSheet visible={challenge} onClose={() => setChallenge(false)} vibes={[v]} fixed={v} />
      <PlanSheet target={tweak} create={plan ? { v, ...plan } : null} onClose={() => { setTweak(null); setPlan(null); }} />
      <MessageSheet
        m={menuFor}
        mine={menuFor?.senderId === uid}
        onClose={() => setMenuFor(null)}
        onReact={(e) => menuFor && void toggleReaction(cid, menuFor.id, e).catch(fail)}
        onReply={() => {
          if (menuFor) setReplyTo(menuFor);
          composer.current?.focus();
        }}
        onLoop={() => menuFor && void createLoop(cid, loopTitleFrom(menuFor.body), menuFor.id).then(() => ads.refreshLoops()).catch(fail)}
        onPlan={() => menuFor && setPlan({ title: loopTitleFrom(menuFor.body), sourceMessageId: menuFor.id })}
        onDelete={() => menuFor && void deleteMessage(cid, menuFor.id).catch(fail)}
      />
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer} testID="view-once-viewer">
          {viewing ? <Img uri={viewing} contentFit="contain" tint="#000" style={StyleSheet.absoluteFill} /> : null}
          {/* Phase 8: placed from the phone's real insets (was a fixed top: 54, which sat
              inside the Dynamic Island / status bar on 59–62-pt phones). */}
          <FullscreenTopBar
            left={
              <T v="footnote" weight="700" color="#fff" numberOfLines={2} style={{ flexShrink: 1 }}>
                View once · it disappears when you close it. Screenshots can’t be blocked.
              </T>
            }
            right={
              <Tap onPress={() => setViewing(null)} style={styles.viewerX} accessibilityLabel="Close photo" testID="view-once-close" hitSlop={8}>
                <X size={20} color="#fff" />
              </Tap>
            }
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
});

function BottomSpace() {
  const insets = useSafeAreaInsets();
  return <View style={{ height: Math.max(insets.bottom, 12) }} />;
}

function HowItStarted({ v }: { v: VibeRow }) {
  const first = firstNameOf(v.other_id);
  return (
    <View style={styles.started} testID="how-it-started">
      <T v="eyebrow" color={ad.pink}>
        HOW IT STARTED
      </T>
      <T v="callout" weight="600" color={ad.ink} style={{ marginTop: 6 }}>
        {originLine(v, first)}
      </T>
      {v.origin_text ? (
        <T v="callout" color={ad.muted} style={{ marginTop: 6, fontStyle: 'italic' }}>
          {`“${v.origin_text}”`}
        </T>
      ) : null}
      <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 8 }}>
        {`${whenLabel(v.created_at)} · Only you and ${first} can see this conversation.`}
      </T>
    </View>
  );
}

function Bubble({ m, mine, quote, first, reactions, onLongPress, onRetry, onOpenOnce, onReact, failText }: { m: ChatMsg; mine: boolean; quote?: ChatMsg; first: string; reactions: ReturnType<typeof summarizeReactions>; onLongPress?: (m: ChatMsg) => void; onRetry: () => void; onOpenOnce: () => void; onReact: (e: string) => void; failText?: string | null }) {
  const failed = m.status === 'failed';
  const quoteText = quote ? `${quote.senderId === m.senderId ? (mine ? 'You' : first) : mine ? first : 'You'}: ${quote.body ?? (quote.type === 'voice' ? 'Voice note' : 'Photo')}` : null;
  let content: React.ReactNode;
  if (m.type === 'voice') {
    content = <VoiceBubble id={m.id} uri={m.audio} durationMs={m.durationMs} mine={mine} />;
  } else if (m.viewOnce) {
    const opened = !!m.viewedAt;
    content = (
      <Tap onPress={!mine && !opened && !m.status ? onOpenOnce : undefined} disabled={mine || opened} style={[styles.once, mine ? styles.mineBg : styles.theirsBg]} accessibilityLabel={mine ? `View-once photo, ${opened ? 'opened' : 'not opened yet'}` : opened ? 'View-once photo, opened' : 'View-once photo. Tap to open. You can open it once.'} testID={`once-${m.id}`}>
        {opened ? <EyeOff size={18} color="#fff" /> : <Eye size={18} color="#fff" />}
        <View style={{ marginLeft: 10 }}>
          <T v="subhead" weight="700" color="#fff">
            {mine ? 'View-once photo' : opened ? 'Opened' : 'Photo · view once'}
          </T>
          <T v="caption" weight="500" color="rgba(255,255,255,0.75)">
            {mine ? (opened ? `${first} opened it` : m.status === 'sending' ? 'Sending…' : failed ? 'Not sent' : 'Not opened yet') : opened ? 'It’s gone now' : 'Tap to open'}
          </T>
        </View>
      </Tap>
    );
  } else if (m.image) {
    content = (
      <Tap onPress={() => openMedia([m.image!], m.aspect ? [m.aspect] : undefined, 0)} accessibilityLabel="Photo">
        <Img uri={m.image} style={{ width: 220, height: Math.round(220 / Math.min(1.6, Math.max(0.7, m.aspect ?? 1))), borderRadius: 18, opacity: m.status === 'sending' ? 0.6 : 1 }} />
      </Tap>
    );
  } else {
    content = null;
  }
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable onLongPress={onLongPress ? () => onLongPress(m) : undefined} delayLongPress={320} style={{ alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '86%' }} accessibilityHint={onLongPress ? 'Long-press to react or reply' : undefined} testID={`vmsg-${m.body ?? m.id}`}>
        {quoteText ? (
          <View style={styles.quote}>
            <CornerUpLeft size={12} color={ad.faint} />
            <T v="caption" color={ad.muted} numberOfLines={1} style={{ marginLeft: 4, flexShrink: 1 }}>
              {quoteText}
            </T>
          </View>
        ) : null}
        {content}
        {m.body && m.type !== 'voice' ? (
          <View style={[styles.bubble, mine ? styles.mineBg : styles.theirsBg, failed && { backgroundColor: 'rgba(255,90,95,0.25)' }, content ? { marginTop: 4 } : null, mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }]}>
            <T v="subhead" weight="400" color="#fff">
              {m.body}
            </T>
          </View>
        ) : null}
      </Pressable>
      {reactions.length && !m.status ? (
        <View style={[styles.reactions, mine && { justifyContent: 'flex-end' }]}>
          {reactions.map((r) => (
            <Tap key={r.emoji} onPress={() => onReact(r.emoji)} style={[styles.chip, r.mine && { borderColor: ad.pink }]} accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', you reacted' : ''}`}>
              <T v="footnote">{`${r.emoji}${r.count > 1 ? ` ${r.count}` : ''}`}</T>
            </Tap>
          ))}
        </View>
      ) : null}
      {failed ? (
        <Tap onPress={onRetry} style={{ marginTop: 3, alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: 260 }} accessibilityLabel={`Not sent${failText ? `. ${failText}` : ''}. Tap to retry`} testID="vmsg-failed">
          {failText ? (
            <T v="caption" weight="500" color={ad.muted} align={mine ? 'right' : 'left'} testID="vmsg-fail-reason">
              {failText}
            </T>
          ) : null}
          <T v="caption" weight="700" color={ad.danger}>
            Not sent · Tap to retry
          </T>
        </Tap>
      ) : (
        <T v="caption" color={ad.faint} style={{ marginTop: 2, fontSize: 11 }}>
          {m.status === 'sending' ? 'Sending…' : clockLabel(m.createdAt)}
        </T>
      )}
    </View>
  );
}

function MessageSheet({ m, mine, onClose, onReact, onReply, onLoop, onPlan, onDelete }: { m: ChatMsg | null; mine: boolean; onClose: () => void; onReact: (e: string) => void; onReply: () => void; onLoop: () => void; onPlan: () => void; onDelete: () => void }) {
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <DarkSheet visible={!!m} onClose={onClose} title="Message" testID="vibe-msg-menu">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
        {REACTIONS.map((e) => (
          <Tap key={e} onPress={run(() => onReact(e))} style={styles.react} accessibilityLabel={`React ${e}`}>
            <T style={{ fontSize: 26 }}>{e}</T>
          </Tap>
        ))}
      </View>
      <ChoiceRow label="Reply" onPress={run(onReply)} />
      <ChoiceRow label="Save as an Open Loop" onPress={run(onLoop)} />
      <ChoiceRow label="Make it a plan" onPress={run(onPlan)} />
      {mine ? <ChoiceRow label="Delete" danger onPress={run(onDelete)} /> : null}
    </DarkSheet>
  );
}

// ─── Composer ──────────────────────────────────────────────────────────────

interface ComposerHandle {
  focus: () => void;
}

const Composer = forwardRef<ComposerHandle, { first: string; voiceAllowed: boolean; replying: { name: string; text: string } | null; onCancelReply: () => void; onSend: (t: string) => void; onVoice: (v: { uri: string; durationMs: number }) => Promise<void>; onPlus: () => void; onError: (m: string) => void }>(function Composer(
  { first, voiceAllowed, replying, onCancelReply, onSend, onVoice, onPlus, onError },
  ref,
) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const rec = useVoiceRecorder(onError);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  const stopAndSend = useCallback(async () => {
    const got = await rec.finish(true);
    if (got) await onVoice(got);
  }, [rec, onVoice]);
  useEffect(() => {
    if (rec.active && rec.durationMs >= MAX_VOICE_MS) void stopAndSend();
  }, [rec.active, rec.durationMs, stopAndSend]);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };
  const pad = { paddingBottom: Math.max(insets.bottom, 8) };

  if (rec.active) {
    return (
      <View style={[styles.composer, pad]} testID="voice-recording">
        <Tap onPress={() => void rec.finish(false)} style={styles.side} accessibilityLabel="Cancel voice note" testID="voice-cancel">
          <Trash2 size={20} color={ad.muted} />
        </Tap>
        <View style={styles.recBar}>
          <View style={styles.recDot} />
          <T v="callout" weight="700" color="#fff" style={{ marginLeft: 8 }}>
            {durationText(rec.durationMs)}
          </T>
          <T v="footnote" color={ad.faint} style={{ marginLeft: 8 }}>
            Recording…
          </T>
        </View>
        <Tap onPress={() => void stopAndSend()} haptic="light" style={styles.send} accessibilityLabel="Send voice note" testID="voice-send">
          <Send size={18} color="#fff" />
        </Tap>
      </View>
    );
  }

  return (
    <View style={pad}>
      {replying ? (
        <View style={styles.reply}>
          <CornerUpLeft size={14} color={ad.pink} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T v="caption" color={ad.pink}>{`Replying to ${replying.name}`}</T>
            <T v="footnote" color={ad.muted} numberOfLines={1}>
              {replying.text}
            </T>
          </View>
          <Tap onPress={onCancelReply} style={styles.side} accessibilityLabel="Cancel reply">
            <X size={16} color={ad.muted} />
          </Tap>
        </View>
      ) : null}
      <View style={styles.composer}>
        <Tap onPress={onPlus} style={styles.plus} accessibilityLabel="Add a challenge, plan or photo" testID="vibe-plus">
          <Plus size={20} color="#fff" />
        </Tap>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={`Message ${first}`}
          placeholderTextColor={ad.faint}
          style={styles.input}
          multiline
          maxLength={4000}
          accessibilityLabel="Message"
          testID="vibe-input"
        />
        {text.trim() ? (
          <Tap onPress={submit} haptic="light" style={styles.send} accessibilityLabel="Send message" testID="vibe-send">
            <Send size={18} color="#fff" />
          </Tap>
        ) : (
          <Tap
            onPress={() => (voiceAllowed ? void rec.start() : onError(`${first} isn’t taking voice notes right now.`))}
            style={[styles.send, { backgroundColor: ad.raised }, !voiceAllowed && { opacity: 0.5 }]}
            accessibilityLabel={voiceAllowed ? 'Record a voice note' : `${first} isn’t taking voice notes`}
            testID="vibe-mic"
          >
            <Mic size={19} color="#fff" />
          </Tap>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Phase 7B patch: the four tray rows share one height, locked or not.
  trayRow: { minHeight: 60 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, maxWidth: 300 },
  mineBg: { backgroundColor: ad.pinkDeep },
  theirsBg: { backgroundColor: ad.raised },
  once: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, minWidth: 200 },
  quote: { flexDirection: 'row', alignItems: 'center', maxWidth: 260, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 3, borderRadius: 12, backgroundColor: ad.glass, borderLeftWidth: 3, borderLeftColor: ad.pink },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chip: { height: 26, paddingHorizontal: 8, borderRadius: 13, backgroundColor: ad.card2, borderWidth: 1, borderColor: ad.line, justifyContent: 'center' },
  started: { marginBottom: 10, padding: 14, borderRadius: 20, backgroundColor: ad.plum2, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.pinkLine },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ad.line, backgroundColor: ad.bg },
  side: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 40, height: 40, borderRadius: 20, backgroundColor: ad.raised, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: ad.card2, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16, color: '#fff', marginLeft: 8 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: ad.pink, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  recBar: { flex: 1, height: 44, borderRadius: 22, backgroundColor: ad.card2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ad.danger },
  reply: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 6, paddingLeft: 12, paddingVertical: 4, borderRadius: 14, backgroundColor: ad.pinkSoft },
  react: { width: 46, height: 46, borderRadius: 23, backgroundColor: ad.glass, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerX: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
