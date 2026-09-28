import { memo } from 'react';
import { View } from 'react-native';

import { repo } from '@/services/repository';
import { colors } from '@/theme';
import { Avatar } from './Avatar';
import { T } from './Text';

interface Props {
  userIds: string[];
  size?: number;
  max?: number;
  borderColor?: string;
  /** Show a "+N" bubble for the remainder. */
  extra?: number;
  overlap?: number;
  dark?: boolean;
}

export const AvatarStack = memo(function AvatarStack({
  userIds,
  size = 26,
  max = 3,
  borderColor = colors.white,
  extra,
  overlap = 0.32,
  dark,
}: Props) {
  const shown = userIds.slice(0, max);
  const ml = -size * overlap;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((id, i) => {
        const u = repo.user(id);
        return (
          <Avatar
            key={id}
            uri={u?.avatar}
            name={u?.displayName}
            size={size}
            ring={borderColor}
            ringWidth={Math.max(1.5, size * 0.07)}
            style={{ marginLeft: i === 0 ? 0 : ml, zIndex: max - i }}
          />
        );
      })}
      {extra && extra > 0 ? (
        <View
          style={{
            marginLeft: ml,
            height: size,
            minWidth: size,
            paddingHorizontal: 6,
            borderRadius: size / 2,
            backgroundColor: dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.28)',
            borderWidth: Math.max(1.5, size * 0.07),
            borderColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T v="footnote" color={colors.white} weight="700">{`+${extra}`}</T>
        </View>
      ) : null}
    </View>
  );
});

/** 2×2 cluster used beside circular scenes on Pulse. */
export const AvatarCluster = memo(function AvatarCluster({ userIds, size = 30 }: { userIds: string[]; size?: number }) {
  const ids = userIds.slice(0, 4);
  return (
    <View style={{ width: size * 2, flexDirection: 'row', flexWrap: 'wrap' }}>
      {ids.map((id, i) => {
        const u = repo.user(id);
        return (
          <Avatar
            key={id}
            uri={u?.avatar}
            name={u?.displayName}
            size={size}
            ring={colors.white}
            ringWidth={2}
            style={{ marginLeft: i % 2 === 1 ? -size * 0.15 : 0, marginTop: i > 1 ? -size * 0.12 : 0 }}
          />
        );
      })}
    </View>
  );
});
