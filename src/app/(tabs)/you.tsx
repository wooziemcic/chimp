import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ellipsis, MessageCircle, Settings } from 'lucide-react-native';
import { useMemo, useRef } from 'react';
import { FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionRequests } from '@/components/profile/ConnectionRequests';
import { MatchCard } from '@/components/profile/MatchCard';
import { InterestGraph, KnownFor, OpenLoopsPanel, OpenToCard, PromptsRow, StatsRow, AgentBriefingCard } from '@/components/profile/ProfileParts';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { RecentPosts } from '@/components/profile/RecentPosts';
import { BoardStackCard } from '@/components/profile/YouCards';
import { DatingSummary, Lately, RelationTiles } from '@/components/profile/YouParts';
import { IconButton } from '@/components/ui/IconButton';
import { SectionHeader } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { INTERESTS, interestById } from '@/data/interests';
import { CATALOG_BY_ID } from '@/data/worldCatalog';
import { agentLines } from '@/graph/agent';
import { AFFINITY, MATCH } from '@/graph/config';
import { isAfterDarkBoard } from '@/graph/surfaces';
import { useAgentBrief, useGraphCtx } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { rankPeople } from '@/services/recommender';
import { selectRequests, selectUnread, useChat } from '@/store/useChat';
import { CONNECTIONS_BASE, SEED_FOLLOWING, useChimp } from '@/store/useChimp';
import { colors, shadow } from '@/theme';
import type { ProfileMoment } from '@/types/models';
import { compact } from '@/utils/format';
import { pushOnce } from '@/utils/nav';

const interestByLabel = Object.fromEntries(INTERESTS.map((i) => [i.label.toLowerCase(), i.id]));

/** Split a motto over two lines near its middle ("Good people,\nbetter plans ♡"). */
function twoLines(text: string): string {
  const words = text.split(' ');
  if (text.length <= 14 || words.length < 3) return text;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

/**
 * You — social identity + lifestyle + a subtle dating layer + your graph.
 * Phase 5 restores the approved creative hero (cut-out portrait over a
 * lavender atmosphere, "Good people, better plans", stacked interest
 * moments). The informational cards follow and never lead.
 */
export default function YouScreen() {
  // The active dataset as React state (not a global read), so memos below track it.
  const data = useDataset();
  const me = data.me;
  const bottom = useTabBarSpace();
  const { width } = useWindowDimensions();
  const ctx = useGraphCtx();
  const profile = useChimp((s) => s.profile);
  const toggleOpenTo = useChimp((s) => s.toggleOpenTo);
  const brief = useAgentBrief();
  const lines = useMemo(() => agentLines(brief), [brief]);
  const scroller = useRef<ScrollView>(null);
  const openToY = useRef(0);
  const s = ctx.s;

  const real = data.mode === 'real';
  const unread = useChat((c) => selectUnread(c) + selectRequests(c));
  const people = useMemo(() => rankPeople(s, { excludeConnected: true }), [s]);
  const matchCount = people.filter((r) => r.match.matchScore >= MATCH.suggestAt).length;
  // REAL: honest counts from real relationships only. DEMO: the seeded fixture numbers.
  const followerCount = real ? me.followers : me.followers;
  const followingCount = real ? Object.keys(s.following).length : me.following + Object.keys(s.following).length - SEED_FOLLOWING.length;
  const connectionCount = real ? Object.keys(s.connections).length : CONNECTIONS_BASE + Object.keys(s.connections).length;

  const saved = useMemo(() => data.boards.filter((b) => s.savedBoards[b.id] && !isAfterDarkBoard(b)), [data.boards, s.savedBoards]);
  const mine = useMemo(() => data.boards.filter((b) => b.ownerId === me.id || (real && s.joined[b.id])), [data.boards, me.id, real, s.joined]);

  // What your graph has been leaning towards: above "high" and above where it started.
  const hot = useMemo(
    () =>
      Object.keys(s.affinity)
        .filter((i) => s.affinity[i] >= AFFINITY.high && s.affinity[i] > (real ? AFFINITY.onboarding : AFFINITY.seed[i] ?? 0) && interestById[i]?.category !== 'afterDark')
        .sort((a, b) => s.affinity[b] - s.affinity[a]),
    [s.affinity, real],
  );
  // Moments keep the approved order; interests you're into lately move to the front.
  const moments = useMemo(() => {
    const key = (m: ProfileMoment) => (m.ref?.kind === 'board' && CATALOG_BY_ID[m.ref.id] ? CATALOG_BY_ID[m.ref.id].interests[0] : interestByLabel[m.label.toLowerCase()]);
    const lead = (me.moments ?? []).filter((m) => hot.includes(key(m))).sort((a, b) => hot.indexOf(key(a)) - hot.indexOf(key(b)));
    return [...lead, ...(me.moments ?? []).filter((m) => !lead.includes(m))];
  }, [me.moments, hot]);
  const knownFor = useMemo(() => {
    const base = me.knownFor ?? [];
    const promoted = base.filter((k) => hot.some((i) => k.toLowerCase().includes(interestById[i]?.label.toLowerCase() ?? '~')));
    return [...promoted, ...base.filter((k) => !promoted.includes(k))];
  }, [me.knownFor, hot]);

  const interests = useMemo(
    () => [...new Set([...me.interests, ...Object.keys(s.affinity).filter((i) => s.affinity[i] >= AFFINITY.high)])].sort((a, b) => (s.affinity[b] ?? 0) - (s.affinity[a] ?? 0)),
    [me.interests, s.affinity],
  );
  const phrase = profile.phrase ?? me.profilePhrase ?? '';
  const emoji = profile.emoji ?? me.profileEmoji ?? '';
  const photo = profile.avatarUri ?? (real ? undefined : me.heroImage);
  const cutout = !profile.avatarUri && !real && !!me.heroCutout;
  // Sparks only (mutual). Crushes you've sent or received are never counted here.
  const sparks = Object.keys(s.crushes).filter((id) => ctx.match(id).spark);
  const cardW = Math.min(220, Math.floor((width - 32 - 12) / 1.7));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <LinearGradient colors={['#ECE6FF', '#F3F0FF', colors.bg]} locations={[0, 0.35, 1]} style={[StyleSheet.absoluteFill, { height: 560 }]} pointerEvents="none" />
      <ScrollView ref={scroller} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottom }}>
        <PageHeader
          title="You"
          showActions={false}
          right={
            <IconButton label="Settings" onPress={() => router.push('/settings')}>
              <Settings size={24} color={colors.ink} strokeWidth={2} />
            </IconButton>
          }
        />

        <ProfileHero
          name={profile.displayName ?? me.displayName}
          verified={me.verified}
          city={profile.city}
          image={photo}
          cutout={cutout}
          photoMode="framed"
          focusY={profile.focusY ?? me.avatarFocusY ?? 0.3}
          moments={moments}
          handwriting={phrase ? twoLines(`${phrase} ${emoji}`.trim()) : undefined}
          onEdit={() => router.push('/edit-profile')}
        >
          <T v="callout" color={colors.ink2} weight="400" style={{ lineHeight: 22 }}>
            {profile.bio}
          </T>
          <KnownFor items={knownFor} />
          {real && !knownFor.length ? (
            <T v="footnote" color={colors.inkFaint} style={{ marginTop: 8 }}>
              Known For grows from what you share in your Worlds.
            </T>
          ) : null}
          <Lately labels={hot.slice(0, 3).map((i) => interestById[i]?.label ?? i)} />
          <StatsRow
            stats={[
              // Phase 9.2: your own lists open here — private to you (others' profiles show totals only).
              { value: compact(followerCount), label: 'Followers', onPress: () => pushOnce('/relations?list=followers') },
              { value: compact(followingCount), label: 'Following', onPress: () => pushOnce('/relations?list=following') },
              { value: compact(connectionCount), label: 'Connections', onPress: () => pushOnce('/relations?list=connections') },
              { value: `${matchCount}`, label: 'Matches', onPress: () => router.push('/people') },
            ]}
          />
          <View style={styles.actions}>
            {/* Phase 6B: your own profile opens your Messages (never "chat with yourself"). */}
            <Tap onPress={() => pushOnce('/messages')} haptic="light" style={[styles.chat, shadow.glow]} accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'}>
              <MessageCircle size={18} color={colors.white} />
              <T v="subhead" weight="700" color={colors.white} style={{ marginLeft: 8 }}>
                Messages
              </T>
              {unread ? (
                <View style={styles.unread}>
                  <T v="caption" weight="800" color={colors.accent} style={{ fontSize: 12 }}>
                    {unread > 99 ? '99+' : unread}
                  </T>
                </View>
              ) : null}
            </Tap>
            <Tap onPress={() => router.push('/settings')} style={styles.more} accessibilityLabel="More">
              <Ellipsis size={20} color={colors.ink} />
            </Tap>
          </View>
        </ProfileHero>

        {/* Phase 7B: requests to connect, where you'll see them. */}
        <ConnectionRequests />

        <View style={{ marginTop: 14 }}>
          <DatingSummary openTo={profile.openTo} sparks={sparks} onEdit={() => scroller.current?.scrollTo({ y: openToY.current - 12, animated: true })} />
        </View>

        <View style={styles.pair}>
          <BoardStackCard
            title="Saved Boards"
            boards={saved}
            countLabel={(b) => postsLabel(repo.boardPostCount(b.id))}
            onSeeAll={() => router.navigate({ pathname: '/boards', params: { segment: 'saved', at: String(Date.now()) } })}
            empty="Nothing saved yet."
          />
          {mine.length || real ? (
            <BoardStackCard title="Your Boards" boards={mine} countLabel={(b) => `${b.memberCount} ${b.memberCount === 1 ? 'member' : 'members'} · ${postsLabel(repo.boardPostCount(b.id))}`} onSeeAll={() => router.navigate({ pathname: '/boards', params: { segment: 'joined', at: String(Date.now()) } })} empty="You haven’t joined a World yet." />
          ) : null}
        </View>

        <RecentPosts personId={me.id} firstName={(profile.displayName ?? me.displayName).split(' ')[0]} own />

        <View style={styles.gap}>
          <OpenLoopsPanel loops={s.openLoops} />
        </View>
        <View style={styles.gap}>
          <AgentBriefingCard lines={real && !Object.keys(s.joined).length && s.activity.length < 3 ? [] : lines.slice(0, 3)} empty="Give Chimp a little time to learn what matters to you." />
        </View>

        <View style={{ marginTop: 22 }}>
          <SectionHeader title="People You Should Meet" subtitle="Curated by your agent from your interests, Worlds and plans" onSeeAll={() => router.push('/people')} style={{ paddingHorizontal: 16 }} />
          {!people.length ? (
            <T v="footnote" color={colors.inkFaint} style={{ paddingHorizontal: 16, marginTop: 2 }}>
              No one yet. As friends join Chimp, people who share your Worlds show up here.
            </T>
          ) : null}
          <FlatList
            horizontal
            data={people.slice(0, 8)}
            keyExtractor={(p) => p.person.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardW + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}
            renderItem={({ item }) => <MatchCard person={item.person} width={cardW} />}
          />
        </View>

        <View
          style={styles.gap}
          onLayout={(e) => {
            openToY.current = e.nativeEvent.layout.y;
          }}
        >
          <OpenToCard value={profile.openTo} onToggle={toggleOpenTo} />
        </View>

        <RelationTiles connections={connectionCount} matches={matchCount} />

        <View style={styles.gap}>
          <InterestGraph
            interests={interests}
            highlight={hot}
            caption={hot.length ? 'Filled: what you’ve been into lately. The number is how much of the graph each one pulls in.' : undefined}
          />
        </View>

        {me.prompts?.length ? (
          <View style={styles.gap}>
            <PromptsRow prompts={me.prompts} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 14 },
  pair: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  chat: { flex: 1, height: 50, borderRadius: 25, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  more: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});

const postsLabel = (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`;
