import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Bookmark, Sparkles } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AvatarStack } from '@/components/ui/AvatarStack';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Img } from '@/components/ui/Img';
import { FreshBadge } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { CATEGORIES } from '@/data/interests';
import { useFresh } from '@/hooks/useGraph';
import { useChimp } from '@/store/useChimp';
import { colors, shadow } from '@/theme';
import type { Board } from '@/types/models';
import { compact } from '@/utils/format';

interface Props {
  board: Board;
  /** magazine = the Boards rack (Phase 4); wide/tile kept for other screens. */
  variant?: 'wide' | 'tile' | 'magazine';
  width?: number;
  reason?: string;
  latest?: string;
  /** Magazine card: show a save control when there's no "new" pill. */
  showSave?: boolean;
}

/** Reusable Board card. Wide = joined list; tile = discovery grid. */
export const BoardCard = memo(function BoardCard(props: Props) {
  if (props.variant === 'magazine') return <MagazineCard {...props} />;
  return <ClassicCard {...props} />;
});

/**
 * A World on the rack: big photo, category, title, one line, who's there.
 * Deliberately light on text — it should read like a magazine cover.
 */
function MagazineCard({ board, width = 170, reason, showSave }: Props & { showSave?: boolean }) {
  const fresh = useFresh({ kind: 'board', id: board.id });
  const saved = useChimp((s) => !!s.savedBoards[board.id]);
  const toggleSave = useChimp((s) => s.toggleSaveBoard);
  const h = Math.round(width * 1.36);
  const dark = board.theme.mode === 'dark';
  const cat = CATEGORIES.find((c) => c.id === board.category)?.label ?? '';

  return (
    <Tap onPress={() => router.push(`/board/${board.id}`)} scaleTo={0.975} accessibilityLabel={`Open ${board.title}${fresh ? `, ${fresh} new` : ''}`} style={[{ height: h, width }, styles.mag, shadow.md]}>
      <View style={[StyleSheet.absoluteFill, styles.magClip]}>
        <Img uri={board.cover} style={StyleSheet.absoluteFill} tint={dark ? '#1a0f14' : colors.bgSoft} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.72)']} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.top}>
        <View style={styles.magTag}>
          <T v="caption" color={colors.ink2} weight="600" style={{ fontSize: 12 }}>
            {cat}
          </T>
        </View>
        <View style={{ flex: 1 }} />
        {fresh > 0 ? (
          <View style={styles.newPill}>
            <View style={styles.newDot} />
            <T v="caption" color={colors.ink} weight="700" style={{ fontSize: 12 }}>
              {`${fresh} new`}
            </T>
          </View>
        ) : showSave ? (
          <Tap onPress={() => toggleSave(board.id)} haptic="light" accessibilityLabel={saved ? 'Unsave board' : 'Save board'} style={styles.save}>
            <Bookmark size={15} color={saved ? colors.accent : colors.ink} fill={saved ? colors.accent : 'transparent'} />
          </Tap>
        ) : null}
      </View>
      <View style={styles.magBottom}>
        <T v="title2" color={colors.white} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.shadow, { fontSize: 23, lineHeight: 27 }]}>
          {board.title}
        </T>
        {reason ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <Sparkles size={11} color="#BFD5FF" />
            <T v="caption" color="#DCE7FF" weight="600" numberOfLines={2} style={{ marginLeft: 4, flexShrink: 1 }}>
              {reason}
            </T>
          </View>
        ) : (
          <T v="footnote" color="rgba(255,255,255,0.9)" weight="400" numberOfLines={2} style={[styles.shadow, { marginTop: 3, lineHeight: 17 }]}>
            {board.tagline}
          </T>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9 }}>
          <AvatarStack userIds={board.memberPreview} size={22} max={3} />
          <T v="caption" color={colors.white} weight="600" numberOfLines={1} style={[styles.shadow, { marginLeft: 6, flexShrink: 1 }]}>
            {`${compact(board.memberCount)} members`}
          </T>
        </View>
      </View>
    </Tap>
  );
}

function ClassicCard({ board, variant = 'wide', width, reason, latest }: Props) {
  const fresh = useFresh({ kind: 'board', id: board.id });
  const saved = useChimp((s) => !!s.savedBoards[board.id]);
  const toggleSave = useChimp((s) => s.toggleSaveBoard);
  const wide = variant === 'wide';
  const h = wide ? 196 : (width ?? 160) * 1.18;
  const dark = board.theme.mode === 'dark';
  const cat = CATEGORIES.find((c) => c.id === board.category)?.label ?? '';

  return (
    <Tap
      onPress={() => router.push(`/board/${board.id}`)}
      scaleTo={0.975}
      accessibilityLabel={`Open ${board.title}`}
      style={[{ height: h, width }, styles.card, shadow.md]}
    >
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Img uri={board.cover} style={StyleSheet.absoluteFill} tint={dark ? '#1a0f14' : colors.bgSoft} />
        <LinearGradient
          colors={dark ? ['rgba(90,8,40,0.35)', 'rgba(7,6,10,0.9)'] : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.66)']}
          locations={[0.3, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.top}>
        <View style={styles.tag}>
          <CategoryIcon id={board.category} size={12} color={dark ? '#FF2E88' : colors.accent} />
          <T v="caption" color={colors.ink2} style={{ marginLeft: 5, letterSpacing: 0.8, fontSize: 10.5 }}>
            {cat.toUpperCase()}
          </T>
        </View>
        {wide && fresh > 0 ? <FreshBadge count={fresh} variant="glass" style={{ marginLeft: 6 }} /> : null}
        <View style={{ flex: 1 }} />
        <Tap onPress={() => toggleSave(board.id)} haptic="light" accessibilityLabel={saved ? 'Unsave board' : 'Save board'} style={styles.save}>
          <Bookmark size={16} color={saved ? colors.accent : colors.ink} fill={saved ? colors.accent : 'transparent'} />
        </Tap>
      </View>

      <View style={styles.bottom}>
        <T v={wide ? 'title2' : 'headline'} color={colors.white} numberOfLines={2} style={styles.shadow}>
          {board.title}
        </T>
        {wide && latest ? (
          <T v="footnote" color="rgba(255,255,255,0.92)" weight="400" numberOfLines={1} style={[styles.shadow, { marginTop: 2 }]}>
            {latest}
          </T>
        ) : null}
        {reason ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Sparkles size={11} color="#BFD5FF" />
            <T v="caption" color="#DCE7FF" weight="600" numberOfLines={1} style={{ marginLeft: 4, flexShrink: 1 }}>
              {reason}
            </T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <AvatarStack userIds={board.memberPreview} size={wide ? 24 : 20} max={3} />
          <T v="caption" color={colors.white} weight="600" style={[styles.shadow, { marginLeft: 6 }]}>
            {`${compact(board.memberCount)} ${board.activityVerb}`}
          </T>
        </View>
      </View>
      {!wide && fresh > 0 ? <FreshBadge count={fresh} variant="pip" style={{ position: 'absolute', top: -4, left: -4 }} /> : null}
    </Tap>
  );
}

const styles = StyleSheet.create({
  mag: { borderRadius: 24, backgroundColor: colors.bgSoft },
  magClip: { borderRadius: 24, overflow: 'hidden' },
  magTag: { height: 28, paddingHorizontal: 11, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center' },
  newPill: { flexDirection: 'row', alignItems: 'center', height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.94)' },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginRight: 6 },
  magBottom: { position: 'absolute', left: 13, right: 13, bottom: 14 },
  card: { borderRadius: 22, backgroundColor: colors.bgSoft },
  clip: { borderRadius: 22, overflow: 'hidden' },
  top: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)' },
  save: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 14, right: 14, bottom: 14 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
});
