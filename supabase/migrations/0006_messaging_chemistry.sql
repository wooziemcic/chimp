-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Final pre-TestFlight messaging patch
-- Group Chat · Reactions + Same Brain · Mutual Ping · Open Loops · Chemistry
-- Run AFTER 0005 (Supabase → SQL Editor). Idempotent: safe to run again.
-- 0001–0005 are not edited. Redefined here: my_conversations() (groups),
-- the "messages send" policy (blocks are 1:1-only), prepare_account_deletion()
-- (group-aware; 0005's World teardown and hand-on are kept exactly) and
-- respond_to_request() (declining a group = leaving it). Messages get replies
-- (reply_to), an unsend-only update guard and server-set timestamps.
--
--   Group chat        conversations.kind = 'group' + title/avatar/created_by,
--                     conversation_members.role owner·admin·member. Created and
--                     changed only through checked functions. Reading and
--                     sending stay "active members only" (0002 RLS).
--   Reactions         message_reactions (members only, via react()); a message
--                     that was deleted can't get new ones.
--   Same Brain        same_brain_events: one per message + emoji, written by
--                     react() when 2 people (1:1) within 30 s, or 3+ distinct
--                     members (group) within 90 s, chose the same emoji.
--   Mutual Ping       mutual_pings are PRIVATE: RLS lets only the sender read
--                     their own, no Realtime, matched only inside send_ping().
--                     ping_matches (what everyone sees) exist only once a match
--                     happens: 2 compatible people (1:1) or 3+ (group).
--   Open Loops        chat_loops (the UI's "Open Loops") belong to the conversation: all its members
--                     can see and edit them; the creator or group owner/admin
--                     can delete. Source message optional (set null on delete).
--   Chemistry         computed in the app from rows members can already read
--                     (messages, reactions, Same Brain, Open Loops, matches).
--                     Unmatched Pings are never readable, so never in it.
--   Account deletion  1:1 chats: deleted (as before). Groups: the person is
--                     removed, ownership passes on, the group survives unless
--                     no active member is left. Their group messages are
--                     deleted with the account (6D policy: no tombstones).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Group conversations ──────────────────────────────────────────────────

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('direct', 'group'));
alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists avatar_media_id uuid references public.media (id) on delete set null;
alter table public.conversations add column if not exists avatar_url text;
alter table public.conversations add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.conversations drop constraint if exists conversations_title_check;
alter table public.conversations add constraint conversations_title_check check (title is null or char_length(btrim(title)) between 1 and 60);
alter table public.conversations drop constraint if exists conversations_group_title;
alter table public.conversations add constraint conversations_group_title check (kind <> 'group' or title is not null);

-- Realtime sends DELETE events to every subscriber of a table, carrying only
-- the primary key (RLS can't be checked on a deleted row). 0002 keyed members
-- by (conversation_id, user_id), so a deleted membership (a group deleted, an
-- account deleted) would tell every listener who was in which conversation.
-- A random id as the primary key makes those events meaningless to anyone else.
alter table public.conversation_members add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.conversation_members'::regclass and c.contype = 'p'
              and pg_get_constraintdef(c.oid) <> 'PRIMARY KEY (id)') then
    execute (select format('alter table public.conversation_members drop constraint %I', conname) from pg_constraint where conrelid = 'public.conversation_members'::regclass and contype = 'p');
    alter table public.conversation_members add constraint conversation_members_pkey primary key (id);
  end if;
end $$;
create unique index if not exists conversation_members_pair_idx on public.conversation_members (conversation_id, user_id);

-- You can always read your OWN membership row, so a removed member's app hears
-- (through Realtime) that it was removed. It reveals nothing about anyone else.
drop policy if exists "members read own" on public.conversation_members;
create policy "members read own" on public.conversation_members for select to authenticated using (user_id = auth.uid());

alter table public.conversation_members add column if not exists role text not null default 'member';
alter table public.conversation_members drop constraint if exists conversation_members_role_check;
alter table public.conversation_members add constraint conversation_members_role_check check (role in ('owner', 'admin', 'member'));

-- My role in a conversation I'm (still) in; null otherwise.
create or replace function public.conversation_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.conversation_members m where m.conversation_id = cid and m.user_id = auth.uid() and m.status <> 'left';
$$;

-- 'direct' / 'group' for a conversation I'm (still) in; null otherwise (so it
-- can't be used to probe other people's conversation ids).
create or replace function public.conversation_kind(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select c.kind from public.conversations c where c.id = cid and public.is_conversation_member(cid);
$$;

-- May I act in this conversation (react, Ping, add or change an Open Loop)?
-- Active or invited members only; not someone who declined; and in a 1:1, not
-- while either of us has blocked the other (a block stops every way of reaching someone).
create or replace function public.can_participate(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = cid and m.user_id = auth.uid() and m.status in ('active', 'request'))
     and not (public.conversation_kind(cid) = 'direct' and public.conversation_blocked(cid));
$$;

-- Blocks stop 1:1 messages (0002). In a group they don't lock anyone out of
-- the whole group; you just can't add someone you've blocked (or who blocked you).
drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and not (public.conversation_kind(conversation_id) = 'direct' and public.conversation_blocked(conversation_id))
  and not exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid() and m.status = 'declined')
);

-- Replies: a message may quote an earlier message of the SAME conversation.
alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;

-- Unsend really removes the words: an unsent message keeps no body or photo.
do $$ declare r record; begin
  -- 0002's unnamed "body or photo" check (named messages_check by Postgres).
  for r in select conname from pg_constraint
            where conrelid = 'public.messages'::regclass and contype = 'c' and conname <> 'messages_content_check'
              and pg_get_constraintdef(oid) like '%media_id IS NOT NULL%' loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (deleted_at is not null or (body is not null and char_length(btrim(body)) > 0) or media_id is not null);

-- 0002's "messages unsend" UPDATE policy only checks sender_id, so on its own
-- it would let a sender rewrite a message or move it into ANOTHER conversation
-- (e.g. a group they're not in). From now on the only change a person can make
-- to a message is to unsend it (once). FK cascades (depth > 1) and checked
-- server functions (running as the owner) are unaffected.
create or replace function public.messages_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.reply_to is not null and not exists (select 1 from public.messages r where r.id = new.reply_to and r.conversation_id = new.conversation_id) then
      new.reply_to := null;
    end if;
    -- From the app, a new message is always "now", never edited, never already unsent.
    if current_user in ('authenticated', 'anon') then
      new.created_at := now();
      new.edited_at := null;
      new.deleted_at := null;
    end if;
    return new;
  end if;
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id <> old.id or new.conversation_id <> old.conversation_id or new.sender_id <> old.sender_id
     or new.body is distinct from old.body and new.deleted_at is null
     or new.media_id is distinct from old.media_id and new.deleted_at is null
     or new.message_type <> old.message_type or new.client_id is distinct from old.client_id
     or new.created_at <> old.created_at or new.edited_at is distinct from old.edited_at
     or new.reply_to is distinct from old.reply_to then
    raise exception 'Messages can only be unsent.' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'That message was already unsent.' using errcode = '42501';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := null;
    new.media_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists messages_guard_ins on public.messages;
create trigger messages_guard_ins before insert on public.messages for each row execute function public.messages_guard();
drop trigger if exists messages_guard_upd on public.messages;
create trigger messages_guard_upd before update on public.messages for each row execute function public.messages_guard();

-- After an unsend, the chat list previews the latest message still there.
create or replace function public.on_message_unsent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.conversations c
       set last_message_id = (select x.id from public.messages x where x.conversation_id = c.id and x.deleted_at is null order by x.created_at desc limit 1)
     where c.id = new.conversation_id and c.last_message_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists messages_after_unsend on public.messages;
create trigger messages_after_unsend after update on public.messages for each row execute function public.on_message_unsent();

-- Internal: after someone leaves a group, keep it owned (oldest admin, else the
-- longest-standing active member); delete it if no active member is left.
create or replace function public._group_after_leave(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare succ uuid;
begin
  perform 1 from public.conversations where id = cid for update;  -- one leave at a time per group
  if not exists (select 1 from public.conversation_members where conversation_id = cid and status = 'active') then
    delete from public.conversations where id = cid and kind = 'group';
    return;
  end if;
  if exists (select 1 from public.conversation_members where conversation_id = cid and role = 'owner' and status = 'active') then return; end if;
  select user_id into succ from public.conversation_members
   where conversation_id = cid and status = 'active'
   order by (role = 'admin') desc, joined_at asc limit 1;
  update public.conversation_members set role = 'owner' where conversation_id = cid and user_id = succ and status = 'active';
end $$;

-- Create a group: you + at least 2 other people you're allowed to message.
-- People who could only get a message request from you join as a request.
create or replace function public.create_group(p_title text, p_members uuid[], p_avatar_media_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); others uuid[]; cid uuid; u uuid; st text; avatar text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters).' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x), '{}') into others from unnest(coalesce(p_members, '{}')) x where x is not null and x <> me;
  if cardinality(others) < 2 then raise exception 'A group needs you and at least 2 other people.' using errcode = '22023'; end if;
  if cardinality(others) > 49 then raise exception 'Groups can have up to 50 people for now.' using errcode = '22023'; end if;
  foreach u in array others loop
    if public.message_status(me, u) is null then raise exception 'You can only add people you can message.' using errcode = '42501'; end if;
  end loop;
  if p_avatar_media_id is not null then
    select storage_path into avatar from public.media where id = p_avatar_media_id and owner_id = me;
    if avatar is null then raise exception 'That photo isn''t yours.' using errcode = '42501'; end if;
  end if;
  insert into public.conversations (kind, title, created_by, avatar_media_id, avatar_url)
  values ('group', btrim(p_title), me, p_avatar_media_id, null) returning id into cid;
  if avatar is not null then update public.conversations set avatar_url = avatar where id = cid; end if;
  insert into public.conversation_members (conversation_id, user_id, status, role) values (cid, me, 'active', 'owner');
  foreach u in array others loop
    st := public.message_status(me, u);
    insert into public.conversation_members (conversation_id, user_id, status, role)
    values (cid, u, case when st = 'active' then 'active' else 'request' end, 'member');
  end loop;
  return cid;
end $$;

-- The avatar is stored as a Storage path (avatar_url); the app turns it into a URL.
create or replace function public.update_group(cid uuid, p_title text default null, p_avatar_media_id uuid default null, p_clear_avatar boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); path text;
begin
  if public.conversation_kind(cid) is distinct from 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  if coalesce(public.conversation_role(cid), '') not in ('owner', 'admin') then raise exception 'Only the group''s owner or an admin can change it.' using errcode = '42501'; end if;
  if p_title is not null then
    if char_length(btrim(p_title)) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters).' using errcode = '22023'; end if;
    update public.conversations set title = btrim(p_title) where id = cid;
  end if;
  if p_avatar_media_id is not null then
    select storage_path into path from public.media where id = p_avatar_media_id and owner_id = me;
    if path is null then raise exception 'That photo isn''t yours.' using errcode = '42501'; end if;
    update public.conversations set avatar_media_id = p_avatar_media_id, avatar_url = path where id = cid;
  elsif p_clear_avatar then
    update public.conversations set avatar_media_id = null, avatar_url = null where id = cid;
  end if;
end $$;

create or replace function public.add_group_members(cid uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); u uuid; st text; n int := 0;
begin
  if public.conversation_kind(cid) is distinct from 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  if coalesce(public.conversation_role(cid), '') not in ('owner', 'admin') then raise exception 'Only the group''s owner or an admin can add people.' using errcode = '42501'; end if;
  if cardinality(coalesce(p_users, '{}')) > 49 then raise exception 'Groups can have up to 50 people for now.' using errcode = '22023'; end if;
  perform 1 from public.conversations where id = cid for update;
  foreach u in array coalesce(p_users, '{}') loop
    continue when u is null or u = me;
    st := public.message_status(me, u);
    if st is null then raise exception 'You can only add people you can message.' using errcode = '42501'; end if;
    if exists (select 1 from public.conversation_members where conversation_id = cid and user_id = u and status <> 'left') then continue; end if;
    if (select count(*) from public.conversation_members where conversation_id = cid and status <> 'left') >= 50 then
      raise exception 'Groups can have up to 50 people for now.' using errcode = '22023';
    end if;
    insert into public.conversation_members (conversation_id, user_id, status, role, joined_at, last_read_at)
    values (cid, u, case when st = 'active' then 'active' else 'request' end, 'member', now(), now())
    on conflict (conversation_id, user_id) do update set status = excluded.status, role = 'member', joined_at = now(), last_read_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Owner removes anyone; an admin removes members only. Removed = no more access.
create or replace function public.remove_group_member(cid uuid, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mine text := public.conversation_role(cid); theirs text;
begin
  if public.conversation_kind(cid) is distinct from 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  select role into theirs from public.conversation_members where conversation_id = cid and user_id = who and status <> 'left';
  if theirs is null then return; end if;
  if who = auth.uid() then raise exception 'Use Leave group.' using errcode = '22023'; end if;
  if not (mine = 'owner' or (mine = 'admin' and theirs = 'member')) then
    raise exception 'Only the group''s owner (or an admin, for members) can remove people.' using errcode = '42501';
  end if;
  update public.conversation_members set status = 'left', role = 'member' where conversation_id = cid and user_id = who;
  delete from public.mutual_pings where conversation_id = cid and sender_id = who and match_id is null;
end $$;

create or replace function public.set_group_role(cid uuid, who uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.conversation_role(cid) is distinct from 'owner' then raise exception 'Only the owner can change roles.' using errcode = '42501'; end if;
  if new_role not in ('admin', 'member') then raise exception 'Unknown role.' using errcode = '22023'; end if;
  update public.conversation_members set role = new_role where conversation_id = cid and user_id = who and status = 'active' and role <> 'owner';
end $$;

create or replace function public.leave_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.conversation_kind(cid) is distinct from 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  update public.conversation_members set status = 'left', role = 'member' where conversation_id = cid and user_id = auth.uid() and status <> 'left';
  if not found then return; end if;
  delete from public.mutual_pings where conversation_id = cid and sender_id = auth.uid() and match_id is null;
  perform public._group_after_leave(cid);
end $$;

-- 0002's respond_to_request, group-aware: declining a GROUP means leaving it
-- (a "declined" member would otherwise keep reading it). 1:1 is unchanged.
create or replace function public.respond_to_request(cid uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not accept and public.conversation_kind(cid) = 'group' then
    perform public.leave_group(cid);
    return;
  end if;
  update public.conversation_members set status = case when accept then 'active' else 'declined' end
   where conversation_id = cid and user_id = auth.uid() and status in ('request', 'declined');
end $$;

create or replace function public.delete_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.conversation_kind(cid) is distinct from 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  if public.conversation_role(cid) is distinct from 'owner' then raise exception 'Only the group''s owner can delete it.' using errcode = '42501'; end if;
  delete from public.conversations where id = cid;  -- members, messages, reactions, loops, pings cascade
end $$;

-- My conversations, 1:1 and groups. (Return type changed → drop first.)
drop function if exists public.my_conversations();
create function public.my_conversations()
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
  where c.kind = 'group' or not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.user_id)
  order by c.updated_at desc;
$$;

-- ─── 2. Reactions + Same Brain ───────────────────────────────────────────────

create table if not exists public.message_reactions (
  id              uuid primary key default gen_random_uuid(),  -- a random key: Realtime DELETE events carry nothing else
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  emoji           text not null check (emoji in ('❤️', '😂', '🔥', '👍', '😮', '😭')),
  created_at      timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_conv_idx on public.message_reactions (conversation_id, created_at desc);
alter table public.message_reactions enable row level security;
drop policy if exists "reactions read" on public.message_reactions;
create policy "reactions read" on public.message_reactions for select to authenticated using (public.is_conversation_member(conversation_id));
-- No insert/update/delete policies: react() is the only way in.

create table if not exists public.same_brain_events (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  emoji           text not null,
  participants    uuid[] not null,
  created_at      timestamptz not null default now(),
  unique (message_id, emoji)
);
alter table public.same_brain_events enable row level security;
drop policy if exists "same brain read" on public.same_brain_events;
create policy "same brain read" on public.same_brain_events for select to authenticated using (public.is_conversation_member(conversation_id));

-- Add or remove my reaction. Returns {"same_brain": true} when THIS reaction
-- completed a Same Brain (so only that moment animates).
create or replace function public.react(p_message_id uuid, p_emoji text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  msg public.messages;
  k text;
  need int;
  win interval;
  who uuid[];
  made boolean := false;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into msg from public.messages where id = p_message_id;
  if not found or not public.can_participate(msg.conversation_id) then raise exception 'You can''t react here.' using errcode = '42501'; end if;
  -- One reaction decision at a time per conversation, so two people reacting in
  -- the same instant can't both miss (or both make) the Same Brain.
  perform 1 from public.conversations where id = msg.conversation_id for update;
  if not p_on then
    delete from public.message_reactions where message_id = p_message_id and user_id = me and emoji = p_emoji;
    return jsonb_build_object('same_brain', false);
  end if;
  if msg.deleted_at is not null then raise exception 'That message was deleted.' using errcode = '22023'; end if;
  if p_emoji not in ('❤️', '😂', '🔥', '👍', '😮', '😭') then raise exception 'Unknown reaction.' using errcode = '22023'; end if;
  insert into public.message_reactions (message_id, conversation_id, user_id, emoji)
  values (p_message_id, msg.conversation_id, me, p_emoji) on conflict (message_id, user_id, emoji) do nothing;

  k := public.conversation_kind(msg.conversation_id);
  need := case when k = 'group' then 3 else 2 end;
  win  := case when k = 'group' then interval '90 seconds' else interval '30 seconds' end;
  -- Distinct people whose same emoji on this message landed within the window
  -- ending now (server time).
  -- (Only people still in the conversation count.)
  select coalesce(array_agg(r.user_id order by r.created_at), '{}') into who
    from public.message_reactions r
    join public.conversation_members m on m.conversation_id = r.conversation_id and m.user_id = r.user_id and m.status in ('active', 'request')
   where r.message_id = p_message_id and r.emoji = p_emoji and r.created_at >= now() - win;
  if cardinality(who) >= need and me = any (who) then
    insert into public.same_brain_events (message_id, conversation_id, emoji, participants)
    values (p_message_id, msg.conversation_id, p_emoji, who)
    on conflict (message_id, emoji) do nothing;
    made := found;
  end if;
  return jsonb_build_object('same_brain', made);
end $$;

-- ─── 3. Mutual Ping (private intent) ─────────────────────────────────────────

create table if not exists public.ping_matches (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  kinds           text[] not null,
  participants    uuid[] not null,
  custom_text     text,
  created_at      timestamptz not null default now()
);
alter table public.ping_matches enable row level security;
drop policy if exists "ping matches read" on public.ping_matches;
create policy "ping matches read" on public.ping_matches for select to authenticated using (public.is_conversation_member(conversation_id));

create table if not exists public.mutual_pings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('free_tonight', 'food', 'hang_out', 'call', 'need_advice', 'thinking_of_you', 'custom')),
  custom_text     text check (custom_text is null or char_length(btrim(custom_text)) between 1 and 60),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  match_id        uuid references public.ping_matches (id) on delete set null,
  check (kind <> 'custom' or custom_text is not null)
);
create index if not exists mutual_pings_conv_idx on public.mutual_pings (conversation_id, expires_at);
alter table public.mutual_pings enable row level security;
-- PRIVATE: you can see and cancel only your own. Nobody else, ever, through the API.
drop policy if exists "pings own read" on public.mutual_pings;
create policy "pings own read" on public.mutual_pings for select to authenticated using (sender_id = auth.uid());
drop policy if exists "pings own cancel" on public.mutual_pings;
create policy "pings own cancel" on public.mutual_pings for delete to authenticated using (sender_id = auth.uid() and match_id is null);

-- The explicit compatibility map (no AI). Same kind always matches; custom only
-- matches custom with the same words (case and spaces ignored).
create or replace function public.pings_compatible(a text, a_text text, b text, b_text text) returns boolean
language sql immutable as $$
  select case
    when a = 'custom' or b = 'custom' then a = b and lower(btrim(coalesce(a_text, ''))) = lower(btrim(coalesce(b_text, ''))) and btrim(coalesce(a_text, '')) <> ''
    when a = b then true
    else (least(a, b), greatest(a, b)) in (('food', 'free_tonight'), ('free_tonight', 'hang_out'), ('food', 'hang_out'), ('call', 'need_advice'), ('call', 'thinking_of_you'))
  end;
$$;

-- Send (or replace) my Ping in this conversation. The answer is only
-- 'waiting' or 'matched': nothing about anyone else's hidden Ping.
create or replace function public.send_ping(cid uuid, p_kind text, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mine public.mutual_pings;
  cand record;
  chosen public.mutual_pings[] := '{}';
  ok boolean;
  c public.mutual_pings;
  need int;
  mid uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = cid and user_id = me and status = 'active') or not public.can_participate(cid) then
    raise exception 'You can''t Ping here.' using errcode = '42501';
  end if;
  -- One Ping decision at a time per conversation (two compatible Pings sent in
  -- the same instant must still match, and no Ping can join two matches).
  perform 1 from public.conversations where id = cid for update;
  -- Tidy: expired unmatched Pings disappear.
  delete from public.mutual_pings where conversation_id = cid and match_id is null and expires_at <= now();
  -- One open Ping per person per conversation: a new one replaces it.
  delete from public.mutual_pings where conversation_id = cid and sender_id = me and match_id is null;
  insert into public.mutual_pings (conversation_id, sender_id, kind, custom_text)
  values (cid, me, p_kind, case when p_kind = 'custom' then nullif(btrim(coalesce(p_text, '')), '') end)
  returning * into mine;

  -- Other active members' live, unmatched Pings compatible with mine, oldest first;
  -- keep each only if it's compatible with everyone already chosen.
  for cand in
    select p.* from public.mutual_pings p
      join public.conversation_members m on m.conversation_id = p.conversation_id and m.user_id = p.sender_id and m.status = 'active'
     where p.conversation_id = cid and p.sender_id <> me and p.match_id is null and p.expires_at > now()
       and p.created_at >= m.joined_at  -- a Ping from before someone was (re-)added never counts
       and public.pings_compatible(mine.kind, mine.custom_text, p.kind, p.custom_text)
     order by p.created_at
  loop
    ok := true;
    foreach c in array chosen loop
      if not public.pings_compatible(c.kind, c.custom_text, cand.kind, cand.custom_text) then ok := false; end if;
    end loop;
    if ok then chosen := chosen || row(cand.id, cand.conversation_id, cand.sender_id, cand.kind, cand.custom_text, cand.created_at, cand.expires_at, cand.match_id)::public.mutual_pings; end if;
  end loop;

  need := case when public.conversation_kind(cid) = 'group' then 3 else 2 end;
  if cardinality(chosen) + 1 < need then return jsonb_build_object('status', 'waiting'); end if;

  insert into public.ping_matches (conversation_id, kinds, participants, custom_text)
  select cid,
         array_agg(k order by t),
         array_agg(u order by t),
         mine.custom_text
    from (select mine.kind k, me u, mine.created_at t
          union all select x.kind, x.sender_id, x.created_at from unnest(chosen) x) q
  returning id into mid;
  update public.mutual_pings set match_id = mid where id = mine.id or id = any (select x.id from unnest(chosen) x);
  return jsonb_build_object('status', 'matched', 'match_id', mid);
end $$;

-- ─── 4. Open Loops (table chat_loops) ────────────────────────────────────────
-- Named chat_loops because 0001 already has a personal, per-user open_loops
-- table (unused by the app); that one is left exactly as it is.

create table if not exists public.chat_loops (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  source_message_id uuid references public.messages (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  title             text not null check (char_length(btrim(title)) between 1 and 120),
  note              text check (note is null or char_length(note) <= 1000),
  status            text not null default 'open' check (status in ('open', 'resolved')),
  target_date       date,
  location_text     text check (location_text is null or char_length(location_text) <= 120),
  board_id          text references public.boards (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz
);
create index if not exists chat_loops_conv_idx on public.chat_loops (conversation_id, status);
alter table public.chat_loops enable row level security;
drop policy if exists "loops read" on public.chat_loops;
create policy "loops read" on public.chat_loops for select to authenticated using (public.is_conversation_member(conversation_id));
drop policy if exists "loops add" on public.chat_loops;
create policy "loops add" on public.chat_loops for insert to authenticated with check (
  created_by = auth.uid() and public.can_participate(conversation_id)
  and (source_message_id is null or exists (select 1 from public.messages x where x.id = source_message_id and x.conversation_id = chat_loops.conversation_id))
);
drop policy if exists "loops edit" on public.chat_loops;
create policy "loops edit" on public.chat_loops for update to authenticated using (public.can_participate(conversation_id)) with check (public.can_participate(conversation_id));
drop policy if exists "loops delete" on public.chat_loops;
create policy "loops delete" on public.chat_loops for delete to authenticated using (
  public.can_participate(conversation_id) and (created_by = auth.uid() or public.conversation_role(conversation_id) in ('owner', 'admin'))
);

-- Server-kept fields: who/where/when can't be rewritten; resolved_at follows
-- status; a World can only be linked by someone who owns it.
create or replace function public.chat_loops_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.updated_at := now(); new.status := 'open'; new.resolved_at := null;
    if new.board_id is not null and not exists (select 1 from public.boards b where b.id = new.board_id and b.owner_id = auth.uid()) then new.board_id := null; end if;
    return new;
  end if;
  new.conversation_id := old.conversation_id;
  new.created_at := old.created_at;
  -- Only the database's own ON DELETE SET NULL (a cascade, one trigger level
  -- down) may clear these; members can't rewrite or clear them.
  new.created_by := case when new.created_by is null and pg_trigger_depth() > 1 then null else old.created_by end;
  new.source_message_id := case when new.source_message_id is null and pg_trigger_depth() > 1 then null else old.source_message_id end;
  new.updated_at := now();
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now();
  elsif new.status = 'open' then new.resolved_at := null;
  else new.resolved_at := old.resolved_at;
  end if;
  if new.board_id is distinct from old.board_id and new.board_id is not null
     and not exists (select 1 from public.boards b where b.id = new.board_id and b.owner_id = auth.uid()) then
    raise exception 'You can only link a World you own.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists chat_loops_guard_ins on public.chat_loops;
create trigger chat_loops_guard_ins before insert on public.chat_loops for each row execute function public.chat_loops_guard();
drop trigger if exists chat_loops_guard_upd on public.chat_loops;
create trigger chat_loops_guard_upd before update on public.chat_loops for each row execute function public.chat_loops_guard();

-- ─── 5. Account deletion: group-aware (0005's World logic kept as is) ────────
create or replace function public.prepare_account_deletion(p_uid uuid, p_transfer boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; g record; succ uuid; deleted text[] := '{}'; handed int := 0; paths text[] := '{}';
begin
  if p_uid is null then raise exception 'No account.'; end if;
  -- Worlds (unchanged from 0005): hand on or delete through the shared teardown.
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

  -- 1:1 chats end for both people (as before).
  delete from public.conversations c
   where c.kind = 'direct' and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_uid);

  -- Groups survive: remove the person, delete their messages there (no
  -- tombstones), keep the group owned, refresh its last-message preview, and
  -- drop a group photo that was theirs.
  for g in select m.conversation_id as id from public.conversation_members m join public.conversations c on c.id = m.conversation_id
            where m.user_id = p_uid and c.kind = 'group' loop
    update public.conversations set avatar_media_id = null, avatar_url = null
     where id = g.id and avatar_media_id in (select id from public.media where owner_id = p_uid);
    delete from public.messages where conversation_id = g.id and sender_id = p_uid;
    delete from public.conversation_members where conversation_id = g.id and user_id = p_uid;
    update public.conversations c set last_message_id = (select x.id from public.messages x where x.conversation_id = c.id and x.deleted_at is null order by x.created_at desc limit 1) where c.id = g.id;
    perform public._group_after_leave(g.id);
  end loop;

  delete from public.comments where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                               or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                               or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  delete from public.reactions where (target_kind = 'buzz'  and target_id in (select id::text from public.buzz_items  where author_id = p_uid))
                                or (target_kind = 'drift' and target_id in (select id::text from public.drift_items where author_id = p_uid))
                                or (target_kind = 'story' and target_id in (select id::text from public.story_items where author_id = p_uid));
  return jsonb_build_object('deleted_boards', to_jsonb(deleted), 'handed_on', handed, 'paths', to_jsonb(paths));
end $$;

-- ─── 6. Realtime (RLS applies) ───────────────────────────────────────────────
-- mutual_pings is deliberately NOT published: private until matched.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.same_brain_events; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.ping_matches; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_loops; exception when duplicate_object then null; end;
  end if;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
do $$ begin
  revoke execute on function public._group_after_leave(uuid) from public, anon, authenticated;
  revoke execute on function public.prepare_account_deletion(uuid, boolean) from public, anon, authenticated;
  revoke execute on function public.pings_compatible(text, text, text, text) from public, anon;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.prepare_account_deletion(uuid, boolean) to service_role;
  end if;
end $$;
revoke execute on function public.create_group(text, uuid[], uuid), public.update_group(uuid, text, uuid, boolean), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.set_group_role(uuid, uuid, text), public.leave_group(uuid), public.delete_group(uuid),
  public.my_conversations(), public.react(uuid, text, boolean), public.send_ping(uuid, text, text),
  public.conversation_role(uuid), public.conversation_kind(uuid), public.can_participate(uuid), public.respond_to_request(uuid, boolean) from public, anon;
grant execute on function public.create_group(text, uuid[], uuid), public.update_group(uuid, text, uuid, boolean), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.set_group_role(uuid, uuid, text), public.leave_group(uuid), public.delete_group(uuid),
  public.my_conversations(), public.react(uuid, text, boolean), public.send_ping(uuid, text, text),
  public.conversation_role(uuid), public.conversation_kind(uuid), public.can_participate(uuid), public.respond_to_request(uuid, boolean), public.pings_compatible(text, text, text, text) to authenticated;
