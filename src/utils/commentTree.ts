/**
 * Phase 9.2: threaded comments, flattened for a list.
 *
 * Comments carry an optional parentId. This turns them into rows in reading
 * order (each comment, then its replies, depth-first, oldest first) with a
 * visual depth that stops at `maxDepth` so deep threads don't run off a
 * phone screen (deeper replies sit at the last level and say who they
 * answer). A collapsed comment hides everything under it. A reply whose
 * parent isn't there (deleted) shows as a top-level comment.
 */
export interface Threadable {
  id: string;
  parentId?: string;
}

export interface ThreadRow<T extends Threadable> {
  item: T;
  /** 0 = top-level; never more than maxDepth. */
  depth: number;
  /** How many replies sit under this one (all levels). */
  replies: number;
  /** Set when the visual depth was capped: the comment it answers. */
  replyTo?: T;
}

export const MAX_THREAD_DEPTH = 2;

export function threadRows<T extends Threadable>(items: T[], collapsed: Record<string, boolean> = {}, maxDepth = MAX_THREAD_DEPTH): ThreadRow<T>[] {
  const byId = new Map(items.map((c) => [c.id, c]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const c of items) {
    if (c.parentId && c.parentId !== c.id && byId.has(c.parentId)) {
      const list = children.get(c.parentId);
      if (list) list.push(c);
      else children.set(c.parentId, [c]);
    } else roots.push(c);
  }
  const count = new Map<string, number>();
  const seen = new Set<string>();
  const total = (c: T): number => {
    const known = count.get(c.id);
    if (known !== undefined) return known;
    if (seen.has(c.id)) return 0; // (a cycle can't come from the server; never loop on bad local data)
    seen.add(c.id);
    const n = (children.get(c.id) ?? []).reduce((a, k) => a + 1 + total(k), 0);
    count.set(c.id, n);
    return n;
  };
  const out: ThreadRow<T>[] = [];
  const placed = new Set<string>();
  const walk = (c: T, depth: number, parent?: T) => {
    if (placed.has(c.id)) return;
    placed.add(c.id);
    out.push({ item: c, depth: Math.min(depth, maxDepth), replies: total(c), ...(depth > maxDepth && parent ? { replyTo: parent } : {}) });
    if (collapsed[c.id]) {
      hide(c);
      return;
    }
    for (const k of children.get(c.id) ?? []) walk(k, depth + 1, c);
  };
  // Everything under a collapsed comment stays hidden (and isn't picked up below).
  const hide = (c: T) => {
    for (const k of children.get(c.id) ?? []) {
      if (placed.has(k.id)) continue;
      placed.add(k.id);
      hide(k);
    }
  };
  for (const r of roots) walk(r, 0);
  // Anything left (only possible with a broken parent chain) still shows.
  for (const c of items) if (!placed.has(c.id)) walk(c, 0);
  return out;
}

/** Collapse / expand one thread. */
export const toggleThread = (collapsed: Record<string, boolean>, id: string): Record<string, boolean> => {
  const next = { ...collapsed };
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
};
