import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft, ShieldCheck, User, VenetianMask } from 'lucide-react-native';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/IconButton';
import { Img } from '@/components/ui/Img';
import { SectionHeader } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { NIGHT_SECTIONS } from '@/data/afterDark';
import { MY_PERSONAS } from '@/data/users';
import { useTabBarSpace } from '@/hooks/useLayout';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { fonts } from '@/theme';
import { NightCard, ThreadCard } from './NightParts';

interface Props {
  /** tab = the After Dark primary tab; board = a nightlife-template Board. */
  variant: 'tab' | 'board';
  /** Any board using the nightlife template. */
  boardId?: string;
}

/**
 * After Dark: its own territory. Mature, nightlife and dating-adjacent
 * conversation — deliberately non-explicit and 18+ gated (research §8.3).
 */
export function AfterDarkWorld({ variant, boardId = 'after-dark' }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabSpace = useTabBarSpace();
  const board = repo.nightBoard(boardId);
  const threads = repo.nightThreads();
  const real = repo.mode() === 'real';
  // Every colour below comes from the board's theme tokens, not constants.
  const t = board.theme;
  const anon = useChimp((s) => s.identity['after-dark'] === 'anonymous');
  const joined = useChimp((s) => !!s.joined['after-dark']);
  const setBrowseAnonymously = useChimp((s) => s.setBrowseAnonymously);
  const toggleJoin = useChimp((s) => s.toggleJoin);
  const persona = MY_PERSONAS.find((p) => p.contexts.includes('after-dark'))!;

  const heroH = 640;
  const cardW = (width - 40 - 12) / 2;

  const joinWithAccount = () => {
    setBrowseAnonymously(false);
    if (!joined) toggleJoin('after-dark');
  };

  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: variant === 'tab' ? tabSpace : insets.bottom + 32 }}>
        {/* Atmosphere */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: heroH }}>
          <Img uri={board.hero} tint="#12080d" style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(7,6,10,0.55)', 'rgba(90,8,40,0.22)', 'rgba(7,6,10,0.2)', t.background]} locations={[0, 0.3, 0.62, 1]} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(7,6,10,0.8)', 'rgba(7,6,10,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0 }} style={StyleSheet.absoluteFill} />
        </View>

        <View style={{ paddingTop: insets.top }}>
          {variant === 'tab' ? (
            <T style={[styles.logo, { color: t.primary }]} accessibilityRole="header">
              CHIMP
            </T>
          ) : (
            <View style={styles.boardTop}>
              <IconButton label="Back" variant="dark" onPress={() => router.back()}>
                <ChevronLeft size={24} color="#fff" />
              </IconButton>
            </View>
          )}
        </View>

        <Animated.View entering={FadeIn.duration(500)} style={{ height: variant === 'tab' ? 170 : 230 }}>
          <T style={styles.neonHand}>{'Good\nPeople\nBad\nPlans'}</T>
        </Animated.View>

        <View style={{ paddingHorizontal: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="display" color="#fff" style={{ fontSize: 50, lineHeight: 56 }}>
              After{' '}
            </T>
            <T v="display" color={t.primary} style={[{ fontSize: 50, lineHeight: 56 }, styles.glowText]}>
              Dark
            </T>
            <View style={[styles.age, { borderColor: t.primary }]}>
              <T v="footnote" color={t.primary} weight="800">
                18+
              </T>
            </View>
          </View>
          <T v="body" color={t.mutedText} style={{ fontSize: 18, lineHeight: 25, marginTop: 6 }}>
            {'Nightlife, confessions, chemistry\nand discreet connections.'}
          </T>

          <View style={styles.ctaRow}>
            <Tap onPress={() => setBrowseAnonymously(true)} haptic="light" accessibilityState={{ selected: anon }} style={[styles.cta, styles.ctaGhost, anon && { borderColor: t.primary, backgroundColor: t.primarySoft }]}>
              <VenetianMask size={24} color="#F2B8D2" />
              <View style={{ marginLeft: 9, flex: 1 }}>
                <T v="subhead" color="#fff" weight="600" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  Browse Anonymously
                </T>
                <T v="caption" color={t.mutedText} weight="400" numberOfLines={1}>
                  {anon ? 'On · no profile, no trace' : 'Explore freely. No profile.'}
                </T>
              </View>
            </Tap>
            <Tap onPress={joinWithAccount} haptic="medium" style={[styles.cta, { overflow: 'hidden' }]}>
              <LinearGradient colors={[t.accent ?? t.primary, t.secondary ?? t.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <User size={22} color="#fff" fill="#fff" />
              <View style={{ marginLeft: 9, flex: 1 }}>
                <T v="subhead" color="#fff" weight="600" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  {joined && !anon ? 'Joined' : 'Join with Account'}
                </T>
                <T v="caption" color="rgba(255,255,255,0.85)" weight="400" numberOfLines={1}>
                  {joined && !anon ? `as ${persona.displayName}` : 'Unlock more. Connect deeper.'}
                </T>
              </View>
            </Tap>
          </View>

          <Tap onPress={() => router.push('/settings')} style={[styles.identity, { borderColor: t.line }]}>
            <ShieldCheck size={16} color={t.primary} />
            <T v="footnote" color={t.mutedText} style={{ marginLeft: 8, flex: 1 }}>
              {anon
                ? 'You appear as Anonymous. Your main profile is never linked here.'
                : real
                  ? 'You appear with a verified pseudonym. Your main profile stays separate.'
                  : `You appear as ${persona.displayName}, a verified pseudonym. Your main profile stays separate.`}
            </T>
          </Tap>

          <SectionHeader title="Inside After Dark" dark style={{ marginTop: 26 }} onSeeAll={() => router.push('/after-dark/confessions')} />
          <View style={styles.grid}>
            {NIGHT_SECTIONS.map((sec) => (
              <NightCard
                key={sec.id}
                section={sec}
                theme={t}
                width={sec.wide ? width - 40 : cardW}
                height={sec.wide ? 150 : undefined}
                onPress={() => router.push(`/after-dark/${sec.id}`)}
              />
            ))}
          </View>

          <SectionHeader title="Tonight in the scene" subtitle="Bounded by the scene, moderated, never explicit" dark style={{ marginTop: 28 }} />
          <View style={{ gap: 12 }}>
            {threads.slice(0, 3).map((th) => (
              <ThreadCard key={th.id} thread={th} theme={t} />
            ))}
            {!threads.length ? (
              <View style={[styles.quiet, { borderColor: t.line }]}>
                <T v="subhead" weight="700" color={t.text}>
                  Quiet tonight
                </T>
                <T v="footnote" color={t.mutedText} style={{ marginTop: 4 }}>
                  Conversations appear here as people join After Dark.
                </T>
              </View>
            ) : null}
          </View>

          <T v="caption" color={t.mutedText} weight="500" align="center" style={{ marginTop: 22, lineHeight: 16 }}>
            {'18+ only · Non-explicit by design · Report and block are one tap away'}
          </T>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  quiet: { padding: 16, borderRadius: 18, borderWidth: 1 },
  boardTop: { paddingHorizontal: 16, paddingTop: 6, flexDirection: 'row' },
  logo: {
    alignSelf: 'center',
    marginTop: 8,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 7,
    textShadowColor: 'rgba(255,46,136,0.7)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  neonHand: {
    position: 'absolute',
    right: 22,
    top: -6,
    fontFamily: fonts.handBold,
    fontSize: 36,
    lineHeight: 34,
    color: '#FF4D9A',
    textAlign: 'center',
    transform: [{ rotate: '-12deg' }],
    textShadowColor: '#FF2E88',
    textShadowRadius: 16,
    textShadowOffset: { width: 0, height: 0 },
  },
  glowText: { textShadowColor: 'rgba(255,46,136,0.6)', textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
  age: {
    marginLeft: 10,
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  ctaRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cta: {
    flex: 1,
    height: 72,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  ctaGhost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
