import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { ReactNode } from 'react';
import { View } from 'react-native';

import { colors } from '@/theme';
import { IconButton } from './IconButton';
import { T } from './Text';

/** Back button + title for pushed secondary screens. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
      <IconButton label="Back" onPress={() => router.back()}>
        <ChevronLeft size={24} color={colors.ink} />
      </IconButton>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T v="title2">{title}</T>
        {subtitle ? (
          <T v="footnote" color={colors.inkMuted}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}
