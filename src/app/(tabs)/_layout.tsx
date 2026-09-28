import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/TabBar';
import { colors } from '@/theme';

/** Phase 5: the tab bar order is unchanged, but Buzz is where Chimp opens. */
export const unstable_settings = { initialRouteName: 'buzz' };

/**
 * Canonical navigation: Boards · Buzz · Happening · You · After Dark.
 * Phase 6C: Drift is Buzz's fourth sub-tab (For You · Following · Trending ·
 * Drift). drift / pulse / stories / moves are legacy redirects, hidden from
 * the bar (old links and saved state still land safely).
 */
export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="buzz"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, lazy: true }}
    >
      <Tabs.Screen name="boards" />
      <Tabs.Screen name="buzz" />
      <Tabs.Screen name="happening" />
      <Tabs.Screen name="you" />
      <Tabs.Screen name="after-dark" options={{ sceneStyle: { backgroundColor: '#07060A' } }} />
      <Tabs.Screen name="drift" options={{ href: null }} />
      <Tabs.Screen name="pulse" options={{ href: null }} />
      <Tabs.Screen name="stories" options={{ href: null }} />
      <Tabs.Screen name="moves" options={{ href: null }} />
    </Tabs>
  );
}
