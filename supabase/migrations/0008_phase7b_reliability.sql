-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 7B · Reliability, realtime, security & logic hardening
--
-- Run AFTER 0007 (it checks). Idempotent: safe to run twice. Never re-run
-- 0001–0007 after it. RLS stays on everywhere; nothing is widened.
--
--   1. user_events            one private, realtime feed of "something changed
--                             for you" (connection request / accepted, mutual
--                             Crush, Vibe request / accepted / updated,
--                             challenge your turn / completed, plan waiting /
--                             updated). Written only by triggers. Random ids
--                             (a Realtime DELETE reveals nothing). The client
--                             listens to it and reconciles; it is also the
--                             foundation for push notifications later.
--   2. set_connection()       explicit, idempotent connection intents
--                             (request / accept / decline / cancel / disconnect).
--                             Build 4's request_connection() is unchanged.
--                             Direct inserts/updates of connections are closed
--                             (they allowed forcing a "connected" row).
--   3. search_people()        server-side people search (new users are findable).
--   4. View-once, private     a private bucket (vibe-media); view-once photos
--                             must live in it; only the Edge Function
--                             `view-once` (server key) can open one: once, by
--                             the recipient, while the Vibe is active and
--                             nobody is blocked. Nothing is ever public.
--   5. Media                  media rows only for your own folders; the media
--                             table never exposes private files.
--   6. Vibe request expiry    pending requests expire after N days (14).
--   7. Two Truths             a free-text challenge; the lie stays hidden.
--   8. Age                    corrections only within 24 h; afterwards only +1
--                             a year. 18+ stays enforced server-side.
--   9. Moderation             report status / review fields + a moderation
--                             queue (schema `moderation`, not exposed to the app).
-- ════════════════════════════════════════════════════════════════════════════

-- All or nothing: a failure part-way leaves the database exactly as it was.
begin;

do $$ begin
  if not exists (select 1 from pg_class where relname = 'view_once_media' and relnamespace = 'public'::regnamespace) then
    raise exception 'Run 0007_phase7a_after_dark.sql first.';
  end if;
end $$;

-- ─── 0. Settings (server-side knobs; nobody reads them through the API) ─────

create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values
  ('vibe_request_ttl_days', '14'),
  ('view_once_ttl_days', '14'),
  ('user_events_keep_days', '30'),
  ('user_events_per_actor_hour', '30')
on conflict (key) do nothing;

create or replace function public._setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;

-- ─── 1. user_events ──────────────────────────────────────────────────────────

create table if not exists public.user_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,   -- who it is for
  kind       text not null check (kind in (
               'connection_request', 'connection_accepted', 'connection_updated',
               'mutual_crush', 'relationship_updated',
               'vibe_request', 'vibe_accepted', 'vibe_updated',
               'challenge_your_turn', 'challenge_completed',
               'plan_waiting', 'plan_updated',
               'message_received')),
  actor_id   uuid references public.profiles (id) on delete cascade,
  ref_id     uuid,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists user_events_actor_idx on public.user_events (user_id, actor_id, created_at desc);
create index if not exists user_events_user_idx on public.user_events (user_id, created_at desc);
alter table public.user_events enable row level security;
drop policy if exists "events own read" on public.user_events;
create policy "events own read" on public.user_events for select to authenticated using (user_id = auth.uid());
-- No insert / update / delete policies: only the triggers below write here.

-- Internal: record an event (never across a block, never to yourself).
-- No de-duplication: a quick pause → resume must deliver both, or a phone
-- could reconcile in between and stay on the stale state.
create or replace function public._emit(p_user uuid, p_kind text, p_actor uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  -- Account deletion cascades through these tables: nobody to tell.
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  if p_actor is not null and not exists (select 1 from public.profiles where id = p_actor) then p_actor := null; end if;
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  -- One person can't flood another (e.g. request / cancel in a loop): at most
  -- N events per sender per hour. Nothing is lost for the recipient: the app
  -- re-reads the real state on foreground / reconnect.
  if p_actor is not null and (select count(*) from public.user_events e
                               where e.user_id = p_user and e.actor_id = p_actor and e.created_at > now() - interval '1 hour')
                              >= public._setting_int('user_events_per_actor_hour', 30) then
    return;
  end if;
  insert into public.user_events (user_id, kind, actor_id, ref_id) values (p_user, p_kind, p_actor, p_ref);
end $$;

-- Mark my events seen (badges).
create or replace function public.mark_events_seen(p_before timestamptz default now()) returns void
language sql security definer set search_path = public as $$
  update public.user_events set seen_at = now() where user_id = auth.uid() and seen_at is null and created_at <= p_before;
$$;

-- Connections → events
create or replace function public.connections_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'requested' then
      other := case when new.user_a = new.requested_by then new.user_b else new.user_a end;
      perform public._emit(other, 'connection_request', new.requested_by, null);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'requested' and new.status = 'connected' then
      other := case when new.user_a = new.requested_by then new.user_b else new.user_a end;
      perform public._emit(new.requested_by, 'connection_accepted', other, null);
    end if;
  elsif tg_op = 'DELETE' then
    -- Declined / cancelled / disconnected: the other side's view must update too.
    other := case when old.user_a = auth.uid() then old.user_b when old.user_b = auth.uid() then old.user_a end;
    if other is not null then
      perform public._emit(other, 'connection_updated', auth.uid(), null);
    else
      perform public._emit(old.user_a, 'connection_updated', null, null);
      perform public._emit(old.user_b, 'connection_updated', null, null);
    end if;
    return old;
  end if;
  return new;
end $$;
drop trigger if exists connections_events on public.connections;
create trigger connections_events after insert or update or delete on public.connections for each row execute function public.connections_events();

-- Crushes → events (ONLY when mutual: a one-way Crush is never announced)
create or replace function public.crushes_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.crushes c where c.from_id = new.to_id and c.to_id = new.from_id) then
      perform public._emit(new.from_id, 'mutual_crush', new.to_id, null);
      perform public._emit(new.to_id, 'mutual_crush', new.from_id, null);
    end if;
    return new;
  end if;
  -- A Crush withdrawn while it was mutual: the other side's Spark goes away.
  if exists (select 1 from public.crushes c where c.from_id = old.to_id and c.to_id = old.from_id) then
    perform public._emit(old.to_id, 'relationship_updated', old.from_id, null);
  end if;
  return old;
end $$;
drop trigger if exists crushes_events on public.crushes;
create trigger crushes_events after insert or delete on public.crushes for each row execute function public.crushes_events();

-- Vibes → events
create or replace function public.vibes_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid; actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    recipient := case when new.user_low = new.requested_by then new.user_high else new.user_low end;
    perform public._emit(recipient, 'vibe_request', new.requested_by, new.id);
    return new;
  end if;
  if old.status = 'pending' and new.status = 'active' then
    perform public._emit(new.requested_by, 'vibe_accepted', case when new.user_low = new.requested_by then new.user_high else new.user_low end, new.id);
  elsif new.status is distinct from old.status or new.paused_by is distinct from old.paused_by then
    if actor in (new.user_low, new.user_high) then
      perform public._emit(case when new.user_low = actor then new.user_high else new.user_low end, 'vibe_updated', actor, new.id);
    else
      -- The server did it (expiry): tell both.
      perform public._emit(new.user_low, 'vibe_updated', null, new.id);
      perform public._emit(new.user_high, 'vibe_updated', null, new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vibes_events on public.vibes;
create trigger vibes_events after insert or update on public.vibes for each row execute function public.vibes_events();

-- Challenges → events
create or replace function public.challenges_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.vibes; actor uuid := auth.uid();
begin
  select * into v from public.vibes where id = new.vibe_id;
  if not found then return new; end if;
  if tg_op = 'INSERT' then
    perform public._emit(case when v.user_low = new.sent_by then v.user_high else v.user_low end, 'challenge_your_turn', new.sent_by, new.id);
  elsif old.status = 'waiting' and new.status = 'completed' then
    perform public._emit(case when v.user_low = actor then v.user_high when v.user_high = actor then v.user_low end, 'challenge_completed', actor, new.id);
  end if;
  return new;
end $$;
drop trigger if exists challenges_events on public.vibe_challenges;
create trigger challenges_events after insert or update on public.vibe_challenges for each row execute function public.challenges_events();

-- Open Loops / Plans inside Vibes → events (normal chats already update live)
create or replace function public.loops_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.vibes; actor uuid := auth.uid(); other uuid;
begin
  select * into v from public.vibes where conversation_id = coalesce(new.conversation_id, old.conversation_id);
  if not found then return coalesce(new, old); end if;
  other := case when v.user_low = actor then v.user_high when v.user_high = actor then v.user_low end;
  if tg_op = 'DELETE' then
    perform public._emit(other, 'plan_updated', actor, v.id);
    return old;
  end if;
  if new.plan_state = 'proposed'
     and (tg_op = 'INSERT' or old.plan_state is distinct from 'proposed' or new.plan_by is distinct from old.plan_by
          or new.plan_at is distinct from old.plan_at or new.title is distinct from old.title or new.location_text is distinct from old.location_text) then
    perform public._emit(case when v.user_low = new.plan_by then v.user_high else v.user_low end, 'plan_waiting', new.plan_by, new.id);
  else
    perform public._emit(other, 'plan_updated', actor, new.id);
  end if;
  return new;
end $$;
drop trigger if exists loops_events on public.chat_loops;
create trigger loops_events after insert or update or delete on public.chat_loops for each row execute function public.loops_events();

-- Housekeeping (server key / scheduled job only).
create or replace function public.purge_old_events() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.user_events where created_at < now() - make_interval(days => public._setting_int('user_events_keep_days', 30));
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── 2. Connections: explicit, idempotent intents ───────────────────────────

-- Close the direct-write hole: with the 0001 policies anyone could insert or
-- update a row to status 'connected' without the other person. Every app
-- version (Build 4 included) changes connections only through functions.
drop policy if exists "connections insert" on public.connections;
drop policy if exists "connections update" on public.connections;

-- Returns my view after the change: 'none' | 'requested_by_me' | 'requested_of_me' | 'connected'.
create or replace function public.set_connection(p_other uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a uuid; b uuid; cur public.connections;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_other is null or p_other = me then raise exception 'Not available.' using errcode = '22023'; end if;
  if p_action not in ('request', 'accept', 'decline', 'cancel', 'disconnect') then raise exception 'Unknown action.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'Not available.' using errcode = '22023'; end if;
  a := least(me, p_other); b := greatest(me, p_other);
  perform pg_advisory_xact_lock(hashtext('conn:' || a::text || b::text));
  select * into cur from public.connections where user_a = a and user_b = b;

  if p_action = 'request' then
    if public.is_blocked_between(me, p_other) then raise exception 'Not available.' using errcode = '42501'; end if;
    if cur is null then
      insert into public.connections (user_a, user_b, requested_by, status) values (a, b, me, 'requested');
      return 'requested_by_me';
    elsif cur.status = 'requested' and cur.requested_by <> me then
      update public.connections set status = 'connected' where user_a = a and user_b = b;   -- they already asked
      return 'connected';
    end if;
  elsif p_action = 'accept' then
    if cur.status = 'requested' and cur.requested_by <> me then
      if public.is_blocked_between(me, p_other) then raise exception 'Not available.' using errcode = '42501'; end if;
      update public.connections set status = 'connected' where user_a = a and user_b = b;
      return 'connected';
    end if;
  elsif p_action = 'decline' then
    if cur.status = 'requested' and cur.requested_by <> me then
      delete from public.connections where user_a = a and user_b = b;
      return 'none';
    end if;
  elsif p_action = 'cancel' then
    if cur.status = 'requested' and cur.requested_by = me then
      delete from public.connections where user_a = a and user_b = b;
      return 'none';
    end if;
  elsif p_action = 'disconnect' then
    if cur.status = 'connected' then
      delete from public.connections where user_a = a and user_b = b;
      return 'none';
    end if;
  end if;
  -- Nothing to do (a repeat tap, or the state already moved on): report the truth.
  select * into cur from public.connections where user_a = a and user_b = b;
  if cur is null then return 'none'; end if;
  if cur.status = 'connected' then return 'connected'; end if;
  return case when cur.requested_by = me then 'requested_by_me' else 'requested_of_me' end;
end $$;

-- ─── 3. People search (finished profiles; never across a block) ─────────────

create or replace function public.search_people(p_q text, p_limit int default 20)
returns table (id uuid, username text, display_name text, avatar_url text, city text)
language sql stable security definer set search_path = public as $$
  with q as (select lower(regexp_replace(btrim(coalesce(p_q, '')), '[%_\\]', '', 'g')) as s)
  select p.id, p.username, p.display_name, p.avatar_url, p.city
    from public.profiles p, q
   where auth.uid() is not null
     and char_length(q.s) >= 2
     and p.id <> auth.uid()
     and p.onboarded_at is not null
     and not public.is_blocked_between(auth.uid(), p.id)
     and (lower(p.username) like q.s || '%' or lower(coalesce(p.display_name, '')) like '%' || q.s || '%')
   order by (lower(p.username) = q.s) desc, (lower(p.username) like q.s || '%') desc, p.display_name
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ─── 4. View-once: a private bucket, opened only by the server ──────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vibe-media', 'vibe-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload into your own once/{you}/ folder. No select, update or delete
-- policy: nobody (sender included) can read or list these files through the
-- API; only the view-once Edge Function, with the server key, reads them.
drop policy if exists "vibe media insert" on storage.objects;
create policy "vibe media insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'vibe-media' and (storage.foldername(name))[1] = 'once' and (storage.foldername(name))[2] = auth.uid()::text
);

-- Sealed, whatever other storage policies exist on the project: the app can
-- never read, change or delete a vibe-media file (restrictive policies AND
-- with every permissive one). The server key bypasses RLS.
drop policy if exists "vibe media sealed read" on storage.objects;
create policy "vibe media sealed read" on storage.objects as restrictive for select to anon, authenticated using (bucket_id <> 'vibe-media');
drop policy if exists "vibe media sealed update" on storage.objects;
create policy "vibe media sealed update" on storage.objects as restrictive for update to anon, authenticated using (bucket_id <> 'vibe-media') with check (bucket_id <> 'vibe-media');
drop policy if exists "vibe media sealed delete" on storage.objects;
create policy "vibe media sealed delete" on storage.objects as restrictive for delete to anon, authenticated using (bucket_id <> 'vibe-media');

-- Media rows: only for your own folders (the 0001 policy only checked the
-- owner). A video's poster must sit next to the video (the same folder); no
-- path may climb out of its folder.
drop policy if exists "media insert" on public.media;
create policy "media insert" on public.media for insert to authenticated with check (
  owner_id = auth.uid()
  and storage_path not like '%..%' and coalesce(poster_path, '') not like '%..%'
  and (poster_path is null or (bucket = 'media'
       and split_part(poster_path, '/', 1) = split_part(storage_path, '/', 1)
       and split_part(poster_path, '/', 2) = split_part(storage_path, '/', 2)))
  and (
    (bucket = 'media' and split_part(storage_path, '/', 1) in ('avatars', 'posts', 'drift', 'stories', 'chat', 'afterdark')
       and split_part(storage_path, '/', 2) = auth.uid()::text)
    or (bucket = 'media' and split_part(storage_path, '/', 1) = 'boards'
       and exists (select 1 from public.boards bo where bo.id = split_part(storage_path, '/', 2) and bo.owner_id = auth.uid()))
    or (bucket = 'vibe-media' and split_part(storage_path, '/', 1) = 'once' and split_part(storage_path, '/', 2) = auth.uid()::text
       and kind = 'image')
  )
);

-- Reading media rows: private (vibe-media) rows only by their owner; chat and
-- After Dark rows by their owner and members of a conversation that uses them.
drop policy if exists "media read" on public.media;
create policy "media read" on public.media for select to authenticated using (
  owner_id = auth.uid()
  or (bucket = 'media' and storage_path not like 'chat/%' and storage_path not like 'afterdark/%')
  or (bucket = 'media' and exists (select 1 from public.messages m
              where m.media_id = media.id and m.deleted_at is null and public.is_conversation_member(m.conversation_id)))
);

-- Rows written before this policy: a poster outside its video's folder could
-- point at someone else's file (and a World / account deletion would remove
-- it with the server key). Forget such posters.
update public.media set poster_path = null
 where poster_path is not null
   and (bucket <> 'media' or poster_path like '%..%'
        or split_part(poster_path, '/', 1) <> split_part(storage_path, '/', 1)
        or split_part(poster_path, '/', 2) <> split_part(storage_path, '/', 2));

-- A file is "safely yours to delete" only inside its owner's folder (or a World it belongs to).
create or replace function public._media_path_safe(p_owner uuid, p_bucket text, p_path text, p_board text default null) returns boolean
language sql immutable set search_path = public as $$
  select p_path is not null and p_path not like '%..%' and (
    (p_bucket = 'media' and split_part(p_path, '/', 1) in ('avatars', 'posts', 'drift', 'stories', 'chat', 'afterdark')
       and split_part(p_path, '/', 2) = p_owner::text)
    or (p_bucket = 'media' and p_board is not null and split_part(p_path, '/', 1) = 'boards' and split_part(p_path, '/', 2) = p_board)
    or (p_bucket = 'vibe-media' and split_part(p_path, '/', 1) = 'once' and split_part(p_path, '/', 2) = p_owner::text));
$$;

-- World teardown (0005), now deleting only media that belongs to the item's
-- author (or the World's owner, for its cover) and only inside their folders:
-- a post can no longer smuggle someone else's media id or poster into a
-- deletion that runs with the server key.
create or replace function public._world_teardown(p_board_id text) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  b          public.boards;
  keep_buzz  boolean;
  gone_buzz  uuid[];
  gone_drift uuid[];
  gone_story uuid[];
  mids       uuid[];
  paths      text[] := '{}';
begin
  select * into b from public.boards where id = p_board_id;
  if not found then return paths; end if;
  keep_buzz := b.visibility = 'public';

  select coalesce(array_agg(id), '{}') into gone_drift from public.drift_items where board_id = p_board_id;
  select coalesce(array_agg(id), '{}') into gone_story from public.story_items where board_id = p_board_id;
  if keep_buzz then
    gone_buzz := '{}';
  else
    select coalesce(array_agg(id), '{}') into gone_buzz from public.buzz_items where board_id = p_board_id;
  end if;

  -- Media those items (and the cover) used — only the author's own (the cover: the owner's).
  select coalesce(array_agg(distinct q.m), '{}') into mids from (
    select x.m, x.author from (select unnest(d.media_ids) as m, d.author_id as author from public.drift_items d where d.id = any (gone_drift)) x
    union select x.m, x.author from (select unnest(z.media_ids) as m, z.author_id as author from public.buzz_items z where z.id = any (gone_buzz)) x
    union select st.media_id, st.author_id from public.story_items st where st.id = any (gone_story)
    union select b.cover_media_id, b.owner_id where b.cover_media_id is not null
  ) q
  join public.media md on md.id = q.m and md.owner_id = q.author;

  delete from public.comments  where (target_kind = 'drift' and target_id = any (select unnest(gone_drift)::text))
                                  or (target_kind = 'buzz'  and target_id = any (select unnest(gone_buzz)::text))
                                  or (target_kind = 'story' and target_id = any (select unnest(gone_story)::text));
  delete from public.reactions where (target_kind = 'drift' and target_id = any (select unnest(gone_drift)::text))
                                  or (target_kind = 'buzz'  and target_id = any (select unnest(gone_buzz)::text))
                                  or (target_kind = 'story' and target_id = any (select unnest(gone_story)::text));

  if keep_buzz then
    update public.buzz_items set board_id = null where board_id = p_board_id;
  else
    delete from public.buzz_items where id = any (gone_buzz);
  end if;
  delete from public.story_items where id = any (gone_story);
  delete from public.drift_items where id = any (gone_drift);

  update public.boards set cover_media_id = null where id = p_board_id;
  delete from public.boards where id = p_board_id;

  with gone as (
    delete from public.media m
     where m.id = any (mids)
       and not exists (select 1 from public.buzz_items x  where m.id = any (x.media_ids))
       and not exists (select 1 from public.drift_items d where m.id = any (d.media_ids))
       and not exists (select 1 from public.story_items s where s.media_id = m.id)
       and not exists (select 1 from public.profiles p    where p.avatar_media_id = m.id)
       and not exists (select 1 from public.boards bo     where bo.cover_media_id = m.id)
       and not exists (select 1 from public.messages x    where x.media_id = m.id)
    returning m.owner_id, m.bucket, m.storage_path, m.poster_path)
  select coalesce(array_agg(q.p) filter (where q.p is not null), '{}') into paths
    from (select storage_path as p from gone where public._media_path_safe(owner_id, bucket, storage_path, p_board_id)
          union all select poster_path from gone where public._media_path_safe(owner_id, bucket, poster_path, p_board_id)) q;

  insert into public.storage_cleanup (path, board_id) select unnest(paths), p_board_id on conflict (path) do nothing;
  return paths;
end $$;

alter table public.view_once_media add column if not exists purged_at timestamptz;
-- 0007 allowed one file to be sent as view-once twice. Keep the first; the
-- others are treated as already gone (so the unique index below can exist).
with d as (
  select message_id, row_number() over (partition by media_id order by message_id) as rn
    from public.view_once_media where media_id is not null)
update public.view_once_media vo set media_id = null, purged_at = coalesce(vo.purged_at, now())
  from d where d.message_id = vo.message_id and d.rn > 1;
create unique index if not exists view_once_media_media_uidx on public.view_once_media (media_id) where media_id is not null;

-- Messages: the file must be in the right place for the message.
--   view-once photo → your own private once/ file, never used for another view-once
--   normal photo / voice → a public-bucket file (never a private one)
create or replace function public.messages_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare md public.media;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or new.media_id is null then return new; end if;
  select * into md from public.media where id = new.media_id;
  if not found or md.owner_id <> auth.uid() then
    raise exception 'That file can''t be sent as this message.' using errcode = '42501';
  end if;
  if new.view_once then
    if md.bucket <> 'vibe-media' or md.kind <> 'image' then
      raise exception 'View-once photos must be sent privately.' using errcode = '42501';
    end if;
    if exists (select 1 from public.view_once_media vo where vo.media_id = md.id) then
      raise exception 'That photo was already sent.' using errcode = '42501';
    end if;
  elsif md.bucket <> 'media' then
    raise exception 'That file can''t be sent as this message.' using errcode = '42501';
  end if;
  return new;
end $$;
-- Name order matters: runs after messages_guard_7a_ins (type/kind checks) and
-- before messages_view_once_ins (which moves the file off the message row).
drop trigger if exists messages_guard_8_media on public.messages;
create trigger messages_guard_8_media before insert on public.messages for each row execute function public.messages_media_guard();

-- The app can no longer open a view-once photo directly (0007 handed back the
-- path). Opening is the view-once Edge Function's job: it calls this with the
-- server key, for the signed-in user it verified.
create or replace function public.view_once_open_as(p_message uuid, p_user uuid)
returns table (bucket text, path text, mime text)
language plpgsql security definer set search_path = public as $$
declare m public.messages; vo public.view_once_media; md public.media;
begin
  select * into m from public.messages where id = p_message for update;
  if not found or not exists (select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = p_user and cm.status <> 'left') then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  if not m.view_once then raise exception 'Not a view-once photo.' using errcode = '22023'; end if;
  if m.sender_id = p_user then raise exception 'Only the person it was sent to can open it.' using errcode = '42501'; end if;
  if m.deleted_at is not null then raise exception 'This photo was unsent.' using errcode = '22023'; end if;
  if m.viewed_at is not null then raise exception 'Already viewed.' using errcode = '22023'; end if;
  if not exists (select 1 from public.vibes v where v.conversation_id = m.conversation_id and v.status = 'active'
                  and not public.is_blocked_between(v.user_low, v.user_high)) then
    raise exception 'This Vibe isn''t active.' using errcode = '42501';
  end if;
  select * into vo from public.view_once_media where message_id = m.id for update;
  if not found or vo.opened_at is not null then raise exception 'Already viewed.' using errcode = '22023'; end if;
  if vo.purged_at is not null or vo.media_id is null then raise exception 'This photo expired.' using errcode = '22023'; end if;
  select * into md from public.media where id = vo.media_id;
  -- Only the sender's own private file, in the sender's own folder.
  if not found or md.bucket <> 'vibe-media' or md.owner_id <> m.sender_id
     or not public._media_path_safe(md.owner_id, md.bucket, md.storage_path) then
    raise exception 'This photo expired.' using errcode = '22023';
  end if;
  update public.view_once_media set opened_at = now() where message_id = m.id;
  update public.messages set viewed_at = now() where id = m.id;
  return query select md.bucket, md.storage_path, md.mime_type;
end $$;

create or replace function public.view_once_mark_purged(p_message uuid) returns void
language sql security definer set search_path = public as $$
  update public.view_once_media set purged_at = now() where message_id = p_message;
$$;

-- The server couldn't hand the photo over (a storage hiccup): undo the opening
-- so the recipient can try again. Only while the file hasn't been deleted.
create or replace function public.view_once_release(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.view_once_media set opened_at = null where message_id = p_message and purged_at is null;
  if found then update public.messages set viewed_at = null where id = p_message; end if;
end $$;

-- What the cleanup should delete: opened files that weren't deleted at once,
-- unopened ones past their time, unsent ones, ones in Vibes that ended or
-- were blocked (a paused Vibe keeps its unopened photos). A path is only
-- handed out if it's inside the sender's own folder; anything else is just
-- marked gone (null path) — never deleted on someone's say-so.
create or replace function public.view_once_sweep_candidates(p_limit int default 200)
returns table (message_id uuid, bucket text, path text)
language sql stable security definer set search_path = public as $$
  select vo.message_id, md.bucket,
         case when md.owner_id = m.sender_id
                   and ((md.bucket = 'vibe-media' and public._media_path_safe(md.owner_id, md.bucket, md.storage_path))
                        or (md.bucket = 'media' and md.storage_path like 'chat/' || md.owner_id::text || '/%' and md.storage_path not like '%..%'))
              then md.storage_path end
    from public.view_once_media vo
    join public.media md on md.id = vo.media_id
    join public.messages m on m.id = vo.message_id
    left join public.vibes v on v.conversation_id = m.conversation_id
   where vo.purged_at is null
     and (vo.opened_at is not null
          or m.deleted_at is not null
          or m.created_at < now() - make_interval(days => public._setting_int('view_once_ttl_days', 14))
          or v.id is null
          or v.status = 'closed'
          or public.is_blocked_between(v.user_low, v.user_high))
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- Files in the private bucket that no live view-once photo points at any more
-- (uploaded but never sent, or whose media row was deleted), a day old.
create or replace function public.view_once_orphans(p_limit int default 200)
returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'vibe-media'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.media md
                       join public.view_once_media vo on vo.media_id = md.id
                      where md.bucket = 'vibe-media' and md.storage_path = o.name
                        and vo.purged_at is null)
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- ─── 6. Pending Vibe requests expire ─────────────────────────────────────────

create or replace function public._expire_pending_vibes(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.vibes
     set status = 'closed', closed_at = now(), closed_by = null, updated_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(days => public._setting_int('vibe_request_ttl_days', 14))
     and (p_user is null or p_user in (user_low, user_high));
  get diagnostics n = row_count;
  return n;
end $$;
-- For a scheduled job (server key).
create or replace function public.expire_stale_vibes() returns integer
language sql security definer set search_path = public as $$ select public._expire_pending_vibes(null); $$;

create or replace function public.request_vibe(p_other uuid, p_origin text, p_origin_text text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lo uuid; hi uuid; v public.vibes; cid uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_other is null or p_other = me then raise exception 'Not available.' using errcode = '22023'; end if;
  if p_origin not in ('mutual_crush', 'open_loop', 'interest') then raise exception 'Unknown origin.' using errcode = '22023'; end if;
  if p_origin_text is not null and char_length(p_origin_text) > 200 then raise exception 'Keep it under 200 characters.' using errcode = '22023'; end if;
  if not exists (select 1 from public.after_dark_profiles a where a.user_id = me and a.age >= 18) then
    raise exception 'Confirm you are 18+ in After Dark first.' using errcode = '42501';
  end if;
  if public.is_blocked_between(me, p_other) or not public._romantic_open(me) or not public._romantic_open(p_other) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if p_origin = 'mutual_crush' then
    if not (exists (select 1 from public.crushes where from_id = me and to_id = p_other)
            and exists (select 1 from public.crushes where from_id = p_other and to_id = me)) then
      raise exception 'Not available.' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.after_dark_profiles a where a.user_id = p_other and a.discoverable) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.after_dark_profiles a where a.user_id = p_other and a.age >= 18) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  lo := least(me, p_other); hi := greatest(me, p_other);
  perform pg_advisory_xact_lock(hashtext(lo::text || hi::text));
  -- 7B: a request nobody answered in time is closed first.
  update public.vibes set status = 'closed', closed_at = now(), closed_by = null, updated_at = now()
   where user_low = lo and user_high = hi and status = 'pending'
     and created_at < now() - make_interval(days => public._setting_int('vibe_request_ttl_days', 14));
  select * into v from public.vibes x where x.user_low = lo and x.user_high = hi and x.status <> 'closed';
  if found then return v.id; end if;
  select * into v from public.vibes x where x.user_low = lo and x.user_high = hi order by x.created_at desc limit 1;
  if found and v.closed_by = p_other and not (v.requested_by = p_other and v.accepted_at is null) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if found and v.closed_by = me and v.requested_by = me and v.accepted_at is null and v.closed_at > now() - interval '7 days' then
    raise exception 'You can ask again later.' using errcode = '42501';
  end if;
  insert into public.conversations (kind, created_by) values ('vibe', me) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, status) values (cid, me, 'active'), (cid, p_other, 'request');
  insert into public.vibes (conversation_id, user_low, user_high, requested_by, origin, origin_text)
  values (cid, lo, hi, me, p_origin, nullif(btrim(coalesce(p_origin_text, '')), '')) returning * into v;
  insert into public.vibe_members (vibe_id, user_id, role) values (v.id, me, 'requester'), (v.id, p_other, 'recipient');
  return v.id;
end $$;

create or replace function public.respond_vibe(p_vibe uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v public.vibes;
begin
  select * into v from public.vibes where id = p_vibe for update;
  if not found or me not in (v.user_low, v.user_high) then raise exception 'Vibe not found.' using errcode = '42501'; end if;
  if v.status = 'pending' and v.created_at < now() - make_interval(days => public._setting_int('vibe_request_ttl_days', 14)) then
    raise exception 'This request expired.' using errcode = '22023';   -- my_vibes() / request_vibe() close it
  end if;
  if v.status <> 'pending' then raise exception 'This Vibe is no longer waiting.' using errcode = '22023'; end if;
  if not exists (select 1 from public.vibe_members where vibe_id = v.id and user_id = me and role = 'recipient') then
    raise exception 'Only the person who was asked can answer.' using errcode = '42501';
  end if;
  if p_accept then
    if not exists (select 1 from public.after_dark_profiles a where a.user_id = me and a.age >= 18) then
      raise exception 'Confirm you are 18+ in After Dark first.' using errcode = '42501';
    end if;
    if public.is_blocked_between(v.user_low, v.user_high) then raise exception 'Not available.' using errcode = '42501'; end if;
    update public.vibes set status = 'active', accepted_at = now(), updated_at = now() where id = v.id;
    update public.conversation_members set status = 'active' where conversation_id = v.conversation_id and user_id = me;
  else
    update public.vibes set status = 'closed', closed_by = me, closed_at = now(), updated_at = now() where id = v.id;
    insert into public.vibe_closures (vibe_id, user_id, reason) values (v.id, me, 'declined');
    insert into public.after_dark_passes (from_id, to_id)
    values (me, case when v.user_low = me then v.user_high else v.user_low end) on conflict do nothing;
  end if;
end $$;

-- my_vibes(): + `expired` (a request that ran out of time, not an ending);
-- stale requests of mine are closed on the way.
drop function if exists public.my_vibes();
create or replace function public.my_vibes()
returns table (
  vibe_id uuid, conversation_id uuid, other_id uuid, status text, my_role text,
  origin text, origin_text text, requested_by_me boolean, paused_by_me boolean, closed_by_me boolean,
  my_allows_photos boolean, my_allows_voice boolean, their_allows_photos boolean, their_allows_voice boolean,
  created_at timestamptz, updated_at timestamptz,
  last_body text, last_type text, last_sender uuid, last_at timestamptz, unread integer,
  challenges_completed integer, challenges_waiting_on_me integer, challenges_waiting_on_them integer,
  open_loops integer, plans_pending integer, plans_confirmed integer,
  messages_from_me integer, messages_from_them integer,
  expired boolean
)
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public._expire_pending_vibes(auth.uid());
  return query
  select v.id, v.conversation_id, o.user_id, v.status, me.role,
         v.origin, v.origin_text, coalesce(v.requested_by = auth.uid(), false), coalesce(v.paused_by = auth.uid(), false), coalesce(v.closed_by = auth.uid(), false),
         me.allows_photos, me.allows_voice, o.allows_photos, o.allows_voice,
         v.created_at, v.updated_at,
         case when lm.deleted_at is null then lm.body end, lm.message_type, lm.sender_id, lm.created_at,
         (select count(*)::int from public.messages x
           where x.conversation_id = v.conversation_id and x.sender_id <> auth.uid() and x.deleted_at is null and x.created_at > cm.last_read_at),
         (select count(*)::int from public.vibe_challenges c where c.vibe_id = v.id and c.status = 'completed'),
         (select count(*)::int from public.vibe_challenges c where c.vibe_id = v.id and c.status = 'waiting'
            and not exists (select 1 from public.vibe_challenge_answers a where a.challenge_id = c.id and a.user_id = auth.uid())),
         (select count(*)::int from public.vibe_challenges c where c.vibe_id = v.id and c.status = 'waiting'
            and exists (select 1 from public.vibe_challenge_answers a where a.challenge_id = c.id and a.user_id = auth.uid())),
         (select count(*)::int from public.chat_loops l where l.conversation_id = v.conversation_id and l.plan_state is null and l.status = 'open'),
         (select count(*)::int from public.chat_loops l where l.conversation_id = v.conversation_id and l.plan_state = 'proposed'),
         (select count(*)::int from public.chat_loops l where l.conversation_id = v.conversation_id and l.plan_state = 'confirmed'),
         (select count(*)::int from public.messages x where x.conversation_id = v.conversation_id and x.sender_id = auth.uid() and x.deleted_at is null),
         (select count(*)::int from public.messages x where x.conversation_id = v.conversation_id and x.sender_id <> auth.uid() and x.deleted_at is null),
         (v.status = 'closed' and v.closed_by is null and v.accepted_at is null)
    from public.vibes v
    join public.vibe_members me on me.vibe_id = v.id and me.user_id = auth.uid()
    join public.vibe_members o on o.vibe_id = v.id and o.user_id <> auth.uid()
    join public.conversations c on c.id = v.conversation_id
    left join public.conversation_members cm on cm.conversation_id = v.conversation_id and cm.user_id = auth.uid()
    left join public.messages lm on lm.id = c.last_message_id
   where auth.uid() in (v.user_low, v.user_high)
   order by v.updated_at desc;
end $$;

-- ─── 7. Two Truths (free text; the lie stays hidden until they guess) ───────

alter table public.vibe_challenges add column if not exists statements text[];
alter table public.vibe_challenges drop constraint if exists vibe_challenges_kind_check;
alter table public.vibe_challenges add constraint vibe_challenges_kind_check
  check (kind in ('same_brain', 'would_you_rather', 'predict_me', 'choose_the_night', 'fast_five', 'after_hours', 'two_truths'));
alter table public.vibe_challenges drop constraint if exists vibe_challenges_statements_check;
alter table public.vibe_challenges add constraint vibe_challenges_statements_check check (
  (kind = 'two_truths') = (statements is not null)
  and (statements is null or (cardinality(statements) = 3
       and char_length(statements[1]) between 1 and 120 and char_length(statements[2]) between 1 and 120 and char_length(statements[3]) between 1 and 120))
);

-- Plain text only: no control or invisible characters, single spaces, trimmed.
create or replace function public._clean_text(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
           '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]', '', 'g'),   -- zero-width / direction marks
           '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public.send_two_truths(p_vibe uuid, p_statements text[], p_lie int, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v public.vibes; cid uuid; s text[];
begin
  select * into v from public.vibes where id = p_vibe;
  if not found or me not in (v.user_low, v.user_high) then raise exception 'Vibe not found.' using errcode = '42501'; end if;
  if v.status <> 'active' or public.is_blocked_between(v.user_low, v.user_high) then raise exception 'Challenges are for active Vibes.' using errcode = '42501'; end if;
  if (select count(*) from public.vibe_challenges where vibe_id = v.id and sent_by = me and status = 'waiting') >= 3 then
    raise exception 'Wait for them to play the ones you sent.' using errcode = '22023';
  end if;
  if p_statements is null or cardinality(p_statements) <> 3 then raise exception 'Write three statements.' using errcode = '22023'; end if;
  s := array[public._clean_text(p_statements[1]), public._clean_text(p_statements[2]), public._clean_text(p_statements[3])];
  if exists (select 1 from unnest(s) x where char_length(x) not between 1 and 120) then
    raise exception 'Each statement needs 1 to 120 characters.' using errcode = '22023';
  end if;
  if s[1] = s[2] or s[1] = s[3] or s[2] = s[3] then raise exception 'Make the three statements different.' using errcode = '22023'; end if;
  if p_lie is null or p_lie not between 0 and 2 then raise exception 'Pick which one is the lie.' using errcode = '22023'; end if;
  insert into public.vibe_challenges (vibe_id, kind, deck, sent_by, note, statements)
  values (v.id, 'two_truths', 'tt', me, nullif(public._clean_text(p_note), ''), s) returning id into cid;
  -- The sender's answer (the lie) is hidden from the other person until they guess (0007 RLS).
  insert into public.vibe_challenge_answers (challenge_id, user_id, answers) values (cid, me, jsonb_build_array(p_lie));
  return cid;
end $$;

-- A Two Truths answer is one number: which statement is the lie (0–2). Both the
-- sender's (via send_two_truths) and the guess (via answer_challenge).
create or replace function public.two_truths_answer_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select kind from public.vibe_challenges where id = new.challenge_id) = 'two_truths' then
    if jsonb_typeof(new.answers) <> 'array' or jsonb_array_length(new.answers) <> 1
       or jsonb_typeof(new.answers -> 0) <> 'number' or (new.answers ->> 0) not in ('0', '1', '2') then
      raise exception 'Pick which one is the lie.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vibe_challenge_answers_two_truths on public.vibe_challenge_answers;
create trigger vibe_challenge_answers_two_truths before insert on public.vibe_challenge_answers
  for each row execute function public.two_truths_answer_guard();

-- ─── 8. Age: no age-hopping ──────────────────────────────────────────────────

alter table public.after_dark_profiles add column if not exists age_set_at timestamptz;     -- when it was first set
alter table public.after_dark_profiles add column if not exists age_bumped_at timestamptz;  -- last birthday (+1)
create or replace function public.after_dark_age_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.age_set_at := case when new.age is not null then now() end;
    new.age_bumped_at := null;
    return new;
  end if;
  -- These clocks are the server's, never the app's.
  new.age_set_at := old.age_set_at;
  new.age_bumped_at := old.age_bumped_at;
  if new.age is not distinct from old.age then return new; end if;
  if old.age is null then
    new.age_set_at := now();
    return new;
  end if;
  if new.age is null then raise exception 'Your age can''t be removed.' using errcode = '22023'; end if;
  -- A correction right after setting it for the first time.
  if old.age_set_at > now() - interval '24 hours' then return new; end if;
  -- A birthday: +1, at most once in ~a year.
  if new.age = old.age + 1 and coalesce(old.age_bumped_at, old.age_set_at) < now() - interval '300 days' then
    new.age_bumped_at := now();
    return new;
  end if;
  raise exception 'Your age can''t be changed now. Contact support if it''s wrong.' using errcode = '22023';
end $$;
-- Cards from before this migration: their age counts as set over a day ago
-- (no fresh correction window just because the column is new).
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'after_dark_age_guard') then
    alter table public.after_dark_profiles disable trigger after_dark_age_guard;
  end if;
  update public.after_dark_profiles set age_set_at = least(coalesce(updated_at, now()), now() - interval '25 hours')
   where age is not null and age_set_at is null;
  if exists (select 1 from pg_trigger where tgname = 'after_dark_age_guard') then
    alter table public.after_dark_profiles enable trigger after_dark_age_guard;
  end if;
end $$;
drop trigger if exists after_dark_age_guard on public.after_dark_profiles;
create trigger after_dark_age_guard before insert or update on public.after_dark_profiles for each row execute function public.after_dark_age_guard();
-- 0007's policy was FOR ALL, which included DELETE: delete + insert reset the
-- age clock. Your card can be read, created and edited — not deleted (it goes
-- with the account).
drop policy if exists "ad profile own" on public.after_dark_profiles;
drop policy if exists "ad profile own read" on public.after_dark_profiles;
create policy "ad profile own read" on public.after_dark_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "ad profile own insert" on public.after_dark_profiles;
create policy "ad profile own insert" on public.after_dark_profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "ad profile own update" on public.after_dark_profiles;
create policy "ad profile own update" on public.after_dark_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── 9. Moderation (no admin UI yet: dashboard / server key only) ───────────

alter table public.reports add column if not exists status text not null default 'open';
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('open', 'reviewed', 'actioned', 'dismissed'));
alter table public.reports add column if not exists reviewed_at timestamptz;
alter table public.reports add column if not exists reviewed_by text check (reviewed_by is null or char_length(reviewed_by) <= 120);
alter table public.reports add column if not exists resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
-- Reporters can't change a report (no update policy); the status is the moderator's.

-- The queue lives in its own schema, which the app's API never exposes and
-- the app's roles can't even see. Read it in the Supabase SQL editor (or with
-- the server key through a schema you choose to expose later).
-- A report always starts open; only moderators (server key) review it.
create or replace function public.reports_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.status := 'open';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.resolution_note := null;
  end if;
  return new;
end $$;
drop trigger if exists reports_insert_guard on public.reports;
create trigger reports_insert_guard before insert on public.reports for each row execute function public.reports_insert_guard();
-- Reporters can read their own reports, but never the moderators' notes.
revoke select on public.reports from anon, authenticated;
grant select (id, reporter_id, subject_id, vibe_id, message_id, context, reason, note, created_at, status, reviewed_at) on public.reports to authenticated;

create schema if not exists moderation;
revoke all on schema moderation from public, anon, authenticated;
grant usage on schema moderation to service_role;

create or replace view moderation.queue as
  select r.id, r.status, r.created_at, r.reason as category, r.context, r.note,
         r.reporter_id, rp.username as reporter_username,
         r.subject_id, sp.username as subject_username, sp.display_name as subject_name,
         r.vibe_id, v.status as vibe_status,
         r.message_id, left(m.body, 280) as message_excerpt, m.message_type, m.created_at as message_at,
         (select count(*) from public.reports r2 where r2.subject_id = r.subject_id) as reports_on_subject,
         r.reviewed_at, r.reviewed_by, r.resolution_note
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles sp on sp.id = r.subject_id
    left join public.vibes v on v.id = r.vibe_id
    left join public.messages m on m.id = r.message_id;
revoke all on moderation.queue from public, anon, authenticated;
grant select on moderation.queue to service_role;

create or replace function moderation.set_status(p_report uuid, p_status text, p_note text default null, p_reviewer text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('open', 'reviewed', 'actioned', 'dismissed') then raise exception 'Unknown status.'; end if;
  update public.reports
     set status = p_status, reviewed_at = case when p_status = 'open' then null else now() end,
         reviewed_by = coalesce(p_reviewer, reviewed_by), resolution_note = coalesce(p_note, resolution_note)
   where id = p_report;
  if not found then raise exception 'Report not found.'; end if;
end $$;
revoke execute on function moderation.set_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function moderation.set_status(uuid, text, text, text) to service_role;

-- ─── Realtime ─────────────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.user_events; exception when duplicate_object then null; end;
  end if;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Internal helpers: never callable through the API.
revoke execute on function public._setting_int(text, int), public._emit(uuid, text, uuid, uuid), public._clean_text(text),
  public._expire_pending_vibes(uuid), public._media_path_safe(uuid, text, text, text), public._world_teardown(text) from public, anon, authenticated;
-- Server-only (the view-once Edge Function, scheduled jobs, moderators with the server key).
revoke execute on function public.view_once_open_as(uuid, uuid), public.view_once_mark_purged(uuid), public.view_once_sweep_candidates(int),
  public.view_once_release(uuid), public.view_once_orphans(int),
  public.expire_stale_vibes(), public.purge_old_events() from public, anon, authenticated;
grant execute on function public.view_once_open_as(uuid, uuid), public.view_once_mark_purged(uuid), public.view_once_sweep_candidates(int),
  public.view_once_release(uuid), public.view_once_orphans(int),
  public.expire_stale_vibes(), public.purge_old_events() to service_role;
-- 0007's direct open: retired (the path alone is useless now, but nobody should consume a photo outside the server flow).
revoke execute on function public.open_view_once(uuid) from public, anon, authenticated;
-- Trigger functions.
revoke execute on function public.connections_events(), public.crushes_events(), public.vibes_events(), public.challenges_events(),
  public.loops_events(), public.messages_media_guard(), public.after_dark_age_guard(), public.two_truths_answer_guard(),
  public.reports_insert_guard() from public, anon, authenticated;
-- The app.
revoke execute on function public.set_connection(uuid, text), public.search_people(text, int), public.mark_events_seen(timestamptz),
  public.send_two_truths(uuid, text[], int, text), public.request_vibe(uuid, text, text), public.respond_vibe(uuid, boolean), public.my_vibes()
  from public, anon;
grant execute on function public.set_connection(uuid, text), public.search_people(text, int), public.mark_events_seen(timestamptz),
  public.send_two_truths(uuid, text[], int, text), public.request_vibe(uuid, text, text), public.respond_vibe(uuid, boolean), public.my_vibes()
  to authenticated;

commit;
