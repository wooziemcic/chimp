-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 7A · After Dark v2 foundation
-- "Real attraction. Mutual intent. Playful chemistry. Real plans."
-- Run AFTER 0006 (Supabase → SQL Editor). Idempotent: safe to run again.
-- 0001–0006 are not edited.
--
-- Reused, not duplicated:
--   crushes / my_sparks()   Crush stays the private Chimp primitive; a mutual
--                           Crush is one way into a Vibe.
--   conversations           a Vibe's private romantic chat is a conversation of
--                           kind 'vibe': same messages, reactions, Open Loops,
--                           RLS and Realtime as every other chat. Normal
--                           Messages (my_conversations) never lists it.
--   chat_loops              After Dark Plans are Open Loops with a plan state.
--   blocks                  a block ends every way of reaching someone.
--
-- New (only what had no home):
--   after_dark_profiles     opt-in to Discover: age, intent, an Open Loop
--                           prompt, extra photos. Nobody is in Discover unless
--                           they opted in.
--   after_dark_passes       private "Pass".
--   vibes / vibe_members    the pair object and each person's own controls.
--   vibe_challenges / _answers  dating games; your answers stay hidden from
--                           the other person until both have answered.
--   vibe_closures           the PRIVATE reason someone ended a Vibe.
--   reports                 report entry point (moderation tools: Phase 7B).
--
-- Consent model (no gender in the data): "the recipient of romantic interest
-- controls the next level of access".
--   * A Vibe starts pending; only the person who was asked can accept it.
--   * Photos and voice notes reach you only if YOU allow them (photos are off
--     until you turn them on).
--   * A Plan proposed by one person is confirmed only by the other.
--   * Either person can pause (only they resume) or end it; ending is final
--     and the other side only sees "This Vibe has ended."
--
-- View-once photos: the STATE is enforced here (only the recipient can open
-- it, once; afterwards the message no longer points at the file). The file
-- itself still lives in the public media bucket until Phase 7B adds a private
-- bucket + one-time signed URLs + server deletion. Not a security guarantee yet.
-- ════════════════════════════════════════════════════════════════════════════

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_participate') then
    raise exception 'Run 0006_messaging_chemistry.sql first.';
  end if;
end $$;

-- ─── 1. Vibe conversations, voice notes, view-once photos ────────────────────

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('direct', 'group', 'vibe'));

do $$ declare r record; begin
  -- media.kind: + 'audio' (voice notes)
  for r in select conname from pg_constraint
            where conrelid = 'public.media'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.media drop constraint %I', r.conname);
  end loop;
  -- messages.message_type: + 'voice'
  for r in select conname from pg_constraint
            where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%message_type%' loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.media add constraint media_kind_check check (kind in ('image', 'video', 'audio'));
alter table public.messages add constraint messages_type_check check (message_type in ('text', 'photo', 'voice'));

alter table public.messages add column if not exists view_once boolean not null default false;
alter table public.messages add column if not exists viewed_at timestamptz;
alter table public.messages add column if not exists duration_ms int check (duration_ms is null or duration_ms between 0 and 300000);

-- A view-once photo never carries its file on the message row (see
-- view_once_media below), and an unsent message keeps no words.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (deleted_at is not null or view_once or (body is not null and char_length(btrim(body)) > 0) or media_id is not null);

-- From the app: view-once only on photos, never arrives "viewed"; the view-once
-- fields can't be changed afterwards (opening goes through open_view_once()).
create or replace function public.messages_guard_7a() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.viewed_at := null;
    if new.view_once and new.message_type <> 'photo' then
      raise exception 'Only photos can be view-once.' using errcode = '22023';
    end if;
    if new.message_type in ('photo', 'voice') and new.media_id is null then
      raise exception 'A photo or voice note needs its file.' using errcode = '22023';
    end if;
    -- The file must be the sender's own upload, of the kind the message says
    -- (so a photo can't be sent as "text" or "voice" past someone's controls).
    if new.media_id is not null and not exists (
         select 1 from public.media md
          where md.id = new.media_id and md.owner_id = auth.uid()
            and md.kind = case new.message_type when 'photo' then 'image' when 'voice' then 'audio' end) then
      raise exception 'That file can''t be sent as this message.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.view_once is distinct from old.view_once or new.viewed_at is distinct from old.viewed_at or new.duration_ms is distinct from old.duration_ms then
    raise exception 'Messages can only be unsent.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_guard_7a_ins on public.messages;
create trigger messages_guard_7a_ins before insert on public.messages for each row execute function public.messages_guard_7a();
drop trigger if exists messages_guard_7a_upd on public.messages;
create trigger messages_guard_7a_upd before update on public.messages for each row execute function public.messages_guard_7a();

-- The file behind a view-once photo lives HERE, not on the message: it never
-- travels in a message read or a Realtime event, and nobody can read this
-- table (no policies). Only open_view_once() hands it to the recipient, once.
create table if not exists public.view_once_media (
  message_id uuid primary key references public.messages (id) on delete cascade deferrable initially deferred,
  media_id   uuid references public.media (id) on delete set null,
  opened_at  timestamptz
);
alter table public.view_once_media enable row level security;

create or replace function public.messages_view_once_stash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.view_once and new.media_id is not null then
    insert into public.view_once_media (message_id, media_id) values (new.id, new.media_id)
    on conflict (message_id) do update set media_id = excluded.media_id;
    new.media_id := null;
  end if;
  return new;
end $$;
-- (Fires after messages_guard_7a_ins / messages_guard_ins: triggers run in name order.)
drop trigger if exists messages_view_once_ins on public.messages;
create trigger messages_view_once_ins before insert on public.messages for each row execute function public.messages_view_once_stash();
create index if not exists messages_media_idx on public.messages (media_id) where media_id is not null;

-- 0001's "media read" was open to every signed-in user. Chat and After Dark
-- files (photos, voice notes, card photos) are now readable only by their
-- owner and by members of a conversation whose messages use them.
drop policy if exists "media read" on public.media;
create policy "media read" on public.media for select to authenticated using (
  owner_id = auth.uid()
  or (storage_path not like 'chat/%' and storage_path not like 'afterdark/%')
  or exists (select 1 from public.messages m
              where m.media_id = media.id and m.deleted_at is null and public.is_conversation_member(m.conversation_id))
);

-- Storage: voice notes (m4a / aac / webm on web) go to chat/{you}/…; After Dark
-- card photos to afterdark/{you}/…. (The 0002 policy, plus 'afterdark'.)
update storage.buckets
   set allowed_mime_types = (
     select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}') ||
       array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime',
             'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm']) m)
 where id = 'media' and allowed_mime_types is not null;
drop policy if exists "media objects insert" on storage.objects;
create policy "media objects insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    ((storage.foldername(name))[1] in ('avatars', 'posts', 'drift', 'stories', 'chat', 'afterdark') and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'boards' and exists (
      select 1 from public.boards b where b.id = (storage.foldername(name))[2] and b.owner_id = auth.uid()))
  )
);

-- ─── 2. After Dark profile (opt-in) + Pass ───────────────────────────────────

create table if not exists public.after_dark_profiles (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  -- Only people who switch this on can appear in anyone's Discover.
  discoverable boolean not null default false,
  -- Self-declared (18+). Real age verification is Phase 7B.
  age          int check (age between 18 and 99),
  intent       text check (intent in ('dating', 'casual', 'serious', 'open')),
  -- The Open Loop on their card ("Convince me Boston has better food than NYC.").
  prompt       text check (prompt is null or char_length(btrim(prompt)) between 1 and 140),
  -- Extra card photos (Storage paths of their own media).
  photo_paths  text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  updated_at   timestamptz not null default now(),
  check (not discoverable or age is not null)
);
alter table public.after_dark_profiles enable row level security;
drop policy if exists "ad profile own" on public.after_dark_profiles;
create policy "ad profile own" on public.after_dark_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.after_dark_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.prompt is not null then new.prompt := btrim(new.prompt); end if;
  if exists (select 1 from unnest(new.photo_paths) p
              where split_part(p, '/', 1) <> 'afterdark' or split_part(p, '/', 2) <> new.user_id::text
                 or not exists (select 1 from public.media m where m.storage_path = p and m.owner_id = new.user_id and m.kind = 'image')) then
    raise exception 'Card photos must be your own photos.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists after_dark_profiles_guard on public.after_dark_profiles;
create trigger after_dark_profiles_guard before insert or update on public.after_dark_profiles for each row execute function public.after_dark_profiles_guard();

create table if not exists public.after_dark_passes (
  from_id    uuid not null references public.profiles (id) on delete cascade,
  to_id      uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
alter table public.after_dark_passes enable row level security;
drop policy if exists "passes own" on public.after_dark_passes;
create policy "passes own" on public.after_dark_passes for all to authenticated using (from_id = auth.uid()) with check (from_id = auth.uid());

-- ─── 3. Vibes ────────────────────────────────────────────────────────────────

create table if not exists public.vibes (
  id              uuid primary key default gen_random_uuid(),   -- random key: Realtime DELETEs reveal nothing
  conversation_id uuid not null unique references public.conversations (id) on delete cascade,
  user_low        uuid not null references public.profiles (id) on delete cascade,
  user_high       uuid not null references public.profiles (id) on delete cascade,
  requested_by    uuid references public.profiles (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'active', 'paused', 'closed')),
  origin          text not null check (origin in ('mutual_crush', 'open_loop', 'interest')),
  origin_text     text check (origin_text is null or char_length(origin_text) <= 200),
  paused_by       uuid references public.profiles (id) on delete set null,
  closed_by       uuid references public.profiles (id) on delete set null,
  closed_at       timestamptz,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (user_low < user_high)
);
-- One live Vibe per pair.
alter table public.vibes add column if not exists accepted_at timestamptz;
create unique index if not exists vibes_open_pair_idx on public.vibes (user_low, user_high) where status <> 'closed';
create index if not exists vibes_low_idx on public.vibes (user_low);
create index if not exists vibes_high_idx on public.vibes (user_high);
alter table public.vibes enable row level security;
drop policy if exists "vibes members read" on public.vibes;
create policy "vibes members read" on public.vibes for select to authenticated using (auth.uid() in (user_low, user_high));
-- No insert/update/delete policies: only the checked functions below change a Vibe.

-- A Vibe that goes away (an account deleted) takes its private chat with it.
create or replace function public.vibes_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.conversations where id = old.conversation_id;
  return old;
end $$;
drop trigger if exists vibes_after_delete on public.vibes;
create trigger vibes_after_delete after delete on public.vibes for each row execute function public.vibes_after_delete();

create table if not exists public.vibe_members (
  id            uuid primary key default gen_random_uuid(),
  vibe_id       uuid not null references public.vibes (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('requester', 'recipient')),
  -- What THIS person accepts from the other one.
  allows_photos boolean not null default false,
  allows_voice  boolean not null default true,
  unique (vibe_id, user_id)
);
alter table public.vibe_members enable row level security;
drop policy if exists "vibe members read" on public.vibe_members;
create policy "vibe members read" on public.vibe_members for select to authenticated using (
  exists (select 1 from public.vibes v where v.id = vibe_id and auth.uid() in (v.user_low, v.user_high))
);

create table if not exists public.vibe_closures (
  id         uuid primary key default gen_random_uuid(),
  vibe_id    uuid not null references public.vibes (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reason     text not null check (reason in ('not_feeling_it', 'timing', 'different', 'met_someone', 'declined', 'blocked', 'other')),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
alter table public.vibe_closures enable row level security;
drop policy if exists "closures own" on public.vibe_closures;
-- PRIVATE: only the person who ended it ever sees why.
create policy "closures own" on public.vibe_closures for select to authenticated using (user_id = auth.uid());

-- Helpers
create or replace function public.vibe_for(cid uuid) returns public.vibes
language sql stable security definer set search_path = public as $$
  select * from public.vibes where conversation_id = cid;
$$;

-- May a member send this kind of message into this Vibe right now?
create or replace function public.vibe_can_send(cid uuid, p_type text, p_view_once boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vibes v
      join public.vibe_members other on other.vibe_id = v.id and other.user_id <> auth.uid()
     where v.conversation_id = cid and v.status = 'active' and auth.uid() in (v.user_low, v.user_high)
       and not public.is_blocked_between(v.user_low, v.user_high)
       and (p_type <> 'photo' or other.allows_photos)
       and (p_type <> 'voice' or other.allows_voice)
       and (not p_view_once or p_type = 'photo')
  );
$$;

-- 0006's can_participate (reactions, Pings, Open Loops), Vibe-aware: inside a
-- Vibe only while it's active (not pending, paused or ended).
create or replace function public.can_participate(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = cid and m.user_id = auth.uid() and m.status in ('active', 'request'))
     and not (public.conversation_kind(cid) = 'direct' and public.conversation_blocked(cid))
     and (public.conversation_kind(cid) is distinct from 'vibe'
          or exists (select 1 from public.vibes v where v.conversation_id = cid and v.status = 'active' and not public.is_blocked_between(v.user_low, v.user_high)));
$$;

-- 0006's "messages send", Vibe-aware: a Vibe's chat is open only while it's
-- active, and photos / voice notes reach someone only if they allow them.
-- Voice notes and view-once photos exist only inside Vibes.
drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and not (public.conversation_kind(conversation_id) = 'direct' and public.conversation_blocked(conversation_id))
  and not exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid() and m.status = 'declined')
  and (case when public.conversation_kind(conversation_id) = 'vibe'
            then public.vibe_can_send(conversation_id, message_type, view_once)
            else message_type in ('text', 'photo') and not view_once end)
);

-- Normal Messages never lists Vibe chats (0006's my_conversations, + that filter).
create or replace function public.my_conversations()
returns table (
  conversation_id uuid,
  kind text,
  other_id uuid,
  title text,
  avatar_url text,
  member_count integer,
  my_role text,
  my_status text,
  other_status text,
  last_message_id uuid,
  last_body text,
  last_type text,
  last_sender uuid,
  last_at timestamptz,
  updated_at timestamptz,
  unread integer
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.kind,
    o.user_id,
    c.title,
    c.avatar_url,
    (select count(*)::int from public.conversation_members x where x.conversation_id = c.id and x.status <> 'left'),
    me.role,
    me.status,
    o.status,
    lm.id,
    case when lm.deleted_at is null then lm.body end,
    lm.message_type,
    lm.sender_id,
    lm.created_at,
    c.updated_at,
    (select count(*)::int from public.messages x
      where x.conversation_id = c.id and x.sender_id <> auth.uid() and x.deleted_at is null and x.created_at > me.last_read_at)
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid() and me.status <> 'left'
  left join lateral (
    select m.user_id, m.status from public.conversation_members m
     where c.kind = 'direct' and m.conversation_id = c.id and m.user_id <> auth.uid() limit 1
  ) o on true
  left join public.messages lm on lm.id = c.last_message_id
  where c.kind <> 'vibe'
    and (c.kind = 'group' or not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.user_id))
  order by c.updated_at desc;
$$;

-- Is this person someone with whom romance is on the table at all?
create or replace function public._romantic_open(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = u and p.open_to && array['dating', 'casual'])
      or exists (select 1 from public.after_dark_profiles a where a.user_id = u and a.discoverable);
$$;

-- Take it After Dark: ask the other person for a Vibe.
--   origin 'mutual_crush'  — you both have a Crush on each other (my_sparks()).
--   origin 'open_loop' / 'interest' — they opted in to Discover; you answered
--   their card's Open Loop (origin_text) or sent interest.
-- Either way the Vibe is PENDING until they accept. Idempotent per pair.
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
  -- Generic refusals (never says whether they blocked you or what they chose).
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
  -- Nothing (not even a line of text) reaches anyone who hasn't confirmed 18+ in After Dark.
  if not exists (select 1 from public.after_dark_profiles a where a.user_id = p_other and a.age >= 18) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  lo := least(me, p_other); hi := greatest(me, p_other);
  perform pg_advisory_xact_lock(hashtext(lo::text || hi::text));
  select * into v from public.vibes x where x.user_low = lo and x.user_high = hi and x.status <> 'closed';
  if found then return v.id; end if;
  -- The pair's most recent Vibe decides. If they ended or declined it, only
  -- they can start a new one (their own withdrawn request doesn't count). If
  -- you withdrew your own unanswered request, you can ask again after a week.
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

-- Only the person who was asked can accept (or decline) a pending Vibe.
create or replace function public.respond_vibe(p_vibe uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v public.vibes;
begin
  select * into v from public.vibes where id = p_vibe for update;
  if not found or me not in (v.user_low, v.user_high) then raise exception 'Vibe not found.' using errcode = '42501'; end if;
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
    -- ...and they don't come back into my Discover.
    insert into public.after_dark_passes (from_id, to_id)
    values (me, case when v.user_low = me then v.user_high else v.user_low end) on conflict do nothing;
  end if;
end $$;

create or replace function public.pause_vibe(p_vibe uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  update public.vibes set status = 'paused', paused_by = me, updated_at = now()
   where id = p_vibe and me in (user_low, user_high) and status = 'active';
  if not found then raise exception 'Only an active Vibe can be paused.' using errcode = '22023'; end if;
end $$;

-- Only the person who paused it can pick it back up.
create or replace function public.resume_vibe(p_vibe uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  update public.vibes set status = 'active', paused_by = null, updated_at = now()
   where id = p_vibe and me in (user_low, user_high) and status = 'paused' and paused_by = me
     and not public.is_blocked_between(user_low, user_high);
  if not found then raise exception 'Only the person who paused it can resume it.' using errcode = '42501'; end if;
end $$;

-- End a Vibe (final). The reason is private to you; the other person only
-- sees that it ended, and nobody can message in it again.
create or replace function public.end_vibe(p_vibe uuid, p_reason text default 'other', p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v public.vibes;
begin
  select * into v from public.vibes where id = p_vibe for update;
  if not found or me not in (v.user_low, v.user_high) then raise exception 'Vibe not found.' using errcode = '42501'; end if;
  if v.status = 'closed' then return; end if;
  if p_reason not in ('not_feeling_it', 'timing', 'different', 'met_someone', 'blocked', 'other') then raise exception 'Unknown reason.' using errcode = '22023'; end if;
  update public.vibes set status = 'closed', closed_by = me, closed_at = now(), paused_by = null, updated_at = now() where id = v.id;
  insert into public.vibe_closures (vibe_id, user_id, reason, note) values (v.id, me, p_reason, nullif(btrim(coalesce(p_note, '')), ''));
  insert into public.after_dark_passes (from_id, to_id)
  values (me, case when v.user_low = me then v.user_high else v.user_low end) on conflict do nothing;
  -- Nothing private keeps waiting in an ended Vibe.
  delete from public.mutual_pings where conversation_id = v.conversation_id and match_id is null;
  update public.chat_loops set plan_state = 'closed' where conversation_id = v.conversation_id and plan_state in ('proposed', 'confirmed', 'paused');
end $$;

-- What I accept from the other person in this Vibe.
create or replace function public.set_vibe_controls(p_vibe uuid, p_photos boolean, p_voice boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_members set allows_photos = coalesce(p_photos, allows_photos), allows_voice = coalesce(p_voice, allows_voice)
   where vibe_id = p_vibe and user_id = auth.uid();
  if not found then raise exception 'Vibe not found.' using errcode = '42501'; end if;
  update public.vibes set updated_at = now() where id = p_vibe;  -- tells the other phone (Realtime)
end $$;

-- ─── 4. Challenges ───────────────────────────────────────────────────────────

create table if not exists public.vibe_challenges (
  id           uuid primary key default gen_random_uuid(),
  vibe_id      uuid not null references public.vibes (id) on delete cascade,
  kind         text not null check (kind in ('same_brain', 'would_you_rather', 'predict_me', 'choose_the_night', 'fast_five', 'after_hours')),
  -- Which question set (defined in the app; answers are option indexes).
  deck         text not null check (char_length(deck) between 1 and 40),
  sent_by      uuid references public.profiles (id) on delete set null,
  note         text check (note is null or char_length(note) <= 140),
  status       text not null default 'waiting' check (status in ('waiting', 'completed')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists vibe_challenges_vibe_idx on public.vibe_challenges (vibe_id, created_at desc);
alter table public.vibe_challenges enable row level security;
drop policy if exists "challenges members read" on public.vibe_challenges;
create policy "challenges members read" on public.vibe_challenges for select to authenticated using (
  exists (select 1 from public.vibes v where v.id = vibe_id and auth.uid() in (v.user_low, v.user_high))
);

create table if not exists public.vibe_challenge_answers (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.vibe_challenges (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  answers      jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) between 1 and 12),
  created_at   timestamptz not null default now(),
  unique (challenge_id, user_id)
);
alter table public.vibe_challenge_answers enable row level security;
drop policy if exists "answers read" on public.vibe_challenge_answers;
-- Yours always; theirs only once BOTH have answered (no peeking, no gaming it).
create policy "answers read" on public.vibe_challenge_answers for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.vibe_challenges c join public.vibes v on v.id = c.vibe_id
              where c.id = challenge_id and c.status = 'completed' and auth.uid() in (v.user_low, v.user_high))
);

create or replace function public.send_challenge(p_vibe uuid, p_kind text, p_deck text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v public.vibes; cid uuid;
begin
  select * into v from public.vibes where id = p_vibe;
  if not found or me not in (v.user_low, v.user_high) then raise exception 'Vibe not found.' using errcode = '42501'; end if;
  if v.status <> 'active' or public.is_blocked_between(v.user_low, v.user_high) then raise exception 'Challenges are for active Vibes.' using errcode = '42501'; end if;
  if (select count(*) from public.vibe_challenges where vibe_id = v.id and sent_by = me and status = 'waiting') >= 3 then
    raise exception 'Wait for them to play the ones you sent.' using errcode = '22023';
  end if;
  insert into public.vibe_challenges (vibe_id, kind, deck, sent_by, note)
  values (v.id, p_kind, p_deck, me, nullif(btrim(coalesce(p_note, '')), '')) returning id into cid;
  return cid;
end $$;

-- Answer once. When both have answered, the challenge completes and both see both.
create or replace function public.answer_challenge(p_challenge uuid, p_answers jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.vibe_challenges; v public.vibes; n int;
begin
  select * into c from public.vibe_challenges where id = p_challenge for update;
  if not found then raise exception 'Challenge not found.' using errcode = '42501'; end if;
  select * into v from public.vibes where id = c.vibe_id;
  if me not in (v.user_low, v.user_high) then raise exception 'Challenge not found.' using errcode = '42501'; end if;
  if v.status <> 'active' or public.is_blocked_between(v.user_low, v.user_high) then raise exception 'This Vibe isn''t active.' using errcode = '42501'; end if;
  if exists (select 1 from jsonb_array_elements(p_answers) x where jsonb_typeof(x) <> 'number' or (x::text)::numeric not between 0 and 9) then
    raise exception 'Answers are option numbers.' using errcode = '22023';
  end if;
  insert into public.vibe_challenge_answers (challenge_id, user_id, answers) values (c.id, me, p_answers)
  on conflict (challenge_id, user_id) do nothing;
  if not found then raise exception 'You already answered.' using errcode = '22023'; end if;
  select count(*) into n from public.vibe_challenge_answers where challenge_id = c.id;
  if n >= 2 then
    update public.vibe_challenges set status = 'completed', completed_at = now() where id = c.id;
    return 'completed';
  end if;
  return 'waiting';
end $$;

-- ─── 5. Plans = Open Loops with a plan state (private to the Vibe) ──────────

alter table public.chat_loops add column if not exists plan_state text;
alter table public.chat_loops drop constraint if exists chat_loops_plan_state_check;
alter table public.chat_loops add constraint chat_loops_plan_state_check check (plan_state is null or plan_state in ('proposed', 'confirmed', 'paused', 'completed', 'closed'));
alter table public.chat_loops add column if not exists plan_at timestamptz;
alter table public.chat_loops add column if not exists plan_by uuid references public.profiles (id) on delete set null;

-- Plan rules: only inside a Vibe; whoever proposes (or changes the details of)
-- a plan becomes its proposer and the OTHER person confirms it.
create or replace function public.chat_loops_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); detail_changed boolean;
begin
  if pg_trigger_depth() > 1 or me is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.plan_state is not null then
      if public.conversation_kind(new.conversation_id) is distinct from 'vibe' then raise exception 'Plans live in After Dark Vibes.' using errcode = '22023'; end if;
      new.plan_state := 'proposed';
      new.plan_by := me;
    else
      new.plan_by := null; new.plan_at := null;
    end if;
    return new;
  end if;
  if new.plan_state is null then
    if old.plan_state is not null then raise exception 'Close the plan instead.' using errcode = '22023'; end if;
    new.plan_by := old.plan_by; new.plan_at := old.plan_at;
    return new;
  end if;
  if public.conversation_kind(new.conversation_id) is distinct from 'vibe' then raise exception 'Plans live in After Dark Vibes.' using errcode = '22023'; end if;
  detail_changed := new.plan_at is distinct from old.plan_at or new.title is distinct from old.title or new.location_text is distinct from old.location_text or new.target_date is distinct from old.target_date;
  if old.plan_state = 'closed' or old.plan_state = 'completed' then
    if new.plan_state is distinct from old.plan_state or detail_changed or new.note is distinct from old.note
       or new.status is distinct from old.status or new.board_id is distinct from old.board_id then
      raise exception 'This plan is finished.' using errcode = '22023';
    end if;
    new.plan_by := old.plan_by;
    return new;
  end if;
  -- A note or status change isn't a new proposal: the proposer stays the proposer.
  if not detail_changed and new.plan_state = old.plan_state then
    new.plan_by := old.plan_by;
    return new;
  end if;
  if new.plan_state = 'confirmed' and old.plan_state is distinct from 'confirmed' then
    if old.plan_state is distinct from 'proposed' or old.plan_by = me or detail_changed then
      raise exception 'The other person confirms a plan.' using errcode = '42501';
    end if;
    new.plan_by := old.plan_by;
  elsif new.plan_state = 'completed' and old.plan_state is distinct from 'completed' then
    if old.plan_state is distinct from 'confirmed' then raise exception 'Only a confirmed plan can be completed.' using errcode = '22023'; end if;
    new.plan_by := old.plan_by;
  elsif new.plan_state in ('paused', 'closed') then
    new.plan_by := old.plan_by;
  else
    -- 'proposed' (new, re-proposed, or details tweaked): needs the other person again.
    new.plan_state := 'proposed';
    new.plan_by := me;
  end if;
  if detail_changed and new.plan_state = 'confirmed' then
    new.plan_state := 'proposed'; new.plan_by := me;
  end if;
  return new;
end $$;
drop trigger if exists chat_loops_plan_guard on public.chat_loops;
create trigger chat_loops_plan_guard before insert or update on public.chat_loops for each row execute function public.chat_loops_plan_guard();

-- ─── 6. View-once photos ─────────────────────────────────────────────────────

-- The recipient opens a view-once photo: once. Returns its Storage path, marks
-- it viewed, and the message stops pointing at the file. (The file itself is
-- removed from Storage in Phase 7B; until then this is state, not secrecy.)
create or replace function public.open_view_once(p_message uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.messages; vo public.view_once_media; p text;
begin
  select * into m from public.messages where id = p_message for update;
  if not found or not public.is_conversation_member(m.conversation_id) then raise exception 'Not found.' using errcode = '42501'; end if;
  if not m.view_once then raise exception 'Not a view-once photo.' using errcode = '22023'; end if;
  if m.sender_id = me then raise exception 'Only the person it was sent to can open it.' using errcode = '42501'; end if;
  if m.viewed_at is not null or m.deleted_at is not null then raise exception 'Already viewed.' using errcode = '22023'; end if;
  -- Only while the Vibe is active and nobody is blocked (not after an End or a block).
  if not exists (select 1 from public.vibes v where v.conversation_id = m.conversation_id and v.status = 'active'
                  and not public.is_blocked_between(v.user_low, v.user_high)) then
    raise exception 'This Vibe isn''t active.' using errcode = '42501';
  end if;
  select * into vo from public.view_once_media where message_id = m.id for update;
  if not found or vo.opened_at is not null then raise exception 'Already viewed.' using errcode = '22023'; end if;
  select storage_path into p from public.media where id = vo.media_id;
  update public.view_once_media set opened_at = now() where message_id = m.id;
  update public.messages set viewed_at = now() where id = m.id;
  return p;
end $$;

-- ─── 7. My Vibes, Discover ───────────────────────────────────────────────────

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
  messages_from_me integer, messages_from_them integer
)
language sql stable security definer set search_path = public as $$
  select v.id, v.conversation_id, o.user_id, v.status, me.role,
         v.origin, v.origin_text, v.requested_by = auth.uid(), v.paused_by = auth.uid(), v.closed_by = auth.uid(),
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
         (select count(*)::int from public.messages x where x.conversation_id = v.conversation_id and x.sender_id <> auth.uid() and x.deleted_at is null)
    from public.vibes v
    join public.vibe_members me on me.vibe_id = v.id and me.user_id = auth.uid()
    join public.vibe_members o on o.vibe_id = v.id and o.user_id <> auth.uid()
    join public.conversations c on c.id = v.conversation_id
    left join public.conversation_members cm on cm.conversation_id = v.conversation_id and cm.user_id = auth.uid()
    left join public.messages lm on lm.id = c.last_message_id
   where auth.uid() in (v.user_low, v.user_high)
   order by v.updated_at desc;
$$;

-- Discover: adults who opted in, never yourself, nobody you blocked or who
-- blocked you, nobody you passed on, nobody you already have a Vibe with, and
-- nobody who ended a Vibe with you. Only what their card shows: first name,
-- age, city (broad), interests, intent, their Open Loop, photos, and context
-- you can already see (Worlds you're BOTH members of, mutual connections).
-- You see Discover once you've confirmed 18+ (your own After Dark profile).
create or replace function public.after_dark_discover(p_limit int default 30)
returns table (
  user_id uuid, first_name text, age int, city text, interests text[], intent text, prompt text,
  avatar_url text, photo_paths text[], shared_worlds text[], mutual_connections int
)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id)
  select p.id, split_part(coalesce(p.display_name, p.username, 'Someone'), ' ', 1), a.age, p.city, p.interests, a.intent, a.prompt,
         p.avatar_url, a.photo_paths,
         array(select b.title from public.board_memberships m1
                 join public.board_memberships m2 on m2.board_id = m1.board_id and m2.user_id = p.id
                 join public.boards b on b.id = m1.board_id
                where m1.user_id = (select id from me) order by b.title limit 4),
         (select count(*)::int from public.connections c1
            join public.connections c2 on c2.status = 'connected'
             and (case when c2.user_a = p.id then c2.user_b else c2.user_a end) = (case when c1.user_a = (select id from me) then c1.user_b else c1.user_a end)
             and p.id in (c2.user_a, c2.user_b)
           where c1.status = 'connected' and (select id from me) in (c1.user_a, c1.user_b))
    from public.after_dark_profiles a
    join public.profiles p on p.id = a.user_id
   where a.discoverable and a.age >= 18
     and exists (select 1 from public.after_dark_profiles mine where mine.user_id = (select id from me) and mine.age >= 18)
     and p.id <> (select id from me)
     and not public.is_blocked_between((select id from me), p.id)
     and not exists (select 1 from public.after_dark_passes x where x.from_id = (select id from me) and x.to_id = p.id)
     and not exists (select 1 from public.vibes v where v.user_low = least((select id from me), p.id) and v.user_high = greatest((select id from me), p.id)
                       and (v.status <> 'closed' or v.closed_by = p.id))
   order by a.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 60));
$$;

-- ─── 8. Reports (entry point; moderation tools are Phase 7B) ─────────────────

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject_id  uuid references public.profiles (id) on delete set null,
  vibe_id     uuid references public.vibes (id) on delete set null,
  message_id  uuid references public.messages (id) on delete set null,
  context     text not null check (context in ('after_dark_vibe', 'after_dark_profile', 'message')),
  reason      text not null check (reason in ('fake', 'harassment', 'inappropriate', 'underage', 'safety', 'spam', 'other')),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports own insert" on public.reports;
create policy "reports own insert" on public.reports for insert to authenticated with check (
  reporter_id = auth.uid() and subject_id is distinct from auth.uid()
  and (vibe_id is null or exists (select 1 from public.vibes v where v.id = vibe_id and auth.uid() in (v.user_low, v.user_high)))
  and (message_id is null or exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)))
);
drop policy if exists "reports own read" on public.reports;
create policy "reports own read" on public.reports for select to authenticated using (reporter_id = auth.uid());

-- ─── Blocks end Vibes ────────────────────────────────────────────────────────
-- A block closes any Vibe between the two (the blocker "ended" it, privately
-- marked 'blocked'), so neither side sees a falsely "active" Vibe and the
-- blocked person can't start a new one. They see only "This Vibe has ended."
create or replace function public.blocks_close_vibes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.vibes;
begin
  for v in select * from public.vibes
            where user_low = least(new.blocker_id, new.blocked_id) and user_high = greatest(new.blocker_id, new.blocked_id)
              and status <> 'closed' for update loop
    update public.vibes set status = 'closed', closed_by = new.blocker_id, closed_at = now(), paused_by = null, updated_at = now() where id = v.id;
    insert into public.vibe_closures (vibe_id, user_id, reason) values (v.id, new.blocker_id, 'blocked');
    delete from public.mutual_pings where conversation_id = v.conversation_id and match_id is null;
    update public.chat_loops set plan_state = 'closed' where conversation_id = v.conversation_id and plan_state in ('proposed', 'confirmed', 'paused');
  end loop;
  return new;
end $$;
drop trigger if exists blocks_close_vibes on public.blocks;
create trigger blocks_close_vibes after insert on public.blocks for each row execute function public.blocks_close_vibes();

-- ─── 9. Realtime (RLS applies; every published table has a random-id key) ───
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.vibes; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.vibe_challenges; exception when duplicate_object then null; end;
  end if;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public.vibe_for(uuid), public._romantic_open(uuid) from public, anon, authenticated;
-- Whether two people blocked each other is nobody else's business: only the
-- checked functions above (security definer) ask. (0002 left it callable.)
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.request_vibe(uuid, text, text), public.respond_vibe(uuid, boolean), public.pause_vibe(uuid), public.resume_vibe(uuid),
  public.end_vibe(uuid, text, text), public.set_vibe_controls(uuid, boolean, boolean), public.send_challenge(uuid, text, text, text),
  public.answer_challenge(uuid, jsonb), public.open_view_once(uuid), public.my_vibes(), public.after_dark_discover(int),
  public.vibe_can_send(uuid, text, boolean), public.can_participate(uuid), public.my_conversations() from public, anon;
grant execute on function public.request_vibe(uuid, text, text), public.respond_vibe(uuid, boolean), public.pause_vibe(uuid), public.resume_vibe(uuid),
  public.end_vibe(uuid, text, text), public.set_vibe_controls(uuid, boolean, boolean), public.send_challenge(uuid, text, text, text),
  public.answer_challenge(uuid, jsonb), public.open_view_once(uuid), public.my_vibes(), public.after_dark_discover(int),
  public.vibe_can_send(uuid, text, boolean), public.can_participate(uuid), public.my_conversations() to authenticated;
