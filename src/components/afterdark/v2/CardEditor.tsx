/**
 * Phase 7A: your After Dark card. Age (18+, required), what you're open to,
 * an Open Loop people can answer, extra photos, and whether you appear in
 * Discover at all (off until you say so). Your main Chimp profile is
 * untouched; Discover only ever shows your city, never a precise location.
 */
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { AdIntent } from '@/services/backend/afterDark';
import { pickImages } from '@/services/backend/media';
import { useAfterDark } from '@/store/useAfterDark';
import { INTENTS } from '@/utils/afterDark';
import { ad } from './adTheme';
import { DarkButton, ErrorLine } from './VibeParts';

export function CardEditor({ setup, onDone, bottomPad = 30 }: { setup?: boolean; onDone?: () => void; bottomPad?: number }) {
  const profile = useAfterDark((s) => s.profile);
  const save = useAfterDark((s) => s.saveProfile);
  const upload = useAfterDark((s) => s.uploadCardPhoto);
  const photoUrl = useAfterDark((s) => s.photoUrl);
  const [age, setAge] = useState(profile?.age ? String(profile.age) : '');
  const [intent, setIntent] = useState<AdIntent | null>(profile?.intent ?? null);
  const [prompt, setPrompt] = useState(profile?.prompt ?? '');
  const [photos, setPhotos] = useState<string[]>(profile?.photo_paths ?? []);
  const [discoverable, setDiscoverable] = useState(profile?.discoverable ?? false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const n = Number(age);
  const ageOk = Number.isInteger(n) && n >= 18 && n <= 99;

  const addPhoto = async () => {
    setError(null);
    try {
      const [img] = await pickImages({ source: 'library', square: true });
      if (!img) return;
      setUploading(true);
      const path = await upload(img);
      setPhotos((p) => [...p, path].slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setUploading(false);
  };
  const go = async () => {
    if (!ageOk) {
      setError(age && n < 18 ? 'After Dark is for adults (18+).' : 'Add your age (18+).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({ age: n, intent, prompt: prompt.trim() || null, photo_paths: photos, discoverable });
      setSaved(true);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled" testID="card-editor">
      {setup ? (
        <>
          <T v="title1" color={ad.ink}>
            Your After Dark card
          </T>
          <T v="callout" color={ad.muted} style={{ marginTop: 6, lineHeight: 22 }}>
            Real attraction. Mutual intent. Playful chemistry. Real plans. Nobody gets access to you unless you say yes.
          </T>
        </>
      ) : null}
      <Label>Your age</Label>
      <TextInput value={age} onChangeText={(t) => setAge(t.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="18+" placeholderTextColor={ad.faint} style={[styles.input, { width: 110 }]} accessibilityLabel="Your age" testID="card-age" />
      <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 6 }}>
        Only your age shows on your card, never your birthday.
      </T>
      <Label>Open to</Label>
      <View style={styles.wrap}>
        {INTENTS.map((i) => (
          <Tap key={i.id} onPress={() => setIntent(intent === i.id ? null : i.id)} style={[styles.chip, intent === i.id && styles.chipOn]} accessibilityState={{ selected: intent === i.id }} accessibilityLabel={i.label} testID={`card-intent-${i.id}`}>
            <T v="footnote" weight="700" color={intent === i.id ? '#fff' : ad.muted}>
              {i.label}
            </T>
          </Tap>
        ))}
      </View>
      <Label>Your Open Loop</Label>
      <TextInput value={prompt} onChangeText={setPrompt} placeholder="Something people can answer: “Rooftop drinks this week?”" placeholderTextColor={ad.faint} maxLength={140} multiline style={[styles.input, { minHeight: 70 }]} accessibilityLabel="Your Open Loop" testID="card-prompt" />
      <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 6 }}>{`${prompt.length}/140 · Answering it asks you for a Vibe. You decide.`}</T>
      <Label>Photos</Label>
      <View style={styles.wrap}>
        {photos.map((p) => (
          <View key={p}>
            <Img uri={photoUrl(p)} tint={ad.card2} style={styles.photo} />
            <Tap onPress={() => setPhotos((list) => list.filter((x) => x !== p))} style={styles.photoX} accessibilityLabel="Remove photo">
              <X size={13} color="#fff" />
            </Tap>
          </View>
        ))}
        {photos.length < 6 ? (
          <Tap onPress={() => void addPhoto()} disabled={uploading} style={[styles.photo, styles.add]} accessibilityLabel="Add a photo" testID="card-add-photo">
            <Plus size={22} color={ad.muted} />
          </Tap>
        ) : null}
      </View>
      <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 6 }}>
        {uploading ? 'Uploading…' : 'Your profile photo shows first. Add up to 6 more. Nothing explicit.'}
      </T>
      <View style={styles.toggle}>
        <View style={{ flex: 1 }}>
          <T v="callout" weight="700" color={ad.ink}>
            Show me in Discover
          </T>
          <T v="caption" weight="500" color={ad.faint} style={{ marginTop: 2 }}>
            Off: you can browse and answer, but nobody finds you in Discover.
          </T>
        </View>
        <Switch value={discoverable} onValueChange={setDiscoverable} trackColor={{ true: ad.pink, false: ad.raised }} thumbColor={Platform.OS === 'android' ? '#fff' : undefined} accessibilityLabel="Show me in Discover" testID="card-discoverable" />
      </View>
      <DarkButton label={setup ? 'Enter After Dark' : saved ? 'Saved' : 'Save'} onPress={go} busy={busy} disabled={!age} style={{ marginTop: 20 }} testID="card-save" />
      <ErrorLine text={error} />
    </ScrollView>
  );
}

function Label({ children }: { children: string }) {
  return (
    <T v="eyebrow" color={ad.faint} style={{ marginTop: 22, marginBottom: 8 }}>
      {children.toUpperCase()}
    </T>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderRadius: 16, backgroundColor: ad.glass, borderWidth: 1, borderColor: ad.line, color: '#fff', fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: ad.line, justifyContent: 'center' },
  chipOn: { backgroundColor: ad.pink, borderColor: ad.pink },
  photo: { width: 84, height: 105, borderRadius: 14 },
  photoX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  add: { borderWidth: 1, borderStyle: 'dashed', borderColor: ad.lineStrong, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', marginTop: 22, padding: 14, borderRadius: 18, backgroundColor: ad.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line },
});
