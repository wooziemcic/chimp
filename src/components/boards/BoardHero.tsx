import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Bell, BellRing, Camera, Check, ChevronDown, ChevronLeft, Clock, Crown, Ellipsis, Lock, Play, Plus, Users } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WorldOwnerMenu } from '@/components/boards/WorldOwnerMenu';
import { AvatarStack } from '@/components/ui/AvatarStack';
import { IconButton } from '@/components/ui/IconButton';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { pickImages } from '@/services/backend/media';
import { changeWorldCover } from '@/services/create';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, shadow } from '@/theme';
import type { Board } from '@/types/models';
import { compact } from '@/utils/format';

export const HERO_HEIGHT = 380;

/** Immersive board hero: the board should feel like entering a place. */
export function BoardHero({ board, storyId }: { board: Board; storyId?: string }) {
  const insets = useSafeAreaInsets();
  const joinedFlag = useChimp((s) => !!s.joined[board.id]);
  const requested = useChimp((s) => !!s.joinRequested?.[board.id]);
  const followed = useChimp((s) => !!s.followedBoards?.[board.id]);
  const toggleJoin = useChimp((s) => s.toggleJoin);
  const toggleFollowBoard = useChimp((s) => s.toggleFollowBoard);
  const real = repo.mode() === 'real';
  const meId = repo.meId();
  // Phase 6D: owner / admin / member / follower are different things.
  const role = repo.isMe(board.ownerId) ? 'owner' : board.roles?.[meId] ?? (joinedFlag ? 'member' : undefined);
  const joined = !!role;
  const manages = role === 'owner' || role === 'admin';
  const catalog = !board.ownerId;
  const year = new Date(board.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const creatorId = board.creatorId ?? board.ownerId;
  const createdBy = catalog ? 'By Chimp' : repo.isMe(creatorId) ? 'Created by you' : `Created by ${board.creatorName ?? repo.user(creatorId)?.displayName ?? 'a Chimp member'}`;
  const followers = board.followerCount ?? 0;
  const primary = manages
    ? { label: role === 'owner' ? 'Your World' : 'Admin', icon: 'crown' as const, onPress: () => router.push(`/board/${board.id}?tab=people`), a11y: `Manage ${board.title}` }
    : joined
      ? { label: 'Joined', icon: 'check' as const, onPress: () => toggleJoin(board.id), a11y: `Leave ${board.title}` }
      : requested
        ? { label: 'Requested', icon: 'clock' as const, onPress: () => toggleJoin(board.id), a11y: `Cancel your request to join ${board.title}` }
        : { label: real && !catalog ? 'Ask to join' : 'Join', icon: 'plus' as const, onPress: () => toggleJoin(board.id), a11y: real && !catalog ? `Ask to join ${board.title}` : `Join ${board.title}` };
  const on = joined || requested;
  const extra = Math.max(0, board.memberPreview.length - 4);
  const posts = repo.boardPostCount(board.id);
  // Phase 6C: the owner can replace the cover (Demo: Worlds you made on this phone).
  const createdHere = useChimp((s) => !!s.created?.boards.some((b) => b.id === board.id));
  const canEditCover = repo.isMe(board.ownerId) && (repo.mode() === 'real' || createdHere);
  // Phase 6D (final): the owner's ••• menu (Delete World). Owner only: not admins, members or followers.
  const isOwner = canEditCover;
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const changeCover = async () => {
    try {
      const [img] = await pickImages({ source: 'library' });
      if (!img) return;
      setCoverBusy(true);
      await changeWorldCover(board, img);
    } catch (e) {
      Alert.alert('Couldn’t change the cover', e instanceof Error ? e.message : String(e));
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <View style={{ height: HERO_HEIGHT + insets.top }}>
      {isOwner ? <WorldOwnerMenu board={board} open={menuOpen} onClose={() => setMenuOpen(false)} /> : null}
      <Img uri={board.hero} style={StyleSheet.absoluteFill} tint="#E9D9DC" />
      <LinearGradient
        colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.25, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.topBar, { top: insets.top + 6 }]}>
        <IconButton label="Back" variant="glass" size={46} onPress={() => router.back()}>
          <ChevronLeft size={24} color={colors.ink} strokeWidth={2.4} />
        </IconButton>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {canEditCover ? (
            <IconButton label={coverBusy ? 'Changing cover' : 'Change cover'} variant="glass" size={46} onPress={coverBusy ? () => undefined : () => void changeCover()}>
              {coverBusy ? <ActivityIndicator color={colors.ink} /> : <Camera size={21} color={colors.ink} strokeWidth={2.3} />}
            </IconButton>
          ) : null}
          <IconButton label={isOwner ? 'World options' : 'More'} variant="glass" size={46} onPress={isOwner ? () => setMenuOpen(true) : () => router.push('/settings')}>
            <Ellipsis size={22} color={colors.ink} strokeWidth={2.4} />
          </IconButton>
        </View>
      </View>

      <View style={styles.bottom}>
        <T v="display" color={colors.white} style={[styles.shadow, { fontSize: 42, lineHeight: 48 }]}>
          {board.title}
        </T>
        <T v="callout" color={colors.white} weight="500" style={[styles.shadow, { marginTop: 2, fontSize: 16 }]}>
          {board.tagline}
        </T>
        {board.visibility === 'private' || board.visibility === 'connections' ? (
          <View style={styles.access} accessibilityLabel={board.visibility === 'private' ? 'Private World' : 'Visible to connections'}>
            {board.visibility === 'private' ? <Lock size={11} color={colors.white} /> : <Users size={11} color={colors.white} />}
            <T v="caption" color={colors.white} weight="700" style={{ marginLeft: 4 }}>
              {board.visibility === 'private' ? 'Private' : 'Connections'}
            </T>
          </View>
        ) : null}

        {/* Who's here, and the honest numbers (members ≠ followers). */}
        <View style={styles.row}>
          <Tap onPress={() => router.push(`/board/${board.id}?tab=people`)} scaleTo={0.97} accessibilityLabel="Members">
            <AvatarStack userIds={board.memberPreview} size={40} max={3} extra={extra > 0 ? extra : undefined} overlap={0.22} />
          </Tap>
          <T v="footnote" color={colors.white} weight="500" style={[styles.shadow, { flex: 1, marginLeft: 10 }]} testID="world-stats">
            {`${compact(board.memberCount)} ${board.memberCount === 1 ? 'member' : 'members'}${real || followers ? `  •  ${compact(followers)} ${followers === 1 ? 'follower' : 'followers'}` : ''}  •  ${compact(posts)} ${posts === 1 ? 'post' : 'posts'}\n${createdBy}  •  ${year}`}
          </T>
          {storyId ? (
            <Tap onPress={() => router.push(`/story/${storyId}`)} style={styles.story} accessibilityLabel="Watch board stories">
              <Play size={12} color={colors.white} fill={colors.white} />
              <T v="caption" color={colors.white} style={{ marginLeft: 5 }}>
                Stories
              </T>
            </Tap>
          ) : null}
        </View>

        {/* Phase 6D: Follow = see its activity; Join = be a member. Members don't need to follow. */}
        <View style={[styles.row, { gap: 10 }]}>
          {!joined ? (
            <Tap
              onPress={() => toggleFollowBoard(board.id)}
              haptic="light"
              accessibilityLabel={followed ? `Unfollow ${board.title}` : `Follow ${board.title}`}
              style={[styles.follow, followed && { backgroundColor: 'rgba(255,255,255,0.92)' }]}
              testID="world-follow"
            >
              {followed ? <BellRing size={17} color={colors.ink} /> : <Bell size={17} color={colors.white} />}
              <T v="bodyStrong" color={followed ? colors.ink : colors.white} style={{ marginLeft: 7, fontSize: 16 }} numberOfLines={1}>
                {followed ? 'Following' : 'Follow'}
              </T>
            </Tap>
          ) : null}
          <Tap
            onPress={primary.onPress}
            haptic="medium"
            accessibilityLabel={primary.a11y}
            style={[styles.join, on || manages ? { backgroundColor: board.theme.primarySoft } : { backgroundColor: board.theme.primary }, shadow.md]}
            testID="world-join"
          >
            {primary.icon === 'crown' ? (
              <Crown size={18} color={board.theme.primary} strokeWidth={2.6} />
            ) : primary.icon === 'check' ? (
              <Check size={20} color={board.theme.primary} strokeWidth={3} />
            ) : primary.icon === 'clock' ? (
              <Clock size={18} color={board.theme.primary} strokeWidth={2.6} />
            ) : (
              <Plus size={20} color={board.theme.onPrimary} strokeWidth={3} />
            )}
            <T v="bodyStrong" color={on || manages ? board.theme.primary : board.theme.onPrimary} style={{ marginHorizontal: 8, fontSize: 17 }} numberOfLines={1}>
              {primary.label}
            </T>
            {joined && !manages ? <ChevronDown size={18} color={board.theme.primary} strokeWidth={2.6} /> : null}
          </Tap>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  bottom: { position: 'absolute', left: 20, right: 20, bottom: 44 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  join: { flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, paddingHorizontal: 14, borderRadius: 25 },
  follow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, paddingHorizontal: 12, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.6)' },
  access: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 8, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.35)' },
  story: {
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
});
