-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 9.2 follow-up · Who viewed my Story
--
-- Run AFTER 0013 (it checks). Additive and idempotent: safe to run twice.
-- Never re-run 0001–0013 after it. RLS stays on; no `with check (true)`.
--
--   story_views            one row per (Story frame, viewer): the first time
--                          that frame was shown to that person. Per frame,
--                          like story_items itself (a World's copy of a frame
--                          is the same row, so it counts once). Goes away
--                          with the frame or the account.
--                          No policies at all: nobody can read or write it
--                          directly — only through the functions below.
--   mark_story_viewed()    the viewer's phone, when a frame is actually shown.
--                          Idempotent (primary key). Only for a frame that is
--                          still live and that the viewer may see (the same
--                          rule as reading Stories), never for the author,
--                          never across a block.
--   story_viewers()        who viewed one frame — ONLY its author; never
--                          anyone blocked either way.
--   story_view_counts()    how many viewed each of the author's own frames
--                          (other people's frames are simply left out).
-- No analytics, no ranking: nothing else reads this table.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'post_likers' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 0013_phase9_boards.sql first.';
  end if;
end $$;

create table if not exists public.story_views (
  story_item_id uuid not null references public.story_items (id) on delete cascade,
  viewer_id     uuid not null references public.profiles (id) on delete cascade,
  viewed_at     timestamptz not null default now(),
  primary key (story_item_id, viewer_id)
);
create index if not exists story_views_item_idx on public.story_views (story_item_id, viewed_at desc);
alter table public.story_views enable row level security;
-- (No policies: direct reads and writes are refused for everyone.)

-- The viewer's phone: this frame was shown to me. true = recorded (or already was).
create or replace function public.mark_story_viewed(p_item uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select x.id, x.author_id, x.board_id, x.expires_at into s from public.story_items x where x.id = p_item;
  if not found or s.expires_at <= now() then return false; end if;      -- gone or expired
  if s.author_id = me then return false; end if;                          -- never the author
  if public.is_blocked_between(me, s.author_id) then return false; end if;
  if not public.can_see_board(s.board_id) then return false; end if;    -- same rule as "stories read"
  insert into public.story_views (story_item_id, viewer_id) values (p_item, me)
  on conflict (story_item_id, viewer_id) do nothing;
  return true;
end $$;

-- The author only: who viewed this frame (newest first).
create or replace function public.story_viewers(p_item uuid)
returns table (viewer_id uuid, viewed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.story_items x where x.id = p_item and x.author_id = me) then
    raise exception 'Only the person who posted this Story can see who viewed it.' using errcode = '42501';
  end if;
  return query
    select v.viewer_id, v.viewed_at
      from public.story_views v
     where v.story_item_id = p_item
       and v.viewer_id <> me
       and not public.is_blocked_between(me, v.viewer_id)
     order by v.viewed_at desc
     limit 1000;
end $$;

-- The author only: view counts for their own frames (others' frames are left out).
create or replace function public.story_view_counts(p_items uuid[])
returns table (story_item_id uuid, viewers bigint)
language sql stable security definer set search_path = public as $$
  select x.id, count(v.viewer_id) filter (where v.viewer_id is not null and not public.is_blocked_between(auth.uid(), v.viewer_id))
    from public.story_items x
    left join public.story_views v on v.story_item_id = x.id and v.viewer_id <> x.author_id
   where auth.uid() is not null and x.author_id = auth.uid() and x.id = any (coalesce(p_items, '{}'))
   group by x.id;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on public.story_views from anon, authenticated;
revoke execute on function public.mark_story_viewed(uuid), public.story_viewers(uuid), public.story_view_counts(uuid[]) from public, anon;
grant execute on function public.mark_story_viewed(uuid), public.story_viewers(uuid), public.story_view_counts(uuid[]) to authenticated;

commit;
