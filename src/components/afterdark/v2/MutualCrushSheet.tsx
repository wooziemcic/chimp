/**
 * Phase 7A: a mutual Crush — you both chose each other. It only OFFERS the
 * next step; it never moves anyone into After Dark. "Take it After Dark"
 * asks for a Vibe (they decide); "Start normal chat" stays in Messages.
 */
import { router } from 'expo-router';
import { Heart, MessageCircle, Moon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { T } from '@/components/ui/Text';
import { firstNameOf, useAfterDark } from '@/store/useAfterDark';
import { ad } from './adTheme';
import { DarkButton, DarkSheet, ErrorLine, PairAvatars } from './VibeParts';

export function MutualCrushSheet({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  const first = firstNameOf(personId);
  const request = useAfterDark((s) => s.requestVibe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };
  const takeItAfterDark = async () => {
    if (!personId) return;
    setBusy(true);
    setError(null);
    try {
      const id = await request(personId, 'mutual_crush');
      close();
      router.push(`/after-dark/vibe/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <DarkSheet visible={!!personId} onClose={close} title="It’s mutual" subtitle={`You and ${first} both have a Crush. Only the two of you can see this.`} testID="mutual-sheet">
      {personId ? (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <PairAvatars otherId={personId} size={64} ring={ad.plum2} />
          <Heart size={18} color={ad.pink} fill={ad.pink} style={{ marginTop: 10 }} />
        </View>
      ) : null}
      <DarkButton label="Take it After Dark" icon={<Moon size={17} color="#fff" />} onPress={takeItAfterDark} busy={busy} testID="mutual-after-dark" />
      <T v="caption" weight="500" color={ad.faint} align="center" style={{ marginTop: 6, marginBottom: 12 }}>
        {`${first} decides whether to open a Vibe. Nothing else unlocks until you both say yes.`}
      </T>
      <DarkButton
        label="Start normal chat"
        tone="ghost"
        icon={<MessageCircle size={17} color="#fff" />}
        onPress={() => {
          const id = personId;
          close();
          if (id) router.push(`/chat/${id}`);
        }}
        testID="mutual-normal-chat"
      />
      <DarkButton label="Not now" tone="soft" onPress={close} style={{ marginTop: 8 }} />
      <ErrorLine text={error} />
    </DarkSheet>
  );
}
