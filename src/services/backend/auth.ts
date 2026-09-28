/**
 * Email authentication (Phase 6D): a 6-digit code sent by Supabase Auth.
 *
 *   signInWithOtp({ email })          → Supabase emails a one-time code
 *   verifyOtp({ email, token, 'email'}) → a real session
 *
 * One path for everyone ("Continue with Email"): there is no separate Sign
 * Up / Sign In choice. A new email gets a new account; a known email gets its
 * account back. What happens after verification depends only on the profile
 * (finished → Buzz, missing or unfinished → onboarding). Nobody skips the
 * code, developers included: developer access is looked up on the server
 * only after a verified session exists.
 *
 * The code (not a magic link) needs {{ .Token }} in the Supabase email
 * templates ("Magic Link" for known emails, "Confirm signup" for new ones), and a custom SMTP sender so
 * anyone can receive it (Supabase's built-in sender only reaches your team).
 * Phone / SMS sign-in is retired from the app.
 */
import { isBackendConfigured, supabase } from '@/lib/supabase';

/** Trim + lower-case: the one canonical form of an email everywhere in Chimp. */
export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

export const isEmail = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(raw));

/** "wo•••@gmail.com" for the verify screen (enough to recognise, not to harvest). */
export function maskEmail(email: string): string {
  const [name, domain] = normalizeEmail(email).split('@');
  if (!domain) return email;
  return `${name.slice(0, 2)}${name.length > 2 ? '•••' : ''}@${domain}`;
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('signups not allowed') || m.includes('otp_disabled') || m.includes('email logins are disabled'))
    return 'Chimp isn’t accepting new accounts by email right now. Try again later.';
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many') || m.includes('seconds'))
    return 'A code was sent a moment ago. Wait a minute, then tap Resend.';
  if (m.includes('expired') || m.includes('invalid') || m.includes('otp')) return 'That code didn’t work: it’s wrong or has expired. Check the latest email, or tap Resend for a new code.';
  if (m.includes('error sending') || m.includes('smtp') || m.includes('email address not authorized') || m.includes('sending'))
    return 'Chimp couldn’t send the email right now. Try again in a minute.';
  if (m.includes('network') || m.includes('fetch')) return 'No connection. Check your internet, then try again.';
  return message;
}

// ─── Send / verify ──────────────────────────────────────────────────────────

/** Email a 6-digit code. Creates the Auth user the first time an email is used. */
export async function sendCode(email: string): Promise<void> {
  if (!isBackendConfigured) throw new Error('Chimp’s backend isn’t connected on this build yet.');
  const address = normalizeEmail(email);
  if (!isEmail(address)) throw new Error('That doesn’t look like an email address.');
  // The Auth user only becomes usable once the code is verified; an unverified
  // one (e.g. a typo) never gets a profile and can simply sign in later.
  const { error } = await supabase().auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
  if (error) throw new Error(friendly(error.message));
}

export async function verifyCode(email: string, token: string): Promise<{ id: string; email: string }> {
  const address = normalizeEmail(email);
  const { data, error } = await supabase().auth.verifyOtp({ email: address, token, type: 'email' });
  if (error) throw new Error(friendly(error.message));
  const u = data.session?.user;
  if (!u) throw new Error('Verification didn’t complete. Try again.');
  return { id: u.id, email: u.email ?? address };
}

export async function currentUserId(): Promise<{ id: string; email?: string } | null> {
  if (!isBackendConfigured) return null;
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  return { id: u.id, email: u.email ?? undefined };
}

export async function signOutBackend(): Promise<void> {
  if (!isBackendConfigured) return;
  await supabase().auth.signOut();
}

/** Drop this phone's session without calling the server (after the account was deleted). */
/** Supabase ended the session by itself (refresh token revoked, account deleted elsewhere). */
export function onSessionEnded(fn: () => void): () => void {
  if (!isBackendConfigured) return () => undefined;
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') fn();
  });
  return () => data.subscription.unsubscribe();
}

export async function signOutLocal(): Promise<void> {
  if (!isBackendConfigured) return;
  await supabase().auth.signOut({ scope: 'local' });
}

// ─── Access & account (Phase 6D) ─────────────────────────────────────────────

/**
 * Developer access is decided by the server (my_access(): the verified email
 * is on Chimp's developer list). The app only uses it to show developer tools.
 */
export async function fetchAccess(): Promise<{ developer: boolean }> {
  if (!isBackendConfigured) return { developer: false };
  const { data, error } = await supabase().rpc('my_access');
  if (error || !data) return { developer: false };
  return { developer: !!(data as { developer?: boolean }).developer };
}

export interface DeletionPreview {
  worlds: { id: string; title: string; others: number }[];
}

export async function fetchDeletionPreview(): Promise<DeletionPreview> {
  const { data, error } = await supabase().rpc('account_deletion_preview');
  if (error) throw new Error(`Couldn’t load your account details: ${error.message}`);
  return (data as DeletionPreview | null) ?? { worlds: [] };
}

/**
 * Permanently delete the signed-in account (server-side Edge Function, which
 * only ever deletes the caller). `transferWorlds`: hand each World you own to
 * its longest-standing member instead of deleting it.
 */
export async function deleteMyAccount(transferWorlds: boolean): Promise<{ deletedWorlds: number; handedOnWorlds: number }> {
  const { data, error } = await supabase().functions.invoke('delete-account', { body: { confirm: 'DELETE', transferWorlds } });
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') detail = ((await ctx.json()) as { error?: string }).error ?? detail;
    } catch {
      /* keep the generic message */
    }
    if (/not found|404|failed to send/i.test(detail)) detail = 'Account deletion isn’t set up on the server yet (the delete-account function). Nothing was deleted.';
    throw new Error(detail);
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; deletedWorlds?: number; handedOnWorlds?: number };
  if (!r.ok) throw new Error(r.error ?? 'Your account wasn’t deleted. Try again.');
  return { deletedWorlds: r.deletedWorlds ?? 0, handedOnWorlds: r.handedOnWorlds ?? 0 };
}
