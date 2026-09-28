/**
 * Open Loop progress — derived from the graph, never typed in.
 *
 * A loop has a goal type:
 *   people – "Find a travel buddy for Japan": follow → connect → chat (+ a Move)
 *   plan   – "Plan Italy 2027": a Board → a Move → someone to go with
 * People steps only count relationships formed AFTER the loop was opened,
 * so an old connection doesn't silently complete a new goal.
 */
import { interestById, INTERESTS } from '@/data/interests';
import { SUGGESTED_LOOPS } from '@/data/graph';
import { LOCATION_BY_ID, locationForCity } from '@/data/locations';
import { ds, isRealMode } from '@/services/dataset';
import { repo } from '@/services/repository';
import type { EntityRef, LoopStatus, OpenLoop } from '@/types/models';

import { AFFINITY, LOOP_PROGRESS, SUGGEST_LOOP_AT } from './config';
import type { GraphContext } from './relevance';
import { scoreBoard, scoreMove } from './relevance';

export type LoopStepId = keyof typeof LOOP_PROGRESS.steps;

export interface LoopStep {
  id: LoopStepId;
  label: string;
  done: boolean;
  weight: number;
  /** What completed it, or the best candidate to do next. */
  ref?: EntityRef;
}

export interface LoopProgress {
  loop: OpenLoop;
  status: LoopStatus;
  progress: number; // 0..100
  steps: LoopStep[];
  next?: LoopStep;
  /** People, Boards and Moves that could help, best first. */
  candidates: { people: string[]; boards: string[]; moves: string[] };
}

const PEOPLE_WORDS = /\b(meet|find|buddy|people|friend|co-?founder|someone|partner|crew)\b/i;

export function goalOf(loop: OpenLoop): 'people' | 'plan' {
  return PEOPLE_WORDS.test(loop.title) ? 'people' : 'plan';
}

/** Infers interests from a free-text loop title ("Plan a Japan food trip" → Japan, Food). */
export function inferInterests(title: string): string[] {
  const t = title.toLowerCase();
  const hits = INTERESTS.filter((i) => t.includes(i.label.toLowerCase())).map((i) => i.id);
  if (/tokyo|kyoto|osaka/.test(t) && !hits.includes('i_japan')) hits.unshift('i_japan');
  if (/trip|travel|flight/.test(t) && !hits.includes('i_travel')) hits.push('i_travel');
  if (/founder|startup/.test(t) && !hits.includes('i_startups')) hits.push('i_startups');
  return hits;
}

const since = (loop: OpenLoop) => {
  const t = Date.parse(loop.createdAt);
  return Number.isFinite(t) ? t : 0;
};

export function loopCandidates(ctx: GraphContext, loop: OpenLoop) {
  const primary = loop.interests[0];
  const related = (kind: EntityRef['kind']) => loop.related.filter((r) => r.kind === kind).map((r) => r.id);
  const people = [
    ...related('person'),
    ...repo
      .people()
      // People whose defining interest is the loop's (Zara → Japan, Jordan → Startups).
      .filter((p) => primary && p.interests[0] === primary)
      .map((p) => p.id),
  ].filter((id, i, arr) => id !== ds().me.id && !!repo.user(id) && !ctx.s.blocked[id] && arr.indexOf(id) === i);
  const boards = [
    ...related('board'),
    ...repo.boards().filter((b) => primary && b.interests.slice(0, AFFINITY.primaryInterests).includes(primary)).map((b) => b.id),
  ].filter((id, i, arr) => arr.indexOf(id) === i);
  const moves = [
    ...related('move'),
    ...repo.moves().filter((m) => primary && m.interests.slice(0, AFFINITY.primaryInterests).includes(primary)).map((m) => m.id),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  // Best first: people by match, Boards/Moves by relevance; direct links stay on top.
  people.sort((a, b) => ctx.match(b).matchScore - ctx.match(a).matchScore);
  const directFirst = (kind: EntityRef['kind']) => (a: string, b: string) =>
    Number(related(kind).includes(b)) - Number(related(kind).includes(a));
  // Only entities that exist in the active dataset (Phase 6B hardening).
  const liveBoards = boards.filter((id) => !!repo.board(id));
  const liveMoves = moves.filter((id) => !!repo.move(id));
  liveBoards.sort((a, b) => scoreBoard(ctx, repo.board(b)!).score - scoreBoard(ctx, repo.board(a)!).score).sort(directFirst('board'));
  liveMoves.sort((a, b) => scoreMove(ctx, repo.move(b)!).score - scoreMove(ctx, repo.move(a)!).score).sort(directFirst('move'));
  return { people: people.filter((id) => !!repo.user(id)), boards: liveBoards, moves: liveMoves };
}

export function loopProgress(ctx: GraphContext, loop: OpenLoop): LoopProgress {
  const { s } = ctx;
  const cand = loopCandidates(ctx, loop);
  const goal = goalOf(loop);
  const t0 = since(loop);
  const W = LOOP_PROGRESS.steps;
  const first = (id: string) => repo.user(id)?.displayName.split(' ')[0] ?? 'someone';
  const steps: LoopStep[] = [];

  const followedAfter = (id: string) =>
    !!s.following[id] && s.activity.some((a) => a.type === 'follow' && a.ref.id === id && a.at >= t0);
  const connectedAfter = (id: string) => {
    const c = s.connections[id];
    return !!c && Date.parse(c.since) >= t0;
  };
  const chattedAfter = (id: string) => (s.chats[id] ?? []).some((m) => m.fromMe && m.at >= t0);
  const boardDone = cand.boards.find((b) => s.joined[b] || repo.board(b)?.ownerId === ds().me.id);
  const moveDone = cand.moves.find((m) => s.moveState[m]?.interested || s.moveState[m]?.rsvp);
  const place = locationForCity(loop.title);
  const whoLabel = loop.interests[0] === 'i_japan' && loop.interests.includes('i_travel')
    ? 'a Japan traveller'
    : place && !loop.interests.includes(LOCATION_BY_ID[place]?.interestId ?? '-')
      ? `someone in ${LOCATION_BY_ID[place]?.label}`
      : loop.interests[0]
      ? `someone into ${interestById[loop.interests[0]]?.label ?? 'this'}`
      : 'someone who fits';

  if (cand.people.length) {
    const followed = cand.people.find(followedAfter);
    const connected = cand.people.find(connectedAfter);
    const chatted = cand.people.find(chattedAfter);
    const best = cand.people.find((id) => !s.connections[id]) ?? cand.people[0];
    if (goal === 'people') {
      steps.push({ id: 'follow', weight: W.follow, done: !!followed || !!connected, label: followed ? `Followed ${first(followed)}` : connected ? `Following ${first(connected)}` : `Follow ${first(best)}`, ref: { kind: 'person', id: followed ?? connected ?? best } });
      steps.push({ id: 'connect', weight: W.connect, done: !!connected, label: connected ? `Connected with ${first(connected)}` : `Connect with ${whoLabel}`, ref: { kind: 'person', id: connected ?? best } });
      steps.push({ id: 'chat', weight: W.chat, done: !!chatted, label: chatted ? `Started a chat with ${first(chatted)}` : `Say hi to ${first(connected ?? best)}`, ref: { kind: 'person', id: chatted ?? connected ?? best } });
    } else {
      steps.push({ id: 'follow', weight: W.follow, done: !!followed || !!connected, label: followed || connected ? `Found ${first((followed ?? connected)!)}` : `Find someone to go with`, ref: { kind: 'person', id: followed ?? connected ?? best } });
    }
  }
  if (goal === 'plan' && cand.boards.length) {
    steps.unshift({ id: 'board', weight: W.board, done: !!boardDone, label: boardDone ? `Planning in ${repo.board(boardDone)?.title}` : `Join ${repo.board(cand.boards[0])?.title}`, ref: { kind: 'board', id: boardDone ?? cand.boards[0] } });
  }
  if (cand.moves.length) {
    const m = moveDone ?? cand.moves[0];
    steps.push({ id: 'move', weight: W.move, done: !!moveDone, label: moveDone ? `Interested in ${repo.move(m)?.title}` : `Try ${repo.move(m)?.title}`, ref: { kind: 'move', id: m } });
  }

  const total = steps.reduce((a, st) => a + st.weight, 0);
  const done = steps.filter((st) => st.done).reduce((a, st) => a + st.weight, 0);
  let progress = total ? Math.round((done / total) * 100) : 0;
  let status: LoopStatus = loop.status;
  if (loop.status === 'resolved') progress = 100;
  else if (loop.status !== 'dismissed') {
    progress = Math.min(LOOP_PROGRESS.openCap, progress);
    status = progress > 0 ? 'progress' : 'active';
  }
  return { loop, status, progress, steps, next: steps.find((st) => !st.done), candidates: cand };
}

/** Suggested loops your graph now points at, not yet opened. */
export function suggestedLoops(ctx: GraphContext): OpenLoop[] {
  const have = new Set(ctx.s.openLoops.map((l) => l.id));
  // Suggested loops are DEMO fixtures (they reference seeded people and Moves).
  if (isRealMode()) return [];
  return SUGGESTED_LOOPS.filter((l) => !have.has(l.id) && (ctx.s.affinity[l.interests[0]] ?? 0) >= SUGGEST_LOOP_AT);
}

export function loopById(ctx: GraphContext, id: string): OpenLoop | undefined {
  return ctx.s.openLoops.find((l) => l.id === id) ?? SUGGESTED_LOOPS.find((l) => l.id === id);
}
