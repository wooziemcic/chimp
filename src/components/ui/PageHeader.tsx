import { router } from 'expo-router';
import { Bell, Search } from 'lucide-react-native';
import { ReactNode } from 'react';
import { View } from 'react-native';

import { useUnseenChanges } from '@/hooks/useGraph';
import { BOARD_THEMES, colors, layout } from '@/theme';
import { IconButton } from './IconButton';
import { T } from './Text';

interface Props {
  title: string;
  eyebrow?: string;
  /** One line under the title ("Thoughts. Photos. Takes. Real people."). */
  subtitle?: string;
  dark?: boolean;
  right?: ReactNode;
  /** Sits right after the title (e.g. After Dark's 18+ mark). */
  badge?: ReactNode;
  showActions?: boolean;
  /**
   * Phase 7C: the same header skeleton, smaller — for a mode inside Chimp
   * (After Dark) whose own top tabs follow immediately. No eyebrow, a title1
   * title, the same gutter and rhythm.
   */
  compact?: boolean;
  /** Subtitle colour override (After Dark's muted ink). */
  subtitleColor?: string;
}

/**
 * The header every primary tab shares (Phase 7C: built from `layout`, so
 * normal Chimp and After Dark have the same gutter, top spacing and gaps).
 */
export function PageHeader({ title, eyebrow = 'Chimp', subtitle, dark, right, badge, showActions = true, compact, subtitleColor }: Props) {
  const unseen = useUnseenChanges().length;
  const ink = dark ? colors.white : colors.ink;
  return (
    <View style={{ paddingHorizontal: layout.gutter, paddingTop: layout.headerTop, paddingBottom: subtitle ? 0 : compact ? layout.headerToSegmented - 2 : layout.headerToSegmented }}>
      <View style={{ flexDirection: 'row', alignItems: compact ? 'center' : 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {compact ? null : (
            <T v="callout" color={dark ? 'rgba(255,255,255,0.7)' : colors.inkFaint} weight="500" style={{ fontSize: 17 }}>
              {eyebrow}
            </T>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: compact ? 0 : 2 }}>
            <T v={compact ? 'title1' : 'display'} color={ink} numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
              {title}
            </T>
            {badge}
          </View>
        </View>
        {right}
        {showActions ? (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: compact ? 0 : 2, marginLeft: right ? 12 : 0 }}>
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
      {subtitle ? (
        <T v="subhead" color={subtitleColor ?? (dark ? 'rgba(255,255,255,0.7)' : colors.inkMuted)} numberOfLines={2} style={{ marginTop: layout.headerToSubtitle, marginBottom: layout.headerToSegmented }}>
          {subtitle}
        </T>
      ) : null}
    </View>
  );
}
