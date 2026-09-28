import { type Href, router } from 'expo-router';

/**
 * Phase 6B: push a route at most once per quick burst of taps. Rapid double
 * taps (or a tap that lands during a transition) must not stack the same
 * screen twice — Back should always return exactly once.
 */
let last = { key: '', at: 0 };
export function pushOnce(href: string | Href) {
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (last.key === key && now - last.at < 900) return;
  last = { key, at: now };
  router.push(href as Href);
}
