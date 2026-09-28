import { router } from 'expo-router';
import { Crown, ShieldCheck, UserPlus } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PersonRow } from '@/components/profile/PersonRow';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useGraphCtx } from '@/hooks/useGraph';
import { sync } from '@/services/backend/content';
import * as realData from '@/services/backend/realData';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import type { Board, BoardRole, User } from '@/types/models';

const ROLE_LABEL: Record<BoardRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/**
 * A World's People tab (Phase 6D).
 *   - Everyone sees who's in it, with their role (owner / admin / member).
 *   - The owner and admins also see join requests (Approve / Decline) and can
 *     add their connections; the owner can make or unmake admins and remove
 *     people. Every one of these is checked again by the server.
 */
export function WorldPeople({ board }: { board: Board }) {
  const ctx = useGraphCtx();
  const t = board.theme;
  const real = repo.mode() === 'real';
  const meId = repo.meId();
  const myRole: BoardRole | undefined = repo.isMe(board.ownerId) ? 'owner' : board.roles?.[meId];
  const manages = real && (myRole === 'owner' || myRole === 'admin');
  const connections = useChimp((s) => s.connections);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberIds = real && board.roles ? Object.keys(board.roles) : Array.from(new Set([board.ownerId, ...board.memberPreview].filter(Boolean)));
  const roleOf = (id: string): BoardRole => (id === board.ownerId ? 'owner' : board.roles?.[id] ?? 'member');
  const order: Record<BoardRole, number> = { owner: 0, admin: 1, member: 2 };
  const members = memberIds
    .map((id) => repo.user(id))
    .filter((u): u is User => !!u && !repo.isMe(u.id))
    .sort((a, b) => order[roleOf(a.id)] - order[roleOf(b.id)]);
  const requests = manages ? (board.requests ?? []).map((id) => repo.user(id)).filter((u): u is User => !!u) : [];
  const addable = manages ? Object.keys(connections).filter((id) => !memberIds.includes(id) && !(board.requests ?? []).includes(id)).map((id) => repo.user(id)).filter((u): u is User => !!u) : [];

  /** Run a server action, show it at once, then reload the World from the server. */
  const run = async (key: string, action: () => Promise<void>, patch: Partial<Board>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      realData.updateBoard(board.id, patch);
      void useSession.getState().refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const withRole = (id: string, role: BoardRole | null): Partial<Board> => {
    const roles = { ...(board.roles ?? {}) };
    if (role) roles[id] = role;
    else delete roles[id];
    const ids = Object.keys(roles);
    return { roles, memberCount: ids.length, memberPreview: ids.slice(0, 5), requests: (board.requests ?? []).filter((r) => r !== id) };
  };

  if (!manages) {
    if (!members.length) {
      return <EmptyState title={myRole ? 'Just you so far' : 'No one here yet'} body="When people join this World, they'll show up here." />;
    }
    return (
      <Animated.View entering={FadeIn.duration(250)} style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <T v="footnote" color={t.mutedText} style={{ marginBottom: 4 }}>
          Members of this World. Follow people to see their stories; connect to plan together.
        </T>
        {members.map((u) => (
          <PersonRow
            key={u.id}
            user={u}
            accent={t.primary}
            textColor={t.text}
            reason={roleOf(u.id) !== 'member' ? `${ROLE_LABEL[roleOf(u.id)]} of ${board.title}` : ctx.match(u.id).matchReasons[0]?.label}
          />
        ))}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ paddingHorizontal: 20, paddingTop: 4 }} testID="world-people-manage">
      <View style={[styles.youAre, { backgroundColor: t.primarySoft }]}>
        {myRole === 'owner' ? <Crown size={15} color={t.primary} /> : <ShieldCheck size={15} color={t.primary} />}
        <T v="footnote" weight="600" color={t.primary} style={{ marginLeft: 6, flex: 1 }}>
          {myRole === 'owner'
            ? board.visibility === 'public'
              ? 'You own this World. People ask to join; you decide.'
              : 'You own this World. Only people you let in are members.'
            : 'You’re an admin: you can approve requests and add people.'}
        </T>
      </View>
      {error ? (
        <T v="footnote" color="#C2362C" style={{ marginTop: 8 }}>
          {error}
        </T>
      ) : null}

      {requests.length ? (
        <>
          <T v="label" color={t.mutedText} style={styles.label}>
            {`REQUESTS · ${requests.length}`}
          </T>
          {requests.map((u) => (
            <Row key={u.id} t={t} u={u} sub="Asked to join">
              <Btn t={t} busy={busy} k={`ok:${u.id}`} label="Approve" solid onPress={() => void run(`ok:${u.id}`, () => sync.respondJoin(board.id, u.id, true), withRole(u.id, 'member'))} />
              <Btn t={t} busy={busy} k={`no:${u.id}`} label="Decline" onPress={() => void run(`no:${u.id}`, () => sync.respondJoin(board.id, u.id, false), { requests: (board.requests ?? []).filter((r) => r !== u.id) })} />
            </Row>
          ))}
        </>
      ) : null}

      <T v="label" color={t.mutedText} style={styles.label}>
        {`MEMBERS · ${board.memberCount}`}
      </T>
      {!members.length ? (
        <T v="footnote" color={t.mutedText}>
          Just you so far.
        </T>
      ) : null}
      {members.map((u) => {
        const role = roleOf(u.id);
        const canRemove = role !== 'owner' && (myRole === 'owner' || role === 'member');
        return (
          <Row key={u.id} t={t} u={u} sub={ROLE_LABEL[role]}>
            {myRole === 'owner' && role !== 'owner' ? (
              <Btn
                t={t}
                busy={busy}
                k={`role:${u.id}`}
                label={role === 'admin' ? 'Unmake admin' : 'Make admin'}
                onPress={() => void run(`role:${u.id}`, () => sync.setRole(board.id, u.id, role === 'admin' ? 'member' : 'admin'), withRole(u.id, role === 'admin' ? 'member' : 'admin'))}
              />
            ) : null}
            {canRemove ? <Btn t={t} busy={busy} k={`rm:${u.id}`} label="Remove" danger onPress={() => void run(`rm:${u.id}`, () => sync.removeMember(board.id, u.id), withRole(u.id, null))} /> : null}
          </Row>
        );
      })}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 6 }}>
        <UserPlus size={15} color={t.mutedText} />
        <T v="label" color={t.mutedText} style={{ marginLeft: 6 }}>
          ADD YOUR CONNECTIONS
        </T>
      </View>
      {!addable.length ? (
        <T v="footnote" color={t.mutedText}>
          {Object.keys(connections).length ? 'All your connections are already here.' : 'Connect with people on Chimp, then add them here.'}
        </T>
      ) : null}
      {addable.map((u) => (
        <Row key={u.id} t={t} u={u} sub="Your connection">
          <Btn t={t} busy={busy} k={`add:${u.id}`} label="Add" solid onPress={() => void run(`add:${u.id}`, () => sync.addMember(board.id, u.id), withRole(u.id, 'member'))} />
        </Row>
      ))}
    </Animated.View>
  );
}

type Theme = Board['theme'];

function Btn({ t, busy, label, onPress, k, solid, danger }: { t: Theme; busy: string | null; label: string; onPress: () => void; k: string; solid?: boolean; danger?: boolean }) {
  return (
    <Tap onPress={onPress} disabled={!!busy} haptic="light" style={[styles.btn, solid ? { backgroundColor: t.primary } : { backgroundColor: t.primarySoft }, !!busy && busy !== k && { opacity: 0.5 }]} accessibilityLabel={label}>
      {busy === k ? (
        <ActivityIndicator size="small" color={solid ? t.onPrimary : t.primary} />
      ) : (
        <T v="footnote" weight="700" color={solid ? t.onPrimary : danger ? '#C2362C' : t.primary}>
          {label}
        </T>
      )}
    </Tap>
  );
}

function Row({ t, u, sub, children }: { t: Theme; u: User; sub: string; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Tap onPress={() => router.push(`/profile/${u.id}`)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} accessibilityLabel={u.displayName}>
        <Avatar uri={u.avatar} name={u.displayName} size={42} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <T v="bodyStrong" color={t.text} numberOfLines={1}>
            {u.displayName}
          </T>
          <T v="footnote" color={t.mutedText} numberOfLines={1}>
            {sub}
          </T>
        </View>
      </Tap>
      <View style={{ flexDirection: 'row', gap: 6 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  youAre: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12 },
  label: { marginTop: 18, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  btn: { minWidth: 64, height: 34, paddingHorizontal: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
