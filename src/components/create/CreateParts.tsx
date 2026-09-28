import { router } from 'expo-router';
import { Camera, ImageIcon, X } from 'lucide-react-native';
import { type ReactNode, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { isNightRef } from '@/graph/surfaces';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { Board } from '@/types/models';
import type { PickedImage } from '@/services/backend/media';

/** Modal shell for every composer: Cancel · title · primary action. */
/** Leave a composer: back to where you came from, or to a sensible tab on a cold start. */
export function closeComposer(fallback: '/buzz' | '/happening' | '/boards' = '/buzz') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function Composer({ title, action, onAction, disabled, busy, error, children }: { title: string; action: string; onAction: () => void; disabled?: boolean; busy?: boolean; error?: string | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.head, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8 }]}>
        <Tap onPress={() => closeComposer()} style={styles.headBtn} accessibilityLabel="Cancel">
          <T v="body" color={colors.ink2}>
            Cancel
          </T>
        </Tap>
        <T v="headline" style={{ flex: 1, textAlign: 'center' }}>
          {title}
        </T>
        <Tap onPress={onAction} disabled={disabled || busy} style={[styles.post, (disabled || busy) && { opacity: 0.4 }]} accessibilityLabel={action}>
          {busy ? <ActivityIndicator color={colors.white} /> : <T v="subhead" weight="700" color={colors.white}>{action}</T>}
        </Tap>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.error}>
            <T v="footnote" color={colors.danger}>
              {error}
            </T>
          </View>
        ) : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Worlds you can post into: yours and joined first, then everything public. Never After Dark. */
export function useWorldChoices(): Board[] {
  const joined = useChimp((s) => s.joined);
  const version = useDatasetVersion((d) => d.version);
  return useMemo(() => {
    void version;
    const all = repo.boards().filter((b) => !b.ageGated && !isNightRef({ kind: 'board', id: b.id }) && (b.visibility !== 'private' || repo.isMe(b.ownerId)));
    const mine = all.filter((b) => joined[b.id] || repo.isMe(b.ownerId));
    return [...mine, ...all.filter((b) => !mine.includes(b))];
  }, [joined, version]);
}

export function WorldPicker({ value, onChange, label = 'Posting in', allowNone }: { value: string | null; onChange: (id: string | null) => void; label?: string; allowNone?: boolean }) {
  const choices = useWorldChoices();
  // The World you came from (e.g. "Post here" on a Board) leads the row; tapping doesn't reorder it.
  const [lead] = useState(value);
  const worlds = useMemo(() => {
    const first = choices.find((b) => b.id === lead);
    return first ? [first, ...choices.filter((b) => b !== first)] : choices;
  }, [choices, lead]);
  return (
    <View style={{ marginBottom: 14 }}>
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        {label.toUpperCase()}
      </T>
      <FlatList
        horizontal
        data={worlds}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          allowNone ? (
            <Tap onPress={() => onChange(null)} style={[styles.world, { paddingLeft: 12, marginRight: 8 }, !value && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} accessibilityLabel={`Just Buzz, no World${!value ? ', selected' : ''}`}>
              <T v="footnote" weight="700" color={!value ? colors.accent : colors.ink}>
                Just Buzz
              </T>
            </Tap>
          ) : null
        }
        renderItem={({ item }) => {
          const on = item.id === value;
          return (
            <Tap onPress={() => onChange(item.id)} style={[styles.world, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} accessibilityLabel={`${item.title}${on ? ', selected' : ''}`}>
              <Img uri={item.cover} style={styles.worldImg} />
              <T v="footnote" weight="700" color={on ? colors.accent : colors.ink} numberOfLines={1} style={{ marginLeft: 8, maxWidth: 140 }}>
                {item.title}
              </T>
            </Tap>
          );
        }}
      />
    </View>
  );
}

export function Input({ counter, max, ...p }: TextInputProps & { counter?: boolean; max?: number }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <TextInput placeholderTextColor={colors.inkFaint} style={[styles.input, p.multiline && { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }]} maxLength={max} {...p} />
      {counter && max ? (
        <T v="caption" color={colors.inkFaint} align="right" style={{ marginTop: 4 }}>
          {`${String(p.value ?? '').length}/${max}`}
        </T>
      ) : null}
    </View>
  );
}

/** Pick 1..N photos from the camera or library, with previews. */
export function PhotoPicker({ images, onPick, onRemove, max = 1 }: { images: PickedImage[]; onPick: (source: 'camera' | 'library') => void; onRemove: (i: number) => void; max?: number }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {images.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {images.map((img, i) => (
            <View key={`${img.uri}${i}`}>
              <Img uri={img.uri} style={[styles.thumb, { aspectRatio: images.length === 1 ? Math.max(0.6, Math.min(1.6, img.width / Math.max(1, img.height))) : 0.8 }]} />
              <Tap onPress={() => onRemove(i)} style={styles.remove} accessibilityLabel="Remove photo">
                <X size={14} color={colors.white} />
              </Tap>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {images.length < max ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: images.length ? 10 : 0 }}>
          <Tap onPress={() => onPick('camera')} style={styles.pick} accessibilityLabel="Take a photo">
            <Camera size={18} color={colors.accent} />
            <T v="subhead" weight="600" color={colors.accent} style={{ marginLeft: 6 }}>
              Camera
            </T>
          </Tap>
          <Tap onPress={() => onPick('library')} style={styles.pick} accessibilityLabel="Choose from library">
            <ImageIcon size={18} color={colors.accent} />
            <T v="subhead" weight="600" color={colors.accent} style={{ marginLeft: 6 }}>
              {max > 1 ? `Library (up to ${max})` : 'Library'}
            </T>
          </Tap>
        </View>
      ) : null}
    </View>
  );
}

export function Segments<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <View style={styles.segs}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Tap key={o.id} onPress={() => onChange(o.id)} style={[styles.seg, on && styles.segOn]} accessibilityLabel={o.label}>
            <T v="footnote" weight="700" color={on ? colors.white : colors.ink2}>
              {o.label}
            </T>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  headBtn: { minWidth: 70, height: 40, justifyContent: 'center' },
  post: { minWidth: 70, height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 12, borderRadius: radius.md, backgroundColor: '#FFF1F1', marginBottom: 12 },
  world: { flexDirection: 'row', alignItems: 'center', height: 44, paddingLeft: 4, paddingRight: 12, borderRadius: 22, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  worldImg: { width: 34, height: 34, borderRadius: 17 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: colors.surface },
  thumb: { height: 180, borderRadius: 16, backgroundColor: colors.surfaceMuted },
  remove: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, backgroundColor: colors.accentSoft },
  segs: { flexDirection: 'row', padding: 4, borderRadius: 22, backgroundColor: colors.surfaceMuted, marginBottom: 14 },
  seg: { flex: 1, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink },
});
