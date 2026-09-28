/**
 * Your Agent — rules-based and local. It only explains actual graph state:
 * every sentence is assembled from activity, scores and reasons computed
 * elsewhere, so it can't say something the data doesn't support.
 */
import { SEED_OPEN_LOOPS, SUGGESTED_LOOPS } from '@/data/graph';
import { interestById } from '@/data/interests';
import { repo } from '@/services/repository';
import type { ActivityEvent } from '@/types/models';

import { loopProgress, suggestedLoops } from './loops';
import { type GraphContext, isActiveLoop, postTitle, rankBoards, rankMoves, rankPeopleCtx, rankStories } from './relevance';
import { buildHappeningGraph } from './happening';
import { rankBuzz, rankDrift, isAfterDarkRef } from './surfaces';
import { buildEdition } from './worlds';
import { unseenChanges } from './touch';

// ─── Session baseline (for "what changed") ──────────────────────────────────

export interface Baseline {
  at: number;
  matches: Record<string, number>;
  topPersonId?: string;
  boards: Record<string, number>;
  moves: Record<string, number>;
  stories: Record<string, number>;
  affinity: Record<string, number>;
  /** Phase 4 surfaces (optional so older baselines still load). */
  buzz?: Record<string, number>;
  drift?: Record<string, number>;
  /** Phase 5: Japan Trip's Today module order and Happening World strengths. */
  edition?: string[];
  happening?: Record<string, number>;
}

export function takeBaseline(ctx: GraphContext, now: number): Baseline {
  const people = rankPeopleCtx(ctx, { excludeConnected: true });
  const rec = <T extends { id: string }>(list: { item: T; score: number }[]) =>
    Object.fromEntries(list.map((x) => [x.item.id, x.score]));
  return {
    at: now,
    matches: Object.fromEntries(people.map((p) => [p.person.id, p.match.matchScore])),
    topPersonId: people[0]?.person.id,
    boards: rec(rankBoards(ctx)),
    moves: rec(rankMoves(ctx)),
    stories: rec(rankStories(ctx)),
    affinity: { ...ctx.s.affinity },
    buzz: rec(rankBuzz(ctx, 'forYou')),
    drift: rec(rankDrift(ctx)),
    edition: editionOrder(ctx, 'japan-trip'),
    happening: Object.fromEntries(buildHappeningGraph(ctx, null).nodes.filter((n) => n.tier === 'major').map((n) => [n.id, n.strength])),
  };
}

/** "lead:drift · top · watch · …" for a World's Today edition. */
export function editionOrder(ctx: GraphContext, boardId: string): string[] {
  const e = buildEdition(ctx, boardId);
  return e ? [`lead:${e.lead?.kind ?? '–'}`, ...e.modules.map((m) => m.id)] : [];
}

// ─── Activity wording ───────────────────────────────────────────────────────

const INTEREST_NOUN: Record<string, string> = {
  i_japan: 'Japan planning',
  i_travel: 'travel planning',
  i_italy: 'Italy planning',
  i_startups: 'founder',
  i_ai: 'AI',
  i_food: 'food',
  i_photo: 'photography',
  i_nightlife: 'nightlife',
};

export function describeActivity(a: ActivityEvent): string | null {
  const name = (() => {
    switch (a.ref.kind) {
      case 'board':
        return repo.board(a.ref.id)?.title;
      case 'move':
        return repo.move(a.ref.id)?.title;
      case 'person':
        return repo.user(a.ref.id)?.displayName.split(' ')[0];
      case 'post':
        return postTitle(repo.post(a.ref.id));
      case 'story':
        return repo.story(a.ref.id)?.title;
      default:
        return undefined;
    }
  })();
  const loopName = a.ref.kind === 'loop' ? [...SUGGESTED_LOOPS, ...SEED_OPEN_LOOPS].find((l) => l.id === a.ref.id)?.title : undefined;
  switch (a.type) {
    case 'join':
      return `joined ${name}`;
    case 'save':
      return `saved ${name}`;
    case 'vote': {
      const b = repo.board(repo.post(a.ref.id)?.boardId ?? '');
      return `voted in the ${b?.title ?? ''} poll`.replace('  ', ' ');
    }
    case 'follow':
      return `followed ${name}`;
    case 'connect':
      return `connected with ${name}`;
    case 'interested':
      return `marked ${name} Interested`;
    case 'rsvp':
      return `RSVP’d to ${name}`;
    case 'like':
      return `liked ${name}`;
    case 'comment':
      return `commented on ${name}`;
    case 'chat':
      return `messaged ${name}`;
    case 'openLoop':
      return loopName ? `opened “${loopName}”` : 'opened a new Open Loop';
    case 'storyView':
      return `watched the ${name} story`;
    case 'open':
      return a.ref.kind === 'board' ? `looked at ${name}` : null;
    default:
      return null;
  }
}

/** Sum of affinity change per interest over the last N days. */
export function affinityTrend(ctx: GraphContext, days = 7, now = Date.now()): { interest: string; delta: number; events: ActivityEvent[] }[] {
  const since = now - days * 86400000;
  const map = new Map<string, { delta: number; events: ActivityEvent[] }>();
  for (const a of ctx.s.activity) {
    if (a.at < since || !a.affinity) continue;
    for (const [i, d] of Object.entries(a.affinity)) {
      const cur = map.get(i) ?? { delta: 0, events: [] };
      cur.delta += d;
      if (d > 0) cur.events.push(a);
      map.set(i, cur);
    }
  }
  return [...map.entries()].map(([interest, v]) => ({ interest, ...v })).sort((a, b) => b.delta - a.delta);
}

// ─── Brief ──────────────────────────────────────────────────────────────────

export interface AgentItem {
  id: string;
  text: string;
  detail?: string;
  href: string;
  action?: { kind: 'openLoop'; loopId: string };
}

export interface AgentBrief {
  changed: AgentItem[];
  meet: AgentItem[];
  next: AgentItem[];
  close: AgentItem[];
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function buildAgentBrief(ctx: GraphContext, baseline: Baseline | undefined, now = Date.now()): AgentBrief {
  const { s } = ctx;
  const changed: AgentItem[] = [];

  // What changed: your own momentum this week.
  const trend = affinityTrend(ctx, 7, now).filter((t) => t.delta >= 0.1);
  if (trend.length) {
    const t = trend[0];
    const noun = INTEREST_NOUN[t.interest] ?? interestById[t.interest]?.label.toLowerCase() ?? 'recent';
    const acts = t.events.map(describeActivity).filter(Boolean).slice(0, 3) as string[];
    const board = rankBoards(ctx, (b) => b.interests[0] === t.interest)[0]?.item;
    changed.push({
      id: 'trend',
      text: `Your ${noun} activity increased this week.`,
      detail: acts.length ? `You ${acts.join(', ')}.` : undefined,
      href: board ? `/board/${board.id}` : '/you',
    });
  }

  // What changed: who rose to the top.
  const people = rankPeopleCtx(ctx, { excludeConnected: true });
  const top = people[0];
  if (top) {
    const name = top.person.displayName.split(' ')[0];
    const clauses = top.match.matchReasons.map((r) => r.clause).filter(Boolean).slice(0, 2) as string[];
    const because = clauses.length ? ` because ${clauses.join(' and ')}` : '';
    const was = baseline?.matches[top.person.id];
    if (baseline?.topPersonId && baseline.topPersonId !== top.person.id) {
      changed.push({ id: 'top', text: `${name} is now your strongest suggested connection${because}.`, href: `/profile/${top.person.id}` });
    } else if (was !== undefined && top.match.matchScore - was >= 5) {
      changed.push({ id: 'top', text: `${name} is an even stronger match now${because}.`, href: `/profile/${top.person.id}` });
    }
  }

  // What changed: a Move that climbed.
  if (baseline) {
    const moves = rankMoves(ctx);
    const riser = moves
      .map((m, rank) => ({ m, rank, before: Object.entries(baseline.moves).sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === m.item.id) }))
      .filter((x) => x.before > x.rank && x.m.score - (baseline.moves[x.m.item.id] ?? 0) >= 4)
      .sort((a, b) => b.before - b.rank - (a.before - a.rank))[0];
    if (riser) {
      changed.push({
        id: 'riser',
        text: `${riser.m.item.title} moved up in your Moves.`,
        detail: riser.m.reasons[0] ? `${riser.m.reasons[0].text}.` : undefined,
        href: `/move/${riser.m.item.id}`,
      });
    }
  }

  const unseen = unseenChanges(s.changes).filter((c) => !isAfterDarkRef(c.ref));
  if (unseen.length) {
    changed.push({ id: 'unseen', text: `${unseen.length} update${unseen.length > 1 ? 's' : ''} since your last visit.`, detail: unseen[0].message, href: '/delta' });
  }

  // Who you should meet.
  const meet: AgentItem[] = people.slice(0, 2).map(({ person, match }) => {
    const clauses = match.matchReasons.map((r) => r.clause).filter(Boolean).slice(0, 2) as string[];
    return {
      id: `meet_${person.id}`,
      text: person.displayName,
      detail: clauses.length ? `${cap(clauses.join(' and '))}.` : 'New to your graph.',
      href: `/profile/${person.id}`,
    };
  });

  // What you should do next.
  const next: AgentItem[] = [];
  const engaged = (id: string) => !!(s.moveState[id]?.interested || s.moveState[id]?.rsvp);
  const moves = rankMoves(ctx, (m) => !engaged(m.id));
  const bestMove = moves[0];
  if (bestMove) {
    const loopReason = bestMove.reasons.find((r) => r.kind === 'loop');
    const loop = loopReason?.ref ? s.openLoops.find((l) => l.id === loopReason.ref!.id) : undefined;
    next.push({
      id: 'move',
      text: loop
        ? `${bestMove.item.title} could help progress your ${loop.short ?? 'Open Loop'}.`
        : `${bestMove.item.title} fits you right now.`,
      detail: bestMove.reasons.filter((r) => r.kind !== 'loop').slice(0, 2).map((r) => r.text).join(' · ') || undefined,
      href: `/move/${bestMove.item.id}`,
    });
  }
  const sugg = suggestedLoops(ctx)[0];
  if (sugg) {
    const i = interestById[sugg.interests[0]]?.label ?? 'this';
    next.push({
      id: `open_${sugg.id}`,
      text: `Open a loop: “${sugg.title}”`,
      detail: `Your ${i} activity points here. Chimp will reorganise around it.`,
      href: '/loops',
      action: { kind: 'openLoop', loopId: sugg.id },
    });
  }
  const board = rankBoards(ctx, (b) => !s.joined[b.id] && b.ownerId !== repo.meId() && !b.ageGated)[0];
  if (board) {
    next.push({ id: 'board', text: `Join ${board.item.title}`, detail: board.reasons[0] ? `${board.reasons[0].text}.` : undefined, href: `/board/${board.item.id}` });
  }

  // What loop you could close.
  const close: AgentItem[] = s.openLoops
    .filter(isActiveLoop)
    .map((l) => loopProgress(ctx, l))
    .filter((p) => p.next)
    .sort((a, b) => b.progress - a.progress || (b.loop.createdAt > a.loop.createdAt ? 1 : -1))
    .slice(0, 2)
    .map((p) => ({
      id: `loop_${p.loop.id}`,
      text: p.loop.title,
      detail: `${p.progress}% there. Next: ${lower(p.next!.label)}.`,
      href: p.next?.ref ? hrefForRef(p.next.ref) : '/loops',
    }));

  return { changed: changed.slice(0, 3), meet, next: next.slice(0, 3), close };
}

function hrefForRef(ref: { kind: string; id: string }): string {
  switch (ref.kind) {
    case 'person':
      return `/profile/${ref.id}`;
    case 'board':
      return `/board/${ref.id}`;
    case 'move':
      return `/move/${ref.id}`;
    default:
      return '/loops';
  }
}

/** Four short lines for the agent card on You. */
export function agentLines(brief: AgentBrief): { id: string; text: string; href: string }[] {
  const lines: { id: string; text: string; href: string }[] = [];
  if (brief.changed[0]) lines.push({ id: 'changed', text: brief.changed[0].text.replace(/\.$/, ''), href: brief.changed[0].href });
  if (brief.meet[0]) lines.push({ id: 'meet', text: `Meet ${brief.meet[0].text.split(' ')[0]}: ${lower(brief.meet[0].detail ?? '').replace(/\.$/, '')}`, href: brief.meet[0].href });
  if (brief.next[0]) lines.push({ id: 'next', text: brief.next[0].text.replace(/\.$/, ''), href: brief.next[0].href });
  if (brief.close[0]) lines.push({ id: 'close', text: `${brief.close[0].text}: ${brief.close[0].detail?.split('.')[0]}`, href: brief.close[0].href });
  return lines;
}

