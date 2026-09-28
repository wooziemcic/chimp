/**
 * Recommender — the API screens call. Deterministic, explainable, local.
 *
 * Deliberately NOT an engagement maximiser (research §8.4). The work is
 * done by the graph engine in src/graph (relevance, matching, loops,
 * changes, agent); this module keeps the screen-facing shapes stable so a
 * remote ranking/AI service can replace it later by returning the same
 * items + human-readable reasons.
 */
import { interestById } from '@/data/interests';
import { AFFINITY } from '@/graph/config';
import type { GraphState } from '@/graph/graph';
import {
  getContext,
  rankBoards,
  rankMoves,
  rankPeopleCtx,
  rankStories,
  type RankedPerson,
  scoreBoard,
  scoreMove,
} from '@/graph/relevance';
import { freshCount } from '@/graph/touch';
import { repo } from '@/services/repository';
import type { Board, CategoryId, MatchExplanation, MatchIntent, Move, Reason, Story, User } from '@/types/models';

export type Signals = GraphState;
export type { RankedPerson };

// ─── Pulse ──────────────────────────────────────────────────────────────────

export type PulseEntity =
  | { kind: 'board'; board: Board; fresh: number; score: number }
  | { kind: 'move'; move: Move; fresh: number; score: number }
  | { kind: 'person'; person: User; match: MatchExplanation; fresh: number; score: number };

export interface PulsePage {
  circles: PulseEntity[]; // 3 slots
  cards: PulseEntity[]; // 3 slots
}

function categoryOfPerson(u: User): CategoryId[] {
  return Array.from(new Set(u.interests.map((i) => interestById[i]?.category).filter(Boolean))) as CategoryId[];
}

export const PULSE_ANCHORS = {
  circles: ['tokyo', 'after-dark', 'boston-founders'],
  cards: ['japan-trip', 'street-style', 'solo-travel'],
};

/**
 * Builds Pulse's editorial pages. Page one stays the approved composition
 * (anchors), with World Delta pips on it; relevance reorders the pages after.
 */
export function buildPulse(s: Signals, lens: CategoryId | null): PulsePage[] {
  const ctx = getContext(s);
  const boards: PulseEntity[] = rankBoards(ctx, (b) => b.ownerId !== repo.meId() && (lens ? b.category === lens : true)).map((x) => ({
    kind: 'board',
    board: x.item,
    fresh: freshCount(s.changes, { kind: 'board', id: x.item.id }),
    score: x.score,
  }));
  const moves: PulseEntity[] = rankMoves(ctx, (m) => (lens ? m.category === lens : true)).map((x) => ({
    kind: 'move',
    move: x.item,
    fresh: freshCount(s.changes, { kind: 'move', id: x.item.id }),
    score: x.score,
  }));
  const people: PulseEntity[] = rankPeopleCtx(ctx, { excludeConnected: true })
    .filter(({ person }) => (lens ? categoryOfPerson(person).includes(lens) : true))
    .slice(0, 8)
    .map(({ person, match, score }) => ({
      kind: 'person',
      person,
      match,
      fresh: freshCount(s.changes, { kind: 'person', id: person.id }),
      score,
    }));

  const circleBoards = boards.filter((e) => e.kind === 'board' && e.board.pulseShape === 'circle');
  const cardBoards = boards.filter((e) => e.kind === 'board' && e.board.pulseShape === 'card');

  let allCircles: PulseEntity[];
  let allCards: PulseEntity[];
  if (lens) {
    allCircles = [...circleBoards, ...people];
    allCards = [...cardBoards, ...moves];
  } else {
    const pick = (list: PulseEntity[], ids: string[]) =>
      ids.map((id) => list.find((e) => e.kind === 'board' && e.board.id === id)).filter(Boolean) as PulseEntity[];
    const anchorCircles = pick(circleBoards, PULSE_ANCHORS.circles);
    const anchorCards = pick(cardBoards, PULSE_ANCHORS.cards);
    allCircles = [...anchorCircles, ...interleave(people, circleBoards.filter((e) => !anchorCircles.includes(e)))];
    allCards = [...anchorCards, ...interleave(moves, cardBoards.filter((e) => !anchorCards.includes(e)))];
  }

  const pages: PulsePage[] = [];
  const pageCount = Math.min(3, Math.max(1, Math.ceil(Math.max(allCircles.length, allCards.length) / 3)));
  for (let p = 0; p < pageCount; p++) {
    pages.push({ circles: allCircles.slice(p * 3, p * 3 + 3), cards: allCards.slice(p * 3, p * 3 + 3) });
  }
  return pages.filter((pg) => pg.circles.length + pg.cards.length > 0);
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// ─── People ─────────────────────────────────────────────────────────────────

export function rankPeople(s: Signals, opts?: { excludeConnected?: boolean }): RankedPerson[] {
  return rankPeopleCtx(getContext(s), opts);
}

const OPEN_TO_INTENT: Record<string, MatchIntent | undefined> = {
  friends: 'friend',
  travel: 'friend',
  events: 'friend',
  collaboration: 'collaborator',
  networking: 'professional',
  dating: 'romantic',
  casual: 'romantic',
  not_looking: undefined,
};

/** Which "People" filter tabs a person appears under. */
export function intentsFor(u: User): MatchIntent[] {
  const fromRec = repo.recFor(u.id)?.intents ?? [];
  const fromOpenTo = (u.openTo ?? []).map((o) => OPEN_TO_INTENT[o]).filter((x): x is MatchIntent => !!x);
  return [...new Set([...fromRec, ...fromOpenTo])];
}

export function explainMatch(s: Signals, personId: string): MatchExplanation {
  return getContext(s).match(personId);
}

// ─── Boards, Moves, Stories ─────────────────────────────────────────────────

export function suggestBoards(s: Signals, limit = 4): { board: Board; reason: string; reasons: Reason[] }[] {
  return rankBoards(getContext(s), (b) => !s.joined[b.id] && b.ownerId !== repo.meId())
    .slice(0, limit)
    .map((x) => ({ board: x.item, reason: (cardReason(x.reasons) ?? x.reasons[0]).short, reasons: x.reasons }));
}

/** Joined Boards, most relevant (and freshest) first. */
export function rankJoinedBoards(s: Signals): Board[] {
  const ctx = getContext(s);
  return rankBoards(ctx, (b) => !!s.joined[b.id])
    .sort((a, b) => b.parts.freshness - a.parts.freshness || b.score - a.score)
    .map((x) => x.item);
}

export function boardReasons(s: Signals, board: Board): Reason[] {
  return scoreBoard(getContext(s), board).reasons;
}

export function suggestMoves(s: Signals, limit = 4): { move: Move; reason: string; reasons: Reason[] }[] {
  return rankMoves(getContext(s), (m) => !(s.moveState[m.id]?.interested || s.moveState[m.id]?.rsvp))
    .slice(0, limit)
    .map((x) => ({ move: x.item, reason: x.reasons[0].text, reasons: x.reasons }));
}

/** Moves ordered by relevance (used inside each Moves section). */
export function orderMoves(s: Signals, moves: Move[]): Move[] {
  const ctx = getContext(s);
  return moves.map((m) => scoreMove(ctx, m)).sort((a, b) => b.score - a.score).map((x) => x.item);
}

export function rankStoriesFor(s: Signals, filter: (st: Story) => boolean) {
  return rankStories(getContext(s), filter);
}

// ─── Move relevance ("why this is for you") ─────────────────────────────────

export type Relevance = Pick<Reason, 'kind' | 'text' | 'short'>;

/** Why a Move is relevant to this user, strongest first, generated from the graph. */
export function moveRelevance(s: Signals, move: Move): Relevance[] {
  return scoreMove(getContext(s), move).reasons;
}

/**
 * The one reason a card has room for: the most specific kind wins (a loop,
 * someone you know, a strong match) before generic interest.
 */
export function cardReason<R extends Relevance>(reasons: R[]): R | undefined {
  const order: Reason['kind'][] = ['loop', 'people', 'match', 'board', 'saved', 'plan', 'place', 'interest', 'fresh', 'editorial'];
  const top = reasons.slice(0, 3);
  for (const k of order) {
    const hit = top.find((r) => r.kind === k && !(k === 'loop' && r.short === 'Near an Open Loop'));
    if (hit) return hit;
  }
  return reasons[0];
}

export function moveReasons(s: Signals, move: Move): string[] {
  return moveRelevance(s, move).map((x) => x.text).slice(0, 5);
}

// ─── Interests as graph inputs ──────────────────────────────────────────────

/** How much of the graph an interest currently pulls in (for "interest reach"). */
export function interestReach(interestId: string): number {
  return (
    repo.boards().filter((b) => b.interests.includes(interestId)).length +
    repo.moves().filter((m) => m.interests.includes(interestId)).length +
    repo.people().filter((p) => p.interests.includes(interestId)).length
  );
}

/** Interests you care most about right now (for agent/profile copy). */
export function topInterests(s: Signals, n = 4): string[] {
  return Object.entries(s.affinity)
    .filter(([, v]) => v >= AFFINITY.meaningful)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => interestById[id]?.label ?? id);
}

export interface AgentLine {
  id: string;
  text: string;
  href: string;
}
