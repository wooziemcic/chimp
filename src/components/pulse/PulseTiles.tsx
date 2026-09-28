import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Bookmark, Calendar, Heart } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AvatarCluster, AvatarStack } from '@/components/ui/AvatarStack';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Img } from '@/components/ui/Img';
import { FreshBadge } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { CATEGORIES } from '@/data/interests';
import type { PulseEntity } from '@/services/recommender';
import { useChimp } from '@/store/useChimp';
import { colors, shadow } from '@/theme';
import { compact } from '@/utils/format';
import type { CardSlot, CircleSlot } from './layout';

const catLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? '';

// ─── Card tile ──────────────────────────────────────────────────────────────

interface CardProps {
  entity: PulseEntity;
  slot: CardSlot;
  s: number;
  index: number;
  onOpenAfterDark: () => void;
}

export const PulseCard = memo(function PulseCard({ entity, slot, s, index, onOpenAfterDark }: CardProps) {
  const savedBoards = useChimp((st) => st.savedBoards);
  const moveState = useChimp((st) => st.moveState);
  const toggleSaveBoard = useChimp((st) => st.toggleSaveBoard);
  const toggleMove = useChimp((st) => st.toggleMove);

  if (entity.kind === 'person') return null;

  const isBoard = entity.kind === 'board';
  const id = isBoard ? entity.board.id : entity.move.id;
  const title = isBoard ? entity.board.title : entity.move.title;
  const image = isBoard ? entity.board.cover : entity.move.image;
  const category = isBoard ? entity.board.category : entity.move.category;
  const people = isBoard ? entity.board.memberPreview : entity.move.attendeePreview;
  const count = isBoard ? entity.board.memberCount : entity.move.attendeeCount;
  const countLabel = isBoard ? 'members' : 'going';
  const saved = isBoard ? !!savedBoards[id] : !!moveState[id]?.saved;

  const open = () => {
    if (isBoard && entity.board.id === 'after-dark') return onOpenAfterDark();
    router.push(isBoard ? `/board/${id}` : `/move/${id}`);
  };
  const toggle = () => (isBoard ? toggleSaveBoard(id) : toggleMove(id, 'saved'));

  const lg = slot.size === 'lg';
  const r = 22 * s;
  const ActionIcon = slot.action === 'bookmark' ? Bookmark : Heart;

  return (
    <Animated.View
      entering={FadeIn.duration(380).delay(80 + index * 60)}
      style={{
        position: 'absolute',
        left: slot.x * s,
        top: slot.y * s,
        width: slot.w * s,
        height: slot.h * s,
        transform: [{ rotate: `${slot.rotate}deg` }],
      }}
    >
      <Tap onPress={open} scaleTo={0.975} accessibilityLabel={`Open ${title}`} style={[styles.card, { borderRadius: r }, shadow.lg]}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
          <Img uri={image} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Tag */}
        <View style={[styles.tag, { top: 12 * s, left: 12 * s, height: 30 * s, paddingHorizontal: 11 * s }]}>
          {isBoard ? (
            <CategoryIcon id={category} size={14 * s} color={colors.accent} />
          ) : (
            <Calendar size={14 * s} color={colors.accent} strokeWidth={2.2} />
          )}
          <T v="caption" color={colors.ink2} weight="600" style={{ marginLeft: 6, letterSpacing: 1, fontSize: 11 * s }}>
            {isBoard ? catLabel(category).toUpperCase() : `MOVE · ${entity.move.dateLabel.toUpperCase()}`}
          </T>
        </View>

        {/* Save */}
        <Tap
          onPress={toggle}
          haptic="light"
          accessibilityLabel={saved ? `Unsave ${title}` : `Save ${title}`}
          style={[styles.action, { top: 10 * s, right: 10 * s, width: 38 * s, height: 38 * s, borderRadius: 19 * s }]}
        >
          <ActionIcon
            size={18 * s}
            color={saved ? (slot.action === 'heart' ? colors.heart : colors.accent) : colors.ink}
            fill={saved ? (slot.action === 'heart' ? colors.heart : colors.accent) : 'transparent'}
            strokeWidth={2}
          />
        </Tap>

        {/* Footer */}
        <View style={[styles.footer, { left: 14 * s, right: 12 * s, bottom: 14 * s }]}>
          <T
            v="title2"
            color={colors.white}
            numberOfLines={2}
            style={[styles.titleShadow, { fontSize: (lg ? 27 : 23) * s, lineHeight: (lg ? 31 : 26) * s }]}
          >
            {title}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 * s, marginRight: slot.arrow ? 42 * s : 0, height: 40 * s }}>
            <AvatarStack userIds={people} size={22 * s} max={3} overlap={0.38} />
            <T v="footnote" color={colors.white} weight="600" numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[styles.titleShadow, { marginLeft: 6, fontSize: 12.5 * s, flexShrink: 1 }]}
            >
              {`${compact(count)} ${countLabel}`}
            </T>
          </View>
        </View>

        {slot.arrow ? (
          <View style={[styles.arrow, { right: 12 * s, bottom: 15 * s, width: 40 * s, height: 40 * s, borderRadius: 20 * s }]}>
            <ArrowRight size={19 * s} color={colors.ink} strokeWidth={2.2} />
          </View>
        ) : null}
      </Tap>
      <FreshBadge count={entity.fresh} variant="pip" style={{ position: 'absolute', top: -4, left: -4 }} />
    </Animated.View>
  );
});

// ─── Circle tile ────────────────────────────────────────────────────────────

interface CircleProps {
  entity: PulseEntity;
  slot: CircleSlot;
  s: number;
  index: number;
  onOpenAfterDark: () => void;
}

export const PulseCircle = memo(function PulseCircle({ entity, slot, s, index, onOpenAfterDark }: CircleProps) {
  if (entity.kind === 'move') return null;
  const isPerson = entity.kind === 'person';
  const title = isPerson ? entity.person.displayName.split(' ')[0] : entity.board.title;
  const image = isPerson ? entity.person.avatar : entity.board.cover;
  const cluster = isPerson ? [] : entity.board.memberPreview;
  const stat = isPerson ? `${entity.match.matchScore}%` : `${compact(entity.board.memberCount)}+`;
  const verb = isPerson ? 'match' : entity.board.activityVerb;
  const d = slot.circle.d * s;

  const open = () => {
    if (isPerson) return router.push(`/profile/${entity.person.id}`);
    if (entity.board.id === 'after-dark') return onOpenAfterDark();
    router.push(`/board/${entity.board.id}`);
  };

  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={slot.glow.colors}
        start={{ x: 0.2, y: 0.2 }}
        end={{ x: 0.9, y: 0.9 }}
        style={{
          position: 'absolute',
          left: slot.glow.x * s,
          top: slot.glow.y * s,
          width: slot.glow.d * s,
          height: slot.glow.d * s,
          borderRadius: slot.glow.d * s,
          opacity: 0.9,
        }}
      />
      {!isPerson ? (
        <View style={{ position: 'absolute', left: slot.cluster.x * s, top: slot.cluster.y * s }}>
          <AvatarCluster userIds={cluster} size={29 * s} />
        </View>
      ) : null}
      <View
        style={{
          position: 'absolute',
          left: (isPerson ? slot.cluster.x : slot.label.x) * s,
          top: (isPerson ? slot.cluster.y + 12 : slot.label.y) * s,
          width: 76 * s,
        }}
        pointerEvents="none"
      >
        <T v="headline" style={{ fontSize: 16 * s }}>
          {stat}
        </T>
        <T v="footnote" color={colors.inkMuted} weight="400" numberOfLines={1} style={{ fontSize: 13 * s, lineHeight: 16 * s }}>
          {verb}
        </T>
      </View>

      <Animated.View
        entering={FadeIn.duration(380).delay(40 + index * 60)}
        style={{ position: 'absolute', left: slot.circle.x * s, top: slot.circle.y * s, width: d, height: d }}
      >
        <Tap onPress={open} scaleTo={0.95} accessibilityLabel={`Open ${title}`} style={[{ width: d, height: d, borderRadius: d / 2 }, shadow.md]}>
          <View style={{ width: d, height: d, borderRadius: d / 2, overflow: 'hidden' }}>
            <Img uri={image} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.circleLabel}>
              <T v="headline" color={colors.white} align="center" numberOfLines={2} style={[styles.titleShadow, { fontSize: 19 * s, lineHeight: 22 * s }]}>
                {title}
              </T>
            </View>
          </View>
        </Tap>
        <FreshBadge count={entity.fresh} variant="pip" style={{ position: 'absolute', top: 6 * s, right: 6 * s }} />
      </Animated.View>
    </>
  );
});

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.bgSoft },
  tag: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  action: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  footer: { position: 'absolute' },
  arrow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  titleShadow: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  circleLabel: { position: 'absolute', left: 6, right: 6, bottom: '16%' },
});
