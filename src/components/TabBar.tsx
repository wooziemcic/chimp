import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Flame, LayoutGrid, LucideIcon, Moon, Orbit, User } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import { TAB_BAR_HEIGHT } from '@/hooks/useLayout';
import { useUnseenChanges } from '@/hooks/useGraph';
import { selectRequests, selectUnread, useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { BOARD_THEMES, colors, layout, navBottomInset, night, shadow } from '@/theme';
import { Tap } from './ui/Tap';
import { T } from './ui/Text';

/**
 * Canonical five surfaces (Phase 6B: Drift merged into Happening).
 * Anything else in (tabs) is a hidden legacy redirect.
 */
const TABS: Record<string, { label: string; Icon: LucideIcon; fillable: boolean }> = {
  boards: { label: 'Boards', Icon: LayoutGrid, fillable: true },
  buzz: { label: 'Buzz', Icon: Flame, fillable: true },
  happening: { label: 'Happening', Icon: Orbit, fillable: false },
  you: { label: 'You', Icon: User, fillable: true },
  'after-dark': { label: 'After Dark', Icon: Moon, fillable: true },
};

/**
 * Floating tab bar matching the approved screens. Normal tabs use Chimp
 * blue; After Dark turns the whole bar dark with a magenta active state.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index]?.name;
  const dark = activeRoute === 'after-dark';
  const hasFreshPeople = useUnseenChanges().some((d) => d.type === 'PERSON_BECAME_RELEVANT' || d.type === 'NEW_MATCH');
  const openLoops = useChimp((s) => s.openLoops.filter((l) => l.status === 'active' || l.status === 'progress').length);
  // Phase 6B: unread messages and new Message Requests also light the You dot.
  const unreadChats = useChat((c) => selectUnread(c) + selectRequests(c));
  // Phase 7B: and someone asking to connect.
  const connectRequests = useChimp((s) => Object.keys(s.incomingConnects ?? {}).length);

  const activeColor = dark ? BOARD_THEMES.neonNight.primary : colors.accent;
  const idleColor = dark ? 'rgba(255,255,255,0.72)' : colors.inkMuted;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: navBottomInset(insets.bottom) }]}>
      {/* Phase 7C: content scrolls under the bar, never visibly around or below it. */}
      <LinearGradient
        pointerEvents="none"
        colors={dark ? ['rgba(7,6,10,0)', night.bg] : ['rgba(245,247,251,0)', colors.bg]}
        locations={[0, 0.45]}
        style={[StyleSheet.absoluteFill, { top: -18 }]}
      />
      <View style={[styles.bar, dark ? styles.barDark : styles.barLight]} testID="tab-bar">
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          const nightTab = route.name === 'after-dark';
          const color = focused ? (nightTab ? BOARD_THEMES.neonNight.primary : activeColor) : idleColor;
          const { Icon } = meta;
          const showDot = route.name === 'you' && (hasFreshPeople || openLoops > 0 || unreadChats > 0 || connectRequests > 0) && !focused;
          return (
            <Tap
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected: focused }}
              haptic="select"
              scaleTo={0.92}
              style={styles.item}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
            >
              <View>
                <Icon
                  size={24}
                  color={color}
                  strokeWidth={focused ? 2.3 : 1.8}
                  fill={focused && meta.fillable ? color : 'transparent'}
                />
                {showDot ? <View style={[styles.dot, { backgroundColor: activeColor, borderColor: dark ? '#141016' : colors.white }]} /> : null}
              </View>
              <T v="caption" color={color} weight={focused ? '700' : '500'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ marginTop: 4, fontSize: 10.5, letterSpacing: -0.1 }}>
                {meta.label}
              </T>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: layout.navSideMargin },
  bar: {
    height: TAB_BAR_HEIGHT,
    borderRadius: layout.navRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },
  barLight: { backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...shadow.lg },
  barDark: {
    backgroundColor: 'rgba(22,16,26,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', height: TAB_BAR_HEIGHT - 12, marginHorizontal: 0, borderRadius: 20, paddingHorizontal: 0 },
  dot: { position: 'absolute', top: -1, right: -4, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
