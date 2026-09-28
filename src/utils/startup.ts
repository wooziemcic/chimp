/**
 * Phase 6C: development-only startup timeline. Every stage logs the time since
 * the JS bundle started, so a slow launch shows exactly which step it was:
 *
 *   [chimp:startup] +212ms  store hydrated
 *   [chimp:startup] +240ms  session known (REAL)
 *   [chimp:startup] +251ms  cached world shown (Buzz can render)
 *   [chimp:startup] +902ms  fresh world loaded
 */
const t0 = Date.now();
const seen = new Set<string>();

export function startupMark(stage: string, extra?: string) {
  if (!__DEV__) return;
  // Each stage once per launch (re-entries after sign-in etc. are not "startup").
  if (seen.has(stage)) return;
  seen.add(stage);
  console.log(`[chimp:startup] +${Date.now() - t0}ms  ${stage}${extra ? `  (${extra})` : ''}`);
}

/** Run `fn` once the first screen has had a chance to paint (idle callback when available). */
export function afterFirstPaint(fn: () => void, maxWaitMs = 1200): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (g.requestIdleCallback) {
    const h = g.requestIdleCallback(fn, { timeout: maxWaitMs });
    return () => g.cancelIdleCallback?.(h);
  }
  const t = setTimeout(fn, Math.min(600, maxWaitMs));
  return () => clearTimeout(t);
}
