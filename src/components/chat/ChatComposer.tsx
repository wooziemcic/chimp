import { CornerUpLeft, ImageIcon, Send, Sparkles, X } from 'lucide-react-native';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type PickedImage, pickImages } from '@/services/backend/media';
import { colors } from '@/theme';

export interface ComposerHandle {
  /** Put text in the box (e.g. "Make a plan") and focus it. */
  fill: (text: string) => void;
  focus: () => void;
}

interface Props {
  placeholder: string;
  onSend: (text: string, photo?: PickedImage) => void;
  /** Replying to a message. */
  replying?: { name: string; text: string } | null;
  onCancelReply: () => void;
  onPing: () => void;
  /** I have a Ping waiting (private): the button shows a quiet dot. */
  pingWaiting?: boolean;
  initialText?: string;
  onError?: (message: string) => void;
}

/** The message box: + photo · + Ping · text · send. */
export const ChatComposer = forwardRef<ComposerHandle, Props>(function ChatComposer({ placeholder, onSend, replying, onCancelReply, onPing, pingWaiting, initialText, onError }, ref) {
  const [text, setText] = useState(initialText ?? '');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    fill: (t) => {
      setText(t);
      setTimeout(() => input.current?.focus(), 50);
    },
    focus: () => input.current?.focus(),
  }));

  const submit = () => {
    if (!text.trim() && !photo) return;
    onSend(text, photo ?? undefined);
    setText('');
    setPhoto(null);
  };
  const pickPhoto = async () => {
    try {
      const [img] = await pickImages({ source: 'library' });
      if (img) setPhoto(img);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View>
      {replying ? (
        <View style={styles.reply}>
          <CornerUpLeft size={14} color={colors.accent} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T v="caption" color={colors.accent}>{`Replying to ${replying.name}`}</T>
            <T v="footnote" color={colors.inkMuted} numberOfLines={1}>
              {replying.text}
            </T>
          </View>
          <Tap onPress={onCancelReply} style={styles.replyX} accessibilityLabel="Cancel reply">
            <X size={16} color={colors.inkMuted} />
          </Tap>
        </View>
      ) : null}
      {photo ? (
        <View style={styles.preview}>
          <Img uri={photo.uri} style={{ width: 64, height: 64, borderRadius: 12 }} />
          <Tap onPress={() => setPhoto(null)} style={styles.previewX} accessibilityLabel="Remove photo">
            <X size={14} color={colors.white} />
          </Tap>
        </View>
      ) : null}
      <View style={styles.composer}>
        <Tap onPress={pickPhoto} style={styles.side} accessibilityLabel="Add a photo">
          <ImageIcon size={22} color={colors.accent} />
        </Tap>
        <Tap onPress={onPing} style={styles.side} accessibilityLabel={pingWaiting ? 'Ping (yours is waiting privately)' : 'Ping'} testID="ping-button">
          <Sparkles size={21} color={colors.violet} />
          {pingWaiting ? <View style={styles.dot} /> : null}
        </Tap>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkFaint}
          style={styles.input}
          multiline
          maxLength={4000}
          accessibilityLabel="Message"
        />
        <Tap onPress={submit} disabled={!text.trim() && !photo} haptic="light" style={[styles.send, !text.trim() && !photo && { opacity: 0.4 }]} accessibilityLabel="Send message">
          <Send size={18} color={colors.white} />
        </Tap>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  side: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.violet, borderWidth: 1.5, borderColor: colors.bg },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16, color: colors.ink, marginLeft: 4 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  preview: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8 },
  previewX: { position: 'absolute', left: 64, top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  reply: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: colors.accentSoft },
  replyX: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});
