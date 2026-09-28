import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthScreen, ErrorNote, Headline, PrimaryButton, Steps } from '@/components/auth/AuthUI';
import { auth } from '@/components/auth/palette';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { OPEN_TO_LABEL } from '@/data/users';
import { useSession } from '@/store/useSession';
import type { OpenTo } from '@/types/models';

const OPTIONS: OpenTo[] = ['friends', 'dating', 'casual', 'networking', 'collaboration', 'travel', 'events', 'not_looking'];

/** Step 4: Open To. Dating and Casual are opt-in and off by default. */
export default function OpenToStep() {
  const uid = useSession((s) => s.uid);
  const profile = useSession((s) => s.profile);
  const saveProfile = useSession((s) => s.saveProfile);
  const finish = useSession((s) => s.finishOnboarding);
  const [value, setValue] = useState<OpenTo[]>(((profile?.open_to ?? []) as OpenTo[]).length ? (profile!.open_to as OpenTo[]) : ['friends']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!uid) return <Redirect href="/welcome" />;

  const toggle = (o: OpenTo) =>
    setValue((v) => {
      if (v.includes(o)) return v.filter((x) => x !== o);
      if (o === 'not_looking') return ['not_looking'];
      return [...v.filter((x) => x !== 'not_looking'), o];
    });

  const done = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ open_to: value });
      await finish(); // → Buzz (the gate takes you there)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const romantic = value.includes('dating') || value.includes('casual');
  return (
    <AuthScreen back={false} footer={<PrimaryButton label="Enter Chimp" onPress={done} disabled={!value.length} loading={busy} />}>
      <StatusBar style="light" />
      <View style={{ height: 24 }} />
      <Steps at={3} />
      <Headline title="Open to" sub="What you’d like Chimp to help with. Change it any time." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 24, marginTop: 22 }}>
        {OPTIONS.map((o) => {
          const on = value.includes(o);
          return (
            <Tap key={o} onPress={() => toggle(o)} haptic="select" style={{ flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 16, borderRadius: 23, borderWidth: 1.5, borderColor: on ? auth.coral : auth.line, backgroundColor: on ? 'rgba(255,107,97,0.16)' : auth.bg2 }} accessibilityLabel={`${OPEN_TO_LABEL[o]}${on ? ', on' : ''}`}>
              {on ? <Check size={16} color={auth.coral} strokeWidth={3} style={{ marginRight: 6 }} /> : null}
              <T style={{ color: auth.cream, fontSize: 16, fontWeight: '600' }}>{OPEN_TO_LABEL[o]}</T>
            </Tap>
          );
        })}
      </View>
      <View style={{ marginHorizontal: 24, marginTop: 20, padding: 14, borderRadius: 16, backgroundColor: auth.bg2, borderWidth: 1, borderColor: auth.line }}>
        <T style={{ color: auth.cream, fontSize: 14, fontWeight: '700' }}>{romantic ? '♡ Dating is on' : 'Dating is off'}</T>
        <T style={{ color: auth.muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
          {romantic
            ? 'People who are also open to it can send you a private Crush. Nobody is told unless it’s mutual.'
            : 'Chimp isn’t a dating app. Turn on Dating or Casual only if you want Crushes to be possible.'}
        </T>
      </View>
      <View style={{ paddingHorizontal: 24 }}>
        <ErrorNote text={error} />
      </View>
      <View style={{ height: 24 }} />
    </AuthScreen>
  );
}
