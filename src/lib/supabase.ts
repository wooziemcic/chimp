/**
 * Supabase client (Phase 6A). The one place the app talks to the backend.
 *
 * Configuration comes from public Expo env vars only (see `.env.example`):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (or EXPO_PUBLIC_SUPABASE_ANON_KEY)
 * Both are safe to ship in a client: Row Level Security protects the data.
 * Never put a service-role key in this app.
 *
 * When the vars are missing the app still runs (Demo mode, and a clear
 * "backend not configured" message on the phone screen).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// The `.env.example` placeholders don't count as configured.
export const isBackendConfigured = /^https:\/\/.+/.test(url) && key.length > 20 && !/YOUR-PROJECT/i.test(url) && !/x{8,}/i.test(key);

/** Public bucket for all user media (see supabase/migrations/0001_phase6a.sql). */
export const MEDIA_BUCKET = 'media';

let client: SupabaseClient | null = null;

/**
 * Reliability patch: database / RPC / auth requests give up after this long.
 * On a phone, a request sent just as Wi-Fi ↔ cellular changes can sit on a
 * dead connection for a minute or more (the system timeout) — that was the
 * "Sending…" that only cleared after switching networks. A bounded wait turns
 * it into a normal network error, which callers already retry. Storage
 * uploads and Edge Functions keep their own (longer) limits.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** fetch with a time limit for /rest/ and /auth/ calls (a caller's own signal still works). Exported for tests. */
export function timeoutFetch(base: typeof fetch = (...a) => fetch(...a), ms = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!/\/(rest|auth)\/v1\//.test(target) || typeof AbortController === 'undefined') return base(input, init);
    const ctl = new AbortController();
    const outer = init?.signal;
    const onAbort = () => ctl.abort();
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener('abort', onAbort);
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, ms);
    return base(input, { ...init, signal: ctl.signal })
      .catch((e: unknown) => {
        // Reads as a network failure everywhere (errors.ts kindOf → 'timed out' → 'network'). Named
        // AbortError so postgrest-js doesn't silently retry it 3 more times (the caller decides).
        if (timedOut) throw Object.assign(new Error('Network request timed out'), { name: 'AbortError' });
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        outer?.removeEventListener('abort', onAbort);
      });
  };
}

export function supabase(): SupabaseClient {
  if (!isBackendConfigured) throw new Error('Chimp’s backend isn’t configured on this build (missing EXPO_PUBLIC_SUPABASE_URL / key).');
  if (!client) {
    client = createClient(url, key, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: { fetch: timeoutFetch() },
    });
    if (Platform.OS !== 'web') {
      // Refresh tokens only while the app is in the foreground.
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

/** Authenticated upload endpoint for an object in the media bucket (Storage REST API). */
export function storageObjectUrl(path: string): string {
  return `${url}/storage/v1/object/${MEDIA_BUCKET}/${path}`;
}

/** The public (publishable) key, for direct Storage uploads. Never a secret key. */
export const publishableKey = () => key;

/** Public URL for an object in the media bucket. */
export function mediaUrl(path: string): string {
  return `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}
