import { Compass, LucideIcon, Newspaper, Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { BoardTab, BoardTheme } from '@/types/models';

/** Phase 5: three calm tabs. Today holds the modular edition; Explore is the rabbit hole. */
const TABS: { id: BoardTab; label: string; Icon: LucideIcon }[] = [
  { id: 'today', label: 'Today', Icon: Newspaper },
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'people', label: 'People', Icon: Users },
];

export function BoardTabs({ active, onChange, theme }: { active: BoardTab; onChange: (t: BoardTab) => void; theme: BoardTheme }) {
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.line }]} accessibilityRole="tablist">
      {TABS.map(({ id, label, Icon }) => {
        const on = id === active;
        return (
          <Tap
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            haptic="select"
            onPress={() => onChange(id)}
            style={[styles.tab, on && { backgroundColor: theme.primary }]}
          >
            <Icon size={17} color={on ? theme.onPrimary : theme.mutedText} strokeWidth={2} />
            <T v="callout" weight="700" color={on ? theme.onPrimary : theme.mutedText} style={{ marginLeft: 6 }}>
              {label}
            </T>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: 16, padding: 4, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 21 },
});
