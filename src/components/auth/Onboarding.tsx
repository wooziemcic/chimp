import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Check, ImageIcon, MapPin } from 'lucide-react-native';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { fonts } from '@/theme';
import type { ImageSrc } from '@/types/models';
import { auth } from './palette';

// ─── Text field ─────────────────────────────────────────────────────────────

export function Field({ label, hint, count, max, prefix, ...input }: TextInputProps & { label: string; hint?: string | null; count?: number; max?: number; prefix?: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 }}>
        <T style={styles.label}>{label}</T>
        {max ? <T style={[styles.count, (count ?? 0) > max && { color: auth.coral }]}>{`${count ?? 0}/${max}`}</T> : null}
      </View>
      <View style={[styles.field, input.multiline && { height: 104, alignItems: 'flex-start', paddingTop: 12 }]}>
        {prefix ? <T style={styles.prefix}>{prefix}</T> : null}
        <TextInput placeholderTextColor={auth.faint} selectionColor={auth.coral} style={[styles.input, input.multiline && { height: 84, textAlignVertical: 'top' }]} {...input} />
      </View>
      {hint ? <T style={styles.hint}>{hint}</T> : null}
    </View>
  );
}

// ─── Avatar picker ──────────────────────────────────────────────────────────

export const FRAMING: { label: string; y: number }[] = [
  { label: 'Top', y: 0.15 },
  { label: 'Upper', y: 0.3 },
  { label: 'Center', y: 0.5 },
  { label: 'Lower', y: 0.7 },
];

export function AvatarPicker({ uri, focusY, onCamera, onLibrary, onFocus }: { uri?: string; focusY: number; onCamera: () => void; onLibrary: () => void; onFocus: (y: number) => void }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.avatarFrame}>
        {uri ? <Img uri={uri} contentPosition={{ top: `${Math.round(focusY * 100)}%` }} style={StyleSheet.absoluteFill} /> : <Camera size={36} color={auth.muted} />}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pill label="Camera" icon={<Camera size={16} color={auth.cream} />} onPress={onCamera} />
        <Pill label="Photo Library" icon={<ImageIcon size={16} color={auth.cream} />} onPress={onLibrary} />
      </View>
      {uri ? (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'center' }}>
          <T style={{ color: auth.muted, fontSize: 13, marginRight: 4 }}>Framing</T>
          {FRAMING.map((f) => (
            <Tap key={f.label} onPress={() => onFocus(f.y)} style={[styles.frameChip, Math.abs(focusY - f.y) < 0.01 && styles.frameOn]} accessibilityLabel={`Framing ${f.label}`}>
              <T style={{ color: auth.cream, fontSize: 13, fontWeight: '600' }}>{f.label}</T>
            </Tap>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Pill({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={styles.pill} accessibilityLabel={label}>
      {icon}
      <T style={{ color: auth.cream, fontSize: 15, fontWeight: '600', marginLeft: 6 }}>{label}</T>
    </Tap>
  );
}

// ─── Phrase preview (a mini You hero) ───────────────────────────────────────

export function PhrasePreview({ phrase, emoji, name, city, photo, focusY = 0.3 }: { phrase: string; emoji: string; name: string; city: string; photo?: ImageSrc; focusY?: number }) {
  return (
    <View style={styles.preview}>
      <LinearGradient colors={['#D6E4FF', '#ECE6FF', '#FFEFE6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <T style={styles.previewHand} numberOfLines={2}>{`${phrase || 'Your phrase here'} ${emoji}`}</T>
      <View style={styles.previewPhoto}>{photo ? <Img uri={photo} contentPosition={{ top: `${Math.round(focusY * 100)}%` }} style={StyleSheet.absoluteFill} /> : null}</View>
      <View style={{ position: 'absolute', left: 16, bottom: 14, right: 130 }}>
        <T style={{ color: '#0B0D12', fontSize: 22, fontWeight: '900' }} numberOfLines={1}>
          {name || 'Your name'}
        </T>
        {city ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <MapPin size={12} color="#3A4152" />
            <T style={{ color: '#3A4152', fontSize: 13, marginLeft: 3 }} numberOfLines={1}>
              {city}
            </T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Emoji picker (curated, plus free entry) ────────────────────────────────

export const EMOJIS = ['♡', '✨', '✈️', '🌙', '☕', '🎬', '🚀', '🌊', '🌎', '🎧', '📷', '🔥', '🍜', '🏔️', '💫'];

export function EmojiGrid({ value, onChange, custom, onCustom }: { value: string; onChange: (e: string) => void; custom: boolean; onCustom: () => void }) {
  return (
    <View style={styles.emojiGrid}>
      {EMOJIS.map((e) => (
        <Tap key={e} onPress={() => onChange(e)} style={[styles.emoji, value === e && styles.emojiOn]} accessibilityLabel={`Emoji ${e}`}>
          <T style={{ fontSize: 24, color: e === '♡' ? auth.pink : undefined }}>{e}</T>
        </Tap>
      ))}
      <Tap onPress={onCustom} style={[styles.emoji, styles.more, custom && styles.emojiOn]} accessibilityLabel="More emoji">
        <T style={{ color: auth.cream, fontSize: 14, fontWeight: '700' }}>More</T>
      </Tap>
    </View>
  );
}

// ─── Selectable card (interests / worlds) ───────────────────────────────────

export function PickCard({ title, emoji, image, on, onPress, width }: { title: string; emoji: string; image: string; on: boolean; onPress: () => void; width: number }) {
  return (
    <Tap onPress={onPress} haptic="select" scaleTo={0.96} style={[styles.pick, { width, height: width * 0.8 }, on && styles.pickOn]} accessibilityLabel={`${title}${on ? ', selected' : ''}`}>
      <Img uri={image} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(12,15,29,0.05)', 'rgba(12,15,29,0.85)']} style={StyleSheet.absoluteFill} />
      <T style={{ position: 'absolute', top: 8, left: 10, fontSize: 22 }}>{emoji}</T>
      {on ? (
        <View style={styles.check}>
          <Check size={14} color={auth.cream} strokeWidth={3} />
        </View>
      ) : null}
      <T style={styles.pickTitle}>{title}</T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  label: { color: auth.cream, fontSize: 15, fontWeight: '700', flex: 1 },
  count: { color: auth.faint, fontSize: 13 },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 54, borderRadius: 18, borderWidth: 1.5, borderColor: auth.line, backgroundColor: 'rgba(20,23,49,0.9)', paddingHorizontal: 16 },
  prefix: { color: auth.muted, fontSize: 18, marginRight: 2 },
  input: { flex: 1, color: auth.cream, fontSize: 18, minHeight: 50 },
  hint: { color: auth.muted, fontSize: 13, marginTop: 6 },
  avatarFrame: { width: 150, height: 186, borderRadius: 34, backgroundColor: auth.bg2, borderWidth: 2, borderColor: auth.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: auth.navy, borderWidth: 1, borderColor: auth.line },
  frameChip: { height: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderColor: auth.line, justifyContent: 'center' },
  frameOn: { backgroundColor: auth.coral, borderColor: auth.coral },
  preview: { height: 200, borderRadius: 28, overflow: 'hidden', marginHorizontal: 24 },
  previewHand: { position: 'absolute', left: 16, top: 14, right: 140, color: '#1D6BFF', fontFamily: fonts.hand, fontSize: 26, lineHeight: 28, transform: [{ rotate: '-5deg' }] },
  previewPhoto: { position: 'absolute', right: 16, top: 16, width: 110, height: 150, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.6)', overflow: 'hidden', borderWidth: 3, borderColor: '#fff' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, marginTop: 10 },
  emoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: auth.bg2, borderWidth: 1.5, borderColor: auth.line, alignItems: 'center', justifyContent: 'center' },
  emojiOn: { borderColor: auth.coral, backgroundColor: 'rgba(255,107,97,0.18)' },
  more: { width: 64 },
  pick: { borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: auth.bg2 },
  pickOn: { borderColor: auth.coral },
  check: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: auth.coral, alignItems: 'center', justifyContent: 'center' },
  pickTitle: { position: 'absolute', left: 10, bottom: 8, color: auth.cream, fontSize: 16, fontWeight: '800' },
});
