/**
 * Phase 7B: one place that turns backend failures into something a person can
 * act on, decides what is safe to retry, and logs diagnostics in development
 * only (never tokens, codes or secrets).
 *
 * Root cause behind "Loading your profile: JWT issued at future": Supabase's
 * API (PostgREST, error PGRST303) can briefly judge a token minted a moment
 * ago as "issued in the future" (a server-side clock/caching issue; see
 * BUILD_NOTES 0.7B). It clears within seconds, so it is retried with a short
 * backoff, never shown raw. A device clock that is far off is detected
 * separately (clockSkewSeconds) and reported as such.
 */

export type ErrorKind = 'jwt_future' | 'jwt_expired' | 'jwt_invalid' | 'network' | 'denied' | 'not_found_fn' | 'other';

export interface BackendErrorShape {
  message: string;
  code?: string;
  status?: number;
}

export class BackendError extends Error {
  kind: ErrorKind;
  code?: string;
  /** The server's own message (development diagnostics only). */
  raw: string;
  constructor(kind: ErrorKind, message: string, raw: string, code?: string) {
    super(message);
    this.name = 'BackendError';
    this.kind = kind;
    this.code = code;
    this.raw = raw;
  }
}

// ─── Clock skew (device vs server), measured from a fresh token's iat ──────

let skewSeconds: number | null = null;
/** Device clock minus server clock, in seconds (null until measured). */
export const clockSkewSeconds = () => skewSeconds;
export const CLOCK_SKEW_LIMIT = 120;

/** Measure from a just-issued access token (reads only its `iat`; the token is never logged or stored here). */
export function noteTokenIssued(accessToken: string | undefined | null): void {
  if (!accessToken) return;
  try {
    const part = accessToken.split('.')[1];
    if (!part) return;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const decode = (globalThis as { atob?: (s: string) => string }).atob;
    if (!decode) return;
    const iat = Number((JSON.parse(decode(b64)) as { iat?: number }).iat);
    if (!Number.isFinite(iat)) return;
    skewSeconds = Math.round(Date.now() / 1000 - iat);
    diag('clock', { skewSeconds, outOfSync: Math.abs(skewSeconds) > CLOCK_SKEW_LIMIT });
  } catch {
    // Not a JWT we can read: no measurement.
  }
}
export const deviceClockOff = () => skewSeconds !== null && Math.abs(skewSeconds) > CLOCK_SKEW_LIMIT;

// ─── Classification ─────────────────────────────────────────────────────────

export function kindOf(e: unknown): ErrorKind {
  if (e instanceof BackendError) return e.kind;
  const { message = '', code = '' } = (e ?? {}) as { message?: string; code?: string };
  const m = String(message).toLowerCase();
  if (code === 'PGRST303' || m.includes('issued at future')) return 'jwt_future';
  if (code === 'PGRST301' || m.includes('jwt expired')) return 'jwt_expired';
  if (code === 'PGRST302' || m.includes('invalid jwt') || m.includes('jwt malformed') || m.includes('invalid signature')) return 'jwt_invalid';
  if (code === 'PGRST202' || m.includes('could not find the function')) return 'not_found_fn';
  if (code === '42501') return 'denied';
  if (m.includes('network request failed') || m.includes('failed to fetch') || m.includes('fetch failed') || m.includes('networkerror') || m.includes('timed out') || /\bload failed\b/.test(m)) return 'network'; // Safari says "Load failed" ("Upload failed: …" is ours, not a network drop)
  return 'other';
}

const SESSION_MESSAGE = 'We couldn’t finish signing you in. Try again.';
const CLOCK_MESSAGE = 'Your device time appears out of sync. Turn on “Set Automatically” in Settings → General → Date & Time, then try again.';
const NETWORK_MESSAGE = 'No connection. Check your internet, then try again.';

/** What to show a person for this failure (never a raw JWT / PostgREST message). */
export function userMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const kind = kindOf(e);
  if (kind === 'jwt_future' || kind === 'jwt_expired' || kind === 'jwt_invalid') return deviceClockOff() ? CLOCK_MESSAGE : SESSION_MESSAGE;
  if (kind === 'network') return NETWORK_MESSAGE;
  if (e instanceof BackendError) return e.message;
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  // Our own database functions raise short, human sentences; anything technical gets the fallback.
  if (msg && msg.length <= 160 && !/jwt|pgrst|postgrest|violates|constraint|relation|syntax|function\s|column|schema|null value|uuid/i.test(msg)) return msg;
  return fallback;
}

/** Turn a Supabase error into a BackendError ("Loading X" context is kept for diagnostics, not shown). */
export function backendError(err: BackendErrorShape, what: string, opts?: { passThroughCodes?: string[] }): BackendError {
  const raw = `${what}: ${err.message}`;
  const kind = kindOf(err);
  const passThrough = err.code && (opts?.passThroughCodes ?? ['42501', '22023']).includes(err.code);
  let message: string;
  if (kind === 'jwt_future' || kind === 'jwt_expired' || kind === 'jwt_invalid' || kind === 'network') message = userMessage(err);
  // Our own refusals (short sentences) pass through; a raw policy message never does.
  else if (passThrough) message = userMessage(err.message, `${what} didn’t work. Try again.`);
  // A human sentence from our own database functions stays; anything technical becomes plain words.
  else message = userMessage(err.message, `${what} didn’t work. Try again.`);
  diag('error', { what, kind, code: err.code });
  return new BackendError(kind, message, raw, err.code);
}

// ─── Retry (only for things that clear by themselves) ───────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a request that failed for a transient reason: a token the API
 * briefly calls "issued in the future", or a dropped connection. Everything
 * else (a real refusal, a missing row) fails at once — no blind retries.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: { label: string; delays?: number[]; retryOn?: ErrorKind[] }): Promise<T> {
  const delays = opts.delays ?? [500, 1000, 2000, 3500];
  const retryOn = opts.retryOn ?? ['jwt_future', 'network'];
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await fn();
      if (attempt) diag('retry ok', { label: opts.label, attempt });
      return out;
    } catch (e) {
      const kind = kindOf(e);
      if (attempt >= delays.length || !retryOn.includes(kind)) {
        diag('retry gave up', { label: opts.label, attempt, kind });
        throw e;
      }
      diag('retry', { label: opts.label, attempt, kind, waitMs: delays[attempt] });
      await sleep(delays[attempt]);
    }
  }
}

/** Development-only diagnostics. Callers must never pass tokens, OTP codes or secrets. */
export function diag(event: string, data?: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[chimp:reliability] ${event}`, data ? JSON.stringify(data) : '');
}
