import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthScreen, ErrorNote, Headline, PrimaryButton, Steps } from '@/components/auth/AuthUI';
import { EMOJIS, EmojiGrid, Field, PhrasePreview } from '@/components/auth/Onboarding';
import { auth } from '@/components/auth/palette';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useSession } from '@/store/useSession';

const PHRASE_MAX = 40;
const EXAMPLES = ['Good people, better plans', 'Always chasing better stories', 'Coffee first, chaos later', 'Here for the plot', 'Building things with people'];

/** Step 2: your short personal motto (about four words) and an emoji. */
export default function Phrase() {
  const uid = useSession((s) => s.uid);
  const profile = useSession((s) => s.profile);
  const saveProfile = useSession((s) => s.saveProfile);
  const [phrase, setPhrase] = useState(profile?.profile_phrase ?? '');
  const [emoji, setEmoji] = useState(profile?.profile_emoji ?? '✨');
  const [custom, setCustom] = useState(!!profile?.profile_emoji && !EMOJIS.includes(profile.profile_emoji));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!uid) return <Redirect href="/welcome" />;

  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const ready = phrase.trim().length >= 2 && phrase.length <= PHRASE_MAX && emoji.trim().length > 0;
  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ profile_phrase: phrase.trim(), profile_emoji: emoji.trim() });
      router.replace('/interests');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen back={false} footer={<PrimaryButton label="Continue" onPress={next} disabled={!ready} loading={busy} />}>
      <StatusBar style="light" />
      <View style={{ height: 24 }} />
      <Steps at={1} />
      <Headline title="Your phrase" sub="A short motto at the top of your profile. About four words." />
      <View style={{ marginTop: 20 }}>
        <PhrasePreview phrase={phrase} emoji={emoji} name={profile?.display_name ?? ''} city={profile?.city ?? ''} photo={profile?.avatar_url ?? undefined} focusY={profile?.avatar_focus_y ?? 0.3} />
      </View>
      <View style={{ paddingHorizontal: 24 }}>
        <Field
          label="Phrase"
          value={phrase}
          onChangeText={setPhrase}
          placeholder="Here for the plot"
          maxLength={PHRASE_MAX}
          max={PHRASE_MAX}
          count={phrase.length}
          hint={words > 6 ? 'Shorter reads better, but it’s your call.' : null}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {EXAMPLES.map((x) => (
            <Tap key={x} onPress={() => setPhrase(x)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: auth.line, justifyContent: 'center' }} accessibilityLabel={`Use ${x}`}>
              <T style={{ color: auth.muted, fontSize: 13 }}>{x}</T>
            </Tap>
          ))}
        </View>
      </View>
      <T style={{ color: auth.cream, fontSize: 15, fontWeight: '700', paddingHorizontal: 24, marginTop: 22 }}>Emoji</T>
      <EmojiGrid value={emoji} onChange={(e) => { setEmoji(e); setCustom(false); }} custom={custom} onCustom={() => { setCustom(true); setEmoji(''); }} />
      {custom ? (
        <View style={{ paddingHorizontal: 24 }}>
          <Field label="Any emoji" value={emoji} onChangeText={(t) => setEmoji(t.trim().slice(0, 8))} placeholder="Type or paste one" maxLength={8} autoFocus />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 24 }}>
        <ErrorNote text={error} />
      </View>
      <View style={{ height: 24 }} />
    </AuthScreen>
  );
}
