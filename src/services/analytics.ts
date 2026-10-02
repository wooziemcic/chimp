/**
 * Phase 7C: product events (what people do, never what they say).
 *
 * REAL accounts only — the Demo and the App Review Demo never send anything.
 * Events are batched (every 10 s, at 20 events, or when the app goes to the
 * background) and sent through log_product_events() (0009), which validates
 * them again and stamps the server's time. Never: message text, captions,
 * comments, prompts or answers, OTPs, tokens, JWTs, media URLs, report text,
 * email or phone, or who you have a Crush on / passed on.
 */
import { AppState, type NativeEventSubscription } from 'react-native';

import { isBackendConfigured, supabase } from '@/lib/supabase';
import type { ActivityType, EntityRef } from '@/types/models';

import * as realData from './backend/realData';
import { isRealMode } from './dataset';

export type ProductEventType =
  // content
  | 'content_view' | 'content_like' | 'content_unlike' | 'content_save' | 'content_unsave' | 'content_share'
  | 'content_create' | 'content_dislike' | 'content_comment' | 'poll_vote'
  // people
  | 'profile_view' | 'follow' | 'unfollow' | 'connect_request' | 'connect_accept' | 'connect_remove' | 'crush_set' | 'crush_remove' | 'block'
  // worlds
  | 'world_view' | 'world_join' | 'world_leave' | 'world_follow' | 'world_unfollow' | 'world_create'
  // messaging
  | 'conversation_open' | 'message_sent' | 'group_create' | 'reaction_add' | 'ping_send'
  // after dark
  | 'after_dark_open' | 'discover_view' | 'discover_pass' | 'vibe_request' | 'vibe_accept' | 'vibe_decline' | 'vibe_pause' | 'vibe_close'
  | 'challenge_send' | 'challenge_answer' | 'photo_consent_change'
  // plans
  | 'loop_open' | 'loop_resolve' | 'loop_dismiss' | 'plan_propose' | 'plan_confirm' | 'plan_pause' | 'plan_close'
  // outcome
  | 'suggestion_shown' | 'suggestion_acted' | 'suggestion_dismissed' | 'why_shown' | 'delta_shown' | 'delta_opened'
  | 'push_opened' | 'push_enabled' | 'push_disabled'
  // app
  | 'app_open' | 'app_foreground' | 'surface_view' | 'onboarding_step' | 'sign_in' | 'sign_out';

export type TargetType = 'buzz' | 'drift' | 'post' | 'story' | 'board' | 'move' | 'person' | 'conversation' | 'message' | 'vibe' | 'challenge' | 'loop' | 'plan' | 'notification' | 'surface' | 'interest';

type Scalar = string | number | boolean;

interface WireEvent {
  event_type: ProductEventType;
  target_type?: TargetType;
  target_id?: string;
  source_surface?: string;
  client_at: string;
  session_id: string;
  context?: Record<string, Scalar>;
}

const FLUSH_MS = 10_000;
const FLUSH_AT = 20;
const MAX_QUEUE = 200;
/** Same rule as the server: keys that could carry content or credentials are dropped. */
const SENSITIVE_KEY = /(body|text|message|content|caption|comment|prompt|answer|title|url|uri|path|token|otp|jwt|password|secret|key|email|phone|name|address|reason_text|report)/;
const SAFE_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
/** Events whose target must never leave the phone. */
const NO_TARGET = new Set<ProductEventType>(['crush_set', 'crush_remove', 'block', 'discover_view', 'discover_pass']);

let queue: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sub: NativeEventSubscription | null = null;
let disabled = false;
const newSession = () => `s_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
/** One id per sign-in (a new one for every account, so two accounts are never linked). */
let sessionId = newSession();

const enabled = () => !disabled && isBackendConfigured && isRealMode() && !!realData.real.uid();

/** Keep only short scalar values under safe keys (defence in depth; the server filters again). */
export function cleanContext(ctx: Record<string, unknown> | undefined): Record<string, Scalar> | undefined {
  if (!ctx) return undefined;
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k) || SENSITIVE_KEY.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 40 && /^[A-Za-z0-9_:.-]*$/.test(v)) out[k] = v;
    if (Object.keys(out).length >= 12) break;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Build the wire form (exported for tests). Returns null when nothing safe is left to send. */
export function toWire(type: ProductEventType, o: { targetType?: TargetType; targetId?: string; surface?: string; context?: Record<string, unknown> } = {}, now = Date.now()): WireEvent {
  const keepTarget = !NO_TARGET.has(type) && o.targetType !== 'message' && !(type.startsWith('vibe_') && o.targetType === 'person');
  return {
    event_type: type,
    ...(o.targetType ? { target_type: o.targetType } : {}),
    ...(keepTarget && o.targetId && SAFE_ID.test(o.targetId) ? { target_id: o.targetId } : {}),
    ...(o.surface && /^[a-z_]{1,24}$/.test(o.surface) ? { source_surface: o.surface } : {}),
    client_at: new Date(now).toISOString(),
    session_id: sessionId,
    ...(cleanContext(o.context) ? { context: cleanContext(o.context) } : {}),
  };
}

export function logEvent(type: ProductEventType, o?: { targetType?: TargetType; targetId?: string; surface?: string; context?: Record<string, unknown> }): void {
  if (!enabled()) return;
  queue.push(toWire(type, o));
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= FLUSH_AT) void flushEvents();
  else if (!timer) timer = setTimeout(() => void flushEvents(), FLUSH_MS);
}

export async function flushEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || !enabled()) return;
  const batch = queue.slice(0, 50);
  queue = queue.slice(50);
  try {
    const { error } = await supabase().rpc('log_product_events', { p_events: batch });
    if (error) {
      // Not on this project yet (0009 not applied): stop for this session, quietly.
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) disabled = true;
      else if (/fetch|network/i.test(error.message)) queue = [...batch, ...queue].slice(-MAX_QUEUE);
    }
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE); // offline: try again later
  }
  if (queue.length && !timer) timer = setTimeout(() => void flushEvents(), FLUSH_MS);
}

/** Start with a signed-in REAL account (flushes when the app goes to the background). */
export function startAnalytics(): void {
  if (sub) return;
  disabled = false;
  sessionId = newSession();
  sub = AppState.addEventListener('change', (st) => {
    if (st === 'background') void flushEvents();
    else if (st === 'active') logEvent('app_foreground');
  });
  logEvent('app_open');
}

/** Sign-out / account switch: send what's queued for this account, then stop. */
export async function stopAnalytics(): Promise<void> {
  sub?.remove();
  sub = null;
  await flushEvents().catch(() => {});
  queue = [];
}

// ─── The local action log → product events ──────────────────────────────────

const CONTENT: Partial<Record<EntityRef['kind'], TargetType>> = { buzz: 'buzz', drift: 'drift', post: 'post', story: 'story', move: 'move' };

/** What a tracked action means as a product event (null: not one we count). Exported for tests. */
export function activityEvent(type: ActivityType, ref: EntityRef): { type: ProductEventType; targetType?: TargetType; targetId?: string } | null {
  const target = (t: TargetType | undefined) => (t ? { targetType: t, targetId: ref.id } : {});
  const board = ref.kind === 'board';
  const person = ref.kind === 'person';
  const content = CONTENT[ref.kind];
  switch (type) {
    case 'open':
      return board ? { type: 'world_view', ...target('board') } : person ? { type: 'profile_view', ...target('person') } : content ? { type: 'content_view', ...target(content) } : null;
    case 'storyView':
      return { type: 'content_view', ...target('story') };
    case 'like':
      return content ? { type: 'content_like', ...target(content) } : null;
    case 'unlike':
      return content ? { type: 'content_unlike', ...target(content) } : null;
    case 'save':
      return content || board ? { type: 'content_save', ...target(content ?? 'board') } : null;
    case 'unsave':
      return content || board ? { type: 'content_unsave', ...target(content ?? 'board') } : null;
    case 'join':
      return board ? { type: 'world_join', ...target('board') } : null;
    case 'leave':
      return board ? { type: 'world_leave', ...target('board') } : null;
    case 'follow':
      return board ? { type: 'world_follow', ...target('board') } : person ? { type: 'follow', ...target('person') } : null;
    case 'unfollow':
      return board ? { type: 'world_unfollow', ...target('board') } : person ? { type: 'unfollow', ...target('person') } : null;
    case 'connect':
      return person ? { type: 'connect_accept', ...target('person') } : null;
    case 'disconnect':
      return person ? { type: 'connect_remove', ...target('person') } : null;
    case 'vote':
      return { type: 'poll_vote', ...target(content) };
    case 'comment':
    case 'reply':
      return { type: 'content_comment', ...target(content) };
    case 'repost':
      return { type: 'content_share', ...target(content) };
    case 'dislike':
      return content ? { type: 'content_dislike', ...target(content) } : null;
    case 'create':
      return board ? { type: 'world_create', ...target('board') } : { type: 'content_create', ...target(content) };
    case 'openLoop':
      return { type: 'loop_open', ...target('loop') };
    case 'resolveLoop':
      return { type: 'loop_resolve', ...target('loop') };
    case 'dismissLoop':
      return { type: 'loop_dismiss', ...target('loop') };
    case 'block':
      return { type: 'block' };
    default:
      return null;
  }
}

export function logActivity(type: ActivityType, ref: EntityRef): void {
  const e = activityEvent(type, ref);
  if (e) logEvent(e.type, { targetType: e.targetType, targetId: e.targetId });
}
