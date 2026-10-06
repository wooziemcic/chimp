// Chimp · Phase 7C · push (Supabase Edge Function, Deno)
//
// Delivers what the database queued in `push_outbox` (0009): Edge Function →
// Expo Push Service → APNs. Phones never send pushes and never hold a
// privileged credential; this function only ever sends rows the database
// wrote (from new messages and user_events), so nobody can make it send an
// arbitrary notification.
//
//   POST {"action":"send"}      claim due rows (push_claim, skip-locked, so
//                               two runs never send the same row), send them
//                               in batches of ≤100, record tickets
//                               (push_mark), forget dead tokens
//                               (DeviceNotRegistered → push_token_invalid),
//                               back off and retry temporary failures
//                               (429 / 5xx / MessageRateExceeded), give up
//                               after push_max_attempts.
//   POST {"action":"receipts"}  check Expo receipts for pushes sent 15 min –
//                               23 h ago; DeviceNotRegistered → forget token.
//                               Also purges old outbox rows and events.
//
// Auth: header  x-push-secret: <PUSH_SECRET>  (an Edge Function secret you
// choose). Nothing else is accepted — not even a signed-in user.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  push  → paste this file → Deploy. Then:
//   1. Edge Functions → Secrets: PUSH_SECRET = a long random string.
//      Strongly recommended: in your Expo account turn on "Enhanced push
//      security" and set EXPO_ACCESS_TOKEN here — then only this function
//      (not anyone who learns a device's push token) can send to Chimp's users.
//   2. Database → Webhooks → Create: table public.push_outbox, event INSERT,
//      type "Supabase Edge Functions" → push, method POST, header
//      x-push-secret: <PUSH_SECRET>, body {"action":"send"}  (instant delivery).
//   3. Integrations → Cron: every minute POST {"action":"send"} and every 15
//      minutes POST {"action":"receipts"} to this function with the same
//      header (retries, receipts, anything the webhook missed).

// ─── Pure logic (unit-tested in Node; no Deno APIs below this line until serve) ──

export interface OutboxRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  collapse_key: string | null;
  attempts: number;
  tokens: string[];
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  /** Ask Expo/APNs to drop a push that couldn't be delivered within a day. */
  ttl: number;
  /**
   * Phase 9: iOS `content-available` — lets iOS wake Chimp briefly in the
   * background so the recipient's phone can acknowledge "Delivered" itself
   * (never Seen). Only on message pushes; the alert is shown as before.
   */
  contentAvailable?: true;
}

export type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

export interface RowResult {
  id: string;
  ok: boolean;
  retry: boolean;
  error: string | null;
  tickets: { token: string; ticket: string }[];
  deadTokens: string[];
}

export const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
export const BATCH = 100;

/** One Expo message per device. Only the queued title / body / data — nothing else is ever added. */
export function toExpoMessages(rows: OutboxRow[]): { msg: ExpoMessage; rowId: string }[] {
  const out: { msg: ExpoMessage; rowId: string }[] = [];
  for (const r of rows) {
    const seen = new Set<string>();
    for (const token of r.tokens ?? []) {
      if (seen.has(token)) continue; // never the same device twice for one notification
      seen.add(token);
      out.push({
        rowId: r.id,
        // `for`: the account it was meant for — a phone that has since switched accounts ignores the tap.
        msg: {
          to: token,
          title: r.title,
          body: r.body,
          data: { ...(r.data ?? {}), kind: payloadKind(r.kind), for: r.user_id },
          sound: 'default',
          priority: 'high',
          ttl: 86_400,
          ...(r.kind === 'MESSAGE_RECEIVED' ? { contentAvailable: true as const } : {}),
        },
      });
    }
  }
  return out;
}

export function chunk<T>(list: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** After Dark kinds travel as a neutral word, even in the hidden payload. */
const AFTER_DARK_KINDS = new Set(['AFTER_DARK_MESSAGE', 'MUTUAL_CRUSH', 'VIBE_REQUEST', 'VIBE_ACCEPTED', 'CHALLENGE_YOUR_TURN', 'PLAN_WAITING_FOR_YOU']);
/** Phase 9 (0012): likes, replies and World activity. */
const ACTIVITY_KINDS = new Set(['CONTENT_LIKED', 'CONTENT_COMMENTED', 'THREAD_REPLY', 'WORLD_ACTIVITY', 'WORLD_JOIN']);
export const payloadKind = (kind: string) =>
  AFTER_DARK_KINDS.has(kind) ? 'after_dark' : kind === 'MESSAGE_RECEIVED' ? 'message' : ACTIVITY_KINDS.has(kind) ? 'activity' : 'connection';

const RETRYABLE = new Set(['MessageRateExceeded', 'ExpoError', 'ProviderError']);

/**
 * Tickets come back in message order. A row is sent if any of its devices
 * accepted it; dead devices are forgotten; it is retried only when every
 * device failed for a temporary reason.
 */
export function interpretTickets(sent: { msg: ExpoMessage; rowId: string }[], tickets: Ticket[], rowIds: string[]): RowResult[] {
  const by = new Map<string, RowResult & { temp: number; fails: number; n: number }>();
  for (const id of rowIds) by.set(id, { id, ok: false, retry: false, error: null, tickets: [], deadTokens: [], temp: 0, fails: 0, n: 0 });
  sent.forEach((s, i) => {
    const r = by.get(s.rowId);
    if (!r) return;
    r.n += 1;
    const t = tickets[i];
    if (t && t.status === 'ok') {
      r.ok = true;
      r.tickets.push({ token: s.msg.to, ticket: t.id });
      return;
    }
    r.fails += 1;
    const code = t?.details?.error ?? (t ? 'Unknown' : 'NoTicket');
    if (code === 'DeviceNotRegistered') r.deadTokens.push(s.msg.to);
    else if (RETRYABLE.has(code) || code === 'NoTicket') r.temp += 1;
    r.error = code;
  });
  return [...by.values()].map(({ temp, fails, n, ...r }) => ({
    ...r,
    // Nothing reached any device and at least one failure was temporary → try again later.
    retry: !r.ok && temp > 0,
    error: r.ok ? (fails ? `${fails}/${n} failed` : null) : r.error ?? (n === 0 ? 'NoDevices' : null),
  }));
}

/** The whole request failed: retry on 429 / 5xx / network, give up on other 4xx. */
export function requestFailure(status: number | null): { retry: boolean; error: string } {
  if (status === null) return { retry: true, error: 'network' };
  if (status === 429 || status >= 500) return { retry: true, error: `HTTP ${status}` };
  return { retry: false, error: `HTTP ${status}` };
}

/** Receipts → tokens Expo says are gone. */
export function deadTokensFromReceipts(ticketToToken: Map<string, string>, receipts: Record<string, Ticket | undefined>): string[] {
  const out = new Set<string>();
  for (const [ticket, rc] of Object.entries(receipts ?? {})) {
    if (rc && rc.status === 'error' && rc.details?.error === 'DeviceNotRegistered') {
      const token = ticketToToken.get(ticket);
      if (token) out.add(token);
    }
  }
  return [...out];
}

/** Constant-time string compare (for the shared secret). */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ─── Server ──────────────────────────────────────────────────────────────────

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void } | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function serviceKey(env: (k: string) => string | undefined): string {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function expoPost(url: string, body: unknown, env: (k: string) => string | undefined): Promise<{ status: number | null; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' };
  const token = env('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const parsed = await res.json().catch(() => null);
    return { status: res.status, json: parsed };
  } catch {
    return { status: null, json: null };
  }
}

export async function send(db: Db, env: (k: string) => string | undefined, budgetMs = 20_000) {
  const started = Date.now();
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let dead = 0;
  while (Date.now() - started < budgetMs) {
    const { data: rows, error } = await db.rpc('push_claim', { p_limit: BATCH });
    if (error) throw new Error(`claim: ${error.message}`);
    if (!rows?.length) {
      // Messages wait ~2 s before sending (so a burst becomes one notification):
      // wait that out here instead of leaving it for the next cron run.
      const { data: dueIn } = await db.rpc('push_next_due_in');
      const wait = typeof dueIn === 'number' ? dueIn : dueIn == null ? null : Number(dueIn);
      if (wait === null || !Number.isFinite(wait) || wait > 5 || Date.now() - started + wait * 1000 > budgetMs) break;
      await new Promise((r) => setTimeout(r, Math.max(200, wait * 1000 + 150)));
      continue;
    }
    const messages = toExpoMessages(rows as OutboxRow[]);
    const results: RowResult[] = [];
    let batchFailure: { retry: boolean; error: string } | null = null;
    const tickets: Ticket[] = [];
    for (const part of chunk(messages)) {
      const r = await expoPost(EXPO_SEND, part.map((m) => m.msg), env);
      const data = (r.json as { data?: Ticket[] } | null)?.data;
      if (r.status !== 200 || !Array.isArray(data)) {
        batchFailure = requestFailure(r.status);
        // The rest of this claim waits for the next run.
        tickets.push(...part.map(() => undefined as unknown as Ticket));
        continue;
      }
      tickets.push(...data);
    }
    results.push(...interpretTickets(messages, tickets, (rows as OutboxRow[]).map((x) => x.id)));
    for (const r of results) {
      for (const t of r.deadTokens) {
        await db.rpc('push_token_invalid', { p_token: t });
        dead++;
      }
      const retry = r.retry || (!r.ok && !!batchFailure?.retry && r.deadTokens.length === 0);
      await db.rpc('push_mark', { p_id: r.id, p_ok: r.ok, p_tickets: r.tickets.length ? r.tickets : null, p_error: r.error ?? batchFailure?.error ?? null, p_retry: retry });
      if (r.ok) sent++;
      else if (retry) retried++;
      else failed++;
    }
    // Expo is rate-limiting us: stop for now; the cron run picks it up.
    if (batchFailure?.retry) break;
  }
  return { sent, retried, failed, dead };
}

export async function receipts(db: Db, env: (k: string) => string | undefined) {
  const { data: rows, error } = await db.rpc('push_receipts_due', { p_limit: 300 });
  if (error) throw new Error(`receipts: ${error.message}`);
  const ticketToToken = new Map<string, string>();
  for (const r of (rows ?? []) as { id: string; tickets: { token: string; ticket: string }[] | null }[]) {
    for (const t of r.tickets ?? []) ticketToToken.set(t.ticket, t.token);
  }
  let dead = 0;
  const unfetched = new Set<string>();
  for (const ids of chunk([...ticketToToken.keys()], 1000)) {
    const r = await expoPost(EXPO_RECEIPTS, { ids }, env);
    const data = (r.json as { data?: Record<string, Ticket> } | null)?.data;
    if (r.status !== 200 || !data) {
      ids.forEach((i) => unfetched.add(i)); // try these again next run (receipts stay ~24 h)
      continue;
    }
    for (const t of deadTokensFromReceipts(ticketToToken, data)) {
      await db.rpc('push_token_invalid', { p_token: t });
      dead++;
    }
  }
  // Only rows whose receipts were actually read are marked checked.
  const done = ((rows ?? []) as { id: string; tickets: { ticket: string }[] | null }[])
    .filter((r) => !(r.tickets ?? []).some((t) => unfetched.has(t.ticket)))
    .map((r) => r.id);
  if (done.length) await db.rpc('push_receipts_done', { p_ids: done });
  await db.rpc('purge_push_outbox');
  await db.rpc('purge_old_product_events');
  return { checked: rows?.length ?? 0, dead };
}

export async function handle(req: Request, env: (k: string) => string | undefined): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = env('PUSH_SECRET') ?? '';
  if (!secret || !safeEqual(req.headers.get('x-push-secret') ?? '', secret)) return json({ error: 'Not allowed' }, 401);
  const body = (await req.json().catch(() => ({}))) as { action?: string; type?: string; record?: { status?: string } };
  // A Database Webhook call for a row that isn't waiting to be sent: nothing to do.
  if (body.type === 'INSERT' && body.record?.status && body.record.status !== 'pending') return json({ skipped: true });
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const db = createClient(env('SUPABASE_URL') ?? '', serviceKey(env), { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (body.action === 'receipts') return json(await receipts(db, env));
    return json(await send(db, env));
  } catch (e) {
    // Never echo row contents; just the failing step.
    return json({ error: e instanceof Error ? e.message.slice(0, 120) : 'failed' }, 500);
  }
}

if (typeof Deno !== 'undefined') Deno.serve((req) => handle(req, (k) => Deno!.env.get(k)));
