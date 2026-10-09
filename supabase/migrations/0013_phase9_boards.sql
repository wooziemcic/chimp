-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 9.2 · Boards organisation, private social graph, likers,
--                     threaded comments
--
-- Run AFTER 0012 (it checks). Additive and idempotent: safe to run twice.
-- Never re-run 0001–0012 after it. Nothing is renamed or dropped except one
-- policy ("follows read"), recreated narrower. RLS stays on everywhere; no
-- `with check (true)`.
--
--   1. Threaded comments     comments.parent_id (nullable). A reply must be on
--                            the same post as the comment it answers (checked
--                            by a trigger), and can't be moved later. Deleting
--                            a comment keeps the replies (they lose their
--                            parent, nobody else's words are deleted).
--   2. post_likers()         who liked a post — ONLY for the post's author.
--                            Returns ids + when; never across a block.
--   3. Private follow lists  follows rows are readable only by the two people
--                            in them (was: everyone could read everyone's
--                            followers/following). follow_counts() keeps the
--                            public totals on profiles working.
--   4. board_archives        your own "archive this Board" list (hidden from
--                            your Boards; doesn't change the Board or who can
--                            see it). Readable/writable only by you.
--   5. Board type guard      now that the owner edits visibility later, the app
--                            keeps `type` in step (private ↔ user_created). The
--                            owner can't use that to turn their Board into a
--                            Chimp-curated / canonical one.
--
-- Board visibility needs nothing new: boards.visibility already holds
-- public | connections | private (0004), and the owner may already update
-- their Board ("boards update", 0001). Every existing Board keeps its value.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'set_board_pin' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 0012_phase9_social.sql first.';
  end if;
end $$;

-- ─── 1. Threaded comments ───────────────────────────────────────────────────

alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete set null;
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;

create or replace function public.comments_parent_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.comments;
begin
  if tg_op = 'UPDATE' then
    -- Only the parent's deletion may change it (ON DELETE SET NULL → null).
    if new.parent_id is not null and new.parent_id is distinct from old.parent_id then
      raise exception 'A reply can''t be moved to another comment.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.parent_id is null then return new; end if;
  select * into p from public.comments c where c.id = new.parent_id;
  if not found then
    raise exception 'That comment was deleted.' using errcode = '23503';
  end if;
  if p.target_kind <> new.target_kind or p.target_id <> new.target_id then
    raise exception 'A reply must be on the same post as the comment it answers.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists comments_parent_guard on public.comments;
create trigger comments_parent_guard before insert or update of parent_id on public.comments
  for each row execute function public.comments_parent_guard();

-- ─── 2. Who liked my post (author only) ─────────────────────────────────────

create or replace function public.post_likers(p_kind text, p_id text)
returns table (user_id uuid, liked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); p record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_kind not in ('buzz', 'drift') then raise exception 'Unknown post.' using errcode = '22023'; end if;
  select * into p from public._post_of(p_kind, p_id);
  if p.author is null or p.author <> me then
    raise exception 'Only the person who posted it can see who liked it.' using errcode = '42501';
  end if;
  return query
    select r.user_id, r.created_at
      from public.reactions r
     where r.target_kind = p_kind and r.target_id = p_id and r.kind = 'like'
       and r.user_id <> me
       and not public.is_blocked_between(me, r.user_id)
     order by r.created_at desc
     limit 500;
end $$;

-- ─── 3. Follower / following lists are private ──────────────────────────────

-- Totals stay public (they're on every profile); the lists are not.
create or replace function public.follow_counts(p_user uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.follows f where f.followee_id = p_user),
         (select count(*) from public.follows f where f.follower_id = p_user);
$$;

drop policy if exists "follows read" on public.follows;
create policy "follows read" on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- ─── 4. Archived Boards (per person) ────────────────────────────────────────

create table if not exists public.board_archives (
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  board_id    text not null references public.boards (id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
alter table public.board_archives enable row level security;
drop policy if exists "archives read" on public.board_archives;
create policy "archives read" on public.board_archives for select to authenticated using (user_id = auth.uid());
drop policy if exists "archives insert" on public.board_archives;
create policy "archives insert" on public.board_archives for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_board(board_id));
drop policy if exists "archives delete" on public.board_archives;
create policy "archives delete" on public.board_archives for delete to authenticated using (user_id = auth.uid());

-- ─── 5. A Board's type stays a user type ────────────────────────────────────

create or replace function public.boards_type_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type is distinct from old.type and auth.uid() is not null
     and (old.type not in ('user_created', 'private') or new.type not in ('user_created', 'private')) then
    raise exception 'A World''s type can''t be changed to that.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists boards_type_guard on public.boards;
create trigger boards_type_guard before update of type on public.boards
  for each row execute function public.boards_type_guard();

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public.comments_parent_guard(), public.boards_type_guard() from public, anon, authenticated;
revoke execute on function public.post_likers(text, text), public.follow_counts(uuid) from public, anon;
grant execute on function public.post_likers(text, text), public.follow_counts(uuid) to authenticated;
revoke all on public.board_archives from anon;
grant select, insert, delete on public.board_archives to authenticated;

commit;
