import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { PingKind, PingRow } from '@/services/backend/chat';
import { colors, radius } from '@/theme';
import { PING_TYPES, pingEmoji, pingLabel } from '@/utils/messaging';

interface Props {
  visible: boolean;
  group: boolean;
  /** 1:1: their first name. */
  otherName?: string;
  /** My live, unmatched Ping here (only mine is ever readable). */
  mine?: PingRow;
  onClose: () => void;
  onSend: (kind: PingKind, text?: string) => Promise<'waiting' | 'matched'>;
  onCancel: (id: string) => Promise<void>;
}

const hoursLeft = (iso: string) => Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3600000));

/**
 * Mutual Ping: say what you're up for, privately. Nobody sees it. It's only
 * revealed if it matches: the other person (1:1) or 2+ others (group) Ping
 * something compatible within 24 hours. No AI: a fixed map decides.
 */
export function PingSheet({ visible, group, otherName, mine, onClose, onSend, onCancel }: Props) {
  const insets = useDeviceInsets(); // Phase 8: a Modal sheet covers the whole phone → its real insets
  const [kind, setKind] = useState<PingKind | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const close = () => {
    if (busy) return;
    setKind(null);
    setText('');
    setError(null);
    setSent(false);
    onClose();
  };
  const send = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const status = await onSend(kind, kind === 'custom' ? text : undefined);
      setBusy(false);
      if (status === 'matched') close();
      else setSent(true);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const cancel = async () => {
    if (!mine) return;
    setBusy(true);
    try {
      await onCancel(mine.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const who = group ? 'at least 2 others here' : otherName ?? 'they';
  const canSend = !!kind && (kind !== 'custom' || text.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close Ping">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]} onPress={() => undefined}>
            <View style={styles.grabber} />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T v="title3" style={{ flex: 1 }}>
                Ping
              </T>
              <View style={styles.private}>
                <Lock size={12} color={colors.violet} />
                <T v="caption" color={colors.violet} style={{ marginLeft: 4 }}>
                  Private
                </T>
              </View>
            </View>
            <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 4, marginBottom: 12 }}>
              {group
                ? 'Nobody sees your Ping. If at least 2 others here Ping something that fits within 24 hours, it’s revealed to the group.'
                : `${otherName ?? 'They'} won’t see your Ping unless they Ping something that fits within 24 hours. Then you both find out.`}
            </T>

            {mine && !sent ? (
              <View style={styles.mine} testID="my-ping">
                <T v="subhead" weight="700">{`Your Ping: ${pingEmoji(mine.kind)} ${mine.kind === 'custom' ? `“${mine.custom_text ?? ''}”` : pingLabel(mine.kind)}`}</T>
                <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 2 }}>
                  {`Waiting privately · ${hoursLeft(mine.expires_at)} h left. Sending another replaces it.`}
                </T>
                <Tap onPress={() => void cancel()} disabled={busy} style={styles.cancelPing} accessibilityLabel="Cancel my Ping">
                  <T v="footnote" weight="700" color={colors.ink2}>
                    Cancel it
                  </T>
                </Tap>
              </View>
            ) : null}

            {sent ? (
              <View style={styles.sent} testID="ping-sent">
                <T v="headline">Sent, privately.</T>
                <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 4 }}>
                  {`Nobody can see it. If ${who} ${group ? 'Ping' : 'Pings'} something that fits in the next 24 hours, it’s revealed. If not, it quietly disappears.`}
                </T>
                <Tap onPress={close} style={[styles.big, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Done">
                  <T v="bodyStrong" color={colors.ink2}>
                    Done
                  </T>
                </Tap>
              </View>
            ) : (
              <>
                <View style={styles.grid}>
                  {PING_TYPES.map((p) => {
                    const on = p.kind === kind;
                    return (
                      <Tap key={p.kind} onPress={() => setKind(p.kind)} haptic="select" style={[styles.type, on && styles.typeOn]} accessibilityLabel={`${p.label}${on ? ', selected' : ''}`} testID={`ping-${p.kind}`}>
                        <T style={{ fontSize: 18, lineHeight: 22 }}>{p.emoji}</T>
                        <T v="subhead" weight="700" color={on ? colors.violet : colors.ink2} style={{ marginLeft: 6 }}>
                          {p.label}
                        </T>
                      </Tap>
                    );
                  })}
                </View>
                {kind === 'custom' ? (
                  <>
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      placeholder="A few words (e.g. Sushi Friday)"
                      placeholderTextColor={colors.inkFaint}
                      maxLength={60}
                      style={styles.input}
                      autoFocus
                      accessibilityLabel="Custom Ping"
                    />
                    <T v="caption" color={colors.inkFaint} style={{ marginTop: 4 }}>
                      Custom Pings match only the same words.
                    </T>
                  </>
                ) : null}
                {error ? (
                  <T v="footnote" color={colors.danger} style={{ marginTop: 10 }}>
                    {error}
                  </T>
                ) : null}
                <Tap onPress={() => void send()} disabled={!canSend || busy} style={[styles.big, { backgroundColor: colors.violet }, (!canSend || busy) && { opacity: 0.45 }]} accessibilityLabel="Send Ping privately">
                  {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>Send privately</T>}
                </Tap>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8, width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: 12 },
  private: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: colors.violetSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  type: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  typeOn: { borderColor: colors.violet, backgroundColor: colors.violetSoft },
  input: { marginTop: 12, height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, fontSize: 16, color: colors.ink },
  mine: { padding: 12, borderRadius: radius.lg, backgroundColor: colors.violetSoft, marginBottom: 12 },
  cancelPing: { alignSelf: 'flex-start', marginTop: 8, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surface, justifyContent: 'center' },
  sent: { paddingVertical: 4 },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});
