/**
 * The local Opportunity Graph.
 *
 * Two layers of typed edges:
 *   1. Content edges, built once from seed data (Boards, Moves, people,
 *      Stories, locations, the Board graph).
 *   2. WollyMc's edges, DERIVED from the persisted store (joined, saved,
 *      following, connections, Move state, votes, loops, affinity, activity).
 *      Deriving instead of storing twice means the graph can never drift
 *      from what the screens show.
 *
 * A production graph store can replace this module as long as it answers
 * the same small query API (from / to / has / neighbours).
 */
import { LOCATIONS, locationForCity } from '@/data/locations';
import { ds } from '@/services/dataset';
import type {
  ActivityEvent,
  ChangeEvent,
  ChatMessage,
  Comment,
  Connection,
  EdgeType,
  EntityRef,
  GraphEdge,
  GraphNodeKind,
  MoveState,
  OpenLoop,
  OpenTo,
} from '@/types/models';

import { AFFINITY } from './config';

type Flags = Record<string, true>;

/** Everything the behaviour layer reads. The store's state satisfies it. */
export interface GraphState {
  affinity: Record<string, number>;
  joined: Flags;
  savedBoards: Flags;
  savedPosts: Flags;
  likedPosts: Flags;
  pollVotes: Record<string, string>;
  moveState: Record<string, MoveState>;
  following: Flags;
  connections: Record<string, Connection>;
  blocked: Flags;
  openLoops: OpenLoop[];
  changes: ChangeEvent[];
  activity: ActivityEvent[];
  chats: Record<string, ChatMessage[]>;
  comments: Record<string, Comment[]>;
  openTo: OpenTo[];
  // Phase 4 surfaces
  buzzLikes: Flags;
  buzzDislikes: Flags;
  buzzSaves: Flags;
  buzzReposts: Flags;
  driftLikes: Flags;
  driftSaves: Flags;
  /** Phase 6C: private "not for me" on Drift media (hides it from Buzz → Drift). */
  driftDislikes?: Flags;
  /** Private Crushes (never exposed unless mutual). */
  crushes: Flags;
  /** Your Buzz poll votes (for shared-context starters). */
  buzzVotes: Record<string, string>;
  // Phase 5
  /** Drift items you actually watched in the viewer. */
  driftViews: Flags;
  /** Worlds you've opened at least once. */
  boardVisits: Flags;
  /** Happening nodes you've explored, and the branch currently open. */
  exploredNodes: Flags;
  happeningFocus: string | null;
}

// ─── Node ids ───────────────────────────────────────────────────────────────

/** The signed-in person (DEMO: WollyMc; REAL: your account). Id-independent. */
export const ME_NODE = 'user:me';

export function node(kind: GraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

export function refNode(ref: EntityRef): string {
  if (ref.kind === 'person' && ref.id === ds().me.id) return ME_NODE;
  return node(ref.kind as GraphNodeKind, ref.id);
}

export function idOf(nodeId: string): string {
  return nodeId.slice(nodeId.indexOf(':') + 1);
}

export function kindOf(nodeId: string): GraphNodeKind {
  return nodeId.slice(0, nodeId.indexOf(':')) as GraphNodeKind;
}

// ─── Graph container ────────────────────────────────────────────────────────

export class Graph {
  readonly edges: GraphEdge[];
  private out = new Map<string, GraphEdge[]>();
  private inc = new Map<string, GraphEdge[]>();

  constructor(edges: GraphEdge[]) {
    this.edges = edges;
    for (const e of edges) {
      (this.out.get(e.fromId) ?? this.out.set(e.fromId, []).get(e.fromId)!).push(e);
      (this.inc.get(e.toId) ?? this.inc.set(e.toId, []).get(e.toId)!).push(e);
    }
  }

  from(nodeId: string, type?: EdgeType): GraphEdge[] {
    const list = this.out.get(nodeId) ?? [];
    return type ? list.filter((e) => e.type === type) : list;
  }

  to(nodeId: string, type?: EdgeType): GraphEdge[] {
    const list = this.inc.get(nodeId) ?? [];
    return type ? list.filter((e) => e.type === type) : list;
  }

  edge(fromId: string, type: EdgeType, toId: string): GraphEdge | undefined {
    return this.from(fromId, type).find((e) => e.toId === toId);
  }

  has(fromId: string, type: EdgeType, toId: string): boolean {
    return !!this.edge(fromId, type, toId);
  }

  /** Target ids (without namespace) of outgoing edges of a type. */
  targets(nodeId: string, type: EdgeType, kind?: GraphNodeKind): string[] {
    return this.from(nodeId, type)
      .filter((e) => !kind || kindOf(e.toId) === kind)
      .map((e) => idOf(e.toId));
  }

  /** Source ids (without namespace) of incoming edges of a type. */
  sources(nodeId: string, type: EdgeType, kind?: GraphNodeKind): string[] {
    return this.to(nodeId, type)
      .filter((e) => !kind || kindOf(e.fromId) === kind)
      .map((e) => idOf(e.fromId));
  }
}

// ─── Content edges (built once) ─────────────────────────────────────────────

function edge(fromId: string, type: EdgeType, toId: string, weight = 1, at = 0, metadata?: GraphEdge['metadata']): GraphEdge {
  return { id: `${type}:${fromId}>${toId}`, fromId, toId, type, weight, createdAt: at, updatedAt: at, metadata };
}

const interestWeight = (i: number) => (i < AFFINITY.primaryInterests ? 1 : AFFINITY.secondaryFactor);
const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

let contentEdges: { version: number; edges: GraphEdge[] } | null = null;

/** Content edges for the ACTIVE dataset (rebuilt when it changes). */
export function buildContentEdges(): GraphEdge[] {
  const d = ds();
  if (contentEdges && contentEdges.version === d.version) return contentEdges.edges;
  const ME_ID = d.me.id;
  const out: GraphEdge[] = [];

  for (const b of d.boards) {
    const bn = node('board', b.id);
    const at = time(b.createdAt);
    b.interests.forEach((i, idx) => out.push(edge(bn, 'INTERESTED_IN', node('interest', i), interestWeight(idx), at)));
    if (b.ownerId) out.push(edge(bn, 'CREATED_BY', b.ownerId === ME_ID ? ME_NODE : node('person', b.ownerId), 1, at));
    for (const m of new Set([b.ownerId, ...b.memberPreview])) {
      if (m && m !== ME_ID) out.push(edge(node('person', m), 'MEMBER_OF', bn, m === b.ownerId ? 1 : 0.8, at));
    }
    for (const r of b.relatedBoardIds) out.push(edge(bn, 'RELATED_TO', node('board', r), 1, at));
    if (b.location) out.push(edge(bn, 'LOCATED_IN', node('location', b.location), 1, at));
  }

  for (const p of d.posts) {
    out.push(edge(node('post', p.id), 'RELATED_TO', node('board', p.boardId)));
    out.push(edge(node('post', p.id), 'CREATED_BY', p.authorId === ME_ID ? ME_NODE : node('person', p.authorId)));
  }

  for (const m of d.moves) {
    const mn = node('move', m.id);
    if (m.boardId) out.push(edge(mn, 'RELATED_TO', node('board', m.boardId)));
    m.interests.forEach((i, idx) => out.push(edge(mn, 'INTERESTED_IN', node('interest', i), interestWeight(idx))));
    const loc = locationForCity(m.city);
    if (loc) out.push(edge(mn, 'LOCATED_IN', node('location', loc)));
    out.push(edge(mn, 'CREATED_BY', node('person', m.hostId)));
    for (const a of new Set([m.hostId, ...m.attendeePreview])) out.push(edge(node('person', a), 'INTERESTED_IN', mn, a === m.hostId ? 1 : 0.8));
  }

  for (const u of d.people) {
    const un = node('person', u.id);
    u.interests.forEach((i, idx) => out.push(edge(un, 'INTERESTED_IN', node('interest', i), interestWeight(idx))));
    const loc = locationForCity(u.city);
    if (loc) out.push(edge(un, 'LOCATED_IN', node('location', loc)));
  }
  // Undirected person↔person connections, stored both ways.
  const seen = new Set<string>();
  for (const [a, list] of Object.entries(d.peopleConnections)) {
    for (const b of list) {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const k = `${x}>${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(edge(node('person', x), 'CONNECTED_TO', node('person', y)));
      }
    }
  }
  for (const f of d.followsMe) out.push(edge(node('person', f), 'FOLLOWS', ME_NODE));

  for (const s of d.stories) {
    const sn = node('story', s.id);
    out.push(edge(sn, 'RELATED_TO', refNode(s.owner)));
    for (const a of new Set(s.items.map((i) => i.authorId))) out.push(edge(sn, 'CREATED_BY', a === ME_ID ? ME_NODE : node('person', a)));
  }

  // Buzz and Drift always belong to a World (and a creator).
  for (const b of d.buzz) {
    out.push(edge(node('buzz', b.id), 'RELATED_TO', node('board', b.boardId)));
    if (b.authorId) out.push(edge(node('buzz', b.id), 'CREATED_BY', b.authorId === ME_ID ? ME_NODE : node('person', b.authorId)));
  }
  for (const x of d.drift) {
    out.push(edge(node('drift', x.id), 'RELATED_TO', node('board', x.boardId)));
    out.push(edge(node('drift', x.id), 'CREATED_BY', x.authorId === ME_ID ? ME_NODE : node('person', x.authorId)));
  }

  for (const l of LOCATIONS) {
    const ln = node('location', l.id);
    if (l.parentId) out.push(edge(ln, 'LOCATED_IN', node('location', l.parentId)));
    if (l.interestId) out.push(edge(ln, 'RELATED_TO', node('interest', l.interestId)));
  }

  contentEdges = { version: d.version, edges: out };
  return out;
}

// ─── WollyMc's edges (derived from state) ───────────────────────────────────

/** First/last time of any activity on a ref, from the activity log. */
function activityTimes(activity: ActivityEvent[]) {
  const map = new Map<string, { first: number; last: number; views: number; types: Set<string> }>();
  for (const a of activity) {
    const k = refNode(a.ref);
    const cur = map.get(k) ?? { first: a.at, last: a.at, views: 0, types: new Set<string>() };
    cur.first = Math.min(cur.first, a.at);
    cur.last = Math.max(cur.last, a.at);
    if (a.type === 'open' || a.type === 'storyView') cur.views += 1;
    cur.types.add(a.type);
    map.set(k, cur);
  }
  return map;
}

export function buildUserEdges(s: GraphState): GraphEdge[] {
  const out: GraphEdge[] = [];
  const times = activityTimes(s.activity);
  const mine = (type: EdgeType, target: string, weight = 1, metadata?: GraphEdge['metadata']) => {
    const t = times.get(target);
    out.push(edge(ME_NODE, type, target, weight, t?.first ?? 0, metadata));
    if (t) out[out.length - 1].updatedAt = t.last;
  };

  for (const id of Object.keys(s.joined)) mine('JOINED', node('board', id));
  for (const id of Object.keys(s.savedBoards)) mine('SAVED', node('board', id));
  for (const id of Object.keys(s.savedPosts)) mine('SAVED', node('post', id));
  for (const id of Object.keys(s.likedPosts)) mine('LIKED', node('post', id));
  for (const [id, option] of Object.entries(s.pollVotes)) mine('VOTED', node('post', id), 1, { option });
  for (const [id, list] of Object.entries(s.comments)) {
    if (list.some((c) => c.authorId === ds().me.id)) mine('RELATED_TO', node('post', id), 0.6, { commented: true });
  }
  for (const [id, st] of Object.entries(s.moveState)) {
    if (st.rsvp) mine('RSVPED', node('move', id));
    if (st.interested) mine('INTERESTED_IN', node('move', id), 0.8);
    if (st.saved) mine('SAVED', node('move', id), 0.7);
  }
  for (const id of Object.keys(s.buzzLikes)) mine('LIKED', node('buzz', id));
  for (const id of Object.keys(s.buzzDislikes)) mine('DISLIKED', node('buzz', id), -1);
  for (const id of Object.keys(s.buzzSaves)) mine('SAVED', node('buzz', id));
  for (const id of Object.keys(s.buzzReposts)) mine('REPOSTED', node('buzz', id));
  for (const id of Object.keys(s.driftLikes)) mine('LIKED', node('drift', id));
  for (const id of Object.keys(s.driftSaves)) mine('SAVED', node('drift', id));
  for (const id of Object.keys(s.crushes)) mine('CRUSH_ON', node('person', id), 1, { private: true });
  for (const id of Object.keys(s.following)) mine('FOLLOWS', node('person', id));
  for (const [id, c] of Object.entries(s.connections)) {
    const at = time(c.since);
    out.push(edge(ME_NODE, 'CONNECTED_TO', node('person', id), 1, at));
  }
  for (const [i, w] of Object.entries(s.affinity)) {
    if (w > 0) out.push(edge(ME_NODE, 'INTERESTED_IN', node('interest', i), w));
  }
  for (const l of s.openLoops) {
    const ln = node('loop', l.id);
    const at = time(l.createdAt);
    out.push(edge(ln, 'CREATED_BY', ME_NODE, 1, at, { status: l.status }));
    if (l.status === 'resolved') out.push(edge(ME_NODE, 'RESOLVES', ln, 1, at));
    for (const r of l.related) out.push(edge(refNode(r), 'SUPPORTS', ln, 1, at));
    l.interests.forEach((i, idx) => out.push(edge(ln, 'INTERESTED_IN', node('interest', i), interestWeight(idx), at)));
  }
  // Views: weight grows with repeat visits (log-ish, capped).
  for (const [target, t] of times) {
    if (t.views > 0 && target !== ME_NODE) {
      out.push({ ...edge(ME_NODE, 'VIEWED', target, Math.min(1, 0.2 + t.views * 0.2), t.first), updatedAt: t.last, metadata: { count: t.views } });
    }
  }
  return out;
}

export function buildGraph(s: GraphState): Graph {
  return new Graph([...buildContentEdges(), ...buildUserEdges(s)]);
}

/** Adds MATCHED_WITH edges once match scores are known (Graph Debug). */
export function withMatches(g: Graph, matches: { personId: string; score: number }[], strongAt: number): Graph {
  const extra = matches
    .filter((m) => m.score >= strongAt)
    .map((m) => edge(ME_NODE, 'MATCHED_WITH', node('person', m.personId), m.score / 100));
  return new Graph([...g.edges, ...extra]);
}
