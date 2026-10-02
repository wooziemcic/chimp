// Chimp · Phase 7B · view-once (Supabase Edge Function, Deno)
//
// View-once photos live in the PRIVATE bucket `vibe-media` (0008). No app,
// sender included, can read or list that bucket. This function is the only
// way a view-once photo is ever seen:
//
//   action "open"  (the app, with the signed-in user's session)
//     1. verify the session → the user's id (no user id is accepted from the app)
//     2. view_once_open_as(message, user)  — the database decides: only the
//        recipient, only once, only while the Vibe is active and nobody is
//        blocked; it records the opening
//     3. read the file with the server key, DELETE it from Storage, record that
//     4. return the image bytes once (base64). No URL ever exists, so there is
//        nothing to share, reuse or open again.
//   action "ping"  (the app) — is view-once available on this project?
//   action "sweep" (a scheduled job, with the x-cron-secret header) — delete
//        files that should be gone: opened but not yet deleted, unsent,
//        unopened after view_once_ttl_days (14), in a Vibe that ended or was
//        blocked, and private files nothing points at any more. Only files in
//        the sender's own folder are ever deleted. Also expires stale Vibe
//        requests and old events.
//   If the file can't be read when it's opened (a storage hiccup), the
//   opening is undone and the recipient can try again.
//
// Screenshots can't be prevented by any app; the app says so.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  view-once  → paste this file → Deploy.
// Cleanup (optional, recommended): set a secret CRON_SECRET (Edge Functions →
// Secrets) and schedule a daily POST {"action":"sweep"} with header
// x-cron-secret: <that secret> (Integrations → Cron, or any scheduler).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const MAX_BYTES = 10 * 1024 * 1024;

function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The database's refusal → a status and a message the app can show as-is. */
function refusal(message: string): Response {
  const m = message.toLowerCase();
  if (m.includes('already viewed')) return json({ error: 'You’ve already opened this photo.', code: 'viewed' }, 410);
  if (m.includes('expired') || m.includes('unsent')) return json({ error: 'This photo is no longer available.', code: 'expired' }, 410);
  if (m.includes('only the person')) return json({ error: 'Only the person it was sent to can open it.', code: 'forbidden' }, 403);
  if (m.includes('isn\'t active') || m.includes('isn’t active')) return json({ error: 'This Vibe isn’t active, so the photo can’t be opened.', code: 'inactive' }, 403);
  return json({ error: 'This photo isn’t available.', code: 'not_found' }, 404);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = serviceKey();
  if (!url || !key) return json({ error: 'The server is missing its Supabase configuration.' }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = (await req.json().catch(() => ({}))) as { action?: string; message_id?: string };

  // ── Scheduled cleanup ──
  if (body.action === 'sweep') {
    const secret = Deno.env.get('CRON_SECRET') ?? '';
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Not allowed.' }, 401);
    let removed = 0;
    let failed = 0;
    for (let round = 0; round < 20; round++) {
      const { data, error } = await admin.rpc('view_once_sweep_candidates', { p_limit: 200 });
      if (error) return json({ error: `Sweep failed: ${error.message}` }, 500);
      const rows = (data ?? []) as { message_id: string; bucket: string; path: string | null }[];
      if (!rows.length) break;
      const done: string[] = [];
      // A row without a path is outside its sender's folder: never delete it, just mark it gone.
      for (const r of rows) if (!r.path) done.push(r.message_id);
      const byBucket = new Map<string, { path: string; id: string }[]>();
      for (const r of rows) if (r.path) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), { path: r.path, id: r.message_id }]);
      for (const [bucket, items] of byBucket) {
        const res = await admin.storage.from(bucket).remove(items.map((i) => i.path));
        // Only what was really removed is marked; the rest is retried next time.
        if (res.error) failed += items.length;
        else done.push(...items.map((i) => i.id));
      }
      for (const id of done) await admin.rpc('view_once_mark_purged', { p_message: id });
      removed += done.length;
      if (rows.length < 200 || !done.length) break;
    }
    // Files nothing points at any more (uploaded but never sent, or their media row was deleted).
    let orphans = 0;
    const { data: orphanRows } = await admin.rpc('view_once_orphans', { p_limit: 500 });
    const orphanPaths = ((orphanRows ?? []) as { path: string }[]).map((r) => r.path).filter((x) => /^once\/[0-9a-f-]{36}\/[^/]+$/i.test(x));
    if (orphanPaths.length) {
      const res = await admin.storage.from('vibe-media').remove(orphanPaths);
      if (!res.error) orphans = orphanPaths.length;
    }
    const expired = await admin.rpc('expire_stale_vibes');
    const purged = await admin.rpc('purge_old_events');
    return json({ ok: true, removedFiles: removed, failedFiles: failed, orphanFiles: orphans, expiredRequests: expired.data ?? 0, purgedEvents: purged.data ?? 0 });
  }

  // ── The app: who is asking? Only a valid session counts. ──
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoErr || !user) return json({ error: 'You’re not signed in. Sign in again, then retry.', code: 'auth' }, 401);

  if (body.action === 'ping') return json({ ok: true });
  if (body.action !== 'open' || typeof body.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.message_id)) {
    return json({ error: 'Unknown request.' }, 400);
  }

  // The database decides and records the opening (once).
  const { data: opened, error: openErr } = await admin.rpc('view_once_open_as', { p_message: body.message_id, p_user: user.id });
  if (openErr) return refusal(openErr.message);
  const row = ((opened ?? []) as { bucket: string; path: string; mime: string }[])[0];
  if (!row || row.bucket !== 'vibe-media') return refusal('expired');

  const file = await admin.storage.from(row.bucket).download(row.path);
  if (file.error || !file.data) {
    if (/not.?found/i.test(file.error?.message ?? '')) {
      // The file is gone (cleaned up): so is the photo.
      await admin.rpc('view_once_mark_purged', { p_message: body.message_id });
      return json({ error: 'This photo is no longer available.', code: 'expired' }, 410);
    }
    // A storage hiccup: undo the opening so they can try again (the file is still there).
    await admin.rpc('view_once_release', { p_message: body.message_id });
    return json({ error: 'This photo couldn’t be opened right now. Try again in a moment.', code: 'retry' }, 503);
  }
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  // It has been opened: the file goes now. Marked gone only once really removed
  // (otherwise the scheduled sweep removes it later).
  const removedNow = await admin.storage.from(row.bucket).remove([row.path]);
  if (!removedNow.error) await admin.rpc('view_once_mark_purged', { p_message: body.message_id });
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'This photo is no longer available.', code: 'expired' }, 410);
  // Only image types ever go back (the stored type is whatever the sender's app claimed).
  const mime = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(row.mime) ? row.mime : 'image/jpeg';
  return json({ ok: true, mime, data: toBase64(bytes) });
});
