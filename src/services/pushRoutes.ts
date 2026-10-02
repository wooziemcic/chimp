/**
 * Phase 7C: where a tapped notification goes. Pure (unit-tested): only ids
 * that look like ids are used, so a payload can never steer the app to an
 * arbitrary path. Anything unknown opens nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushData = Record<string, unknown> | null | undefined;

const AD_TABS = new Set(['discover', 'vibes', 'challenges', 'plans', 'inbox']);

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);

export interface PushTarget {
  href: string;
  /** Needs After Dark (18+ confirmed on this phone) — otherwise the After Dark tab decides what to show. */
  afterDark: boolean;
}

export function routeForPush(data: PushData): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const t = data.type;
  switch (t) {
    case 'message': {
      const who = id(data.user_id);
      return { href: who ? `/chat/${who}` : '/messages', afterDark: false };
    }
    case 'group_message': {
      const c = id(data.conversation_id);
      return { href: c ? `/group/${c}` : '/messages', afterDark: false };
    }
    case 'connection': {
      const who = id(data.user_id);
      return who ? { href: `/profile/${who}`, afterDark: false } : { href: '/people?view=connections', afterDark: false };
    }
    case 'vibe_message':
    case 'vibe': {
      const v = id(data.vibe_id);
      return { href: v ? `/after-dark/vibe/${v}` : '/after-dark?tab=vibes', afterDark: true };
    }
    // After Dark notifications carry only a tab (no kind of event, no person).
    case 'after_dark': {
      const tab = typeof data.tab === 'string' && AD_TABS.has(data.tab) ? data.tab : 'vibes';
      return { href: `/after-dark?tab=${tab}`, afterDark: true };
    }
    case 'vibe_request':
      return { href: '/after-dark?tab=inbox', afterDark: true };
    case 'mutual_crush':
      return { href: '/after-dark?tab=vibes', afterDark: true };
    case 'challenge': {
      const c = id(data.challenge_id);
      return { href: c ? `/after-dark/challenge/${c}` : '/after-dark?tab=challenges', afterDark: true };
    }
    case 'plan':
      return { href: '/after-dark?tab=plans', afterDark: true };
    default:
      return null;
  }
}

/** The conversation a notification is about (to stay quiet while you're already in it). */
export function conversationOf(data: PushData): string | null {
  return data && typeof data === 'object' ? id(data.conversation_id) : null;
}
