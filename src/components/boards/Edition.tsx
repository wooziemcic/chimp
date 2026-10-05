import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Flame, Lightbulb, Newspaper, Play, Sparkles, TrendingUp } from 'lucide-react-native';
import { memo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { BuzzCard } from '@/components/buzz/BuzzCard';
import { DriftTile, duration } from '@/components/drift/DriftTile';
import { MoveCard } from '@/components/moves/MoveCard';
import { StoryBubble } from '@/components/stories/StoryBubble';
import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { Edition, EditionModule, ExploreEntry, LeadItem, TodayEntry } from '@/graph/worlds';
import { repo } from '@/services/repository';
import { colors, radius, shadow } from '@/theme';
import type { BoardTheme, Post } from '@/types/models';
import { compact } from '@/utils/format';
import { hrefFor } from '@/utils/links';
import { PostModule } from './PostModules';

const dateLine = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

// ─── Today: the finite edition ──────────────────────────────────────────────

export const TodayEdition = memo(function TodayEdition({ edition, theme, onExplore }: { edition: Edition; theme: BoardTheme; onExplore: () => void }) {
  const { board, lead, modules, topics } = edition;
  // Build 5 patch 2: nothing posted or happening today — no cover and no content
  // module. "From your people" (membership lines like "Mira is a member") and
  // "Trending" (nearby topics and Worlds) aren't today's activity, so on their
  // own they don't count and aren't shown.
  const empty = !lead && !edition.latest.length && modules.every((m) => m.id === 'people' || m.id === 'trending');
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      {/* Masthead */}
      <View style={styles.masthead}>
        <T v="caption" weight="800" color={theme.primary} style={{ letterSpacing: 1.4 }}>
          {`TODAY · ${dateLine().toUpperCase()}`}
        </T>
        <T v="title2" color={theme.text} style={{ marginTop: 2 }}>
          {`The ${board.title} edition`}
        </T>
        <T v="footnote" color={theme.mutedText} weight="500" style={{ marginTop: 2 }}>
          {`${edition.freshCount ? `${edition.freshCount} new since your last visit · ` : ''}Today’s posts first`}
        </T>
        {topics.length ? (
          <View style={styles.topicRow}>
            {topics.slice(0, 5).map((t) => (
              <Tap
                key={t.topic.id}
                onPress={t.topic.ref ? () => router.push(hrefFor(t.topic.ref!)) : undefined}
                disabled={!t.topic.ref}
                style={[styles.topic, { borderColor: theme.line }]}
                accessibilityLabel={`Topic ${t.topic.label}`}
              >
                <T v="caption" weight="700" color={theme.text}>
                  {t.topic.label}
                </T>
              </Tap>
            ))}
          </View>
        ) : null}
      </View>

      {lead ? <Cover lead={lead} theme={theme} /> : null}

      {edition.latest.length ? <LatestPosts entries={edition.latest} leadToday={edition.leadToday} theme={theme} /> : null}

      {empty
        ? null
        : modules.map((m) => (
            <Module key={m.id} m={m} theme={theme} boardTitle={board.title} />
          ))}

      {empty ? (
        // Truly empty today: say so plainly (never old content dressed up as today).
        <View style={styles.emptyToday} testID="today-empty">
          <T v="headline" color={theme.text}>
            Nothing here today yet
          </T>
          <T v="footnote" color={theme.mutedText} style={{ marginTop: 2 }}>
            New posts and activity will show up here.
          </T>
          <Tap onPress={onExplore} style={{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', minHeight: 32 }} accessibilityLabel="Open Explore">
            <T v="subhead" weight="700" color={theme.primary}>
              {`Explore ${board.title}`}
            </T>
            <ArrowRight size={15} color={theme.primary} style={{ marginLeft: 4 }} />
          </Tap>
        </View>
      ) : (
      /* Finite: the edition ends, Explore is the rabbit hole. */
      <View style={[styles.end, { borderColor: theme.line }]}>
        <T v="headline" color={theme.text} align="center">
          You’re caught up on today
        </T>
        <T v="footnote" color={theme.mutedText} align="center" style={{ marginTop: 2 }}>
          {`Keep going in Explore: everything in ${board.title}, then related Worlds.`}
        </T>
        <Tap onPress={onExplore} style={[styles.endBtn, { backgroundColor: theme.primary }]} accessibilityLabel="Open Explore">
          <T v="subhead" weight="700" color={theme.onPrimary}>
            Explore {board.title}
          </T>
          <ArrowRight size={16} color={theme.onPrimary} style={{ marginLeft: 6 }} />
        </Tap>
      </View>
      )}
    </Animated.View>
  );
});

const TODAY_PAGE = 10;
const EARLIER_FIRST = 3;
const EARLIER_PAGE = 10;

/**
 * Today's posts first (newest first), then "Earlier" underneath (newest
 * first). The order is fixed when the edition is built; "Show more" only
 * reveals the next ones in that same order.
 */
function LatestPosts({ entries, leadToday, theme }: { entries: TodayEntry[]; leadToday: boolean; theme: BoardTheme }) {
  const { width } = useWindowDimensions();
  const w = width - 32;
  const today = entries.filter((e) => e.today);
  const earlier = entries.filter((e) => !e.today);
  const [todayCount, setTodayCount] = useState(TODAY_PAGE);
  // "Show older posts" adds to a base that follows whether there's anything new today.
  const [earlierMore, setEarlierMore] = useState(0);
  const earlierCount = (today.length ? EARLIER_FIRST : EARLIER_FIRST * 2) + earlierMore;
  return (
    <View style={styles.module} testID="today-latest">
      {/* The cover is today's newest post: no "nothing new" line under it. */}
      {!today.length && leadToday ? null : (
      <View style={styles.modHead}>
        <View style={[styles.rule, { backgroundColor: theme.text }]} />
        <T v="caption" weight="800" color={theme.text} style={{ letterSpacing: 1.3, marginTop: 8 }}>
          {today.length ? `NEW TODAY · ${today.length}` : 'NEW TODAY'}
        </T>
        {today.length ? null : (
          <T v="footnote" color={theme.mutedText} style={{ marginTop: 2 }} testID="today-none">
            Nothing new today yet.
          </T>
        )}
      </View>
      )}
      {today.length ? (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {today.slice(0, todayCount).map((e) => (
            <ExploreItem key={e.key} e={e} w={w} theme={theme} />
          ))}
          {todayCount < today.length ? <MoreButton theme={theme} label={`Show more from today (${today.length - todayCount})`} onPress={() => setTodayCount((c) => c + TODAY_PAGE)} /> : null}
        </View>
      ) : null}
      {earlier.length ? (
        <>
          <View style={[styles.modHead, { marginTop: today.length ? 22 : leadToday ? 0 : 8 }]}>
            <T v="caption" weight="800" color={theme.mutedText} style={{ letterSpacing: 1.3 }}>
              EARLIER
            </T>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 12 }} testID="today-earlier">
            {earlier.slice(0, earlierCount).map((e) => (
              <ExploreItem key={e.key} e={e} w={w} theme={theme} />
            ))}
            {earlierCount < earlier.length ? <MoreButton theme={theme} label="Show older posts" onPress={() => setEarlierMore((c) => c + EARLIER_PAGE)} /> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function MoreButton({ theme, label, onPress }: { theme: BoardTheme; label: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={[styles.more, { borderColor: theme.line }]} accessibilityLabel={label}>
      <T v="subhead" weight="700" color={theme.primary}>
        {label}
      </T>
    </Tap>
  );
}

function leadHref(lead: LeadItem) {
  if (lead.kind === 'news') return hrefFor({ kind: 'buzz', id: lead.item.id });
  if (lead.kind === 'drift') return hrefFor({ kind: 'drift', id: lead.item.id });
  return `/comments/${lead.item.id}`;
}

function Cover({ lead, theme }: { lead: LeadItem; theme: BoardTheme }) {
  const { width } = useWindowDimensions();
  const w = width - 32;
  const image = lead.kind === 'news' ? lead.item.image : lead.kind === 'drift' ? lead.item.image : lead.item.images?.[0] ?? lead.item.place?.image;
  const kicker = lead.kind === 'news' ? 'COVER · NEWS' : lead.kind === 'drift' ? `COVER · WATCH${lead.item.durationSec ? ` · ${duration(lead.item.durationSec)}` : ''}` : 'COVER · FROM THE WORLD';
  const title = lead.kind === 'news' ? lead.item.news?.headline : lead.kind === 'drift' ? lead.item.caption : lead.item.title ?? lead.item.body;
  const sub =
    lead.kind === 'news'
      ? `${lead.item.news?.source ?? 'Demo source'} · demo fixture, not live news`
      : lead.kind === 'drift'
        ? `${repo.user(lead.item.authorId)?.displayName ?? ''} · ${compact(lead.item.likeCount)} likes`
        : `${repo.user(lead.item.authorId)?.displayName ?? ''} · ${compact(lead.item.likeCount)} likes`;
  return (
    <Tap onPress={() => router.push(leadHref(lead) as never)} scaleTo={0.985} style={[styles.cover, shadow.md, { width: w, height: w * 1.05 }]} accessibilityLabel={`Cover: ${title}`}>
      <Img uri={image} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.78)']} locations={[0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {lead.kind === 'drift' ? (
        <View style={styles.play}>
          <Play size={22} color={colors.white} fill={colors.white} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: 18, right: 18, bottom: 18 }}>
        <T v="caption" weight="800" color="rgba(255,255,255,0.92)" style={{ letterSpacing: 1.2 }}>
          {kicker}
        </T>
        <T v="title2" color={colors.white} numberOfLines={3} style={{ marginTop: 4, lineHeight: 30 }}>
          {title}
        </T>
        <T v="footnote" color="rgba(255,255,255,0.85)" weight="500" numberOfLines={1} style={{ marginTop: 6 }}>
          {sub}
        </T>
        {lead.why ? (
          <View style={[styles.whyPill, { backgroundColor: theme.primary }]}>
            <Sparkles size={11} color={theme.onPrimary} />
            <T v="caption" weight="700" color={theme.onPrimary} numberOfLines={1} style={{ marginLeft: 5, flexShrink: 1 }}>
              {lead.why}
            </T>
          </View>
        ) : null}
      </View>
    </Tap>
  );
}

const MODULE_ICON: Partial<Record<EditionModule['id'], typeof Flame>> = { buzzing: Flame, news: Newspaper, trending: TrendingUp, watch: Play };

function ModuleHead({ m, theme, onSeeAll }: { m: EditionModule; theme: BoardTheme; onSeeAll?: () => void }) {
  const Icon = MODULE_ICON[m.id];
  return (
    <View style={styles.modHead}>
      <View style={[styles.rule, { backgroundColor: theme.text }]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        {Icon ? <Icon size={15} color={theme.primary} style={{ marginRight: 6 }} /> : null}
        <T v="caption" weight="800" color={theme.text} style={{ letterSpacing: 1.3, flex: 1 }}>
          {m.title.toUpperCase()}
        </T>
        {onSeeAll ? (
          <Tap onPress={onSeeAll} accessibilityLabel={`See all ${m.title}`}>
            <T v="caption" weight="700" color={theme.primary}>
              See all
            </T>
          </Tap>
        ) : null}
      </View>
      {m.why ? (
        <T v="caption" color={theme.mutedText} weight="500" style={{ marginTop: 2 }}>
          {`Moved up · ${m.why}`}
        </T>
      ) : null}
    </View>
  );
}

function Module({ m, theme, boardTitle }: { m: EditionModule; theme: BoardTheme; boardTitle: string }) {
  const { width } = useWindowDimensions();
  const w = width - 32;
  switch (m.id) {
    case 'buzzing':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} onSeeAll={() => router.navigate('/buzz')} />
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {m.items.map((b) => (
              <BuzzCard key={b.id} item={b} width={w} />
            ))}
          </View>
        </View>
      );
    case 'news':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} />
          <View style={[styles.newsBox, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            {m.items.map((n, i) => (
              <Tap key={n.id} onPress={() => router.push(`/buzz/${n.id}`)} style={[styles.newsRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]} accessibilityLabel={n.news?.headline}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <T v="subhead" weight="700" color={theme.text} numberOfLines={2} style={{ lineHeight: 20 }}>
                    {n.news?.headline}
                  </T>
                  <T v="caption" color={theme.mutedText} weight="500" style={{ marginTop: 3 }}>
                    {`${n.news?.source ?? 'Demo source'} · ${n.createdAt} · demo`}
                  </T>
                </View>
                <Img uri={n.image} style={styles.newsImg} />
              </Tap>
            ))}
          </View>
          <T v="caption" color={theme.mutedText} weight="500" style={{ paddingHorizontal: 20, marginTop: 6 }}>
            Prototype fixtures, not live reporting.
          </T>
        </View>
      );
    case 'top':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} />
          <View style={{ paddingHorizontal: 16 }}>
            {m.items.map((p: Post) => (
              <PostModule key={p.id} post={p} theme={theme} />
            ))}
          </View>
        </View>
      );
    case 'watch':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} onSeeAll={() => router.navigate('/happening')} />
          <FlatList
            horizontal
            data={m.items}
            keyExtractor={(d) => d.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => <DriftTile item={{ ...item, tall: true }} width={Math.min(170, w / 2.25)} />}
          />
        </View>
      );
    case 'stories':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} />
          <FlatList
            horizontal
            data={m.items}
            keyExtractor={(st) => st.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => <StoryBubble story={item} size={70} lane={item.lane} label={item.title} />}
          />
        </View>
      );
    case 'people':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} />
          <View style={[styles.newsBox, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            {m.items.map((p, i) => {
              const u = repo.user(p.personId);
              if (!u) return null;
              return (
                <Tap
                  key={p.personId}
                  onPress={() => router.push(p.ref ? hrefFor(p.ref) : `/profile/${u.id}`)}
                  style={[styles.personRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]}
                  accessibilityLabel={p.line}
                >
                  <Avatar uri={u.avatar} name={u.displayName} size={40} />
                  <T v="subhead" color={theme.text} weight="500" numberOfLines={2} style={{ flex: 1, marginLeft: 12 }}>
                    {p.line}
                  </T>
                  <View style={[styles.rel, { backgroundColor: theme.primarySoft }]}>
                    <T v="caption" weight="700" color={theme.primary} style={{ fontSize: 11 }}>
                      {p.relation === 'connection' ? 'Connection' : p.relation === 'following' ? 'Following' : 'Match'}
                    </T>
                  </View>
                </Tap>
              );
            })}
          </View>
        </View>
      );
    case 'trending':
      return (
        <View style={styles.module}>
          <ModuleHead m={m} theme={theme} />
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {m.items.map((t, i) => {
              const b = t.kind === 'world' && t.ref ? repo.board(t.ref.id) : undefined;
              return (
                <Tap
                  key={t.id}
                  onPress={t.ref ? () => router.push(hrefFor(t.ref!)) : undefined}
                  disabled={!t.ref}
                  style={[styles.trend, { backgroundColor: theme.surface, borderColor: theme.line }]}
                  accessibilityLabel={t.label}
                >
                  {b ? <Img uri={b.cover} style={styles.trendImg} /> : <T v="caption" weight="800" color={theme.primary} style={{ marginRight: 6 }}>{`#${i + 1}`}</T>}
                  <T v="footnote" weight="700" color={theme.text} numberOfLines={1}>
                    {t.label}
                  </T>
                  {b ? (
                    <T v="caption" color={theme.mutedText} style={{ marginLeft: 6 }}>
                      {compact(b.memberCount)}
                    </T>
                  ) : null}
                </Tap>
              );
            })}
          </View>
          <T v="caption" color={theme.mutedText} weight="500" style={{ paddingHorizontal: 20, marginTop: 8 }}>
            {`Topics and Worlds near ${boardTitle}, in the order that fits you.`}
          </T>
        </View>
      );
    default:
      return null;
  }
}

// ─── Explore: the long-running stream ──────────────────────────────────────

export const ExploreStream = memo(function ExploreStream({ entries, count, theme, onMore }: { entries: ExploreEntry[]; count: number; theme: BoardTheme; onMore: () => void }) {
  const { width } = useWindowDimensions();
  const w = width - 32;
  const shown = entries.slice(0, count);
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ paddingHorizontal: 16, gap: 12 }}>
      <T v="footnote" color={theme.mutedText} weight="500" style={{ marginBottom: 2 }}>
        Newest first: everything in this World, then the Worlds around it. Scroll as long as you like.
      </T>
      {shown.map((e) => (
        <ExploreItem key={e.key} e={e} w={w} theme={theme} />
      ))}
      {count < entries.length ? (
        <Tap onPress={onMore} style={[styles.more, { borderColor: theme.line }]} accessibilityLabel="Load more">
          <T v="subhead" weight="700" color={theme.primary}>
            Keep exploring
          </T>
        </Tap>
      ) : (
        <T v="footnote" color={theme.mutedText} align="center" style={{ marginVertical: 12 }}>
          That’s everything nearby for now.
        </T>
      )}
    </Animated.View>
  );
});

function ExploreItem({ e, w, theme }: { e: ExploreEntry; w: number; theme: BoardTheme }) {
  switch (e.type) {
    case 'section':
      return (
        <Tap onPress={() => router.push(`/board/${e.boardId}`)} style={styles.section} accessibilityLabel={e.title}>
          <View style={[styles.rule, { backgroundColor: theme.text, marginBottom: 8 }]} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="caption" weight="800" color={theme.text} style={{ letterSpacing: 1.3, flex: 1 }}>
              {e.title.toUpperCase()}
            </T>
            <ArrowRight size={14} color={theme.primary} />
          </View>
        </Tap>
      );
    case 'post':
      return <PostModule post={e.item} theme={theme} />;
    case 'buzz':
      return <BuzzCard item={e.item} width={w} />;
    case 'drift':
      return <DriftTile item={{ ...e.item, tall: false }} width={w} />;
    case 'move':
      return <MoveCard move={e.item} width={w} height={220} />;
    case 'story':
      return (
        <Tap onPress={() => router.push(`/story/${e.item.id}`)} style={[styles.storyRow, { backgroundColor: theme.surface, borderColor: theme.line }]} accessibilityLabel={e.item.title}>
          <StoryBubble story={e.item} size={56} lane={e.item.lane} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T v="caption" weight="800" color={theme.primary} style={{ letterSpacing: 0.8 }}>
              STORY
            </T>
            <T v="subhead" weight="700" color={theme.text} numberOfLines={1}>
              {e.item.title}
            </T>
            <T v="caption" color={theme.mutedText} numberOfLines={1}>
              {e.item.items[0]?.caption}
            </T>
          </View>
        </Tap>
      );
    case 'tip': {
      const u = repo.user(e.item.authorId);
      return (
        <View style={[styles.tip, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <View style={[styles.tipIcon, { backgroundColor: theme.primarySoft }]}>
            <Lightbulb size={17} color={theme.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T v="caption" weight="800" color={theme.primary} style={{ letterSpacing: 0.8 }}>
              LOCAL TIP
            </T>
            <T v="bodyStrong" color={theme.text}>
              {e.item.title}
            </T>
            <T v="footnote" color={theme.mutedText} weight="400" style={{ marginTop: 2, lineHeight: 18 }}>
              {e.item.body}
            </T>
            <T v="caption" color={colors.inkFaint} style={{ marginTop: 6 }}>
              {`from ${u?.displayName ?? 'a member'} · ${e.item.helpful} found this helpful`}
            </T>
          </View>
        </View>
      );
    }
    case 'photos': {
      const size = (w - 8) / 3;
      return (
        <View>
          <T v="caption" weight="800" color={theme.text} style={{ letterSpacing: 1.1, marginBottom: 6 }}>
            {e.title.toUpperCase()}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {e.images.map((uri, i) => (
              <Img key={`${uri}${i}`} uri={uri} style={{ width: size, height: size, borderRadius: 10 }} />
            ))}
          </View>
        </View>
      );
    }
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  emptyToday: { marginHorizontal: 16, marginTop: 8, marginBottom: 8, paddingVertical: 4 },
  masthead: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  topicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  topic: { height: 28, paddingHorizontal: 11, borderRadius: 14, borderWidth: 1, justifyContent: 'center' },
  cover: { alignSelf: 'center', borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.bgSoft },
  play: { position: 'absolute', top: 16, right: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  whyPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 10, height: 24, paddingHorizontal: 9, borderRadius: 12, maxWidth: '100%' },
  module: { marginTop: 26 },
  modHead: { paddingHorizontal: 20, marginBottom: 10 },
  rule: { height: 2, width: 28, borderRadius: 1 },
  newsBox: { marginHorizontal: 16, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  newsRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  newsImg: { width: 64, height: 64, borderRadius: 12 },
  personRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  rel: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center', marginLeft: 8 },
  trend: { flexDirection: 'row', alignItems: 'center', height: 38, paddingLeft: 8, paddingRight: 12, borderRadius: 19, borderWidth: 1 },
  trendImg: { width: 26, height: 26, borderRadius: 13, marginRight: 7 },
  end: { marginTop: 30, marginHorizontal: 16, paddingVertical: 20, paddingHorizontal: 16, borderTopWidth: 1, alignItems: 'center' },
  endBtn: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 18, borderRadius: 22, marginTop: 12 },
  more: { height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  section: { marginTop: 14, marginBottom: 2 },
  storyRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  tip: { flexDirection: 'row', padding: 14, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  tipIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
