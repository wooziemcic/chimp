import { router } from 'expo-router';
import { Camera, ImageIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EMOJIS, FRAMING } from '@/components/auth/Onboarding';
import { Img } from '@/components/ui/Img';
import { Button } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type PickedImage, type UploadedMedia, discardMediaById, pickImages, setProfilePhoto } from '@/services/backend/media';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { colors, radius } from '@/theme';

const PHRASE_MAX = 40;

/**
 * Edit your profile. REAL: saved to your Chimp account (photo uploaded to
 * Storage). DEMO: kept on this device only.
 */
export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const profile = useChimp((s) => s.profile);
  const update = useChimp((s) => s.updateProfile);
  const saveProfile = useSession((s) => s.saveProfile);
  const uid = useSession((s) => s.uid);
  const me = repo.me();
  const real = repo.mode() === 'real';
  const [name, setName] = useState(profile.displayName ?? me.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [city, setCity] = useState(profile.city);
  const [phrase, setPhrase] = useState(profile.phrase ?? me.profilePhrase ?? '');
  const [emoji, setEmoji] = useState(profile.emoji ?? me.profileEmoji ?? '✨');
  const [focusY, setFocusY] = useState(profile.focusY ?? me.avatarFocusY ?? 0.3);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [removed, setRemoved] = useState(false);
  const uploaded = useRef<{ uri: string; media: UploadedMedia } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = removed ? undefined : picked?.uri ?? profile.avatarUri ?? (real ? undefined : me.avatar);

  const pick = async (source: 'camera' | 'library') => {
    try {
      const [img] = await pickImages({ source, square: true });
      if (img) {
        setPicked(img);
        setRemoved(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    setError(null);
    if (!real) {
      update({ bio: bio.trim() || profile.bio, city: city.trim() || profile.city, avatarUri: removed ? undefined : picked?.uri ?? profile.avatarUri, phrase: phrase.trim(), emoji, focusY });
      router.back();
      return;
    }
    if (!uid) return;
    setBusy(true);
    try {
      // Phase 6D: text first, then the photo (a fresh file each time; the old one is
      // removed only after the profile points at the new one). A retry reuses a
      // photo that already uploaded.
      const before = useSession.getState().profile?.avatar_media_id ?? null;
      await saveProfile({
        ...(removed ? { avatar_media_id: null, avatar_url: null } : {}),
        display_name: name.trim() || me.displayName,
        city: city.trim(),
        bio: bio.trim(),
        profile_phrase: phrase.trim(),
        profile_emoji: emoji,
        avatar_focus_y: focusY,
      });
      if (removed) await discardMediaById(before);
      else if (picked) {
        await setProfilePhoto({
          userId: uid,
          photo: picked,
          previousMediaId: before,
          reuse: uploaded.current?.uri === picked.uri ? uploaded.current.media : null,
          onUploaded: (media) => {
            uploaded.current = { uri: picked.uri, media };
          },
          link: (patch) => saveProfile(patch),
        });
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Edit profile" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <View style={styles.photo}>{photo ? <Img uri={photo} contentPosition={{ top: `${Math.round(focusY * 100)}%` }} style={StyleSheet.absoluteFill} /> : <Camera size={28} color={colors.inkFaint} />}</View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Chip label="Camera" onPress={() => pick('camera')} icon={<Camera size={14} color={colors.ink2} />} />
            <Chip label="Library" onPress={() => pick('library')} icon={<ImageIcon size={14} color={colors.ink2} />} />
            {photo ? <Chip label="Remove" onPress={() => { setRemoved(true); setPicked(null); }} /> : null}
          </View>
          {photo ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
              {FRAMING.map((f) => (
                <Chip key={f.label} label={f.label} on={Math.abs(focusY - f.y) < 0.01} onPress={() => setFocusY(f.y)} />
              ))}
            </View>
          ) : null}
        </View>

        <Label text="DISPLAY NAME" />
        {real ? (
          <TextInput value={name} onChangeText={setName} style={styles.input} maxLength={50} placeholderTextColor={colors.inkFaint} />
        ) : (
          <View style={[styles.input, { justifyContent: 'center', backgroundColor: colors.surfaceMuted }]}>
            <T v="body" color={colors.inkMuted}>
              {me.displayName}
            </T>
          </View>
        )}

        <Label text="USERNAME" />
        <View style={[styles.input, { justifyContent: 'center', backgroundColor: colors.surfaceMuted }]}>
          <T v="body" color={colors.inkMuted}>
            {`@${profile.username ?? me.username}`}
          </T>
        </View>

        <Label text={`PHRASE · ${phrase.length}/${PHRASE_MAX}`} />
        <TextInput value={phrase} onChangeText={setPhrase} maxLength={PHRASE_MAX} style={styles.input} placeholder="Here for the plot" placeholderTextColor={colors.inkFaint} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {EMOJIS.map((e) => (
            <Tap key={e} onPress={() => setEmoji(e)} style={[styles.emoji, emoji === e && styles.emojiOn]} accessibilityLabel={`Emoji ${e}`}>
              <T style={{ fontSize: 20, color: e === '♡' ? colors.pink : undefined }}>{e}</T>
            </Tap>
          ))}
          <TextInput value={EMOJIS.includes(emoji) ? '' : emoji} onChangeText={(t) => setEmoji(t.trim().slice(0, 8) || '✨')} placeholder="More" placeholderTextColor={colors.inkFaint} style={[styles.emoji, { width: 70, textAlign: 'center', fontSize: 18 }]} maxLength={8} />
        </View>

        <Label text="CITY" />
        <TextInput value={city} onChangeText={setCity} style={styles.input} maxLength={60} placeholder="Where are you based?" placeholderTextColor={colors.inkFaint} />

        <Label text={`BIO · ${bio.length}/280`} />
        <TextInput value={bio} onChangeText={setBio} style={[styles.input, { height: 110, paddingTop: 14, textAlignVertical: 'top' }]} multiline maxLength={280} placeholder="A line about you" placeholderTextColor={colors.inkFaint} />

        {error ? (
          <T v="footnote" color={colors.danger} style={{ marginTop: 12 }}>
            {error}
          </T>
        ) : null}
        {busy ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.accent} /> : <Button label="Save" size="lg" onPress={save} style={{ marginTop: 20 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Label({ text }: { text: string }) {
  return (
    <T v="label" color={colors.inkFaint} style={{ marginTop: 20, marginBottom: 8 }}>
      {text}
    </T>
  );
}

function Chip({ label, onPress, icon, on }: { label: string; onPress: () => void; icon?: React.ReactNode; on?: boolean }) {
  return (
    <Tap onPress={onPress} style={[styles.chip, on && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]} accessibilityLabel={label}>
      {icon}
      <T v="footnote" weight="600" color={on ? colors.accent : colors.ink2} style={{ marginLeft: icon ? 5 : 0 }}>
        {label}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  photo: { width: 120, height: 150, borderRadius: 26, backgroundColor: colors.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  input: { height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, fontSize: 16, color: colors.ink, backgroundColor: colors.surface },
  emoji: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', color: colors.ink },
  emojiOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
});
