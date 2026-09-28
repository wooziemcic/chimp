/** 8400 → "8.4K", 12400 → "12K", 1200 → "1.2K", 342 → "342". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${trim(n / 1000)}K`;
  return `${n}`;
}

function trim(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

export function timeAgo(at: number, now = Date.now()): string {
  const m = Math.max(1, Math.round((now - at) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function firstName(name: string): string {
  return name.split(' ')[0];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Phase 6B: human timestamps for posts, replies, comments and chat.
 *   < 1 min → "Just now" · < 1 h → "5m" · same day / < 24 h → "2h"
 *   calendar yesterday → "Yesterday" · this year → "Sep 24" · older → "Sep 24, 2025"
 * Accepts epoch ms or an ISO string; anything unparseable is returned as-is.
 */
export function whenLabel(at: number | string | undefined, now = Date.now()): string {
  if (at == null || at === '') return '';
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return String(at);
  const diff = now - t;
  if (diff < 60_000) return 'Just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday || diff < 6 * 3_600_000) return `${Math.floor(min / 60)}h`;
  if (t >= startOfToday - 86_400_000) return 'Yesterday';
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

/** Clock time for chat bubbles ("7:04 PM"). */
export function clockLabel(at: number | string): string {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
