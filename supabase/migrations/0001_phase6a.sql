-- ============================================================================
-- Chimp — Phase 6A: Accounts & Creation
-- Minimal, generic schema for real accounts, profiles, Worlds and creation.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Principles
--   * Everyone reads what is public; you only ever write your own rows.
--   * Counts (followers, members…) are derived, never stored.
--   * Private signals (dislikes, saves, crushes) are readable only by you.
--   * Generic models (Board, Post/Buzz, Drift, Story, Comment, Media…) —
--     nothing feature- or place-specific (a "Niagara Falls Trip" is a Board).
-- ============================================================================

create extension if not exists citext;

-- ─── Profiles ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        citext unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name    text   check (char_length(display_name) between 1 and 50),
  avatar_media_id uuid,
  avatar_url      text,
  -- How the photo sits in the You hero (0..1 focal point, set in the app).
  avatar_focus_y  real   not null default 0.3 check (avatar_focus_y between 0 and 1),
  city            text   check (char_length(city) <= 60),
  bio             text   check (char_length(bio) <= 280),
  profile_phrase  text   check (char_length(profile_phrase) <= 40),
  profile_emoji   text   check (char_length(profile_emoji) <= 16),
  open_to         text[] not null default '{}',
  interests       text[] not null default '{}',
  onboarded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Media (every uploaded file) ────────────────────────────────────────────

create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  bucket       text not null default 'media',
  storage_path text not null unique,
  kind         text not null default 'image' check (kind in ('image', 'video')),
  mime_type    text not null,
  width        int,
  height       int,
  duration_ms  int,
  bytes        int,
  created_at   timestamptz not null default now()
);

alter table public.profiles
  drop constraint if exists profiles_avatar_media_fk,
  add constraint profiles_avatar_media_fk foreign key (avatar_media_id) references public.media (id) on delete set null;

-- ─── Worlds (Boards) ────────────────────────────────────────────────────────

create table if not exists public.boards (
  id          text primary key default gen_random_uuid()::text,
  slug        text unique not null,
  title       text not null check (char_length(title) between 2 and 60),
  tagline     text check (char_length(tagline) <= 200),
  category    text not null default 'travel',
  interests   text[] not null default '{}',
  cover_url   text,
  hero_url    text,
  cover_media_id uuid references public.media (id) on delete set null,
  theme_id    text not null default 'lagoon',
  verb        text not null default 'exploring',
  visibility  text not null default 'public' check (visibility in ('public', 'private')),
  type        text not null default 'user_created' check (type in ('canonical', 'curated', 'user_created', 'private')),
  owner_id    uuid references public.profiles (id) on delete cascade, -- null = a Chimp World
  created_at  timestamptz not null default now()
);

create table if not exists public.board_memberships (
  board_id  text not null references public.boards (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.board_saves (
  board_id text not null references public.boards (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Can the current user see this World? (security definer avoids RLS recursion)
create or replace function public.can_see_board(bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select bid is null or exists (
    select 1 from public.boards b
    where b.id = bid and (
      b.visibility = 'public' or b.owner_id = auth.uid()
      or exists (select 1 from public.board_memberships m where m.board_id = b.id and m.user_id = auth.uid())
    )
  );
$$;

-- ─── Content ────────────────────────────────────────────────────────────────

create table if not exists public.buzz_items (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  board_id   text references public.boards (id) on delete cascade,  -- null = personal
  kind       text not null check (kind in ('post', 'note', 'photo', 'meme', 'poll')),
  title      text check (char_length(title) <= 120),
  body       text check (char_length(body) <= 2000),
  media_ids  uuid[] not null default '{}',
  meme_text  text check (char_length(meme_text) <= 120),
  poll       jsonb, -- { "question": text, "options": [{ "id": text, "label": text }] }
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  buzz_id   uuid not null references public.buzz_items (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  option_id text not null,
  voted_at  timestamptz not null default now(),
  primary key (buzz_id, user_id)
);

create table if not exists public.drift_items (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  board_id   text not null references public.boards (id) on delete cascade,
  kind       text not null default 'photo' check (kind in ('photo', 'carousel', 'video')),
  caption    text check (char_length(caption) <= 500),
  media_ids  uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- One row per story frame; the app groups frames by author (or World).
create table if not exists public.story_items (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  board_id   text references public.boards (id) on delete cascade, -- null = your own story
  media_id   uuid not null references public.media (id) on delete cascade,
  caption    text check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

-- Replies on Buzz, comments on Drift and Board posts: one generic table.
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in ('buzz', 'drift', 'post', 'story')),
  target_id   text not null,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists comments_target_idx on public.comments (target_kind, target_id, created_at);

-- Comments follow the visibility of what they're on (a private World's Drift stays private).
create or replace function public.can_see_target(kind text, tid text) returns boolean
language sql stable security definer set search_path = public as $$
  select case kind
    when 'buzz'  then exists (select 1 from public.buzz_items x  where x.id::text = tid and public.can_see_board(x.board_id))
    when 'drift' then exists (select 1 from public.drift_items x where x.id::text = tid and public.can_see_board(x.board_id))
    when 'story' then exists (select 1 from public.story_items x where x.id::text = tid and public.can_see_board(x.board_id))
    else false -- 'post' (Board posts) is reserved; nothing stores them in 6A
  end;
$$;

-- Likes, private dislikes, saves, reposts.
create table if not exists public.reactions (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in ('buzz', 'drift', 'post', 'story')),
  target_id   text not null,
  kind        text not null check (kind in ('like', 'dislike', 'save', 'repost')),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_kind, target_id, kind)
);

-- ─── Relationships (used from Phase 6B; tables exist now) ───────────────────

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table if not exists public.connections (
  user_a       uuid not null references public.profiles (id) on delete cascade,
  user_b       uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'requested' check (status in ('requested', 'connected')),
  created_at   timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

-- Private romantic interest. Nobody can read who has a Crush on them.
create table if not exists public.crushes (
  from_id    uuid not null references public.profiles (id) on delete cascade,
  to_id      uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

-- Sparks = mutual Crushes. Reveals only people YOU also chose.
create or replace function public.my_sparks() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.to_id from public.crushes c
  where c.from_id = auth.uid()
    and exists (select 1 from public.crushes r where r.from_id = c.to_id and r.to_id = auth.uid());
$$;

create table if not exists public.open_loops (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null check (char_length(title) between 2 and 120),
  status     text not null default 'active' check (status in ('active', 'resolved', 'dismissed')),
  interests  text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.media             enable row level security;
alter table public.boards            enable row level security;
alter table public.board_memberships enable row level security;
alter table public.board_saves       enable row level security;
alter table public.buzz_items        enable row level security;
alter table public.poll_votes        enable row level security;
alter table public.drift_items       enable row level security;
alter table public.story_items       enable row level security;
alter table public.comments          enable row level security;
alter table public.reactions         enable row level security;
alter table public.follows           enable row level security;
alter table public.connections       enable row level security;
alter table public.crushes           enable row level security;
alter table public.open_loops        enable row level security;

-- Profiles: signed-in users can read profiles; you can only write your own.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Media rows: readable; you only add/remove your own.
drop policy if exists "media read" on public.media;
create policy "media read" on public.media for select to authenticated using (true);
drop policy if exists "media insert" on public.media;
create policy "media insert" on public.media for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "media delete" on public.media;
create policy "media delete" on public.media for delete to authenticated using (owner_id = auth.uid());

-- Worlds: public ones, your own, and ones you belong to. Chimp Worlds (owner null) are read-only.
drop policy if exists "boards read" on public.boards;
create policy "boards read" on public.boards for select to authenticated using (public.can_see_board(id));
drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards for insert to authenticated
  with check (owner_id = auth.uid() and type in ('user_created', 'private'));
drop policy if exists "boards update" on public.boards;
create policy "boards update" on public.boards for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "boards delete" on public.boards;
create policy "boards delete" on public.boards for delete to authenticated using (owner_id = auth.uid());

-- Membership: visible for Worlds you can see; you only join/leave yourself.
drop policy if exists "members read" on public.board_memberships;
create policy "members read" on public.board_memberships for select to authenticated using (public.can_see_board(board_id));
drop policy if exists "members join" on public.board_memberships;
create policy "members join" on public.board_memberships for insert to authenticated
  with check (user_id = auth.uid() and (role = 'member' or exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()))
              and exists (select 1 from public.boards b where b.id = board_id and (b.visibility = 'public' or b.owner_id = auth.uid())));
drop policy if exists "members leave" on public.board_memberships;
create policy "members leave" on public.board_memberships for delete to authenticated using (user_id = auth.uid());

-- Saves are private.
drop policy if exists "saves own" on public.board_saves;
create policy "saves own" on public.board_saves for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Content: readable where the World is visible; written only by its author.
drop policy if exists "buzz read" on public.buzz_items;
create policy "buzz read" on public.buzz_items for select to authenticated using (public.can_see_board(board_id));
drop policy if exists "buzz insert" on public.buzz_items;
create policy "buzz insert" on public.buzz_items for insert to authenticated with check (author_id = auth.uid() and public.can_see_board(board_id));
drop policy if exists "buzz update" on public.buzz_items;
create policy "buzz update" on public.buzz_items for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "buzz delete" on public.buzz_items;
create policy "buzz delete" on public.buzz_items for delete to authenticated using (author_id = auth.uid());

drop policy if exists "votes read" on public.poll_votes;
create policy "votes read" on public.poll_votes for select to authenticated using (true);
drop policy if exists "votes own" on public.poll_votes;
create policy "votes own" on public.poll_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "votes change" on public.poll_votes;
create policy "votes change" on public.poll_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "votes undo" on public.poll_votes;
create policy "votes undo" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "drift read" on public.drift_items;
create policy "drift read" on public.drift_items for select to authenticated using (public.can_see_board(board_id));
drop policy if exists "drift insert" on public.drift_items;
create policy "drift insert" on public.drift_items for insert to authenticated with check (author_id = auth.uid() and public.can_see_board(board_id));
drop policy if exists "drift update" on public.drift_items;
create policy "drift update" on public.drift_items for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "drift delete" on public.drift_items;
create policy "drift delete" on public.drift_items for delete to authenticated using (author_id = auth.uid());

drop policy if exists "stories read" on public.story_items;
create policy "stories read" on public.story_items for select to authenticated using (expires_at > now() and public.can_see_board(board_id));
drop policy if exists "stories insert" on public.story_items;
create policy "stories insert" on public.story_items for insert to authenticated with check (author_id = auth.uid() and public.can_see_board(board_id));
drop policy if exists "stories delete" on public.story_items;
create policy "stories delete" on public.story_items for delete to authenticated using (author_id = auth.uid());

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated using (public.can_see_target(target_kind, target_id));
drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated with check (author_id = auth.uid() and public.can_see_target(target_kind, target_id));
drop policy if exists "comments delete" on public.comments;
create policy "comments delete" on public.comments for delete to authenticated using (author_id = auth.uid());

-- Reactions: only your own (dislikes stay private). Public like counts come later via a view.
drop policy if exists "reactions own" on public.reactions;
create policy "reactions own" on public.reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "follows read" on public.follows;
create policy "follows read" on public.follows for select to authenticated using (true);
drop policy if exists "follows insert" on public.follows;
create policy "follows insert" on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "follows delete" on public.follows;
create policy "follows delete" on public.follows for delete to authenticated using (follower_id = auth.uid());

drop policy if exists "connections read" on public.connections;
create policy "connections read" on public.connections for select to authenticated using (auth.uid() in (user_a, user_b));
drop policy if exists "connections insert" on public.connections;
create policy "connections insert" on public.connections for insert to authenticated with check (requested_by = auth.uid() and auth.uid() in (user_a, user_b));
drop policy if exists "connections update" on public.connections;
create policy "connections update" on public.connections for update to authenticated using (auth.uid() in (user_a, user_b));
drop policy if exists "connections delete" on public.connections;
create policy "connections delete" on public.connections for delete to authenticated using (auth.uid() in (user_a, user_b));

drop policy if exists "crushes own" on public.crushes;
create policy "crushes own" on public.crushes for all to authenticated using (from_id = auth.uid()) with check (from_id = auth.uid());

drop policy if exists "loops own" on public.open_loops;
create policy "loops own" on public.open_loops for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Storage: one public-read bucket, writes only into your own folders ─────
--   avatars/{uid}/…   posts/{uid}/…   drift/{uid}/…   stories/{uid}/…
--   boards/{boardId}/… (only the World's owner)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media objects insert" on storage.objects;
create policy "media objects insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    ((storage.foldername(name))[1] in ('avatars', 'posts', 'drift', 'stories') and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'boards' and exists (
      select 1 from public.boards b where b.id = (storage.foldername(name))[2] and b.owner_id = auth.uid()))
  )
);
drop policy if exists "media objects update" on storage.objects;
create policy "media objects update" on storage.objects for update to authenticated using (bucket_id = 'media' and owner_id = auth.uid()::text);
drop policy if exists "media objects delete" on storage.objects;
create policy "media objects delete" on storage.objects for delete to authenticated using (bucket_id = 'media' and owner_id = auth.uid()::text);

-- ─── Chimp's public World catalog (keep in sync with src/data/worldCatalog.ts) ─

insert into public.boards (id, slug, title, tagline, category, interests, cover_url, hero_url, theme_id, verb, visibility, type, owner_id) values
  ('travel', 'travel', 'Travel', 'Trips, routes and the people you meet on the way.', 'travel', array['i_travel', 'i_solo'], 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1080&q=72', 'lagoon', 'exploring', 'public', 'canonical', null),
  ('food', 'food', 'Food', 'Where to eat, what to cook, who to eat with.', 'culture', array['i_food'], 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1080&q=72', 'terracotta', 'tasting', 'public', 'canonical', null),
  ('film', 'film', 'Film', 'What to watch, where to see it, who to argue with.', 'culture', array['i_film', 'i_art'], 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1080&q=72', 'ember', 'watching', 'public', 'canonical', null),
  ('science', 'science', 'Science', 'Big questions, good explanations, curious people.', 'culture', array['i_science', 'i_tech'], 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1080&q=72', 'violet', 'diving in', 'public', 'canonical', null),
  ('ai', 'ai', 'AI', 'Building, testing and thinking about AI.', 'founders', array['i_ai', 'i_tech'], 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1080&q=72', 'electric', 'building', 'public', 'canonical', null),
  ('startups', 'startups', 'Startups', 'Founders, operators and first customers.', 'founders', array['i_startups', 'i_tech'], 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1080&q=72', 'graphite', 'building', 'public', 'canonical', null),
  ('photography', 'photography', 'Photography', 'Light, places and the stories behind the shot.', 'culture', array['i_photo', 'i_travel'], 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=1080&q=72', 'sunlight', 'shooting', 'public', 'canonical', null),
  ('style', 'style', 'Style', 'Fits, finds and the way cities dress.', 'style', array['i_style', 'i_vintage'], 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1080&q=72', 'graphite', 'styling', 'public', 'canonical', null),
  ('culture', 'culture', 'Culture', 'Art, design and the scenes worth knowing.', 'culture', array['i_art', 'i_design', 'i_creativity'], 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?auto=format&fit=crop&w=1080&q=72', 'jade', 'creating', 'public', 'canonical', null),
  ('sports', 'sports', 'Sports', 'Games to watch, games to play.', 'culture', array['i_sports', 'i_fitness'], 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1080&q=72', 'citrus', 'playing', 'public', 'canonical', null),
  ('music', 'music', 'Music', 'Shows, records and the people behind them.', 'culture', array['i_music'], 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1080&q=72', 'dusk', 'listening', 'public', 'canonical', null),
  ('gaming', 'gaming', 'Gaming', 'What you’re playing and who you play with.', 'culture', array['i_gaming', 'i_tech'], 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1080&q=72', 'electric', 'playing', 'public', 'canonical', null),
  ('books', 'books', 'Books', 'What you’re reading and what to read next.', 'culture', array['i_books', 'i_art'], 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1080&q=72', 'brass', 'reading', 'public', 'canonical', null),
  ('fitness', 'fitness', 'Fitness', 'Training, routes, and people to move with.', 'culture', array['i_fitness', 'i_wellness'], 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=640&q=72', 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1080&q=72', 'jade', 'training', 'public', 'canonical', null)
on conflict (id) do update set title = excluded.title, tagline = excluded.tagline, category = excluded.category,
  interests = excluded.interests, cover_url = excluded.cover_url, hero_url = excluded.hero_url, theme_id = excluded.theme_id, verb = excluded.verb;
