import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Switch, useWindowDimensions, View } from 'react-native';

import { AuthScreen, ErrorNote, Headline, PrimaryButton, Steps } from '@/components/auth/AuthUI';
import { PickCard } from '@/components/auth/Onboarding';
import { auth } from '@/components/auth/palette';
import { T } from '@/components/ui/Text';
import { ONBOARDING_MAX, ONBOARDING_MIN, WORLD_CATALOG, catalogCover } from '@/data/worldCatalog';
import { sync } from '@/services/backend/content';
import { useSession } from '@/store/useSession';

/**
 * Step 3: what you're into (3–8). These seed YOUR affinity (never WollyMc's)
 * and become the Worlds your Happening graph starts from.
 */
export default function Interests() {
  const uid = useSession((s) => s.uid);
  const profile = useSession((s) => s.profile);
  const saveProfile = useSession((s) => s.saveProfile);
  const { width } = useWindowDimensions();
  const initial = WORLD_CATALOG.filter((w) => (profile?.interests ?? []).includes(w.interests[0])).map((w) => w.id);
  const [picked, setPicked] = useState<string[]>(initial);
  const [join, setJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!uid) return <Redirect href="/welcome" />;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= ONBOARDING_MAX ? p : [...p, id]));
  const ready = picked.length >= ONBOARDING_MIN && picked.length <= ONBOARDING_MAX;
  const cardW = Math.floor((width - 48 - 20) / 3);

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      const interests = picked.map((id) => WORLD_CATALOG.find((w) => w.id === id)!.interests[0]);
      await saveProfile({ interests });
      // Only the Worlds you explicitly chose to join. Everyone else starts at 0.
      if (join) for (const id of picked) await sync.membership(uid, id, true);
      router.replace('/open-to');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen back={false} footer={<PrimaryButton label={ready ? 'Continue' : `Pick ${Math.max(0, ONBOARDING_MIN - picked.length)} more`} onPress={next} disabled={!ready} loading={busy} />}>
      <StatusBar style="light" />
      <View style={{ height: 24 }} />
      <Steps at={2} />
      <Headline title="What are you into?" sub={`Pick ${ONBOARDING_MIN}–${ONBOARDING_MAX}. Your Happening graph starts here.`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 24, marginTop: 20 }}>
        {WORLD_CATALOG.map((w) => (
          <PickCard key={w.id} title={w.title} emoji={w.emoji} image={catalogCover(w)} on={picked.includes(w.id)} onPress={() => toggle(w.id)} width={cardW} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 18 }}>
        <View style={{ flex: 1 }}>
          <T style={{ color: auth.cream, fontSize: 15, fontWeight: '700' }}>Also join these Worlds</T>
          <T style={{ color: auth.muted, fontSize: 13, marginTop: 2 }}>Off by default. You start with no Worlds unless you choose.</T>
        </View>
        <Switch value={join} onValueChange={setJoin} trackColor={{ true: auth.coral, false: auth.line }} thumbColor={auth.cream} />
      </View>
      <View style={{ paddingHorizontal: 24 }}>
        <ErrorNote text={error} />
      </View>
      <View style={{ height: 24 }} />
    </AuthScreen>
  );
}
