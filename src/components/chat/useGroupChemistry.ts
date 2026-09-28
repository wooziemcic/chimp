import { useEffect, useMemo, useState } from 'react';

import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { EMPTY_EXTRAS, useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { computeChemistry } from '@/utils/messaging';

/**
 * Worlds this group has in common: Worlds where at least two of the
 * group's current members are members (from the member lists the app
 * already has). Nothing new is fetched for it.
 */
export function useSharedWorlds(conversationId: string) {
  const members = useChat((s) => s.extras[conversationId]?.members) ?? EMPTY_EXTRAS.members;
  const joined = useChimp((s) => s.joined);
  const version = useDatasetVersion((d) => d.version);
  return useMemo(() => {
    void version;
    const current = new Set(members.filter((m) => m.status !== 'left').map((m) => m.user_id));
    return repo
      .boards()
      .map((b) => {
        const inIt = new Set(b.memberPreview.filter((id) => current.has(id)));
        const me = [...current].find((id) => repo.isMe(id));
        if (me && (joined[b.id] || repo.isMe(b.ownerId))) inIt.add(me);
        if (current.has(b.ownerId)) inIt.add(b.ownerId);
        return { id: b.id, title: b.title, members: inIt.size };
      })
      .filter((w) => w.members >= 2)
      .sort((a, b) => b.members - a.members || a.title.localeCompare(b.title));
  }, [members, joined, version]);
}

/** A slow clock (once a minute) so time-based things age out while a screen is open. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Group Chemistry for one group chat: deterministic, from rows members can read. */
export function useGroupChemistry(conversationId: string) {
  const extras = useChat((s) => s.extras[conversationId]) ?? EMPTY_EXTRAS;
  const messages = useChat((s) => s.messages[conversationId]);
  const worlds = useSharedWorlds(conversationId);
  const now = useMinuteClock(); // "active today" and "this week" age out
  return useMemo(
    () =>
      computeChemistry({
        now,
        members: extras.members,
        messages: (messages ?? []).filter((m) => !m.status).map((m) => ({ id: m.id, senderId: m.senderId, createdAt: m.createdAt })),
        reactions: extras.reactions,
        sameBrain: extras.sameBrain,
        loops: extras.loops,
        matches: extras.matches,
        sharedWorlds: worlds,
      }),
    [now, extras, messages, worlds],
  );
}
