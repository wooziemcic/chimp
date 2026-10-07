/**
 * Phase 8 — Sent / Delivered / Seen, computed from SERVER cursors only.
 *
 *   Sent       the server has the message (it has a server id; no local status)
 *   Delivered  the recipient's app synced it and told the server (never "a push went out")
 *   Seen       the recipient had the chat open, in the foreground, at or after it
 *
 * Cursors come from `chat_receipts` (0011), which already removes people across
 * a block, people who haven't accepted my request yet, and every After Dark
 * Vibe. Times are compared at microsecond precision as the server wrote them —
 * never against this phone's clock.
 */
export interface ReceiptRow {
  user_id: string;
  status: 'active' | 'request' | 'declined' | 'left';
  joined_at: string;
  read_at: string | null;
  delivered_at: string | null;
}

export type Receipt =
  | { kind: 'sent' }
  | { kind: 'delivered' }
  | { kind: 'seen' }
  /** Groups: who has seen it (never shown as a list under the message — tap opens it). */
  | { kind: 'seenBy'; ids: string[]; of: number };

/**
 * A Postgres / ISO timestamp → microseconds since the epoch (exact, no Date
 * rounding). Accepts "2026-01-02T10:00:00.123456+00:00", "...Z", a space
 * instead of "T", or no fraction. NaN if it can't be read.
 */
export function serverMicros(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d(?::\d\d)?)(?:\.(\d+))?\s*(Z|[+-]\d\d(?::?\d\d)?)?$/i.exec(iso.trim());
  if (!m) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms * 1000 : NaN;
  }
  const [, day, time, frac = '', zone] = m;
  let tz = zone ?? 'Z';
  if (/^[+-]\d\d$/.test(tz)) tz = `${tz}:00`;
  else if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const ms = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}${tz.toUpperCase()}`);
  if (!Number.isFinite(ms)) return NaN;
  return ms * 1000 + Number((frac + '000000').slice(0, 6));
}

const atOrAfter = (cursor: string | null | undefined, at: number) => {
  const c = serverMicros(cursor);
  return Number.isFinite(c) && Number.isFinite(at) && c >= at;
};

/**
 * The receipt for one of MY messages. null = show nothing (not mine, not on
 * the server yet, or receipts don't apply here). `rows` undefined/null =
 * receipts unknown (still loading, an older server, offline): show "Sent",
 * which is the only thing we know for certain.
 */
export function receiptFor(
  msg: { senderId: string; createdAt: string; status?: string },
  me: string | undefined,
  kind: 'direct' | 'group',
  rows: ReceiptRow[] | null | undefined,
): Receipt | null {
  if (!me || msg.senderId !== me || msg.status) return null;
  if (!rows) return { kind: 'sent' };
  const at = serverMicros(msg.createdAt);
  if (!Number.isFinite(at)) return { kind: 'sent' };
  // Only people who were there when it was sent and are still in it.
  const audience = rows.filter((r) => r.user_id !== me && r.status === 'active' && serverMicros(r.joined_at) <= at);
  if (kind === 'direct') {
    const other = audience[0];
    if (!other) return { kind: 'sent' };
    if (atOrAfter(other.read_at, at)) return { kind: 'seen' };
    if (atOrAfter(other.delivered_at, at)) return { kind: 'delivered' };
    return { kind: 'sent' };
  }
  if (!audience.length) return { kind: 'sent' };
  const seen = audience.filter((r) => atOrAfter(r.read_at, at)).map((r) => r.user_id);
  if (seen.length) return { kind: 'seenBy', ids: seen, of: audience.length };
  if (audience.every((r) => atOrAfter(r.delivered_at, at))) return { kind: 'delivered' };
  return { kind: 'sent' };
}

/** The words under the bubble. */
export function receiptLabel(r: Receipt): string {
  switch (r.kind) {
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'seen':
      return 'Seen';
    case 'seenBy':
      return r.ids.length >= r.of ? 'Seen by everyone' : `Seen by ${r.ids.length}`;
  }
}

/**
 * Which message carries the receipt: the newest message on the server, if
 * it's mine. Once someone has replied, a receipt above their reply says
 * nothing new, so none is shown (one status line, never one per message).
 */
export function receiptMessageId(list: readonly { id: string; senderId: string; status?: string }[], me: string | undefined): string | undefined {
  if (!me) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.status) continue; // still sending / failed: not on the server
    return m.senderId === me ? m.id : undefined;
  }
  return undefined;
}

/**
 * Phase 9.1: apply a member's cursor move from Realtime (`conversation_members`
 * UPDATE: last_read_at / last_delivered_at) to receipts already on screen, so
 * Delivered / Seen show the moment the event lands — chat_receipts() still
 * re-reads right after and stays authoritative. Only rows the server already
 * shows (non-null cursors) move, only forward; anything else: null (no change).
 */
export function applyCursor(
  rows: ReceiptRow[] | null | undefined,
  change: { user_id?: string | null; status?: string | null; last_read_at?: string | null; last_delivered_at?: string | null } | undefined,
): ReceiptRow[] | null {
  if (!rows || !change?.user_id || !change.last_read_at) return null;
  const i = rows.findIndex((r) => r.user_id === change.user_id);
  const cur = i >= 0 ? rows[i] : undefined;
  if (!cur || cur.read_at === null || cur.delivered_at === null) return null; // hidden by the server (request / declined / blocked)
  if (change.status && change.status !== cur.status) return null; // a membership change: let the server decide
  const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : serverMicros(b) > serverMicros(a) ? b : a);
  const read = later(cur.read_at, change.last_read_at);
  const delivered = later(later(cur.delivered_at, change.last_delivered_at), read);
  if (read === cur.read_at && delivered === cur.delivered_at) return null;
  const next = [...rows];
  next[i] = { ...cur, read_at: read, delivered_at: delivered };
  return next;
}
