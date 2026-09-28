import { router } from 'expo-router';
import { Hand, Search, SlidersHorizontal } from 'lucide-react-native';
import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Chip } from '@/components/ui/Chip';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { CATEGORIES } from '@/data/interests';
import { useMyAvatar, useUnseenChanges } from '@/hooks/useGraph';
import { BOARD_THEMES, colors, radius } from '@/theme';
import type { CategoryId } from '@/types/models';

export const PulseGreeting = memo(function PulseGreeting({ name }: { name: string }) {
  const unseen = useUnseenChanges().length;
  const avatarUri = useMyAvatar();

  return (
    <View style={styles.greeting}>
      <View style={{ flex: 1 }}>
        <View style={styles.eyebrowRow}>
          <T v="eyebrow" color={colors.inkMuted}>
            CHIMP
          </T>
          {unseen > 0 ? (
            <Tap onPress={() => router.push('/delta')} haptic="light" accessibilityLabel={`${unseen} changes since your last visit`} style={styles.deltaPill}>
              <View style={styles.deltaDot} />
              <T v="caption" color={colors.accent} weight="600">
                {`${unseen} changed since you left`}
              </T>
            </Tap>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <T v="title1" numberOfLines={1} style={{ fontSize: 34, lineHeight: 40, flexShrink: 1 }}>
            {`Hey, ${name}`}
          </T>
          <Hand size={30} color={colors.accent} fill="#9CC0FF" strokeWidth={1.6} style={{ marginLeft: 10, transform: [{ rotate: '14deg' }] }} />
        </View>
        <T v="body" color={colors.inkMuted} style={{ marginTop: 2, fontSize: 17 }}>
          People. Places. Possibilities.
        </T>
      </View>
      <Tap onPress={() => router.navigate('/you')} accessibilityLabel="Your profile" style={{ marginLeft: 12 }}>
        <Avatar uri={avatarUri} name={name} size={64} online ring={colors.white} ringWidth={3} />
      </Tap>
    </View>
  );
});

export function PulseSearch({ dark }: { dark?: boolean }) {
  return (
    <Tap onPress={() => router.push('/search')} scaleTo={0.985} accessibilityLabel="Search people, places, or opportunities" style={[styles.search, dark && styles.searchDark]}>
      <Search size={22} color={dark ? 'rgba(255,255,255,0.8)' : colors.ink} strokeWidth={2.2} />
      <T v="body" color={dark ? 'rgba(255,255,255,0.55)' : colors.inkFaint} numberOfLines={1} style={{ flex: 1, marginLeft: 12, fontSize: 16.5 }}>
        Search people, places, or opportunities
      </T>
      <View style={styles.searchSettings}>
        <SlidersHorizontal size={20} color={dark ? 'rgba(255,255,255,0.8)' : colors.ink} strokeWidth={2} />
      </View>
    </Tap>
  );
}

export function CategoryChips({
  active,
  onSelect,
  dark,
}: {
  active: CategoryId | null;
  onSelect: (id: CategoryId) => void;
  dark?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {CATEGORIES.map((c) => {
        const on = active === c.id;
        const iconColor = on ? colors.white : dark ? 'rgba(255,255,255,0.88)' : colors.ink;
        return (
          <Chip
            key={c.id}
            label={c.label}
            active={on}
            tone={dark ? 'dark' : 'light'}
            activeColor={dark ? BOARD_THEMES.neonNight.secondary! : colors.accent}
            icon={<CategoryIcon id={c.id} size={17} color={iconColor} />}
            onPress={() => onSelect(c.id)}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  greeting: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
  },
  deltaDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginRight: 5 },
  search: {
    marginHorizontal: 20,
    marginTop: 18,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 8,
  },
  searchDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.14)' },
  searchSettings: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { paddingHorizontal: 20, gap: 10, paddingVertical: 14 },
});
