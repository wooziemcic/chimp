/**
 * Phase 7C: where a tapped notification goes. Pure (unit-tested): only ids
 * that look like ids are used, so a payload can never steer the app to an
 * arbitrary path. Anything unknown opens nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushData = Record<string, unknown> | null | undefined;

const AD_TABS = new Set(['discover', 'vibes', 'challenges', 'plans', 'inbox']);

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);
/** World ids: catalog slugs or uuids (the same rule the server uses). */
const BOARD_ID = /^[A-Za-z0-9_-]{1,80}$/;

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
    // Phase 9: likes / replies → the post; World activity / joins → the World.
    case 'post': {
      const post = id(data.id);
      if (!post) return null;
      return { href: data.post_kind === 'drift' ? `/drift/${post}` : `/buzz/${post}`, afterDark: false };
    }
    case 'world': {
      const b = typeof data.board_id === 'string' && BOARD_ID.test(data.board_id) ? data.board_id : null;
      return b ? { href: `/board/${b}`, afterDark: false } : { href: '/happening', afterDark: false };
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

/**
 * Phase 8: what to do with a tapped notification right now. Pure (unit-tested).
 *   wait  the app isn't ready for it yet (session restoring, switching,
 *         onboarding, signed out, or chat not yet bound to this account)
 *   drop  it can't be for what's on screen: the Demo is open, it was meant for
 *         another account, or it's older than PUSH_HOLD_MS (a tap from long ago
 *         must not yank you somewhere when you finally sign in)
 *   go    open its (already validated) route
 */
export type PushGate = 'go' | 'wait' | 'drop';
export const PUSH_HOLD_MS = 10 * 60 * 1000;
export const PUSH_CHAT_WAIT_MS = 6000;

export function pushGate(
  p: { for: string | null; at: number },
  session: { status: string; mode: string | null; uid?: string | null },
  chatUid: string | null | undefined,
  now: number,
  waitedMs: number,
): PushGate {
  if (now - p.at > PUSH_HOLD_MS) return 'drop';
  if (session.status !== 'ready') return 'wait';
  if (session.mode !== 'real') return 'drop';
  if (!session.uid) return 'wait';
  if (p.for && p.for !== session.uid) return 'drop';
  if (chatUid !== session.uid && waitedMs < PUSH_CHAT_WAIT_MS) return 'wait';
  return 'go';
}
