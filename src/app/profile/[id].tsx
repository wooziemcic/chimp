import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Ellipsis, Heart, Link2, MessageCircle, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoardCard } from '@/components/boards/BoardCard';
import { MoveCard } from '@/components/moves/MoveCard';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { InterestGraph, KnownFor, OpenToCard, PromptsRow, StatsRow, WhyMatchCard } from '@/components/profile/ProfileParts';
import { SparkActions } from '@/components/afterdark/v2/SparkActions';
import { StoryBubble } from '@/components/stories/StoryBubble';
import { IconButton } from '@/components/ui/IconButton';
import { Button, EmptyState, MatchRing, SectionHeader } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { crushEligibility, RELATIONSHIP_LABEL } from '@/graph/relevance';
import { useConnection } from '@/hooks/useConnection';
import { useGraphCtx, useMatch } from '@/hooks/useGraph';
import { fetchFollowCounts } from '@/services/backend/content';
import { isRealMode } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useAfterDark } from '@/store/useAfterDark';
import { useChat } from '@/store/useChat';
import { followerCountFor, useChimp } from '@/store/useChimp';
import { type PersonStatus, usePeople } from '@/store/usePeople';
import { colors, radius, shadow } from '@/theme';
import { compact } from '@/utils/format';

/**
 * Another person's profile in VIEW mode: the same editorial profile as You,
 * plus compatibility and the graph reasons behind it.
 */
export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = repo.user(id);
  const following = useChimp((s) => s.following);
  // Build 5 patch (REAL): the person's real Followers / Following totals (were
  // only "1 if you follow them" / always 0). Re-read when you follow / unfollow.
  const [counts, setCounts] = useState<{ id: string; followers: number; following: number } | null>(null);
  const iFollow = !!following[id];
  useEffect(() => {
    if (!isRealMode() || !id) return;
    let live = true;
    // A moment's delay so a Follow tap's write has landed before re-counting.
    const t = setTimeout(() => {
      void fetchFollowCounts(id).then((c) => {
        if (live && c) setCounts({ id, ...c });
      });
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id, iFollow]);
  const myOpenTo = useChimp((s) => s.profile.openTo);
  const toggleFollow = useChimp((s) => s.toggleFollow);
  const conn = useConnection(id, user?.displayName);
  const connected = conn.view === 'connected';
  const toggleBlock = useChimp((s) => s.toggleBlock);
  const toggleCrush = useChimp((s) => s.toggleCrush);
  const markSeen = useChimp((s) => s.markSeen);
  const match = useMatch(id);
  const ctx = useGraphCtx();
  const [menu, setMenu] = useState(false);
  // Phase 7B: never decide "not found" from the local snapshot. Fetch the person
  // (new accounts included) and refresh them when you come back to this screen.
  const ensure = usePeople((s) => s.ensure);
  const personStatus = usePeople((s) => s.status[id]);

  useEffect(() => {
    if (user) markSeen({ kind: 'person', id: user.id });
  }, [user, markSeen]);
  useFocusEffect(
    useCallback(() => {
      if (!id || repo.isMe(id)) return;
      const known = !!repo.user(id);
      const at = usePeople.getState().fetchedAt[id];
      if (!known || !at || Date.now() - at > 60_000) void ensure(id, { force: known });
    }, [id, ensure]),
  );

  if (repo.isMe(user?.id)) return <Redirect href="/you" />;
  if (!user || !match) {
    return <PersonPending id={id} status={personStatus} onRetry={() => void ensure(id, { force: true })} />;
  }

  const first = user.displayName.split(' ')[0];
  const isFollowing = !!following[user.id];
  const theirBoards = repo.boards().filter((b) => b.ownerId === user.id || b.memberPreview.includes(user.id));
  const sharedBoards = match.sharedBoards.map((b) => repo.board(b)!).filter(Boolean);
  const otherBoards = theirBoards.filter((b) => !match.sharedBoards.includes(b.id));
  // Moves you're both into first, then where you could meet them.
  const sharedMoves = [...match.sharedMoves, ...match.possibleMoves].map((m) => repo.move(m)!).filter(Boolean);
  const blocked = match.relationship === 'blocked';
  // Crush is offered only when you're both open to dating/casual and nobody is blocked.
  const eligibility = crushEligibility(ctx, user.id);
  const eligible = eligibility.eligible;
  const relLabel = RELATIONSHIP_LABEL[match.relationship];
  const confirmBlock = () => {
    if (blocked) return toggleBlock(user.id);
    Alert.alert(`Block ${first}?`, `${first} won't be suggested to you, and you'll stop following and be disconnected.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => toggleBlock(user.id) },
    ]);
  };
  const story = repo.storiesFor({ kind: 'person', id: user.id })[0];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
        <T v="headline" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
          {`@${user.username}`}
        </T>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <ProfileHero
          name={user.displayName}
          verified={user.verified}
          city={user.city}
          image={user.heroImage ?? user.avatar}
          photoMode={user.real ? 'framed' : 'bleed'}
          focusY={user.avatarFocusY ?? 0.3}
          handwriting={user.profilePhrase ? `${user.profilePhrase} ${user.profileEmoji ?? ''}`.trim() : undefined}
          moments={user.moments}
          badge={
            <View style={styles.ringBadge}>
              <MatchRing value={match.matchScore} size={52} stroke={4} />
            </View>
          }
        >
          <T v="callout" color={colors.ink2} weight="400" style={{ lineHeight: 22 }}>
            {user.bio}
          </T>
          <KnownFor items={user.knownFor} />
          <StatsRow
            stats={[
              { value: compact(counts?.id === user.id ? counts.followers : followerCountFor(user.id, following)), label: 'Followers' },
              { value: compact(counts?.id === user.id ? counts.following : user.following), label: 'Following' },
              { value: `${match.mutualConnections.length}`, label: 'Mutual' },
              { value: `${match.sharedBoards.length}`, label: 'In common' },
            ]}
          />
          {/* Phase 6C: Connect · Message · ••• on one row, each readable; ♡ Crush (only when eligible) gets its own, distinct row. */}
          <View style={styles.actions}>
            <Tap
              onPress={conn.press}
              haptic="medium"
              disabled={conn.busy}
              testID="profile-connect"
              accessibilityLabel={
                connected
                  ? `Disconnect from ${user.displayName}`
                  : conn.view === 'requested_by_me'
                    ? `Cancel your request to ${user.displayName}`
                    : conn.view === 'requested_of_me'
                      ? `Accept ${user.displayName}’s request`
                      : `Connect with ${user.displayName}`
              }
              style={[styles.action, connected ? styles.actionOff : { backgroundColor: colors.accent }, !connected && shadow.glow, conn.busy && { opacity: 0.7 }]}
            >
              {connected ? <Check size={17} color={colors.accent} strokeWidth={3} /> : <Link2 size={17} color={colors.white} />}
              <T v="subhead" weight="700" color={connected ? colors.accent : colors.white} style={{ marginLeft: 6, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {conn.label}
              </T>
            </Tap>
            <Tap onPress={() => router.push(`/chat/${user.id}`)} haptic="light" style={[styles.action, styles.actionOff]} accessibilityLabel={`Message ${first}`}>
              <MessageCircle size={17} color={colors.ink} />
              <T v="subhead" weight="700" style={{ marginLeft: 6, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                Message
              </T>
            </Tap>
            <Tap onPress={() => setMenu((m) => !m)} haptic="light" style={[styles.follow, styles.actionOff]} accessibilityLabel="More options">
              <Ellipsis size={18} color={colors.ink} />
            </Tap>
          </View>
          {conn.error ? (
            <T v="caption" color={colors.danger} weight="600" style={{ marginTop: 6 }}>
              {conn.error}
            </T>
          ) : null}
          {conn.view === 'requested_of_me' ? (
            <Tap onPress={() => conn.run('decline')} disabled={conn.busy} style={{ marginTop: 6, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }} accessibilityLabel={`Decline ${user.displayName}’s request`}>
              <T v="caption" weight="600" color={colors.inkMuted}>
                {`${first} asked to connect · Decline`}
              </T>
            </Tap>
          ) : null}
          {eligible ? (
            <Tap
              onPress={() => toggleCrush(user.id)}
              haptic="medium"
              accessibilityLabel={match.crush ? 'Remove private Crush' : 'Crush, private'}
              style={[styles.crushBtn, match.crush && styles.crushOn]}
            >
              <Heart size={17} color="#FF3D6E" fill={match.crush ? '#FF3D6E' : 'transparent'} />
              <T v="subhead" weight="700" color="#D92D5A" style={{ marginLeft: 6 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {match.crush ? 'Crush sent · private' : 'Crush · private'}
              </T>
            </Tap>
          ) : null}
          {menu ? (
            <View style={styles.menu}>
              <Tap onPress={() => { toggleFollow(user.id); setMenu(false); }} style={styles.menuItem} accessibilityLabel={isFollowing ? 'Unfollow' : 'Follow'}>
                {isFollowing ? <Check size={16} color={colors.ink} /> : <UserPlus size={16} color={colors.ink} />}
                <T v="subhead" weight="600" style={{ marginLeft: 10 }}>
                  {isFollowing ? `Following ${first}` : `Follow ${first}`}
                </T>
              </Tap>
              <Tap onPress={() => { setMenu(false); confirmBlock(); }} style={[styles.menuItem, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]} accessibilityLabel={blocked ? 'Unblock' : 'Block'}>
                <T v="subhead" weight="600" color={blocked ? colors.accent : colors.danger}>
                  {blocked ? `Unblock ${first}` : `Block ${first}`}
                </T>
              </Tap>
            </View>
          ) : null}
          {/* The only unmet condition is YOUR Open To: say so (their Open To is already public on this page). */}
          {eligibility.reason === 'you_not_open' && (user.openTo ?? []).some((o) => o === 'dating' || o === 'casual') ? (
            <Tap onPress={() => router.push('/you')} style={{ marginTop: 8 }} accessibilityLabel="Update your Open To">
              <T v="caption" color={colors.inkMuted} weight="500">
                {`♡ Crush appears when you’re open to Dating or Casual too. Update your Open To on You.`}
              </T>
            </Tap>
          ) : null}
          {eligible && match.crush && !match.spark ? (
            <T v="caption" color={colors.inkMuted} weight="500" style={{ marginTop: 8 }}>
              {`Crush saved privately. ${first} isn’t told anything unless it’s mutual.`}
            </T>
          ) : null}
          <View style={styles.relRow}>
            {relLabel ? (
              <View style={[styles.relChip, match.relationship === 'match' && { backgroundColor: colors.accentSoft }]}>
                <T v="caption" weight="700" color={match.relationship === 'match' ? colors.accent : colors.ink2}>
                  {relLabel}
                </T>
              </View>
            ) : null}
            <T v="caption" color={colors.inkFaint} weight="500" style={{ flex: 1 }}>
              {match.relationship === 'connection' ? 'You can plan together.' : 'Connecting is mutual and unlocks planning together.'}
            </T>
          </View>
        </ProfileHero>

        {/* Crush + Crush = a mutual Crush. Never says who chose first; starters come from shared context. */}
        {match.spark ? (
          <View style={styles.spark}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Heart size={18} color="#FF3D6E" fill="#FF3D6E" />
              <T v="headline" style={{ marginLeft: 8 }}>
                {`You and ${first} have a mutual Crush`}
              </T>
            </View>
            {/* Phase 7A: a mutual Crush only offers the next step (normal chat, or ask for a Vibe). */}
            <SparkActions personId={user.id} first={first} />
            <T v="footnote" color={colors.inkMuted} weight="500" style={{ marginTop: 12 }}>
              Start from something you share. Tapping fills in the chat; you send it.
            </T>
            {match.openers.map((o) => (
              <Tap key={o.context} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: user.id, draft: o.draft } })} style={styles.starter} accessibilityLabel={`Start from: ${o.context}`}>
                <T v="caption" weight="800" color="#D92D5A" style={{ letterSpacing: 0.4 }}>
                  {o.context}
                </T>
                <T v="footnote" weight="600" color={colors.ink2} style={{ marginTop: 2 }}>
                  {`“${o.draft}”`}
                </T>
              </Tap>
            ))}
          </View>
        ) : null}

        <View style={styles.gap}>
          <WhyMatchCard match={match} firstName={first} />
        </View>

        <View style={styles.gap}>
          <OpenToCard value={user.openTo ?? []} highlight={(user.openTo ?? []).filter((o) => myOpenTo.includes(o))} title={`${first} is open to`} />
        </View>

        {user.prompts?.length ? (
          <View style={styles.gap}>
            <PromptsRow prompts={user.prompts} />
          </View>
        ) : null}

        <View style={styles.gap}>
          <InterestGraph
            interests={user.interests}
            highlight={match.sharedInterests}
            caption={match.sharedInterests.length ? 'Highlighted: interests you share.' : 'Interests that shape their graph.'}
          />
        </View>

        {story ? (
          <View style={styles.storyRow}>
            <StoryBubble story={story} size={62} lane="friend" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <T v="bodyStrong">Latest story</T>
              <T v="footnote" color={colors.inkMuted} numberOfLines={1}>
                {story.items[0].caption}
              </T>
            </View>
          </View>
        ) : null}

        {sharedBoards.length || otherBoards.length ? (
          <View style={{ marginTop: 22 }}>
            <SectionHeader
              title="Boards"
              subtitle={sharedBoards.length ? `${sharedBoards.length} shared with you` : `Where ${first} spends time`}
              style={{ paddingHorizontal: 16 }}
            />
            <FlatList
              horizontal
              data={[...sharedBoards, ...otherBoards]}
              keyExtractor={(b) => b.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              renderItem={({ item }) => (
                <BoardCard board={item} variant="tile" width={156} reason={match.sharedBoards.includes(item.id) ? 'You’re both here' : undefined} />
              )}
            />
          </View>
        ) : null}

        {sharedMoves.length ? (
          <View style={{ marginTop: 22 }}>
            <SectionHeader
              title="Moves"
              subtitle={match.sharedMoves.length ? `You’re both into ${match.sharedMoves.length === 1 ? repo.move(match.sharedMoves[0])?.title : `${match.sharedMoves.length} Moves`}` : `Where you could meet ${first}`}
              style={{ paddingHorizontal: 16 }}
            />
            <FlatList
              horizontal
              data={sharedMoves}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => <MoveCard move={item} width={150} />}
            />
          </View>
        ) : null}

        <Tap onPress={confirmBlock} style={styles.block} accessibilityLabel={blocked ? `Unblock ${first}` : `Block ${first}`}>
          <T v="footnote" weight="600" color={blocked ? colors.accent : colors.inkFaint}>
            {blocked ? `Unblock ${first}` : `Block ${first}`}
          </T>
        </Tap>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Phase 7B: a profile that isn't on this phone yet is LOADING, not missing.
 * Only a profile the server confirms doesn't exist (after a few tries) says so.
 */
function PersonPending({ id, status, onRetry }: { id: string; status?: PersonStatus; onRetry: () => void }) {
  const hint = (useChat.getState().people[id] ?? useAfterDark.getState().people[id])?.displayName?.split(' ')[0];
  const who = hint ? `${hint}’s` : 'this';
  if (status === 'missing') {
    return <EmptyState title="This profile isn’t available" body="It may have been deleted, or the link is wrong." action={<Button label="Go back" onPress={() => router.back()} />} />;
  }
  if (status === 'offline') {
    return (
      <EmptyState
        title={`Couldn’t load ${who} profile`}
        body="Check your connection, then try again."
        action={
          <View style={{ gap: 8 }}>
            <Button label="Retry" onPress={onRetry} />
            <Button label="Go back" variant="secondary" onPress={() => router.back()} />
          </View>
        }
      />
    );
  }
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }} testID="profile-loading">
      <View style={styles.top}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
        <ActivityIndicator color={colors.accent} />
        <T v="callout" color={colors.inkMuted} style={{ marginTop: 12 }}>
          {status === 'retrying' ? `Still loading ${who} profile…` : `Loading ${who} profile…`}
        </T>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  gap: { marginTop: 14 },
  ringBadge: { padding: 4, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.94)', ...shadow.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  action: { flex: 1, height: 48, borderRadius: 24, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionOff: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.line },
  follow: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  spark: { marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: '#FFF1F4', borderWidth: 1, borderColor: '#FFD1DC' },
  crushBtn: { height: 42, marginTop: 8, paddingHorizontal: 14, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1F4', borderWidth: 1, borderColor: '#FFD1DC' },
  crushOn: { backgroundColor: '#FFE3EA', borderColor: '#FF9FB6' },
  starter: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.white },
  menu: { marginTop: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, overflow: 'hidden', ...shadow.sm },
  menuItem: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 14 },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  relChip: { height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  block: { alignSelf: 'center', marginTop: 28, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  storyRow: { marginTop: 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
});
