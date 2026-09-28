-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 6D (final patch) · Delete a World
-- Run AFTER 0004 (Supabase → SQL Editor). Idempotent: safe to run again.
-- 0001–0004 are not edited; two 0004 functions are redefined here.
--
--   delete_world(board_id)   the World's OWNER only (auth.uid() = owner_id),
--                            checked here in the database. Admins, members,
--                            followers and everyone else are refused.
--   No direct DELETE         the 6A "boards delete" policy is dropped: a plain
--                            DELETE would cascade over every member's Buzz
--                            posts and skip the clean-up below.
--   What goes with a World   memberships, follows, join requests, saves (FK
--                            cascade); its Drift (a Drift item must belong to
--                            a World) and World Stories, with their replies,
--                            reactions and media rows; the cover.
--   Buzz posts in it         Buzz can exist without a World ("Just Buzz"):
--                              · Public World  → the posts stay, as their
--                                authors' Just Buzz (same audience: everyone),
--                                replies and likes intact
--                              · Connections / Private World → the posts are
--                                deleted (as Just Buzz they would become
--                                visible to everyone)
--   Storage                  the files of every removed media row are returned
--                            AND queued in storage_cleanup (never lost); the
--                            delete-world Edge Function removes them with the
--                            service key (other members' Drift photos included)
--   Account deletion         prepare_account_deletion() keeps its hand-on rule
--                            and now uses the same World teardown, so deleting
--                            an account also cleans other members' files.
-- ════════════════════════════════════════════════════════════════════════════

-- Files still to remove from Storage. RLS on, no policies: never visible or
-- writable through the API; only security-definer functions and the service
-- role touch it.
create table if not exists public.storage_cleanup (
  path      text primary key,
  board_id  text,
  queued_at timestamptz not null default now()
);
alter table public.storage_cleanup enable row level security;

-- ─── The shared teardown (internal; not callable through the API) ──────────
-- Removes one World and everything that belongs to it. Returns the Storage
-- paths of media rows it removed (also queued in storage_cleanup).
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

  -- Media those items (and the cover) used.
  select coalesce(array_agg(distinct m), '{}') into mids from (
    select unnest(media_ids) as m from public.drift_items where id = any (gone_drift)
    union select unnest(media_ids) from public.buzz_items where id = any (gone_buzz)
    union select media_id from public.story_items where id = any (gone_story)
    union select b.cover_media_id where b.cover_media_id is not null
  ) q;

  -- Replies and reactions on what's going away (targets are text ids, no FK).
  delete from public.comments  where (target_kind = 'drift' and target_id = any (select unnest(gone_drift)::text))
                                  or (target_kind = 'buzz'  and target_id = any (select unnest(gone_buzz)::text))
                                  or (target_kind = 'story' and target_id = any (select unnest(gone_story)::text));
  delete from public.reactions where (target_kind = 'drift' and target_id = any (select unnest(gone_drift)::text))
                                  or (target_kind = 'buzz'  and target_id = any (select unnest(gone_buzz)::text))
                                  or (target_kind = 'story' and target_id = any (select unnest(gone_story)::text));

  -- Buzz: keep (Just Buzz) or delete, by the World's audience.
  if keep_buzz then
    update public.buzz_items set board_id = null where board_id = p_board_id;
  else
    delete from public.buzz_items where id = any (gone_buzz);  -- poll votes cascade
  end if;
  delete from public.story_items where id = any (gone_story);
  delete from public.drift_items where id = any (gone_drift);

  -- Break the cover link first (boards.cover_media_id → media), then the World:
  -- memberships, saves, follows and join requests cascade with it.
  update public.boards set cover_media_id = null where id = p_board_id;
  delete from public.boards where id = p_board_id;

  -- Media rows nothing else uses any more (posts, Drift, Stories, avatars, covers, chat).
  with gone as (
    delete from public.media m
     where m.id = any (mids)
       and not exists (select 1 from public.buzz_items x  where m.id = any (x.media_ids))
       and not exists (select 1 from public.drift_items d where m.id = any (d.media_ids))
       and not exists (select 1 from public.story_items s where s.media_id = m.id)
       and not exists (select 1 from public.profiles p    where p.avatar_media_id = m.id)
       and not exists (select 1 from public.boards bo     where bo.cover_media_id = m.id)
       and not exists (select 1 from public.messages x    where x.media_id = m.id)
    returning m.storage_path, m.poster_path)
  select coalesce(array_agg(p) filter (where p is not null), '{}') into paths
    from (select storage_path as p from gone union all select poster_path from gone) q;

  insert into public.storage_cleanup (path, board_id) select unnest(paths), p_board_id on conflict (path) do nothing;
  return paths;
end $$;

-- ─── delete_world: the owner's action ───────────────────────────────────────
create or replace function public.delete_world(p_board_id text) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select owner_id into v_owner from public.boards where id = p_board_id;
  if not found then return '{}'; end if;  -- already gone: nothing to do (idempotent)
  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'Only the World''s owner can delete it.' using errcode = '42501';
  end if;
  return public._world_teardown(p_board_id);
end $$;

-- No more direct DELETE on boards from the app (was: owner could DELETE the row,
-- cascading over every member's Buzz and skipping the clean-up). The service
-- role (account deletion) bypasses RLS and uses the teardown above.
drop policy if exists "boards delete" on public.boards;

-- ─── Account deletion: same hand-on rule, same teardown ─────────────────────
-- Redefines 0004's prepare_account_deletion(). Unchanged: Worlds with other
-- members go to the longest-standing member (admins first) when asked; the
-- rest are deleted. New: deleted Worlds use _world_teardown (public-World Buzz
-- by others survives as Just Buzz; files are returned for removal as 'paths').
create or replace function public.prepare_account_deletion(p_uid uuid, p_transfer boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; succ uuid; deleted text[] := '{}'; handed int := 0; paths text[] := '{}';
begin
  if p_uid is null then raise exception 'No account.'; end if;
  perform set_config('chimp.allow_owner_change', 'on', true);
  for b in select id from public.boards where owner_id = p_uid loop
    succ := null;
    if p_transfer then
      select m.user_id into succ from public.board_memberships m
       where m.board_id = b.id and m.user_id <> p_uid
       order by (m.role = 'admin') desc, m.joined_at asc limit 1;
    end if;
    if succ is not null then
      update public.boards set owner_id = succ where id = b.id;
      update public.board_memberships set role = 'owner' where board_id = b.id and user_id = succ;
      handed := handed + 1;
    else
      deleted := deleted || b.id;
      paths := paths || public._world_teardown(b.id);
    end if;
  end loop;
  perform set_config('chimp.allow_owner_change', '', true);
  delete from public.conversations c where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_uid);
  delete from public.comments where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                               or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                               or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  delete from public.reactions where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                                or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                                or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  return jsonb_build_object('deleted_boards', to_jsonb(deleted), 'handed_on', handed, 'paths', to_jsonb(paths));
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
do $$ begin
  revoke execute on function public._world_teardown(text) from public, anon, authenticated;
  revoke execute on function public.prepare_account_deletion(uuid, boolean) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.prepare_account_deletion(uuid, boolean) to service_role;
    grant select, delete on public.storage_cleanup to service_role;
  end if;
end $$;
revoke execute on function public.delete_world(text) from public, anon;
grant execute on function public.delete_world(text) to authenticated;
revoke all on public.storage_cleanup from anon, authenticated;
