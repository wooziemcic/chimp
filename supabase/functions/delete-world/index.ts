// Chimp · delete-world (Supabase Edge Function, Deno) · Phase 9: storage clean-up worker
//
// Phase 9 (release blocker fix): the app no longer depends on this function
// to DELETE a World. It calls public.delete_world(board_id) directly, as the
// signed-in owner — one database transaction that removes the World and
// everything that belongs to it, and queues the removed files in
// storage_cleanup. This function is then called (best effort) to remove those
// files from Storage with the service key. It is idempotent and safe to call
// again; if it is unreachable, the files simply wait in the queue.
//
//   1. verify the caller's session (any signed-in user)
//   2. if the World still exists: delete_world(board_id) AS THE CALLER — the
//      database refuses anyone who isn't the owner (older app builds still
//      use this path to delete)
//   3. the World is gone → remove its queued files (storage_cleanup rows for
//      that board_id) and anything left under boards/{board_id}/, then clear
//      the queue rows that were removed
//
// Nothing here can remove a file that wasn't queued for deletion or a live
// World's folder: step 3 only runs once the World no longer exists.
//
// Deploy: Dashboard → Edge Functions → delete-world → paste this file → Deploy.
// JWT: this function verifies the session itself (step 1). If your project
// uses the new JWT signing keys, turn OFF "Enforce JWT verification" for it
// (Function → Details), or the platform gateway rejects calls before this
// code runs (that was one way to get "non-2xx").
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function fromJson(name: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || fromJson('SUPABASE_SECRET_KEYS');
const publicKey = () => Deno.env.get('SUPABASE_ANON_KEY') || fromJson('SUPABASE_PUBLISHABLE_KEYS');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.', code: 'method' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const sKey = serviceKey();
    const pKey = publicKey();
    if (!url || !sKey || !pKey) return json({ ok: false, error: 'The server is missing its Supabase configuration.', code: 'config' }, 500);
    const admin = createClient(url, sKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Who is asking?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ ok: false, error: 'Not signed in.', code: 'auth' }, 401);

    const body = (await req.json().catch(() => ({}))) as { boardId?: string };
    const boardId = typeof body.boardId === 'string' ? body.boardId : '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(boardId)) return json({ ok: false, error: 'Which World? (missing id)', code: 'input' }, 400);

    // 2. Still there? Then the database decides, as the caller (owner only).
    const { data: still } = await admin.from('boards').select('id').eq('id', boardId).maybeSingle();
    let paths: string[] = [];
    if (still) {
      const asCaller = createClient(url, pKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: removed, error: delErr } = await asCaller.rpc('delete_world', { p_board_id: boardId });
      if (delErr) {
        const denied = delErr.code === '42501';
        return json({ ok: false, error: denied ? 'Only the World’s owner can delete it.' : 'Couldn’t delete the World.', code: denied ? 'not_owner' : 'db' }, denied ? 403 : 500);
      }
      paths = ((removed as string[] | null) ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    }

    // 3. The World is gone: its queued files, then anything left in its folder.
    const { data: queued } = await admin.from('storage_cleanup').select('path').eq('board_id', boardId).limit(5000);
    const all = [...new Set([...paths, ...((queued ?? []) as { path: string }[]).map((q) => q.path)])];
    const done: string[] = [];
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000);
      const { error } = await admin.storage.from('media').remove(chunk);
      if (!error) done.push(...chunk);
    }
    const prefix = `boards/${boardId}`;
    let left = 0;
    for (let round = 0; round < 50; round++) {
      const { data: files, error } = await admin.storage.from('media').list(prefix, { limit: 1000 });
      if (error || !files?.length) break;
      const names = files.filter((f) => f.name).map((f) => `${prefix}/${f.name}`);
      if (!names.length) break;
      const { error: rmErr } = await admin.storage.from('media').remove(names);
      if (rmErr) break;
      left += names.length;
      if (files.length < 1000) break;
    }
    // Only what was actually removed leaves the queue; the rest is retried next time.
    if (done.length) await admin.from('storage_cleanup').delete().in('path', done);
    return json({ ok: true, removedFiles: done.length + left, pending: all.length - done.length });
  } catch (e) {
    // Always a readable JSON body (never the bare platform message).
    return json({ ok: false, error: 'Clean-up failed. It will be retried.', code: 'unexpected', detail: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 500);
  }
});
