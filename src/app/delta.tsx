import { type Href, router } from 'expo-router';
import { CalendarClock, Calendar, CheckCheck, Heart, LayoutGrid, Link2, PlayCircle, Sparkles, UserPlus } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Img } from '@/components/ui/Img';
import { EmptyState } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { changedSince } from '@/graph/happeningNow';
import { useGraphCtx, useUnseenChanges } from '@/hooks/useGraph';
import { useNow } from '@/hooks/useNow';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { useSocialInbox } from '@/store/useSocialInbox';
import type { SocialEventRow } from '@/services/backend/people';
import { Avatar } from '@/components/ui/Avatar';
import { colors, radius } from '@/theme';
import type { ChangeEvent, ChangeType } from '@/types/models';
import { hrefFor } from '@/utils/links';
import { timeAgo } from '@/utils/format';

const ICON: Record<ChangeType, typeof Sparkles> = {
  BOARD_ACTIVITY: LayoutGrid,
  PERSON_BECAME_RELEVANT: UserPlus,
  MOVE_OPENED: Calendar,
  MOVE_CLOSING: CalendarClock,
  NEW_MATCH: Heart,
  OPEN_LOOP_PROGRESS: Sparkles,
  STORY_UPDATE: PlayCircle,
  NEW_CONNECTION_ACTIVITY: Link2,
};

/**
 * World Delta — a finite list of what changed since the last visit, each
 * with the reason it matters. Ends in "You're caught up", not an infinite feed.
 */
export default function DeltaSheet() {
  const insets = useSafeAreaInsets();
  const unseen = useUnseenChanges();
  const markChangeSeen = useChimp((s) => s.markChangeSeen);
  const markAll = useChimp((s) => s.markAllChangesSeen);
  // Build 5 patch 2: follows and connections for you (your own user_events).
  const social = useSocialInbox((s) => s.items);
  const markSocialSeen = useSocialInbox((s) => s.markSeen);
  // Seeing the list counts as seeing them (the Bell dot clears).
  useEffect(() => {
    const t = setTimeout(markSocialSeen, 800);
    return () => clearTimeout(t);
  }, [markSocialSeen]);
  const openRef = (href: Href) => {
    router.back();
    setTimeout(() => router.push(href), 250);
  };

  const open = (d: ChangeEvent) => {
    markChangeSeen(d.id);
    router.back();
    setTimeout(() => router.push(hrefFor(d.ref)), 250);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader
        title="Since you left"
        subtitle={unseen.length ? `${unseen.length} things changed in your world` : social.length ? 'Your latest activity' : 'Nothing new yet'}
        right={
          unseen.length ? (
            <Tap onPress={markAll} style={styles.markAll} accessibilityLabel="Mark all as seen">
              <CheckCheck size={16} color={colors.accent} />
              <T v="footnote" color={colors.accent} weight="600" style={{ marginLeft: 4 }}>
                All seen
              </T>
            </Tap>
          ) : null
        }
      />
      <FlatList
        data={unseen}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        renderItem={({ item }) => <DeltaRow delta={item} onPress={() => open(item)} />}
        ListHeaderComponent={social.length ? <SocialList items={social} onOpen={openRef} /> : null}
        ListEmptyComponent={
          social.length ? null : (
            <EmptyState
              icon={<CheckCheck size={24} color={colors.accent} />}
              title="You’re caught up"
              body="We’ll collect what changes in your boards, people and Moves while you’re away."
            />
          )
        }
        ListFooterComponent={
          unseen.length ? (
            <T v="footnote" color={colors.inkFaint} align="center" style={{ marginTop: 10 }}>
              That’s everything. No endless feed here.
            </T>
          ) : null
        }
      />
    </View>
  );
}

/**
 * Phase 9: what happened to you — follows, connections, likes, replies, posts
 * in Worlds you follow, joins — grouped per post / World (newest first).
 * Tap → the person, post or World.
 */
function SocialList({ items, onOpen }: { items: SocialEventRow[]; onOpen: (href: Href) => void }) {
  const ctx = useGraphCtx();
  const now = useNow();
  const lines = useMemo(() => changedSince(ctx, items, 0, now, 30, { stories: false, fresh: (g) => g.some((e) => !e.seen_at) }), [ctx, items, now]);
  if (!lines.length) return null;
  return (
    <View style={{ marginBottom: 6 }} testID="social-notifications">
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 6, marginTop: 2 }}>
        FOR YOU
      </T>
      {lines.map((l) => (
        <Tap key={l.id} onPress={() => onOpen(hrefFor(l.ref))} scaleTo={0.98} style={[styles.row, { marginBottom: 8 }]} accessibilityLabel={l.text} testID="social-row">
          <View>
            {l.round ? <Avatar uri={l.image} name={l.person ? repo.user(l.person)?.displayName : undefined} size={44} /> : <Img uri={l.image} style={{ width: 44, height: 44, borderRadius: 12 }} />}
            {l.fresh ? <View style={styles.newDot} /> : null}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T v="subhead" weight="700" numberOfLines={2}>
              {l.text}
            </T>
            <T v="caption" color={colors.inkFaint} weight="500" style={{ marginTop: 2 }}>
              {timeAgo(l.at)}
            </T>
          </View>
        </Tap>
      ))}
    </View>
  );
}

function DeltaRow({ delta, onPress }: { delta: ChangeEvent; onPress: () => void }) {
  const Icon = ICON[delta.type] ?? Sparkles;
  const image = repo.imageFor(delta.ref);
  return (
    <Tap onPress={onPress} scaleTo={0.98} style={styles.row}>
      <View>
        <Img uri={image} style={[styles.thumb, delta.ref.kind === 'person' && { borderRadius: 26 }]} />
        <View style={styles.kind}>
          <Icon size={12} color={colors.white} strokeWidth={2.5} />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T v="subhead" weight="700" numberOfLines={2}>
          {delta.message}
        </T>
        {delta.detail ? (
          <T v="footnote" color={colors.inkMuted} weight="400" numberOfLines={2} style={{ marginTop: 2 }}>
            {delta.detail}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <T v="caption" color={colors.accent} numberOfLines={1} style={{ flexShrink: 1 }}>
            {delta.reason}
          </T>
          <T v="caption" color={colors.inkFaint} weight="500" numberOfLines={1} style={{ flexShrink: 0 }}>
            {`  ·  ${timeAgo(delta.createdAt)}`}
          </T>
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  newDot: { position: 'absolute', right: -1, top: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.white },
  markAll: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  thumb: { width: 52, height: 52, borderRadius: 14 },
  kind: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
