/**
 * Happening (Phase 5, lane layout Phase 6B): a horizontal, left-to-right
 * interest graph.
 *
 * Not a hub: there is no centre object. Each World (interest) owns a LANE — an
 * exclusive horizontal band of the canvas. Inside its lane a World sits on
 * the top or bottom row (alternating, so the graph still zig-zags) and its
 * supporting nodes sit on the opposite row of the SAME lane. Opening a World
 * widens only its own lane with up to 4 branches per column (max 2 columns);
 * everything to the right moves over. Because nothing is ever placed outside
 * its lane, nodes and labels can't collide across Worlds. Lane widths come
 * from estimated label widths, not fixed spacing. No physics.
 *
 * Layout is fully deterministic.
 * Strength, badges and "why" all come from the one Opportunity Graph
 * (affinity, scoreBoard/scoreMove/scoreBuzz, explainPerson, World Delta).
 * After Dark / nightlife never appears (isNightRef on every node).
 */
import { HAPPENING_START_BETWEEN, HAPPENING_WORLDS, type HappeningWorldDef } from '@/data/happening';
import { WORLD_CATALOG } from '@/data/worldCatalog';
import { isRealMode } from '@/services/dataset';
import { interestById } from '@/data/interests';
import { repo } from '@/services/repository';
import type { EntityRef, HappeningItem, ImageSrc } from '@/types/models';
import { compact } from '@/utils/format';
import { AFFINITY, HAPPENING_GRAPH } from './config';
import { type GraphContext, clamp01, first, interestPart, interestReason, scoreBoard, scoreMove } from './relevance';
import { buildHappening, dayOnly, isNightRef, negativeFeedback, scoreBuzz } from './surfaces';
import { freshCount } from './touch';

export type HNodeKind = 'world' | 'board' | 'person' | 'move' | 'buzz';

export interface HNode {
  id: string;
  kind: HNodeKind;
  /** major = a World; minor = supporting node on the chain; child = revealed by exploring. */
  tier: 'major' | 'minor' | 'child';
  worldId: string;
  label: string;
  /** "8.4K planning", "92% match", "Apr 12 · Tokyo". */
  meta?: string;
  image?: ImageSrc;
  /** Where "Open" goes. Worlds open their anchor Board. */
  ref: EntityRef;
  interests: string[];
  x: number;
  y: number;
  d: number;
  /** 0..100 from the Opportunity Graph. */
  strength: number;
  /** Relevant items + unseen changes in the branch. */
  badge: number;
  /** A person worth showing on the node (followed, connected or a strong match). */
  avatarOf?: string;
  why: string[];
}

export interface HEdge {
  id: string;
  from: string;
  to: string;
  kind: 'chain' | 'branch';
}

export interface HappeningGraph {
  nodes: HNode[];
  edges: HEdge[];
  width: number;
  height: number;
  /** Open branch (persisted as happeningFocus). */
  focus: string | null;
  /** x the viewport should centre on (the start, or the open branch). */
  centreX: number;
  /** Phase 6B: left edge of every lane (scroll snaps here, so no World sits half off-screen on the left). */
  laneStarts: number[];
  /** Phase 6C: the World in each lane (same order as laneStarts). */
  laneWorlds: string[];
}

// Lane layout (pt). Two rows; Worlds alternate top / bottom inside their lane.
const PAD = 16; // canvas left padding (first lane never touches the edge)
const TOP = 104;
const BOTTOM = 298;
export const HAPPENING_CANVAS_HEIGHT = 436;
/** Max branches per column when a World is open, and max columns. */
const KIDS_PER_COL = 4;
const MAX_KID_COLS = 2;
const KID_SLOTS = [62, 162, 262, 362];
/** Rough text width (pt) for a label at a font size — enough to size lanes deterministically. */
export const textWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.56);
/** Label box widths (the Node component renders labels at these widths). */
export const LABEL_W = { major: 132, minor: 92, child: 112 } as const;
const GAP = 14; // min space between boxes

const strengthD = (s: number, r: { min: number; max: number }) => Math.round(r.min + ((r.max - r.min) * clamp01(s / 100)));

function refLabel(ref: EntityRef): string {
  if (ref.kind === 'person') return first(ref.id);
  if (ref.kind === 'buzz') {
    const b = repo.buzzItem(ref.id);
    return b?.news?.headline ?? b?.title ?? repo.board(b?.boardId ?? '')?.title ?? 'Buzz';
  }
  return repo.labelFor(ref);
}

function refImage(ref: EntityRef): ImageSrc | undefined {
  if (ref.kind === 'board') return repo.board(ref.id)?.cover;
  return repo.imageFor(ref);
}

/** Strength + meta + why for one branch node, from the shared scorers. */
function describeRef(ctx: GraphContext, ref: EntityRef): { strength: number; meta?: string; why: string[] } {
  switch (ref.kind) {
    case 'board': {
      const b = repo.board(ref.id);
      if (!b) return { strength: 0, why: [] };
      const sc = scoreBoard(ctx, b);
      return { strength: sc.score, meta: `${compact(b.memberCount)} ${b.activityVerb}`, why: sc.reasons.filter((r) => r.kind !== 'editorial').map((r) => r.text) };
    }
    case 'move': {
      const mv = repo.move(ref.id);
      if (!mv) return { strength: 0, why: [] };
      const sc = scoreMove(ctx, mv);
      return { strength: sc.score, meta: `${mv.dateLabel} · ${mv.city}`, why: sc.reasons.filter((r) => r.kind !== 'editorial').map((r) => r.text) };
    }
    case 'person': {
      const mt = ctx.match(ref.id);
      return { strength: mt.matchScore, meta: `${mt.matchScore}% match · ${repo.user(ref.id)?.city ?? ''}`, why: mt.matchReasons.map((r) => r.label) };
    }
    case 'buzz': {
      const bz = repo.buzzItem(ref.id);
      if (!bz) return { strength: 0, why: [] };
      const sc = scoreBuzz(ctx, bz);
      return { strength: sc.score, meta: `Buzz in ${repo.board(bz.boardId)?.title ?? 'a World'}`, why: sc.reasons.filter((r) => r.kind !== 'editorial').map((r) => r.text) };
    }
    default:
      return { strength: 0, why: [] };
  }
}

const visibleRef = (ctx: GraphContext, ref: EntityRef) => {
  if (isNightRef(ref)) return false;
  if (ref.kind === 'person') return !ctx.s.blocked[ref.id] && !!repo.user(ref.id);
  if (ref.kind === 'board') return !!repo.board(ref.id);
  if (ref.kind === 'move') return !!repo.move(ref.id);
  if (ref.kind === 'buzz') return !!repo.buzzItem(ref.id);
  return false;
};

const refKey = (r: EntityRef) => `${r.kind}:${r.id}`;

/** A World's strength: affinity, your evidence in its branch, minus dislikes. */
function worldStrength(ctx: GraphContext, w: HappeningWorldDef): { strength: number; why: string[]; evidence: string[] } {
  const { s } = ctx;
  const neg = negativeFeedback(ctx);
  const affs = w.interests.map((i) => s.affinity[i] ?? 0);
  const top = Math.max(0, ...affs);
  const avg = affs.reduce((a, b) => a + b, 0) / Math.max(1, affs.length);
  const evidence: string[] = [];
  const seen = new Set<string>();
  for (const ref of [{ kind: 'board', id: w.anchor } as EntityRef, ...(w.strong ? [w.strong] : []), ...w.branches]) {
    if (seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    if (!visibleRef(ctx, ref) || evidence.length >= 3) continue;
    if (ref.kind === 'board') {
      const title = repo.board(ref.id)?.title;
      if (s.joined[ref.id]) evidence.push(`You joined ${title}`);
      else if (s.savedBoards[ref.id]) evidence.push(`You saved ${title}`);
      else if (s.boardVisits[ref.id] || Object.keys(s.savedPosts).some((pid) => repo.post(pid)?.boardId === ref.id)) evidence.push(`You’ve been active in ${title}`);
    } else if (ref.kind === 'person' && (s.following[ref.id] || s.connections[ref.id])) {
      evidence.push(`You ${s.connections[ref.id] ? 'are connected with' : 'follow'} ${first(ref.id)}`);
    } else if (ref.kind === 'move') {
      const st = s.moveState[ref.id];
      if (st?.interested || st?.rsvp || st?.saved) evidence.push(`You’re into ${repo.move(ref.id)?.title}`);
    }
  }
  const negHits = w.interests.reduce((a, i) => a + (neg.interests[i] ?? 0), 0);
  const strength = Math.max(0, Math.min(100, 100 * (0.75 * top + 0.25 * avg) + evidence.length * 8 - negHits * 6));
  const why = dayOnly([
    ...interestReason(s, w.interests, interestPart(s, w.interests)).map((r) => r.text),
    ...evidence,
    ...(negHits ? [`Toned down: you asked for less ${w.label.toLowerCase()} content`] : []),
  ]);
  return { strength: Math.round(strength * 10) / 10, why: why.length ? why : [`One of your interests: ${w.interests.map((i) => interestById[i]?.label).filter(Boolean).join(', ')}`], evidence };
}

function inBranch(w: HappeningWorldDef, ref: EntityRef): boolean {
  const keys = new Set([`board:${w.anchor}`, ...(w.strong ? [refKey(w.strong)] : []), ...w.branches.map(refKey)]);
  if (keys.has(refKey(ref))) return true;
  if (ref.kind === 'move') return !!repo.move(ref.id)?.boardId && keys.has(`board:${repo.move(ref.id)!.boardId}`);
  return false;
}

let cache: { ctx: GraphContext; focus: string | null; g: HappeningGraph } | null = null;

/**
 * Which Worlds the graph runs across.
 *   DEMO: WollyMc's seeded shape (data/happening.ts).
 *   REAL: built from YOUR interests (onboarding seeds them; the graph keeps
 *         learning). Each interest you lean towards becomes a World from
 *         Chimp's catalog; its branches are real Worlds (e.g. a "Niagara Falls
 *         Trip" you made under Travel), real people and real Buzz — never
 *         seeded ones. Strongest World sits in the middle of the canvas.
 */
export function happeningWorlds(ctx: GraphContext): { worlds: HappeningWorldDef[]; startBetween: [string, string] } {
  if (!isRealMode()) return { worlds: HAPPENING_WORLDS, startBetween: HAPPENING_START_BETWEEN };
  const { s } = ctx;
  const catalogIds = new Set(WORLD_CATALOG.map((w) => w.id));
  const ranked = WORLD_CATALOG.map((w, order) => ({ w, order, aff: s.affinity[w.interests[0]] ?? 0 }))
    .filter((x) => x.aff >= REAL_WORLD_MIN && repo.board(x.w.id))
    .sort((a, b) => b.aff - a.aff || a.order - b.order)
    .slice(0, 8);
  const defs = ranked.map(({ w }): HappeningWorldDef => {
    const primary = w.interests[0];
    const subWorlds = repo
      .boards()
      .filter((b) => !catalogIds.has(b.id) && b.interests.includes(primary) && !isNightRef({ kind: 'board', id: b.id }))
      .map((b) => ({ b, sc: scoreBoard(ctx, b).score }))
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 3)
      .map(({ b }) => ({ kind: 'board', id: b.id }) as EntityRef);
    const inWorld = new Set([w.id, ...subWorlds.map((r) => r.id)]);
    const content = repo.buzz().filter((z) => inWorld.has(z.boardId));
    const person = content.find((z) => z.authorId && !repo.isMe(z.authorId) && !s.blocked[z.authorId])?.authorId;
    const buzz = [...content].sort((a, b) => a.ageHours - b.ageHours)[0];
    const branches: EntityRef[] = [...subWorlds, ...(person ? [{ kind: 'person', id: person } as EntityRef] : []), ...(buzz ? [{ kind: 'buzz', id: buzz.id } as EntityRef] : [])];
    return { id: `h_${w.id}`, label: w.title, interests: w.interests, anchor: w.id, strong: subWorlds[0], branches, anchorIsWorld: true };
  });
  // Strongest in the middle, the rest alternating out to both edges.
  const laid: HappeningWorldDef[] = [];
  defs.forEach((d, i) => (i % 2 === 0 ? laid.push(d) : laid.unshift(d)));
  const a = defs[0]?.id ?? '';
  const b = defs[1]?.id ?? a;
  return { worlds: laid, startBetween: [b, a] };
}

/** A catalog World joins your REAL graph once its interest reaches this affinity. */
export const REAL_WORLD_MIN = 0.25;

export function buildHappeningGraph(ctx: GraphContext, focus: string | null = ctx.s.happeningFocus ?? null): HappeningGraph {
  if (cache && cache.ctx === ctx && cache.focus === focus) return cache.g;
  const { s } = ctx;
  const items: HappeningItem[] = buildHappening(ctx);
  const source = happeningWorlds(ctx);
  const worlds = source.worlds.filter((w) => !w.interests.some((i) => interestById[i]?.category === 'afterDark') && visibleRef(ctx, { kind: 'board', id: w.anchor }));
  const focusIdx = worlds.findIndex((w) => w.id === focus);

  const nodes: HNode[] = [];
  const edges: HEdge[] = [];
  const addEdge = (from: string, to: string, kind: HEdge['kind']) => edges.push({ id: `${from}>${to}`, from, to, kind });
  const laneStarts: number[] = [];
  const laneWorlds: string[] = [];
  let laneX = PAD;

  worlds.forEach((w, i) => {
    const anchor = repo.board(w.anchor);
    if (!anchor) return; // hardening: a World whose anchor vanished is skipped
    const top = i % 2 === 0;
    const y = top ? TOP : BOTTOM;
    const otherY = top ? BOTTOM : TOP;
    const ws = worldStrength(ctx, w);
    const branchRefs = [...(w.anchorIsWorld ? [] : [{ kind: 'board', id: w.anchor } as EntityRef]), ...(w.strong ? [w.strong] : []), ...w.branches]
      .filter((r, k, all) => all.findIndex((x) => refKey(x) === refKey(r)) === k)
      .filter((r) => visibleRef(ctx, r));
    const people = branchRefs.filter((r) => r.kind === 'person').map((r) => r.id);
    const avatarOf =
      people.find((id) => s.following[id] || s.connections[id]) ??
      anchor.memberPreview.find((id) => (s.following[id] || s.connections[id]) && !s.blocked[id]) ??
      people.find((id) => ctx.match(id).matchScore >= 70);
    const fresh = branchRefs.reduce((a, r) => a + freshCount(s.changes, r), 0);
    const relevant = items.filter((it) => inBranch(w, it.ref)).length;
    const expanded = focusIdx === i;
    const d = strengthD(ws.strength, HAPPENING_GRAPH.major);

    // Lane width: the World's own box, or the supporting nodes side by side, whichever is wider.
    const worldBox = Math.max(d * 1.1, LABEL_W.major);
    const supportBox = 2 * LABEL_W.minor + GAP;
    const baseW = Math.max(worldBox, supportBox, textWidth(w.label, 16) + 24) + GAP * 2;
    const kids = expanded
      ? branchRefs
          .map((r) => ({ r, st: describeRef(ctx, r).strength }))
          .sort((a, b) => b.st - a.st)
          .slice(0, KIDS_PER_COL * MAX_KID_COLS)
          .map((k) => k.r)
      : [];
    const kidCols = Math.ceil(kids.length / KIDS_PER_COL);
    const laneW = baseW + kidCols * (LABEL_W.child + GAP);
    laneStarts.push(laneX);
    laneWorlds.push(w.id);
    const x = laneX + baseW / 2;

    nodes.push({
      id: w.id,
      kind: 'world',
      tier: 'major',
      worldId: w.id,
      label: w.label,
      meta: anchor.memberCount > 0 ? `${compact(anchor.memberCount)} ${anchor.activityVerb}` : 'Just getting started',
      image: anchor.cover,
      ref: { kind: 'board', id: w.anchor },
      interests: w.interests,
      x,
      y,
      d,
      strength: ws.strength,
      badge: fresh + relevant,
      avatarOf,
      why: ws.why.slice(0, 3),
    });

    const childRef = (ref: EntityRef, tier: HNode['tier'], cx: number, cy: number, dd: number): HNode => {
      const desc = describeRef(ctx, ref);
      return {
        id: `${w.id}/${refKey(ref)}`,
        kind: ref.kind as HNodeKind,
        tier,
        worldId: w.id,
        label: refLabel(ref),
        meta: desc.meta,
        image: refImage(ref),
        ref,
        interests: ref.kind === 'board' ? repo.board(ref.id)?.interests ?? [] : w.interests,
        x: cx,
        y: cy,
        d: dd,
        strength: Math.round(desc.strength * 10) / 10,
        badge: freshCount(s.changes, ref),
        why: dayOnly(desc.why).slice(0, 3),
      };
    };

    if (expanded) {
      // Branch columns to the right of the World, inside this lane; strongest first, top to bottom.
      kids.forEach((r, k) => {
        const col = Math.floor(k / KIDS_PER_COL);
        const row = k % KIDS_PER_COL;
        const perCol = Math.min(KIDS_PER_COL, kids.length - col * KIDS_PER_COL);
        // Few branches: spread them over the middle slots.
        const slot = perCol === 1 ? 1.5 : perCol === 2 ? [1, 2][row] : perCol === 3 ? [0.5, 1.5, 2.5][row] : row;
        const cy = KID_SLOTS[0] + (KID_SLOTS[1] - KID_SLOTS[0]) * slot;
        const cx = laneX + baseW + GAP / 2 + col * (LABEL_W.child + GAP) + LABEL_W.child / 2;
        const n = childRef(r, 'child', cx, cy, HAPPENING_GRAPH.child);
        nodes.push(n);
        addEdge(w.id, n.id, 'branch');
      });
    } else {
      // Supporting nodes on the opposite row of the same lane: the chain node, and a
      // second one when your graph leans this way ("strong").
      const support: EntityRef[] = [];
      if (branchRefs[0]) support.push(branchRefs[0]);
      if (ws.strength >= HAPPENING_GRAPH.strongAt && w.strong && visibleRef(ctx, w.strong) && !support.some((r) => refKey(r) === refKey(w.strong!))) support.push(w.strong);
      support.forEach((r, k) => {
        const cx = support.length === 1 ? x : x + (k === 0 ? -1 : 1) * (LABEL_W.minor + GAP) / 2;
        const n = childRef(r, 'minor', cx, otherY, 0);
        n.d = strengthD(n.strength, HAPPENING_GRAPH.minor);
        nodes.push(n);
        addEdge(w.id, n.id, k === 0 ? 'chain' : 'branch');
      });
    }
    laneX += laneW;
  });

  // Chain links: World → its supporting node → next World (or from the open branch nearest the next World).
  const placed = worlds.filter((w) => nodes.some((n) => n.id === w.id));
  placed.forEach((w, i) => {
    const next = placed[i + 1];
    if (!next) return;
    const nextNode = nodes.find((n) => n.id === next.id);
    const minor = nodes.find((n) => n.worldId === w.id && n.tier === 'minor');
    const kids = nodes.filter((n) => n.worldId === w.id && n.tier === 'child');
    const handoff = kids.length && nextNode ? kids.reduce((a, b) => (Math.abs(b.y - nextNode.y) < Math.abs(a.y - nextNode.y) ? b : a)) : undefined;
    addEdge(handoff ? handoff.id : minor ? minor.id : w.id, next.id, 'chain');
  });

  const width = Math.round(laneX + PAD);
  const [aId, bId] = source.startBetween;
  const a = nodes.find((n) => n.id === aId);
  const b = nodes.find((n) => n.id === bId);
  const f = nodes.find((n) => n.id === focus);
  const centreX = f ? f.x + (LABEL_W.child + GAP) / 2 + 40 : a && b ? (a.x + b.x) / 2 : width / 2;

  const g: HappeningGraph = { nodes, edges, width, height: HAPPENING_CANVAS_HEIGHT, focus: focusIdx >= 0 ? focus : null, centreX, laneStarts, laneWorlds };
  cache = { ctx, focus, g };
  return g;
}

/** Is an interest meaningfully part of your graph? (for "why" copy elsewhere) */
export const meaningful = (ctx: GraphContext, i: string) => (ctx.s.affinity[i] ?? 0) >= AFFINITY.meaningful;

// ─── Phase 6C: the endless, cyclic canvas ───────────────────────────────────
//
// The graph holds each World ONCE. To make it feel endless, the canvas shows
// the logical graph with a copy of its last lanes before it and a copy of its
// first lanes after it (about two screens each, never whole extra graphs), and
// a link from the last World back to the first. When a scroll settles in one
// of those copies, the view jumps by exactly one cycle to the identical spot
// in the main copy, so nothing visibly moves. Lanes are never re-laid out, so
// the lane spacing (no collisions) holds across the seam as well.

export interface CanvasNode extends HNode {
  /** Unique per copy ("-1:w_travel", "0:w_travel", "1:w_travel"). */
  key: string;
  copy: -1 | 0 | 1;
}

export interface CanvasEdge extends HEdge {
  key: string;
  fromKey: string;
  toKey: string;
  /** The link from the last World back to the first (the seam). */
  wrap?: boolean;
}

export interface CyclicCanvas {
  cyclic: boolean;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  /** Width of one full cycle (all lanes once). 0 when not cyclic. */
  cycle: number;
  /** x of the main copy's first lane on the canvas. */
  mainStart: number;
  /** Where the main copy is shifted to (node.x + shift). */
  shift: number;
  snaps: number[];
}

const keyOf = (copy: number, id: string) => `${copy}:${id}`;

/** Too few Worlds, or a graph narrower than ~1.25 screens, stays a plain (finite) canvas. */
export function cyclicCanvas(g: HappeningGraph, viewW: number): CyclicCanvas {
  const lanes = g.laneStarts.length;
  const lanesEnd = g.width - PAD;
  const cycle = lanesEnd - PAD;
  const laneOfWorld = new Map(g.laneWorlds.map((w, i) => [w, i]));
  const laneEnd = (i: number) => (i + 1 < lanes ? g.laneStarts[i + 1] : lanesEnd);
  const snapsFor = (starts: number[], width: number) => {
    const maxX = Math.max(0, width - viewW);
    return [...new Set([...starts.map((x) => Math.min(maxX, Math.max(0, x - 16))), maxX])].sort((a, b) => a - b);
  };

  if (lanes < 3 || cycle < viewW * 1.25) {
    return {
      cyclic: false,
      nodes: g.nodes.map((n) => ({ ...n, key: keyOf(0, n.id), copy: 0 })),
      edges: g.edges.map((e) => ({ ...e, key: keyOf(0, e.id), fromKey: keyOf(0, e.from), toKey: keyOf(0, e.to) })),
      width: g.width,
      cycle: 0,
      mainStart: PAD,
      shift: 0,
      snaps: snapsFor(g.laneStarts, g.width),
    };
  }

  // About three screens of copied lanes on each side: room for a long fling before recentering.
  const extra = viewW * 3;
  const head = g.laneStarts.map((_, i) => i).filter((i) => g.laneStarts[i] - PAD < extra);
  const tail = g.laneStarts.map((_, i) => i).filter((i) => laneEnd(i) > lanesEnd - extra);
  const prefix = lanesEnd - Math.min(...tail.map((i) => g.laneStarts[i]));
  const headW = Math.max(...head.map(laneEnd)) - PAD;
  const shift = prefix;
  const offsets: Record<-1 | 0 | 1, number> = { [-1]: shift - cycle, 0: shift, 1: shift + cycle };
  const lanesIn: Record<-1 | 0 | 1, Set<number>> = { [-1]: new Set(tail), 0: new Set(g.laneStarts.map((_, i) => i)), 1: new Set(head) };

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const copy of [-1, 0, 1] as const) {
    const has = (n: HNode) => lanesIn[copy].has(laneOfWorld.get(n.worldId) ?? -1);
    for (const n of g.nodes) if (has(n)) nodes.push({ ...n, x: n.x + offsets[copy], key: keyOf(copy, n.id), copy });
    for (const e of g.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (a && b && has(a) && has(b)) edges.push({ ...e, key: keyOf(copy, e.id), fromKey: keyOf(copy, e.from), toKey: keyOf(copy, e.to) });
    }
  }

  // The seam: last World (from its supporting / branch node nearest the first World) → first World, one cycle later.
  const firstW = g.laneWorlds[0];
  const lastW = g.laneWorlds[lanes - 1];
  const firstNode = byId.get(firstW);
  const lastKids = g.nodes.filter((n) => n.worldId === lastW && n.tier !== 'major');
  const handoff = firstNode && lastKids.length ? lastKids.reduce((a, b) => (Math.abs(b.y - firstNode.y) < Math.abs(a.y - firstNode.y) ? b : a)) : byId.get(lastW);
  if (firstNode && handoff) {
    for (const copy of [-1, 0] as const) {
      const next = (copy + 1) as 0 | 1;
      if (!lanesIn[copy].has(lanes - 1) || !lanesIn[next].has(0)) continue;
      const id = `${handoff.id}>${firstW}~wrap`;
      edges.push({ id, from: handoff.id, to: firstW, kind: 'chain', key: keyOf(copy, id), fromKey: keyOf(copy, handoff.id), toKey: keyOf(next, firstW), wrap: true });
    }
  }

  const width = Math.round(shift + lanesEnd + headW + PAD);
  const starts = [...tail.map((i) => g.laneStarts[i] + offsets[-1]), ...g.laneStarts.map((x) => x + offsets[0]), ...head.map((i) => g.laneStarts[i] + offsets[1])];
  return { cyclic: true, nodes, edges, width, cycle, mainStart: PAD + shift, shift, snaps: snapsFor(starts, width) };
}

/**
 * Where to jump after a scroll settles (or null to stay): when the middle of
 * the view is inside a copy, move by exactly one cycle into the main copy.
 */
export function recenterX(c: CyclicCanvas, x: number, viewW: number): number | null {
  if (!c.cyclic) return null;
  const mid = x + viewW / 2;
  if (mid < c.mainStart) return x + c.cycle;
  if (mid > c.mainStart + c.cycle) return x - c.cycle;
  return null;
}

