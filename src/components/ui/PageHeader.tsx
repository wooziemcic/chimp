import { router } from 'expo-router';
import { Bell, Search } from 'lucide-react-native';
import { ReactNode } from 'react';
import { View } from 'react-native';

import { useUnseenChanges } from '@/hooks/useGraph';
import { BOARD_THEMES, colors } from '@/theme';
import { IconButton } from './IconButton';
import { T } from './Text';

interface Props {
  title: string;
  eyebrow?: string;
  dark?: boolean;
  right?: ReactNode;
  showActions?: boolean;
}

/** "Chimp / Moves" style header shared by the main tabs. */
export function PageHeader({ title, eyebrow = 'Chimp', dark, right, showActions = true }: Props) {
  const unseen = useUnseenChanges().length;
  const ink = dark ? colors.white : colors.ink;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14 }}>
      <View style={{ flex: 1 }}>
        <T v="callout" color={dark ? 'rgba(255,255,255,0.7)' : colors.inkFaint} weight="500" style={{ fontSize: 17 }}>
          {eyebrow}
        </T>
        <T v="display" color={ink} style={{ marginTop: 2 }}>
          {title}
        </T>
      </View>
      {right}
      {showActions ? (
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 2 }}>
          <IconButton label="Search" variant={dark ? 'dark' : 'light'} onPress={() => router.push('/search')}>
            <Search size={22} color={ink} strokeWidth={2.2} />
          </IconButton>
          <IconButton
            label="What changed"
            variant={dark ? 'dark' : 'light'}
            badge={unseen > 0}
            badgeColor={dark ? BOARD_THEMES.neonNight.primary : colors.accent}
            onPress={() => router.push('/delta')}
          >
            <Bell size={22} color={ink} strokeWidth={2.2} />
          </IconButton>
        </View>
      ) : null}
    </View>
  );
}
