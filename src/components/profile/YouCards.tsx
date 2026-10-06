import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Bookmark, Calendar, Camera, ChevronRight, Coffee, LucideIcon, Map as MapIcon, Moon, Plane, Sparkles, Users } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { openWorldActions } from '@/components/worlds/WorldActionSheet';
import { T } from '@/components/ui/Text';
import { colors, radius, shadow } from '@/theme';
import type { Board, OpenLoop } from '@/types/models';

// ─── Board stack (Saved Boards / Your Boards) ───────────────────────────────

export const BoardStackCard = memo(function BoardStackCard({
  title,
  boards,
  countLabel,
  onSeeAll,
  empty = 'Nothing here yet.',
}: {
  title: string;
  boards: Board[];
  countLabel: (b: Board) => string;
  onSeeAll: () => void;
  /** Phase 6A: intentional empty state (“You haven’t joined a World yet.”). */
  empty?: string;
}) {
  const lead = boards[0];
  return (
    <View style={styles.panel}>
      {/* Chevron-only "see all" so the title never truncates in a half-width card. */}
      <Tap onPress={onSeeAll} style={styles.panelHead} accessibilityLabel={`See all ${title}`}>
        <T v="headline" numberOfLines={1} style={{ flex: 1, fontSize: 16.5 }}>
          {title}
        </T>
        <T v="caption" color={colors.inkFaint} weight="600" style={{ marginRight: 2 }}>
          {boards.length}
        </T>
        <ChevronRight size={16} color={colors.inkMuted} />
      </Tap>
      {lead ? (
        <View style={{ flexDirection: 'row', height: 124 }}>
          <Tap onPress={() => router.push(`/board/${lead.id}`)} onLongPress={() => openWorldActions(lead.id)} delayLongPress={380} scaleTo={0.97} style={[styles.lead, shadow.sm]}>
            <Img uri={lead.cover} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']} locations={[0.35, 1]} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
            <View style={styles.bookmark}>
              <Bookmark size={14} color={colors.ink} fill={colors.ink} />
            </View>
            <View style={{ position: 'absolute', left: 9, right: 6, bottom: 8 }}>
              <T v="subhead" weight="700" color={colors.white} numberOfLines={2} style={{ lineHeight: 17 }}>
                {lead.title}
              </T>
              <T v="caption" color="rgba(255,255,255,0.9)" weight="500">
                {countLabel(lead)}
              </T>
            </View>
          </Tap>
          {boards.slice(1, 4).map((b, i) => (
            <Img key={b.id} uri={b.cover} style={[styles.slice, { marginLeft: i === 0 ? 5 : -12, zIndex: -i, height: 124 - i * 8, marginTop: i * 4 }]} />
          ))}
        </View>
      ) : (
        <T v="footnote" color={colors.inkMuted}>
          {empty}
        </T>
      )}
    </View>
  );
});

// ─── Open Loop icons ────────────────────────────────────────────────────────

const LOOP_ICON: Record<OpenLoop['icon'], LucideIcon> = {
  plane: Plane,
  users: Users,
  coffee: Coffee,
  moon: Moon,
  calendar: Calendar,
  camera: Camera,
  map: MapIcon,
  sparkles: Sparkles,
};

export function LoopIcon({ icon, size = 17, color = colors.ink2 }: { icon: OpenLoop['icon']; size?: number; color?: string }) {
  const I = LOOP_ICON[icon];
  return <I size={size} color={color} fill={icon === 'plane' || icon === 'users' ? color : 'transparent'} />;
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.sm,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, minHeight: 32 },
  lead: { flex: 1, borderRadius: 14, backgroundColor: colors.bgSoft },
  bookmark: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slice: { width: 22, borderRadius: 10, borderWidth: 2, borderColor: colors.white },
});
