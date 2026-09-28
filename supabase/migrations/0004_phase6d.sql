-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 6D · Identity, ownership & control
-- Run AFTER 0001, 0002 and 0003 (Supabase → SQL Editor). Idempotent: safe to
-- run more than once. Nothing here loosens existing security; every new
-- mutation checks auth.uid() on the server.
--
--   1. World creation fix      the "boards read" policy no longer depends on a
--                              function that can't see the row being inserted
--                              (INSERT … RETURNING failed with "new row violates
--                              row-level security policy for table boards")
--   2. World ownership         owner is server-derived (auth.uid()), creator and
--                              founding name kept, owner membership by trigger,
--                              owner can only change through the transfer flow
--   3. Access levels           visibility: public · connections · private
--   4. Follow ≠ Join           board_follows; joining a person's World is by
--                              request + approval (or the owner adds you);
--                              roles owner · admin · member
--   5. Own your posts          edit within 1 hour (server time), delete any time,
--                              edited_at; comments the same; a new like/save
--                              needs a post you can see (no orphan reactions)
--   6. Developer access        by verified email (survives account recreation)
--   7. Account deletion        prepare_account_deletion(): service role only,
--                              called by the delete-account Edge Function
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.are_connected(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.connections c
    where c.user_a = least(a, b) and c.user_b = greatest(a, b) and c.status = 'connected');
$$;

create or replace function public.is_board_member(bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.board_memberships m where m.board_id = bid and m.user_id = auth.uid());
$$;

-- 'owner' | 'admin' | 'member' | null for the current user in a World.
create or replace function public.board_role(bid text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.boards b where b.id = bid and b.owner_id = auth.uid()) then 'owner'
    else (select m.role from public.board_memberships m where m.board_id = bid and m.user_id = auth.uid())
  end;
$$;

-- ─── 1–3. Worlds: access levels, provenance, server-derived owner ───────────

alter table public.boards drop constraint if exists boards_visibility_check;
alter table public.boards add constraint boards_visibility_check check (visibility in ('public', 'connections', 'private'));
alter table public.boards add column if not exists creator_id uuid references public.profiles (id) on delete set null;
alter table public.boards add column if not exists creator_name text check (char_length(creator_name) <= 50);

update public.boards b
   set creator_id = b.owner_id, creator_name = coalesce(b.creator_name, p.display_name)
  from public.profiles p
 where p.id = b.owner_id and b.creator_id is null;

-- Who can see a World: public, yours, one you're in, or (connections) its owner is connected with you.
create or replace function public.can_see_board(bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select bid is null or exists (
    select 1 from public.boards b
    where b.id = bid and (
      b.visibility = 'public' or b.owner_id = auth.uid()
      or exists (select 1 from public.board_memberships m where m.board_id = b.id and m.user_id = auth.uid())
      or (b.visibility = 'connections' and public.are_connected(auth.uid(), b.owner_id))
    )
  );
$$;

-- THE FIX: evaluate the row's own columns (a just-inserted row is invisible to a
-- lookup inside can_see_board, so INSERT … RETURNING was rejected).
drop policy if exists "boards read" on public.boards;
create policy "boards read" on public.boards for select to authenticated using (
  visibility = 'public'
  or owner_id = auth.uid()
  or public.is_board_member(id)
  or (visibility = 'connections' and public.are_connected(auth.uid(), owner_id))
);

-- Only an authenticated user can create a World, and only one owned by themselves.
drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards for insert to authenticated
  with check (owner_id = auth.uid() and type in ('user_created', 'private'));

-- Ownership is server-derived: whatever the app sends, the owner is the caller.
create or replace function public.boards_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
    new.creator_id := auth.uid();
    new.creator_name := (select p.display_name from public.profiles p where p.id = auth.uid());
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists boards_before_insert on public.boards;
create trigger boards_before_insert before insert on public.boards for each row execute function public.boards_before_insert();

-- The owner is always a member (role owner) — no second insert from the app.
create or replace function public.boards_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.board_memberships (board_id, user_id, role) values (new.id, new.owner_id, 'owner')
    on conflict (board_id, user_id) do update set role = 'owner';
  end if;
  return null;
end $$;
drop trigger if exists boards_after_insert on public.boards;
create trigger boards_after_insert after insert on public.boards for each row execute function public.boards_after_insert();

-- Provenance is permanent; the owner only changes through the transfer flow.
create or replace function public.boards_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and coalesce(current_setting('chimp.allow_owner_change', true), '') <> 'on' then
    raise exception 'A World''s owner can''t be changed here.' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.creator_name := old.creator_name;
  if new.creator_id is not null then new.creator_id := old.creator_id; end if; -- (null only when the creator's account is deleted)
  return new;
end $$;
drop trigger if exists boards_before_update on public.boards;
create trigger boards_before_update before update on public.boards for each row execute function public.boards_before_update();

-- ─── 4. Roles, Follow vs Join ───────────────────────────────────────────────

alter table public.board_memberships drop constraint if exists board_memberships_role_check;
alter table public.board_memberships add constraint board_memberships_role_check check (role in ('owner', 'admin', 'member'));

-- Joining directly is only for Chimp's open catalog Worlds. A person's World is
-- joined by request + approval, or the owner/admin adds you (functions below).
drop policy if exists "members join" on public.board_memberships;
create policy "members join" on public.board_memberships for insert to authenticated
  with check (user_id = auth.uid() and role = 'member'
              and exists (select 1 from public.boards b where b.id = board_id and b.owner_id is null and b.visibility = 'public'));
drop policy if exists "members leave" on public.board_memberships;
create policy "members leave" on public.board_memberships for delete to authenticated using (user_id = auth.uid() and role <> 'owner');

-- FOLLOW: "show me this World's activity". Not membership.
create table if not exists public.board_follows (
  board_id   text not null references public.boards (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
alter table public.board_follows enable row level security;
drop policy if exists "board follows own read" on public.board_follows;
create policy "board follows own read" on public.board_follows for select to authenticated using (user_id = auth.uid());
drop policy if exists "board follows own add" on public.board_follows;
create policy "board follows own add" on public.board_follows for insert to authenticated with check (user_id = auth.uid() and public.can_see_board(board_id));
drop policy if exists "board follows own remove" on public.board_follows;
create policy "board follows own remove" on public.board_follows for delete to authenticated using (user_id = auth.uid());

-- JOIN requests: you see your own; the World's owner/admins see theirs.
create table if not exists public.board_join_requests (
  board_id   text not null references public.boards (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
alter table public.board_join_requests enable row level security;
drop policy if exists "join requests read" on public.board_join_requests;
create policy "join requests read" on public.board_join_requests for select to authenticated
  using (user_id = auth.uid() or public.board_role(board_id) in ('owner', 'admin'));
drop policy if exists "join requests cancel" on public.board_join_requests;
create policy "join requests cancel" on public.board_join_requests for delete to authenticated using (user_id = auth.uid());

-- 'member' (already in) · 'joined' (open catalog World) · 'requested' (waits for the owner)
create or replace function public.request_to_join(bid text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b public.boards;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into b from public.boards where id = bid;
  if not found or not public.can_see_board(bid) then raise exception 'That World isn''t available.' using errcode = '42501'; end if;
  if exists (select 1 from public.board_memberships where board_id = bid and user_id = me) then return 'member'; end if;
  if b.owner_id is null then
    insert into public.board_memberships (board_id, user_id, role) values (bid, me, 'member') on conflict do nothing;
    return 'joined';
  end if;
  insert into public.board_join_requests (board_id, user_id) values (bid, me) on conflict do nothing;
  return 'requested';
end $$;

create or replace function public.respond_join_request(bid text, requester uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.board_role(bid) not in ('owner', 'admin') or public.board_role(bid) is null then
    raise exception 'Only the World''s owner or an admin can do that.' using errcode = '42501';
  end if;
  if accept and exists (select 1 from public.board_join_requests where board_id = bid and user_id = requester) then
    insert into public.board_memberships (board_id, user_id, role) values (bid, requester, 'member') on conflict do nothing;
  end if;
  delete from public.board_join_requests where board_id = bid and user_id = requester;
end $$;

-- Owner/admin adds someone they're connected with (how a Private World gets its members).
create or replace function public.add_board_member(bid text, who uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.board_role(bid), '') not in ('owner', 'admin') then
    raise exception 'Only the World''s owner or an admin can add people.' using errcode = '42501';
  end if;
  if not public.are_connected(auth.uid(), who) and not exists (select 1 from public.board_join_requests where board_id = bid and user_id = who) then
    raise exception 'You can add your connections (or people who asked to join).' using errcode = '42501';
  end if;
  if public.is_blocked_between(auth.uid(), who) then raise exception 'You can''t add this person.' using errcode = '42501'; end if;
  insert into public.board_memberships (board_id, user_id, role) values (bid, who, 'member') on conflict do nothing;
  delete from public.board_join_requests where board_id = bid and user_id = who;
end $$;

create or replace function public.remove_board_member(bid text, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare my_role text := public.board_role(bid); their_role text;
begin
  select role into their_role from public.board_memberships where board_id = bid and user_id = who;
  if their_role is null then return; end if;
  if their_role = 'owner' then raise exception 'The owner can''t be removed.' using errcode = '42501'; end if;
  if not (my_role = 'owner' or (my_role = 'admin' and their_role = 'member')) then
    raise exception 'Only the World''s owner or an admin can remove members.' using errcode = '42501';
  end if;
  delete from public.board_memberships where board_id = bid and user_id = who;
end $$;

create or replace function public.set_board_role(bid text, who uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.board_role(bid) is distinct from 'owner' then raise exception 'Only the owner can change roles.' using errcode = '42501'; end if;
  if new_role not in ('admin', 'member') then raise exception 'Unknown role.'; end if;
  update public.board_memberships set role = new_role where board_id = bid and user_id = who and role <> 'owner';
end $$;

create or replace function public.leave_board(bid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.board_role(bid) = 'owner' then raise exception 'You own this World. Delete it, or hand it on first.' using errcode = '42501'; end if;
  delete from public.board_memberships where board_id = bid and user_id = auth.uid();
  delete from public.board_join_requests where board_id = bid and user_id = auth.uid();
end $$;

-- Real counts for Worlds you can see (members and followers are different things).
create or replace function public.board_counts(ids text[]) returns table (board_id text, members bigint, followers bigint)
language sql stable security definer set search_path = public as $$
  select b.id,
         (select count(*) from public.board_memberships m where m.board_id = b.id),
         (select count(*) from public.board_follows f where f.board_id = b.id)
    from public.boards b
   where b.id = any (ids) and public.can_see_board(b.id);
$$;

-- ─── 5. Own your posts: edit for 1 hour, delete any time ────────────────────

alter table public.buzz_items add column if not exists edited_at timestamptz;
alter table public.comments   add column if not exists edited_at timestamptz;

-- No more direct UPDATE/DELETE on Buzz: edit_buzz() / delete_buzz() below
-- enforce the rules with server time. (Account deletion still cascades.)
drop policy if exists "buzz update" on public.buzz_items;
drop policy if exists "buzz delete" on public.buzz_items;

create or replace function public.edit_buzz(p_id uuid, p_body text, p_board_id text) returns public.buzz_items
language plpgsql security definer set search_path = public as $$
declare r public.buzz_items; v_body text := nullif(btrim(coalesce(p_body, '')), ''); v_world text := nullif(p_board_id, '');
begin
  select * into r from public.buzz_items where id = p_id for update;
  if not found or r.author_id is distinct from auth.uid() then raise exception 'You can only edit your own posts.' using errcode = '42501'; end if;
  if now() - r.created_at > interval '1 hour' then
    raise exception 'Posts can be edited for 1 hour after posting. You can still delete it.' using errcode = '42501';
  end if;
  if r.kind = 'poll' then raise exception 'Polls can''t be edited once people can vote.' using errcode = '42501'; end if;
  if v_body is null and cardinality(r.media_ids) = 0 then raise exception 'A post needs some text.' using errcode = '22023'; end if;
  if v_world is not null and not public.can_see_board(v_world) then raise exception 'That World isn''t available.' using errcode = '42501'; end if;
  update public.buzz_items set body = v_body, board_id = v_world, edited_at = now() where id = p_id returning * into r;
  return r;
end $$;

-- Returns the Storage paths of media only this post used (the app removes those files).
create or replace function public.delete_buzz(p_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare r public.buzz_items; paths text[] := '{}';
begin
  select * into r from public.buzz_items where id = p_id;
  if not found then return paths; end if; -- already gone (idempotent)
  if r.author_id is distinct from auth.uid() then raise exception 'You can only delete your own posts.' using errcode = '42501'; end if;
  delete from public.comments  where target_kind = 'buzz' and target_id = p_id::text;
  delete from public.reactions where target_kind = 'buzz' and target_id = p_id::text;
  delete from public.buzz_items where id = p_id; -- poll votes cascade
  with gone as (
    delete from public.media m
     where m.id = any (r.media_ids) and m.owner_id = auth.uid()
       and not exists (select 1 from public.buzz_items b  where m.id = any (b.media_ids))
       and not exists (select 1 from public.drift_items d where m.id = any (d.media_ids))
       and not exists (select 1 from public.story_items s where s.media_id = m.id)
       and not exists (select 1 from public.profiles p    where p.avatar_media_id = m.id)
       and not exists (select 1 from public.boards bo     where bo.cover_media_id = m.id)
       and not exists (select 1 from public.messages x    where x.media_id = m.id)
    returning m.storage_path, m.poster_path)
  select coalesce(array_agg(p) filter (where p is not null), '{}') into paths
    from (select storage_path as p from gone union all select poster_path from gone) q;
  return paths;
end $$;

create or replace function public.edit_comment(p_id uuid, p_body text) returns public.comments
language plpgsql security definer set search_path = public as $$
declare c public.comments;
begin
  select * into c from public.comments where id = p_id for update;
  if not found or c.author_id is distinct from auth.uid() then raise exception 'You can only edit your own replies.' using errcode = '42501'; end if;
  if now() - c.created_at > interval '1 hour' then raise exception 'Replies can be edited for 1 hour. You can still delete it.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'A reply needs some text.' using errcode = '22023'; end if;
  update public.comments set body = btrim(p_body), edited_at = now() where id = p_id returning * into c;
  return c;
end $$;

create or replace function public.delete_comment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.comments where id = p_id and author_id is distinct from auth.uid()) then
    raise exception 'You can only delete your own replies.' using errcode = '42501';
  end if;
  delete from public.comments where id = p_id and author_id = auth.uid();
end $$;

-- A like / save on a post that no longer exists (a phone that hasn't
-- refreshed yet) must not leave an orphan row: new reactions need a target
-- you can see, like replies already do. Reading and removing your own is
-- unchanged.
drop policy if exists "reactions own" on public.reactions;
drop policy if exists "reactions own read" on public.reactions;
drop policy if exists "reactions own insert" on public.reactions;
drop policy if exists "reactions own update" on public.reactions;
drop policy if exists "reactions own delete" on public.reactions;
create policy "reactions own read"   on public.reactions for select to authenticated using (user_id = auth.uid());
create policy "reactions own insert" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_target(target_kind, target_id));
create policy "reactions own update" on public.reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reactions own delete" on public.reactions for delete to authenticated using (user_id = auth.uid());

-- ─── 6. Developer access, by verified email ─────────────────────────────────
-- Not tied to a user id: delete the account, sign up again with the same
-- verified email, and access returns. Emails are stored trimmed + lower-case.

create table if not exists public.developer_emails (
  email      text primary key check (email = lower(btrim(email))),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.developer_emails enable row level security; -- no policies: never readable through the API
insert into public.developer_emails (email, note) values ('aayushmallik.contact@gmail.com', 'Chimp founder') on conflict (email) do nothing;

create or replace function public.is_developer(uid uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
      join public.developer_emails d on d.email = lower(btrim(u.email))
     where u.id = uid and u.email_confirmed_at is not null);
$$;

create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('developer', public.is_developer(auth.uid()));
$$;

-- ─── 7. Account deletion ────────────────────────────────────────────────────
-- The app calls the delete-account Edge Function (supabase/functions). It
-- verifies the caller's own session, then: prepare_account_deletion() →
-- remove the person's Storage files → auth.admin.deleteUser(). Deleting the
-- Auth user cascades to the profile and everything that references it, which
-- frees the email and the username.

-- What will happen to the Worlds you own (for the confirmation screen).
create or replace function public.account_deletion_preview() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('worlds', coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'title', b.title,
           'others', (select count(*) from public.board_memberships m where m.board_id = b.id and m.user_id <> auth.uid()))
         order by b.created_at), '[]'::jsonb))
    from public.boards b where b.owner_id = auth.uid();
$$;

create or replace function public.prepare_account_deletion(p_uid uuid, p_transfer boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; succ uuid; deleted text[] := '{}'; handed int := 0;
begin
  if p_uid is null then raise exception 'No account.'; end if;
  perform set_config('chimp.allow_owner_change', 'on', true);
  -- Owned Worlds: hand on to the longest-standing member (admins first) when asked, else delete.
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
      delete from public.boards where id = b.id;
    end if;
  end loop;
  perform set_config('chimp.allow_owner_change', '', true);
  -- 1:1 chats with this person end for both sides (no half-empty conversation left).
  delete from public.conversations c where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_uid);
  -- Other people's replies and reactions on this person's content (the content goes with the account).
  delete from public.comments where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                               or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                               or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  delete from public.reactions where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                                or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                                or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  return jsonb_build_object('deleted_boards', to_jsonb(deleted), 'handed_on', handed);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

do $$ begin
  revoke execute on function public.prepare_account_deletion(uuid, boolean) from public, anon, authenticated;
  revoke execute on function public.is_developer(uuid) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.prepare_account_deletion(uuid, boolean) to service_role;
  end if;
end $$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;
revoke execute on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;
grant execute on function public.request_to_join(text), public.respond_join_request(text, uuid, boolean), public.add_board_member(text, uuid),
  public.remove_board_member(text, uuid), public.set_board_role(text, uuid, text), public.leave_board(text), public.board_counts(text[]),
  public.edit_buzz(uuid, text, text), public.delete_buzz(uuid), public.edit_comment(uuid, text), public.delete_comment(uuid) to authenticated;
revoke execute on function public.request_to_join(text), public.respond_join_request(text, uuid, boolean), public.add_board_member(text, uuid),
  public.remove_board_member(text, uuid), public.set_board_role(text, uuid, text), public.leave_board(text), public.board_counts(text[]),
  public.edit_buzz(uuid, text, text), public.delete_buzz(uuid), public.edit_comment(uuid, text), public.delete_comment(uuid) from public, anon;
grant select, insert, delete on public.board_follows to authenticated;
grant select, delete on public.board_join_requests to authenticated;
