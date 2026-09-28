-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 6C · Trip Demo Candidate
-- Run AFTER 0001_phase6a.sql and 0002_phase6b.sql (Supabase → SQL Editor).
-- Idempotent: safe to run more than once. Nothing here loosens existing RLS.
--
--   1. Short video Buzz        buzz_items.kind accepts 'video'
--   2. Video metadata          media.poster_path (optional poster frame);
--                              kind / mime_type / bytes / duration_ms /
--                              width / height already exist since 0001
--   3. Storage                 the media bucket accepts clips up to 50 MB
--   4. Real like counts        reaction_counts(): public LIKE totals for items
--                              you can see (never who liked; never dislikes)
--
-- Board covers need no schema change: boards.cover_url / hero_url /
-- cover_media_id exist since 0001, "boards update" is owner-only, and
-- Storage only accepts boards/{boardId}/… from that World's owner.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Video Buzz ───────────────────────────────────────────────────────────
alter table public.buzz_items drop constraint if exists buzz_items_kind_check;
alter table public.buzz_items
  add constraint buzz_items_kind_check check (kind in ('post', 'note', 'photo', 'meme', 'poll', 'video'));

-- ─── 2. Video metadata ───────────────────────────────────────────────────────
-- Storage path of a JPEG poster frame for a video (same bucket, same owner folder).
alter table public.media add column if not exists poster_path text;

-- ─── 3. Storage: short clips ─────────────────────────────────────────────────
-- 50 MB per file (the app compresses clips to 960×540 and caps them at 60 s,
-- so real uploads are far smaller). If your project's global limit
-- (Storage → Settings → Upload file size limit) is lower, that one wins.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
 where id = 'media';

-- ─── 4. Real like counts ─────────────────────────────────────────────────────
-- reactions stays "own rows only". This returns only aggregate LIKE totals,
-- and only for Buzz / Drift the caller is allowed to see (can_see_board).
create or replace function public.reaction_counts(p_target_kind text, p_ids text[])
returns table (target_id text, likes bigint)
language sql stable security definer set search_path = public as $$
  select r.target_id, count(*)::bigint
    from public.reactions r
   where r.kind = 'like'
     and r.target_kind = p_target_kind
     and r.target_id = any (p_ids)
     and case p_target_kind
           when 'buzz'  then exists (select 1 from public.buzz_items b  where b.id::text = r.target_id and public.can_see_board(b.board_id))
           when 'drift' then exists (select 1 from public.drift_items d where d.id::text = r.target_id and public.can_see_board(d.board_id))
           else false
         end
   group by r.target_id;
$$;

revoke execute on function public.reaction_counts(text, text[]) from public, anon;
grant execute on function public.reaction_counts(text, text[]) to authenticated;
