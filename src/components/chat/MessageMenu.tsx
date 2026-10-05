import * as Clipboard from 'expo-clipboard';
import { Copy, CornerUpLeft, Repeat, Trash2 } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { REACTIONS } from '@/services/backend/chat';
import type { ChatMsg } from '@/store/useChat';
import { colors, radius } from '@/theme';

interface Props {
  m: ChatMsg | null;
  mine: boolean;
  /** Emojis I've already put on this message. */
  myReactions: string[];
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onLoop: () => void;
  onDelete: () => Promise<void>;
}

/** Long-press on a message: React · Reply · Turn into Open Loop · Copy · Delete (yours). */
export function MessageMenu({ m, mine, myReactions, onClose, onReact, onReply, onLoop, onDelete }: Props) {
  const insets = useDeviceInsets(); // Phase 8: a Modal sheet covers the whole phone → its real insets
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = !!m?.status; // not on the server yet: nothing to react to or quote
  const close = () => {
    if (busy) return;
    setConfirm(false);
    setError(null);
    setCopied(false);
    onClose();
  };
  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setBusy(false);
      close();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal visible={!!m} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close menu">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
          {m && !confirm ? (
            <>
              {m.body ? (
                <T v="footnote" color={colors.inkMuted} numberOfLines={2} style={{ paddingHorizontal: 8, marginBottom: 10 }}>
                  {m.body}
                </T>
              ) : null}
              {!pending ? (
                <View style={styles.reactRow} accessibilityLabel="React">
                  {REACTIONS.map((e) => {
                    const on = myReactions.includes(e);
                    return (
                      <Tap
                        key={e}
                        onPress={() => {
                          onReact(e);
                          close();
                        }}
                        haptic="select"
                        scaleTo={0.85}
                        style={[styles.react, on && styles.reactOn]}
                        accessibilityLabel={on ? `Remove ${e}` : `React ${e}`}
                        testID={`react-${e}`}
                      >
                        <T style={{ fontSize: 26, lineHeight: 32 }}>{e}</T>
                      </Tap>
                    );
                  })}
                </View>
              ) : null}
              {!pending ? (
                <Row icon={<CornerUpLeft size={19} color={colors.ink} />} label="Reply" onPress={() => { onReply(); close(); }} />
              ) : null}
              {!pending ? (
                <Row icon={<Repeat size={19} color={colors.ink} />} label="Turn into Open Loop" sub="Something to come back to, for everyone here" onPress={() => { onLoop(); close(); }} />
              ) : null}
              {m.body ? (
                <Row
                  icon={<Copy size={19} color={colors.ink} />}
                  label={copied ? 'Copied' : 'Copy'}
                  onPress={() => {
                    void Clipboard.setStringAsync(m.body ?? '').then(() => {
                      setCopied(true);
                      setTimeout(close, 500);
                    });
                  }}
                />
              ) : null}
              {mine ? <Row icon={<Trash2 size={19} color={colors.danger} />} label="Delete" danger onPress={() => (pending ? void del() : setConfirm(true))} /> : null}
              <Tap onPress={close} style={[styles.row, styles.cancel]} accessibilityLabel="Cancel">
                <T v="bodyStrong" color={colors.ink2}>
                  Cancel
                </T>
              </Tap>
            </>
          ) : null}
          {m && confirm ? (
            <View style={{ paddingHorizontal: 6 }}>
              <T v="title3">Delete this message?</T>
              <T v="subhead" color={colors.inkMuted} weight="400" style={{ marginTop: 6 }}>
                It’s removed for everyone in this chat. This can’t be undone.
              </T>
              {error ? (
                <T v="footnote" color={colors.danger} style={{ marginTop: 10 }}>
                  {error}
                </T>
              ) : null}
              <Tap onPress={() => void del()} disabled={busy} style={[styles.big, { backgroundColor: colors.danger }]} accessibilityLabel="Confirm delete message">
                {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>Delete message</T>}
              </Tap>
              <Tap onPress={close} disabled={busy} style={[styles.big, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Keep it">
                <T v="bodyStrong" color={colors.ink2}>
                  Keep it
                </T>
              </Tap>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ icon, label, sub, danger, onPress }: { icon: ReactNode; label: string; sub?: string; danger?: boolean; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={styles.row} accessibilityLabel={label}>
      {icon}
      <View style={{ flex: 1, marginLeft: 14 }}>
        <T v="bodyStrong" color={danger ? colors.danger : colors.ink}>
          {label}
        </T>
        {sub ? (
          <T v="footnote" color={colors.inkMuted} weight="400">
            {sub}
          </T>
        ) : null}
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14, paddingHorizontal: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  reactRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 6, marginBottom: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  react: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  reactOn: { backgroundColor: colors.accentGlow },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingHorizontal: 8, borderRadius: radius.lg },
  cancel: { justifyContent: 'center', marginTop: 4, backgroundColor: colors.surfaceMuted },
  big: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
