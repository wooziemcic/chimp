import { router } from 'expo-router';
import { Camera, ChevronLeft, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PeoplePicker } from '@/components/chat/PeoplePicker';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type PickedImage, pickImages } from '@/services/backend/media';
import { chatUser, useChat } from '@/store/useChat';
import { colors, radius } from '@/theme';

/**
 * New Group: pick people (you + at least 2 others) → name it → optional
 * photo → Create. You're the owner. People you're connected with (or who
 * allow requests) are added; the server checks every one of them.
 */
export default function NewGroup() {
  const insets = useSafeAreaInsets();
  const createGroup = useChat((s) => s.createGroup);
  const [step, setStep] = useState<'people' | 'name'>('people');
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 49 ? p : [...p, id]));
  const pick = async () => {
    try {
      const [img] = await pickImages({ source: 'library' });
      if (img) setPhoto(img);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const cid = await createGroup(title, picked, photo);
      router.back();
      setTimeout(() => router.push(`/group/${cid}`), 220);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (step === 'people') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <SheetHeader title="New group" subtitle={picked.length ? `${picked.length} selected · you + at least 2 others` : 'Choose at least 2 people'} />
        <PeoplePicker selected={picked} onToggle={toggle} footerPad={insets.bottom + 90} />
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Tap onPress={() => setStep('name')} disabled={picked.length < 2} style={[styles.primary, picked.length < 2 && { opacity: 0.4 }]} accessibilityLabel="Next">
            <T v="bodyStrong" color={colors.white}>
              {picked.length < 2 ? `Pick ${2 - picked.length} more` : 'Next'}
            </T>
          </Tap>
        </View>
      </View>
    );
  }

  const ok = title.trim().length >= 1 && title.trim().length <= 60;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Name the group" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <Tap onPress={() => setStep('people')} style={styles.backLink} accessibilityLabel="Back to people">
          <ChevronLeft size={16} color={colors.accent} />
          <T v="footnote" weight="700" color={colors.accent}>{`${picked.length} people`}</T>
        </Tap>
        <View style={{ alignItems: 'center', marginVertical: 14 }}>
          <Tap onPress={pick} style={styles.photo} accessibilityLabel={photo ? 'Change group photo' : 'Add a group photo'}>
            {photo ? <Img uri={photo.uri} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Camera size={28} color={colors.accent} />}
          </Tap>
          {photo ? (
            <Tap onPress={() => setPhoto(null)} style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center' }} accessibilityLabel="Remove photo">
              <X size={13} color={colors.inkMuted} />
              <T v="caption" color={colors.inkMuted} style={{ marginLeft: 3 }}>
                Remove photo
              </T>
            </Tap>
          ) : (
            <T v="caption" color={colors.inkFaint} style={{ marginTop: 6 }}>
              Photo (optional)
            </T>
          )}
        </View>
        <TextInput value={title} onChangeText={setTitle} placeholder="Group name (e.g. Niagara crew)" placeholderTextColor={colors.inkFaint} maxLength={60} style={styles.input} autoFocus accessibilityLabel="Group name" />
        <T v="caption" color={colors.inkFaint} style={{ marginTop: 6, textAlign: 'right' }}>{`${title.trim().length}/60`}</T>
        <View style={styles.people}>
          <Users size={15} color={colors.inkFaint} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1, marginLeft: 8 }}>
            {picked.map((id) => {
              const u = chatUser(id);
              return (
                <View key={id} style={styles.person}>
                  <Avatar uri={u?.avatar} name={u?.displayName} size={20} />
                  <T v="caption" color={colors.ink2} style={{ marginLeft: 5 }}>
                    {u?.displayName.split(' ')[0] ?? 'Member'}
                  </T>
                </View>
              );
            })}
          </View>
        </View>
        <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 12 }}>
          Only members can read the group. You’ll be its owner: you can rename it, add or remove people, and make admins.
        </T>
        {error ? (
          <T v="footnote" color={colors.danger} style={{ marginTop: 10 }} testID="new-group-error">
            {error}
          </T>
        ) : null}
        <Tap onPress={() => void create()} disabled={!ok || busy} style={[styles.primary, { marginTop: 18 }, (!ok || busy) && { opacity: 0.45 }]} accessibilityLabel="Create group">
          {busy ? <ActivityIndicator color={colors.white} /> : <T v="bodyStrong" color={colors.white}>Create group</T>}
        </Tap>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  primary: { height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  backLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 4 },
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  input: { height: 50, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, fontSize: 17, color: colors.ink },
  people: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 },
  person: { flexDirection: 'row', alignItems: 'center', height: 28, paddingLeft: 4, paddingRight: 10, borderRadius: 14, backgroundColor: colors.surfaceMuted },
});
