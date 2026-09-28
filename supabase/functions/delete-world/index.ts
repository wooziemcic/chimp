// Chimp · Phase 6D · delete-world (Supabase Edge Function, Deno)
//
// Deletes one World for its OWNER. The decision is made by the database:
// this function calls public.delete_world(board_id) AS THE SIGNED-IN USER
// (their own token), and delete_world() refuses anyone whose auth.uid() isn't
// the World's owner_id. The service key is used only afterwards, to remove
// the Storage files delete_world() returned: the cover, and photos/videos
// other members posted in the World's Drift and Stories (Storage only lets a
// user delete their own files, so this part has to be server-side).
//
//   1. verify the caller's session
//   2. delete_world(board_id) as the caller → the file paths it removed
//   3. remove those files + anything left under boards/{board_id}/
//   4. clear them from the storage_cleanup queue
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  delete-world  → paste this file → Deploy.
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
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const sKey = serviceKey();
  const pKey = publicKey();
  if (!url || !sKey || !pKey) return json({ error: 'The server is missing its Supabase configuration.' }, 500);
  const admin = createClient(url, sKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is asking?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: 'You’re not signed in. Sign in again, then retry.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { boardId?: string };
  const boardId = typeof body.boardId === 'string' ? body.boardId : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(boardId)) return json({ error: 'Which World? (missing id)' }, 400);

  // 2. The database decides, as the caller (auth.uid() = owner_id or nothing happens).
  const asCaller = createClient(url, pKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: removed, error: delErr } = await asCaller.rpc('delete_world', { p_board_id: boardId });
  if (delErr) {
    const denied = delErr.code === '42501' || /owner/i.test(delErr.message);
    return json({ error: denied ? delErr.message : `Couldn’t delete the World: ${delErr.message}` }, denied ? 403 : 500);
  }
  const paths = ((removed as string[] | null) ?? []).filter((p) => typeof p === 'string' && p.length > 0);

  // 3. Storage: the returned files, then anything left in the World's own folder.
  let removedFiles = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const chunk = paths.slice(i, i + 1000);
    const { error } = await admin.storage.from('media').remove(chunk);
    if (!error) removedFiles += chunk.length;
  }
  const prefix = `boards/${boardId}`;
  for (let round = 0; round < 50; round++) {
    const { data: files, error } = await admin.storage.from('media').list(prefix, { limit: 1000 });
    if (error || !files?.length) break;
    const left = files.filter((f) => f.name).map((f) => `${prefix}/${f.name}`);
    if (!left.length) break;
    const { error: rmErr } = await admin.storage.from('media').remove(left);
    if (rmErr) break;
    removedFiles += left.length;
    if (files.length < 1000) break;
  }

  // 4. Done with these; anything that failed stays queued for a later retry.
  if (paths.length) await admin.from('storage_cleanup').delete().in('path', paths);

  return json({ ok: true, removedFiles });
});
