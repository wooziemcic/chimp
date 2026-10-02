/**
 * Phase 7A — After Dark v2: a romantic interaction layer on Chimp's own
 * primitives. Real attraction. Mutual intent. Playful chemistry. Real plans.
 *
 *   Discover → mutual intent → Vibe → Challenges → conversation → Plans → a real date (or a clean goodbye)
 *
 * Five top tabs; the bottom bar (Boards / Buzz / Happening / You / After Dark) is untouched.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useAfterDark } from '@/store/useAfterDark';
import { layout } from '@/theme';
import { ad } from './adTheme';
import { ChallengesTab } from './ChallengesTab';
import { DiscoverTab } from './DiscoverTab';
import { InboxTab } from './InboxTab';
import { PlansTab } from './PlansTab';
import { useAdCounts } from './useAdData';
import { VibesTab } from './VibesTab';

export type AdTab = 'discover' | 'vibes' | 'challenges' | 'plans' | 'inbox';
const TABS: { id: AdTab; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'vibes', label: 'Vibes' },
  { id: 'challenges', label: 'Challenges' },
  { id: 'plans', label: 'Plans' },
  { id: 'inbox', label: 'Inbox' },
];

export function AfterDarkHome() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<AdTab>(TABS.some((t) => t.id === params.tab) ? (params.tab as AdTab) : 'discover');
  const counts = useAdCounts();
  const refresh = useAfterDark((s) => s.refresh);

  // A link to a tab (?tab=vibes) switches to it.
  const [seenParam, setSeenParam] = useState(params.tab);
  if (params.tab !== seenParam) {
    setSeenParam(params.tab);
    if (params.tab && TABS.some((t) => t.id === params.tab)) setTab(params.tab as AdTab);
  }
  // Coming back to After Dark: catch up once (no polling).
  useEffect(() => {
    void refresh();
  }, [tab, refresh]);

  const badge: Record<AdTab, number> = { discover: 0, vibes: counts.vibes, challenges: counts.challenges, plans: counts.plans, inbox: counts.inbox };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="after-dark-home">
      <StatusBar style="light" />
      {/* Phase 7C: the same header skeleton and segmented control as normal Chimp — dark and pink. */}
      <PageHeader
        title="After Dark"
        dark
        compact
        showActions={false}
        badge={
          <View style={styles.age}>
            <T v="caption" weight="800" color={ad.pink}>
              18+
            </T>
          </View>
        }
        right={
          <Tap onPress={() => router.push('/after-dark/card')} style={styles.cardBtn} accessibilityLabel="Your After Dark card" testID="ad-my-card">
            <UserRound size={19} color={ad.ink} />
          </Tap>
        }
      />
      <Segmented
        tone="night"
        value={tab}
        onChange={setTab}
        testIDPrefix="ad-tab-"
        options={TABS.map((t) => ({ ...t, badge: badge[t.id] > 0 }))}
      />
      <View style={{ height: layout.segmentedToContent - 4 }} />
      <View style={{ flex: 1 }}>
        {tab === 'discover' ? <DiscoverTab onGo={setTab} /> : null}
        {tab === 'vibes' ? <VibesTab onGo={setTab} /> : null}
        {tab === 'challenges' ? <ChallengesTab /> : null}
        {tab === 'plans' ? <PlansTab /> : null}
        {tab === 'inbox' ? <InboxTab /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ad.bg },
  age: { marginLeft: 8, height: 22, paddingHorizontal: 7, borderRadius: 11, borderWidth: 1.2, borderColor: ad.pink, justifyContent: 'center' },
  cardBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: ad.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: ad.line },
});
