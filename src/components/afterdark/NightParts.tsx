import { LinearGradient } from 'expo-linear-gradient';
import { CalendarHeart, ChevronRight, Compass, Flag, Flame, Heart, LucideIcon, Martini, MessageCircle, MessageSquare, VenetianMask } from 'lucide-react-native';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { NightSection, NightThread } from '@/data/afterDark';
import { useChimp } from '@/store/useChimp';
import { alpha, BOARD_THEMES, fonts } from '@/theme';
import type { BoardTheme } from '@/types/models';
import { compact } from '@/utils/format';

const DEFAULT = BOARD_THEMES.neonNight;

const SECTION_ICON: Record<NightSection['icon'], LucideIcon> = {
  confessions: MessageSquare,
  rooftops: Martini,
  spicy: Flame,
  guides: Compass,
  private: CalendarHeart,
};

export const NightCard = memo(function NightCard({
  section,
  width,
  height,
  onPress,
  theme: t = DEFAULT,
}: {
  section: NightSection;
  width: number;
  height?: number;
  onPress: () => void;
  theme?: BoardTheme;
}) {
  const h = height ?? width * 1.02;
  const Icon = SECTION_ICON[section.icon];
  return (
    <Tap onPress={onPress} scaleTo={0.97} accessibilityLabel={section.title} style={[styles.card, { width, height: h, backgroundColor: t.surface, borderColor: alpha(t.primary, 0.25) }]}>
      <Img uri={section.image} tint={t.surface} style={StyleSheet.absoluteFill} />
      {/* The theme's grade keeps every photo inside the board's palette. */}
      <LinearGradient colors={[alpha(t.primary, 0.18), alpha(t.background, 0.4), alpha(t.background, 0.94)]} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      {section.badge ? (
        <View style={[styles.badge, { borderColor: t.primary }]}>
          <T v="caption" color={t.primary} weight="800">
            {section.badge}
          </T>
        </View>
      ) : null}
      <View style={styles.cardText}>
        <Icon size={26} color={t.accent ?? t.primary} strokeWidth={2} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <T v="headline" color={t.text} style={{ fontSize: 21, flex: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {section.title}
          </T>
          <ChevronRight size={20} color={t.accent ?? t.primary} />
        </View>
        <T v="footnote" color={t.mutedText} weight="400" numberOfLines={2} style={{ marginTop: 3, lineHeight: 17 }}>
          {section.subtitle}
        </T>
      </View>
    </Tap>
  );
});

export const ThreadCard = memo(function ThreadCard({ thread, theme: t = DEFAULT }: { thread: NightThread; theme?: BoardTheme }) {
  const liked = useChimp((s) => !!s.likedPosts[thread.id]);
  const toggleLike = useChimp((s) => s.toggleLike);
  const [pick, setPick] = useState<'a' | 'b' | null>(null);
  const masked = thread.authorMode !== 'public';

  return (
    <View style={[styles.thread, { backgroundColor: t.surface, borderColor: t.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={[styles.maskAvatar, { backgroundColor: masked ? t.primarySoft : 'rgba(255,255,255,0.12)' }]}>
          {masked ? (
            <VenetianMask size={16} color={t.primary} />
          ) : (
            <T v="footnote" color={t.text} weight="700">
              {thread.authorName[0]}
            </T>
          )}
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <T v="subhead" color={t.text} weight="600">
            {thread.authorName}
          </T>
          <T v="caption" color={t.mutedText} weight="500">
            {`${thread.authorMode === 'anonymous' ? 'Anonymous to members' : thread.authorMode === 'pseudonymous' ? 'Verified pseudonym' : 'Public profile'} · ${thread.at}`}
          </T>
        </View>
        <Tap accessibilityLabel="Report" style={styles.iconHit}>
          <Flag size={16} color={t.mutedText} />
        </Tap>
      </View>
      <T v="body" color={t.text} style={{ marginTop: 10, opacity: 0.94 }}>
        {thread.body}
      </T>
      {thread.poll ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {(['a', 'b'] as const).map((k) => {
            const pct = k === 'a' ? thread.poll!.aPct : 100 - thread.poll!.aPct;
            const on = pick === k;
            return (
              <Tap key={k} onPress={() => setPick(on ? null : k)} haptic="select" style={[styles.pollRow, { borderColor: on ? t.primary : t.line }]}>
                {pick ? <View style={[styles.pollFill, { width: `${pct}%`, backgroundColor: alpha(t.primary, 0.28) }]} /> : null}
                <T v="subhead" color={t.text} weight={on ? '700' : '500'} style={{ flex: 1 }}>
                  {k === 'a' ? thread.poll!.a : thread.poll!.b}
                </T>
                {pick ? (
                  <T v="footnote" color={t.text} weight="600">
                    {`${pct}%`}
                  </T>
                ) : null}
              </Tap>
            );
          })}
        </View>
      ) : null}
      <View style={styles.threadActions}>
        <Tap onPress={() => toggleLike(thread.id)} haptic="light" style={styles.action} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
          <Heart size={18} color={liked ? t.primary : t.mutedText} fill={liked ? t.primary : 'transparent'} />
          <T v="footnote" color={t.mutedText} style={{ marginLeft: 6 }}>
            {compact(thread.reactions + (liked ? 1 : 0))}
          </T>
        </Tap>
        <View style={styles.action}>
          <MessageCircle size={18} color={t.mutedText} />
          <T v="footnote" color={t.mutedText} style={{ marginLeft: 6 }}>
            {thread.replies}
          </T>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 20, overflow: 'hidden', borderWidth: 1 },
  badge: { position: 'absolute', top: 12, right: 12, height: 26, paddingHorizontal: 9, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,6,10,0.45)' },
  neon: {
    position: 'absolute',
    left: 16,
    fontFamily: fonts.handBold,
    fontSize: 32,
    lineHeight: 33,
    transform: [{ rotate: '-10deg' }],
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  countPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(20,12,18,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  cardText: { position: 'absolute', left: 14, right: 12, bottom: 14 },
  thread: { borderRadius: 20, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  maskAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pollRow: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  threadActions: { flexDirection: 'row', marginTop: 12, gap: 18 },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
});
