import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronRight, UserPlus } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddStoryBubble } from '@/components/create/CreateButton';
import { StoryBubble } from '@/components/stories/StoryBubble';
import { Avatar } from '@/components/ui/Avatar';
import { AvatarStack } from '@/components/ui/AvatarStack';
import { Img } from '@/components/ui/Img';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type ChangeLine, type NowCard, changedSince, happeningNow, peopleToKnow, storiesRow } from '@/graph/happeningNow';
import { useGraphCtx } from '@/hooks/useGraph';
import { useTabBarSpace } from '@/hooks/useLayout';
import { useNow } from '@/hooks/useNow';
import { fetchPeople } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { useDataset } from '@/services/dataset';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { useHappening } from '@/store/useHappening';
import { usePins } from '@/store/usePins';
import { useSocialInbox } from '@/store/useSocialInbox';
import { colors, radius, shadow } from '@/theme';
import { timeAgo } from '@/utils/format';
import { hrefFor } from '@/utils/links';
import { pushOnce } from '@/utils/nav';

/**
 * Happening (Phase 9) — "What changed that matters".
 *
 *   Stories · Happening Now (3–5) · People you may want to know · Changed
 *   since you were here. (Phase 9.2: pinned Boards moved to the top of
 *   Boards — they're no longer repeated here; pins still help rank Now.)
 *
 * Built only from real events (graph/happeningNow.ts, deterministic and
 * documented there). With a small network the sections get shorter; nothing
 * is invented to fill space. Never After Dark.
 */
export default function HappeningScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const ctx = useGraphCtx();
  const data = useDataset();
  const real = data.mode === 'real';
  const owner = real ? data.me.id : 'demo';
  const bottom = useTabBarSpace();
  const now = useNow();
  const seen = useChimp((s) => s.seenStoryItems);
  const followedBoards = useChimp((s) => s.followedBoards ?? {});
  const pins = usePins((s) => s.pins);
  const pinsOwner = usePins((s) => s.owner);
  const events = useSocialInbox((s) => s.items);
  const suggestions = useHappening((s) => (s.suggestionsFor === owner ? s.suggestions : null));
  const lastVisit = useHappening((s) => s.seenAt[owner] ?? 0);
  // The "since you were here" line is fixed for this visit (dots stay while you look).
  const [visitFrom, setVisitFrom] = useState<{
    owner: string;
    at: number;
  } | null>(null);
  const since = visitFrom?.owner === owner ? visitFrom.at : lastVisit;

  // People followed from this list stay on it (as "Following") until you leave Happening.
  const [followedHere, setFollowedHere] = useState<{
    owner: string;
    ids: ReadonlySet<string>;
  }>({ owner, ids: new Set() });
  const scroller = useRef<ScrollView>(null);
  const peopleY = useRef(0);

  useFocusEffect(
    useCallback(() => {
      // The Demo keeps its pins on this phone.
      if (!real && usePins.getState().owner !== 'demo') void usePins.getState().load('demo', false);
      setVisitFrom({ owner, at: useHappening.getState().seenAt[owner] ?? 0 });
      void useHappening
        .getState()
        .loadSuggestions(owner, real)
        .then(async (ids) => {
          const unknown = ids.filter((id) => !repo.user(id));
          if (!unknown.length) return;
          const rows = await fetchPeople(unknown).catch(() => []);
          if (rows.length) realData.addPeople(rows.map(toUser));
        });
      return () => {
        useHappening.getState().markSeen(owner, Date.now());
        setFollowedHere({ owner, ids: new Set() });
      };
    }, [owner, real]),
  );

  const stories = useMemo(() => storiesRow(ctx, seen, now), [ctx, seen, now]);
  const cards = useMemo(
    () =>
      happeningNow(ctx, {
        pins: pinsOwner === owner ? pins : {},
        followedBoards,
        now,
      }),
    [ctx, pins, pinsOwner, owner, followedBoards, now],
  );
  const keep = followedHere.owner === owner ? followedHere.ids : undefined;
  const people = useMemo(() => peopleToKnow(ctx, suggestions, now, 6, keep), [ctx, suggestions, now, keep]);
  const onFollowed = (id: string) =>
    setFollowedHere((f) => ({
      owner,
      ids: new Set([...(f.owner === owner ? f.ids : []), id]),
    }));
  const changes = useMemo(() => changedSince(ctx, events, since, now), [ctx, events, since, now]);

  const onLayoutPeople = (y: number) => {
    peopleY.current = y;
    if (params.section === 'people')
      setTimeout(
        () =>
          scroller.current?.scrollTo({
            y: Math.max(0, y - 12),
            animated: true,
          }),
        250,
      );
  };
  const quiet = !cards.length;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView ref={scroller} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottom }} testID="happening">
        <PageHeader title="Happening" subtitle="What changed that matters" />

        {/* A. Stories: yours first. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stories} testID="happening-stories">
          {stories.mine ? <StoryBubble story={stories.mine} size={62} lane="friend" label="Your story" /> : <AddStoryBubble size={62} />}
          {stories.others.map((st) => (
            <StoryBubble key={st.id} story={st} size={62} lane={st.lane} label={st.owner.kind === 'person' ? (repo.user(st.owner.id)?.displayName.split(' ')[0] ?? st.title) : st.title} />
          ))}
        </ScrollView>
        {!stories.others.length ? (
          <T v="caption" color={colors.inkFaint} style={{ paddingHorizontal: 20, marginTop: -2 }}>
            Stories from people you follow show up here for 24 hours.
          </T>
        ) : null}

        {/* C. Happening Now. */}
        <SectionTitle title="Happening now" />
        {cards.length ? (
          <View style={{ paddingHorizontal: 16, gap: 10 }} testID="happening-now">
            {cards.map((c) => (
              <NowRow key={c.id} card={c} />
            ))}
          </View>
        ) : (
          <View style={styles.quiet} testID="happening-quiet">
            <T v="subhead" weight="700">
              Nothing major has changed yet.
            </T>
            <T v="footnote" color={colors.inkMuted} style={{ marginTop: 2 }}>
              When people post in your Worlds, join them or follow you, it shows up here.
            </T>
          </View>
        )}

        {/* D. People you may want to know. */}
        <View onLayout={(e) => onLayoutPeople(e.nativeEvent.layout.y)}>
          <SectionTitle title="People you may want to know" action={{ label: 'Search', onPress: () => router.push('/search') }} />
          {people.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} testID="happening-people">
              {people.map((p) => (
                <PersonCard key={p.personId} id={p.personId} line={p.line} onFollowed={onFollowed} />
              ))}
            </ScrollView>
          ) : (
            <Tap onPress={() => router.push('/search')} style={styles.hint} accessibilityLabel="Find people" testID="people-empty">
              <UserPlus size={15} color={colors.accent} />
              <T v="footnote" color={colors.inkMuted} style={{ marginLeft: 8, flex: 1 }}>
                Find people by name or @username.
              </T>
              <ChevronRight size={16} color={colors.inkFaint} />
            </Tap>
          )}
        </View>

        {/* E. Changed since you were here. */}
        {changes.length ? (
          <>
            <SectionTitle title="Changed since you were here" />
            <View style={[styles.list, shadow.sm]} testID="happening-changed">
              {changes.map((c, i) => (
                <ChangeRow key={c.id} line={c} first={i === 0} />
              ))}
            </View>
          </>
        ) : quiet ? null : (
          <T v="caption" color={colors.inkFaint} align="center" style={{ marginTop: 22 }}>
            You’re up to date.
          </T>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionHead}>
      <T v="headline" style={{ flex: 1 }}>
        {title}
      </T>
      {action ? (
        <Tap onPress={action.onPress} style={styles.sectionAction} accessibilityLabel={action.label}>
          <T v="footnote" weight="700" color={colors.accent}>
            {action.label}
          </T>
        </Tap>
      ) : null}
    </View>
  );
}

function NowRow({ card }: { card: NowCard }) {
  return (
    <Tap onPress={() => pushOnce(hrefFor(card.ref))} scaleTo={0.985} style={[styles.now, shadow.sm]} accessibilityLabel={`${card.title}. ${card.why}`} testID="now-card">
      <Img uri={card.image} style={styles.nowImg} />
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <T v="bodyStrong" numberOfLines={2} style={{ lineHeight: 21 }}>
          {card.title}
        </T>
        <T v="caption" color={colors.inkMuted} numberOfLines={1} style={{ marginTop: 2 }}>
          {`${card.why} · ${timeAgo(card.at)}`}
        </T>
      </View>
      {card.people.length > 1 ? <AvatarStack userIds={card.people} size={22} max={3} /> : null}
      <ChevronRight size={16} color={colors.inkFaint} style={{ marginLeft: 6 }} />
    </Tap>
  );
}

function PersonCard({ id, line, onFollowed }: { id: string; line: string; onFollowed: (id: string) => void }) {
  const u = repo.user(id);
  const following = useChimp((s) => !!s.following[id]);
  const toggleFollow = useChimp((s) => s.toggleFollow);
  if (!u) return null;
  return (
    <Tap
      onPress={() => pushOnce(`/profile/${id}`)}
      scaleTo={0.97}
      style={[styles.person, shadow.sm]}
      accessibilityLabel={`${u.displayName}${u.username ? `, @${u.username}` : ''}. ${line}`}
      testID={`person-${id}`}
    >
      <Avatar uri={u.avatar} name={u.displayName} size={56} />
      <T v="subhead" weight="700" numberOfLines={1} style={{ marginTop: 8 }}>
        {u.displayName}
      </T>
      <T v="caption" color={colors.inkMuted} numberOfLines={1}>
        {u.username ? `@${u.username}` : ' '}
      </T>
      <T v="caption" color={colors.ink2} numberOfLines={2} align="center" style={{ marginTop: 6, minHeight: 32 }}>
        {line}
      </T>
      <Tap
        onPress={() => {
          onFollowed(id);
          toggleFollow(id);
        }}
        haptic="light"
        style={[styles.follow, following && styles.following]}
        accessibilityLabel={following ? `Following ${u.displayName}` : `Follow ${u.displayName}`}
        testID={`follow-${id}`}
      >
        {following ? <Check size={14} color={colors.ink} /> : null}
        <T v="footnote" weight="700" color={following ? colors.ink : colors.white} style={{ marginLeft: following ? 4 : 0 }}>
          {following ? 'Following' : 'Follow'}
        </T>
      </Tap>
    </Tap>
  );
}

function ChangeRow({ line, first }: { line: ChangeLine; first: boolean }) {
  return (
    <Tap onPress={() => pushOnce(hrefFor(line.ref))} scaleTo={0.99} style={[styles.change, !first && styles.divider]} accessibilityLabel={line.text} testID="change-row">
      <View>
        {line.round ? <Avatar uri={line.image} name={line.person ? repo.user(line.person)?.displayName : undefined} size={40} /> : <Img uri={line.image} style={styles.changeImg} />}
        {line.fresh ? <View style={styles.freshDot} /> : null}
      </View>
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <T v="subhead" weight={line.fresh ? '700' : '500'} numberOfLines={2}>
          {line.text}
        </T>
        <T v="caption" color={colors.inkFaint} style={{ marginTop: 1 }}>
          {timeAgo(line.at)}
        </T>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  stories: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 2,
    alignItems: 'flex-start',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
    minHeight: 28,
  },
  sectionAction: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  quiet: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  now: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    padding: 12,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  nowImg: { width: 52, height: 52, borderRadius: 14 },
  person: {
    width: 156,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  follow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    height: 36,
    minWidth: 108,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.ink,
  },
  following: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
  },
  list: {
    marginHorizontal: 16,
    paddingHorizontal: 12,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 10,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  changeImg: { width: 40, height: 40, borderRadius: 12 },
  freshDot: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
  },
});
