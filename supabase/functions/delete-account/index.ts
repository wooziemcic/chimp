// Chimp · Phase 6D · delete-account (Supabase Edge Function, Deno)
//
// Deletes the CALLER's own Chimp account. The app sends only its session
// token; there is no user id in the request, so nobody can delete someone
// else. The service key lives only here (Supabase provides it to every Edge
// Function); it is never in the app.
//
//   1. verify the caller's session → their user id
//   2. prepare_account_deletion(): owned Worlds are handed on or deleted
//      (0005: deleted ones through the same teardown as delete-world),
//      their 1:1 chats end, others' replies/likes on their content go
//   3. remove their Storage files (their own folders + deleted Worlds' covers)
//   4. auth.admin.deleteUser(): the Auth user is hard-deleted, which cascades
//      to the profile and everything that references it, and frees the email
//      and the username for a new account
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  delete-account  → paste this file → Deploy.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = serviceKey();
  if (!url || !key) return json({ error: 'The server is missing its Supabase configuration.' }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is asking? Only a valid session counts.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoErr || !user) return json({ error: 'You’re not signed in. Sign in again, then retry.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { confirm?: string; transferWorlds?: boolean };
  if (body.confirm !== 'DELETE') return json({ error: 'Deletion needs the explicit confirmation.' }, 400);

  // 2. Relational clean-up that needs decisions (Worlds, chats, others' replies).
  const { data: prep, error: prepErr } = await admin.rpc('prepare_account_deletion', { p_uid: user.id, p_transfer: body.transferWorlds === true });
  if (prepErr) return json({ error: `Couldn’t prepare the deletion: ${prepErr.message}` }, 500);
  const deletedWorlds: string[] = (prep as { deleted_boards?: string[] } | null)?.deleted_boards ?? [];
  // 0005: files of the deleted Worlds' content (incl. other members' Drift photos).
  const worldFiles: string[] = ((prep as { paths?: string[] } | null)?.paths ?? []).filter((p) => typeof p === 'string' && p.length > 0);

  // 3. Storage: those files, everything in the person's own folders, and deleted Worlds' folders.
  let removed = 0;
  for (let i = 0; i < worldFiles.length; i += 1000) {
    const chunk = worldFiles.slice(i, i + 1000);
    const { error } = await admin.storage.from('media').remove(chunk);
    if (!error) removed += chunk.length;
  }
  if (worldFiles.length) await admin.from('storage_cleanup').delete().in('path', worldFiles);
  const prefixes = ['avatars', 'posts', 'drift', 'stories', 'chat'].map((f) => `${f}/${user.id}`).concat(deletedWorlds.map((id) => `boards/${id}`));
  for (const prefix of prefixes) {
    for (let round = 0; round < 50; round++) {
      const { data: files, error } = await admin.storage.from('media').list(prefix, { limit: 1000 });
      if (error || !files?.length) break;
      const paths = files.filter((f) => f.name).map((f) => `${prefix}/${f.name}`);
      if (!paths.length) break;
      const { error: rmErr } = await admin.storage.from('media').remove(paths);
      if (rmErr) break;
      removed += paths.length;
      if (files.length < 1000) break;
    }
  }

  // 4. The Auth user itself (hard delete: the email can sign up again).
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id, false);
  if (delErr) return json({ error: `Couldn’t delete the account: ${delErr.message}` }, 500);

  return json({ ok: true, removedFiles: removed, deletedWorlds: deletedWorlds.length, handedOnWorlds: (prep as { handed_on?: number } | null)?.handed_on ?? 0 });
});
