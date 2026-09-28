/**
 * World Delta engine.
 *
 *  • Reactions: after every action, compare the graph before/after and queue
 *    ChangeEvents for things that genuinely changed ("Tokyo Food Tour now
 *    matches your Japan travel-buddy loop", "Zara became more relevant…").
 *  • Release: when the user comes back after time away, release 1–3 changes:
 *    queued reactions first, then pool events whose conditions hold.
 *    Nothing is released if it no longer applies — no filler.
 */
import { CHANGE_POOL, type ChangeTemplate, type ComposeContext } from '@/data/changes';
import { ds, isRealMode } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { ChangeCondition, ChangeEvent, EntityRef } from '@/types/models';

import { AFFINITY, MATCH, RELEASE } from './config';
import type { GraphState } from './graph';
import { loopById } from './loops';
import { isAfterDarkRef } from './surfaces';
import { type GraphContext, isActiveLoop, rankPeopleCtx, scoreBoard, scoreMove, scoreStory } from './relevance';

// ─── Conditions ─────────────────────────────────────────────────────────────

export function conditionHolds(c: ChangeCondition | undefined, s: GraphState): boolean {
  if (!c) return true;
  if ('any' in c) return c.any.some((x) => conditionHolds(x, s));
  if ('all' in c) return c.all.every((x) => conditionHolds(x, s));
  if ('joined' in c) return !!s.joined[c.joined];
  if ('following' in c) return !!s.following[c.following];
  if ('connected' in c) return !!s.connections[c.connected];
  if ('loopActive' in c) return s.openLoops.some((l) => l.id === c.loopActive && isActiveLoop(l));
  if ('moveEngaged' in c) {
    const st = s.moveState[c.moveEngaged];
    return !!(st?.interested || st?.rsvp || st?.saved);
  }
  if ('savedPost' in c) return !!s.savedPosts[c.savedPost];
  if ('affinityAtLeast' in c) return (s.affinity[c.affinityAtLeast[0]] ?? 0) >= c.affinityAtLeast[1];
  if ('notBlocked' in c) return !s.blocked[c.notBlocked];
  if ('notConnected' in c) return !s.connections[c.notConnected];
  return false;
}

function composeContext(s: GraphState): ComposeContext {
  return {
    following: s.following,
    connections: s.connections,
    joined: s.joined,
    firstName: (id) => repo.user(id)?.displayName.split(' ')[0] ?? 'Someone',
    boardMembers: (id) => {
      const b = repo.board(id);
      return b ? [...new Set([b.ownerId, ...b.memberPreview])] : [];
    },
  };
}

function relevanceOf(ctx: GraphContext, ref: EntityRef): number {
  if (ref.kind === 'board') {
    const b = repo.board(ref.id);
    return b ? scoreBoard(ctx, b).score : 0;
  }
  if (ref.kind === 'move') {
    const m = repo.move(ref.id);
    return m ? scoreMove(ctx, m).score : 0;
  }
  if (ref.kind === 'story') {
    const st = repo.story(ref.id);
    return st ? scoreStory(ctx, st).score : 0;
  }
  if (ref.kind === 'person') return ctx.match(ref.id).matchScore * 0.6;
  if (ref.kind === 'post') {
    const b = repo.board(repo.post(ref.id)?.boardId ?? '');
    return b ? scoreBoard(ctx, b).score : 0;
  }
  return 0;
}

// ─── Release (off-session) ──────────────────────────────────────────────────

/** How many changes to release for a given time away. */
export function releaseCount(awayMs: number): number {
  if (awayMs < RELEASE.awayThresholdMs) return 0;
  const min = awayMs / 60000;
  for (const [upTo, n] of RELEASE.schedule) if (min < upTo) return n;
  return RELEASE.schedule[RELEASE.schedule.length - 1][1];
}

export interface EligibleTemplate {
  template: ChangeTemplate;
  event: Omit<ChangeEvent, 'id' | 'createdAt'>;
  relevance: number;
}

/** Pool entries that apply to the current graph, strongest first. */
export function eligiblePool(ctx: GraphContext, fired: Record<string, true>): EligibleTemplate[] {
  const cc = composeContext(ctx.s);
  const out: EligibleTemplate[] = [];
  // The conditional pool is DEMO-only: its events are about seeded people and Worlds.
  for (const t of isRealMode() ? [] : CHANGE_POOL) {
    if (fired[t.key] || !conditionHolds(t.when, ctx.s)) continue;
    // After Dark is isolated: its changes never enter the normal World Delta.
    if (isAfterDarkRef(t.ref)) continue;
    const composed = t.compose ? t.compose(cc) : {};
    if (composed === null) continue;
    out.push({
      template: t,
      relevance: relevanceOf(ctx, t.ref),
      event: {
        key: t.key,
        type: t.type,
        ref: t.ref,
        importance: t.importance,
        message: composed.message ?? t.message,
        detail: composed.detail ?? t.detail,
        count: composed.count ?? t.count,
        reason: composed.reason ?? t.reason,
        seen: false,
        source: 'world',
        requires: t.when,
      },
    });
  }
  return out.sort((a, b) => b.event.importance - a.event.importance || b.relevance - a.relevance);
}

export interface ReleaseResult {
  released: ChangeEvent[];
  pending: ChangeEvent[];
  fired: Record<string, true>;
}

export function releaseChanges(
  ctx: GraphContext,
  pending: ChangeEvent[],
  fired: Record<string, true>,
  now: number,
  awayMs: number,
): ReleaseResult {
  const n = releaseCount(awayMs);
  if (!n) return { released: [], pending, fired };
  // Reactions that still hold compete with pool events on importance, then
  // relevance; at equal footing your own consequences come first.
  const stillValid = pending.filter((p) => conditionHolds(p.requires, ctx.s));
  const candidates = [
    ...stillValid.map((e) => ({ event: e as Omit<ChangeEvent, 'id' | 'createdAt'>, relevance: relevanceOf(ctx, e.ref) + 5 })),
    ...eligiblePool(ctx, fired).map((e) => ({ event: e.event, relevance: e.relevance })),
  ].sort((a, b) => b.event.importance - a.event.importance || b.relevance - a.relevance);
  const picked: Omit<ChangeEvent, 'id' | 'createdAt'>[] = [];
  for (const c of candidates) {
    if (picked.length >= n) break;
    // One change per entity per release keeps it varied.
    if (picked.some((p) => p.ref.kind === c.event.ref.kind && p.ref.id === c.event.ref.id)) continue;
    picked.push(c.event);
  }
  const nextFired = { ...fired };
  const released = picked.map((e, i) => {
    nextFired[e.key] = true;
    return { ...e, id: `c_${e.key}_${now.toString(36)}`, createdAt: now - i * RELEASE.spacingMs, seen: false } as ChangeEvent;
  });
  const releasedKeys = new Set(released.map((r) => r.key));
  return { released, pending: stillValid.filter((p) => !releasedKeys.has(p.key)), fired: nextFired };
}

/**
 * Adds new reactions to the queue: drops duplicates, and a NEW_MATCH for a
 * person replaces any queued "became more relevant" for them.
 */
export function mergeQueue(queue: ChangeEvent[], reactions: ChangeEvent[]): ChangeEvent[] {
  let out = [...queue];
  for (const r of reactions) {
    if (out.some((q) => q.key === r.key)) continue;
    if (r.type === 'NEW_MATCH') out = out.filter((q) => !(q.type === 'PERSON_BECAME_RELEVANT' && q.key.startsWith('relevant:') && q.ref.id === r.ref.id));
    if (r.type === 'PERSON_BECAME_RELEVANT' && r.key.startsWith('relevant:')) {
      const existing = out.find((q) => (q.type === 'NEW_MATCH' || q.key.startsWith('relevant:')) && q.ref.id === r.ref.id);
      if (existing) continue;
    }
    out.push(r);
  }
  return out;
}

// ─── Reactions (consequences of the user's own actions) ─────────────────────

function reaction(e: Omit<ChangeEvent, 'id' | 'seen' | 'source'>): ChangeEvent {
  return { ...e, id: `r_${e.key}_${e.createdAt.toString(36)}`, seen: false, source: 'reaction' };
}

/**
 * Compares the graph before and after an action and queues what really
 * changed. Deduped by key, so repeating an action never spams.
 */
export function detectReactions(
  before: GraphContext,
  after: GraphContext,
  now: number,
  fired: Record<string, true>,
  queued: ChangeEvent[],
  baselineMatches: Record<string, number>,
): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  const known = (key: string) => !!fired[key] || queued.some((q) => q.key === key) || out.some((o) => o.key === key);

  // 1. A loop was opened → the Moves/people that now serve it.
  const prevLoops = new Set(before.activeLoops.map((l) => l.id));
  for (const loop of after.activeLoops.filter((l) => !prevLoops.has(l.id))) {
    const moves = after.s.openLoops.find((l) => l.id === loop.id)?.related.filter((r) => r.kind === 'move') ?? [];
    for (const r of moves.slice(0, 1)) {
      const m = repo.move(r.id);
      const key = `loopmove:${loop.id}:${r.id}`;
      if (m && !known(key)) {
        out.push(reaction({
          key, type: 'OPEN_LOOP_PROGRESS', ref: r, importance: 3, createdAt: now,
          message: `${m.title} now matches your ${loop.short ?? 'Open Loop'}`,
          detail: `${m.city} · ${m.dateLabel}. ${m.attendeeCount.toLocaleString()} interested.`,
          reason: `Open Loop: ${loop.title}`,
          requires: { loopActive: loop.id },
        }));
      }
    }
    const person = rankPeopleCtx(after, { excludeConnected: true }).find((p) => after.match(p.person.id).relevantOpenLoops.includes(loop.id));
    const pkey = person ? `loopperson:${loop.id}:${person.person.id}` : '';
    if (person && !known(pkey)) {
      const name = person.person.displayName.split(' ')[0];
      const why = after.match(person.person.id).matchReasons[0]?.clause ?? 'your graphs overlap';
      out.push(reaction({
        key: pkey, type: 'PERSON_BECAME_RELEVANT', ref: { kind: 'person', id: person.person.id }, importance: 3, createdAt: now,
        message: `${name} could help with “${loop.title}”`,
        detail: `Because ${why}.`,
        reason: `Open Loop: ${loop.title}`,
        requires: { all: [{ loopActive: loop.id }, { notBlocked: person.person.id }, { notConnected: person.person.id }] },
      }));
    }
  }

  // 2. People whose match moved meaningfully since the session began.
  const ranked = rankPeopleCtx(after, { excludeConnected: true }).slice(0, 5);
  for (const { person, match } of ranked) {
    const was = before.match(person.id).matchScore;
    const base = baselineMatches[person.id] ?? was;
    const name = person.displayName.split(' ')[0];
    const why = match.matchReasons[0]?.clause ?? 'your graphs overlap more now';
    if (was < MATCH.newMatchAt && match.matchScore >= MATCH.newMatchAt) {
      const key = `newmatch:${person.id}`;
      if (!known(key)) {
        out.push(reaction({
          key, type: 'NEW_MATCH', ref: { kind: 'person', id: person.id }, importance: 3, createdAt: now,
          message: `${person.displayName} is now a strong match`,
          detail: `Because ${why}.`,
          reason: 'Your recent activity overlaps with theirs',
          requires: { all: [{ notBlocked: person.id }, { notConnected: person.id }] },
        }));
      }
    } else if (match.matchScore - base >= MATCH.becameRelevantDelta && match.matchScore > was) {
      const key = `relevant:${person.id}`;
      if (!known(key) && !known(`newmatch:${person.id}`)) {
        out.push(reaction({
          key, type: 'PERSON_BECAME_RELEVANT', ref: { kind: 'person', id: person.id }, importance: 2, createdAt: now,
          message: `${name} became more relevant`,
          detail: `Because ${why}.`,
          reason: 'Based on what you joined, saved and followed',
          requires: { all: [{ notBlocked: person.id }, { notConnected: person.id }] },
        }));
      }
    }
  }

  // 3. An interest crossed into "high" → the best Board for it now fits you.
  for (const [i, v] of Object.entries(after.s.affinity)) {
    const prev = before.s.affinity[i] ?? 0;
    if (prev < AFFINITY.high && v >= AFFINITY.high) {
      const top = repo
        .boards()
        .filter((b) => b.interests[0] === i && !after.s.joined[b.id] && b.ownerId !== ds().me.id && !b.ageGated)
        .map((b) => scoreBoard(after, b))
        .sort((a, b) => b.score - a.score)[0];
      const key = top ? `affinityboard:${i}` : '';
      if (top && !known(key)) {
        out.push(reaction({
          key, type: 'BOARD_ACTIVITY', ref: { kind: 'board', id: top.item.id }, importance: 1, createdAt: now,
          message: `${top.item.title} now fits what you’re exploring`,
          detail: top.item.tagline,
          reason: top.reasons.find((r) => r.kind === 'interest')?.text ?? top.reasons[0]?.text ?? 'Matches what you’ve been exploring',
          requires: { affinityAtLeast: [i, AFFINITY.high - 0.05] },
        }));
      }
    }
  }

  return out;
}

export function loopTitle(ctx: GraphContext, id: string): string {
  return loopById(ctx, id)?.title ?? 'Open Loop';
}
