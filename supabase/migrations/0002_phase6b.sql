-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 6B · Niagara alpha: real-time chat, connections, blocks
--
-- Run AFTER 0001_phase6a.sql, in the Supabase SQL Editor. Safe to re-run.
--
--   • Buzz without a World: nothing to migrate (buzz_items.board_id was already
--     nullable and RLS already treats NULL as "no World" = visible).
--   • Chat: conversations / conversation_members / messages, RLS so only
--     members can read or send, sender can't be spoofed, blocked people can't
--     message each other, Message Requests for people who aren't connected.
--   • Connections become mutual for real: when both people tap Connect, the
--     request turns into a connection (request_connection).
--   • Blocks are stored server-side (blocks) so a block also stops messages.
--   • Realtime: messages + conversation_members are added to the
--     supabase_realtime publication (Realtime respects the RLS below).
--   • Storage: chat photos may be uploaded to media/chat/{your id}/…
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Profiles: message requests switch ──────────────────────────────────────

alter table public.profiles add column if not exists allow_message_requests boolean not null default true;

-- ─── Blocks ─────────────────────────────────────────────────────────────────

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
drop policy if exists "blocks own" on public.blocks;
create policy "blocks own" on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- Either person blocked the other? (security definer: sees both directions without exposing rows)
create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ─── Connections: mutual for real ───────────────────────────────────────────

-- on = true:  request, or accept if they already requested you (→ connected)
-- on = false: cancel your request / decline theirs / disconnect
create or replace function public.request_connection(other uuid, on_ boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  cur public.connections;
begin
  if me is null then raise exception 'not signed in'; end if;
  if other is null or other = me then raise exception 'invalid person'; end if;
  if not exists (select 1 from public.profiles where id = other) then raise exception 'unknown person'; end if;
  a := least(me, other);
  b := greatest(me, other);
  select * into cur from public.connections where user_a = a and user_b = b;
  if not on_ then
    delete from public.connections where user_a = a and user_b = b;
    return 'none';
  end if;
  if public.is_blocked_between(me, other) then raise exception 'blocked'; end if;
  if cur is null then
    insert into public.connections (user_a, user_b, requested_by, status) values (a, b, me, 'requested');
    return 'requested';
  end if;
  if cur.status = 'requested' and cur.requested_by <> me then
    update public.connections set status = 'connected' where user_a = a and user_b = b;
    return 'connected';
  end if;
  return cur.status;
end;
$$;

-- ─── Chat ───────────────────────────────────────────────────────────────────

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'direct' check (kind in ('direct')),
  -- "smaller-uuid:larger-uuid" for 1:1 chats: exactly one conversation per pair.
  direct_key      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_id uuid
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  -- active: in your chats · request: someone not yet connected wrote to you · declined · left
  status          text not null default 'active' check (status in ('active', 'request', 'declined', 'left')),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text check (char_length(body) <= 4000),
  media_id        uuid references public.media (id) on delete set null,
  message_type    text not null default 'text' check (message_type in ('text', 'photo')),
  -- Set by the sending device; makes a retried send idempotent (no duplicates).
  client_id       text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  check ((body is not null and char_length(btrim(body)) > 0) or media_id is not null)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);
create unique index if not exists messages_client_idx on public.messages (conversation_id, sender_id, client_id) where client_id is not null;

do $$ begin
  alter table public.conversations add constraint conversations_last_message_fk foreign key (last_message_id) references public.messages (id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Am I (still) in this conversation?
create or replace function public.is_conversation_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = cid and m.user_id = auth.uid() and m.status <> 'left');
$$;

-- Is anyone in this conversation blocked by / blocking me?
create or replace function public.conversation_blocked(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = cid and m.user_id <> auth.uid() and public.is_blocked_between(auth.uid(), m.user_id)
  );
$$;

/*
 * Can `a` message `b`, and how?
 *   'active'  — connected, or follow each other, or a mutual Spark (never reveals a one-way Crush)
 *   'request' — they share a World, or `b` allows message requests → lands in b's Requests
 *   null      — not allowed (self, blocked, or b turned requests off and nothing else applies)
 */
create or replace function public.message_status(a uuid, b uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when a is null or b is null or a = b then null
    when public.is_blocked_between(a, b) then null
    when exists (select 1 from public.connections c where c.user_a = least(a, b) and c.user_b = greatest(a, b) and c.status = 'connected') then 'active'
    when exists (select 1 from public.follows f1 join public.follows f2 on f2.follower_id = b and f2.followee_id = a where f1.follower_id = a and f1.followee_id = b) then 'active'
    when exists (select 1 from public.crushes c1 join public.crushes c2 on c2.from_id = b and c2.to_id = a where c1.from_id = a and c1.to_id = b) then 'active'
    when exists (select 1 from public.board_memberships m1 join public.board_memberships m2 on m2.board_id = m1.board_id and m2.user_id = b where m1.user_id = a) then 'request'
    when (select p.allow_message_requests from public.profiles p where p.id = b) then 'request'
    else null
  end;
$$;

-- For the UI: can I message this person? ('active' / 'request' / null)
create or replace function public.can_message(other uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.message_status(auth.uid(), other);
$$;

-- Open (or create) my 1:1 conversation with `other`. Idempotent.
create or replace function public.start_direct_conversation(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k text;
  cid uuid;
  st text;
begin
  if me is null then raise exception 'not signed in'; end if;
  k := least(me, other)::text || ':' || greatest(me, other)::text;
  select id into cid from public.conversations where direct_key = k;
  if cid is not null then
    -- Existing chat: rejoin if I had left; never auto-accept a request on the other side.
    update public.conversation_members set status = 'active' where conversation_id = cid and user_id = me and status = 'left';
    return cid;
  end if;
  st := public.message_status(me, other);
  if st is null then raise exception 'not_allowed' using hint = 'You can message people you are connected with, follow each other, share a World with, or who accept message requests.'; end if;
  insert into public.conversations (kind, direct_key) values ('direct', k) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, status) values (cid, me, 'active'), (cid, other, st);
  return cid;
end;
$$;

-- Mark a conversation read (for me).
create or replace function public.mark_conversation_read(cid uuid) returns void
language sql security definer set search_path = public as $$
  update public.conversation_members set last_read_at = now() where conversation_id = cid and user_id = auth.uid();
$$;

-- Accept or decline a Message Request addressed to me.
create or replace function public.respond_to_request(cid uuid, accept boolean) returns void
language sql security definer set search_path = public as $$
  update public.conversation_members set status = case when accept then 'active' else 'declined' end
  where conversation_id = cid and user_id = auth.uid() and status in ('request', 'declined');
$$;

-- My conversation list with the other person, last message and unread count.
create or replace function public.my_conversations()
returns table (
  conversation_id uuid,
  other_id uuid,
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
    o.user_id,
    me.status,
    o.status,
    lm.id,
    lm.body,
    lm.message_type,
    lm.sender_id,
    lm.created_at,
    c.updated_at,
    (select count(*)::int from public.messages x
      where x.conversation_id = c.id and x.sender_id <> auth.uid() and x.deleted_at is null and x.created_at > me.last_read_at)
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid() and me.status <> 'left'
  join public.conversation_members o on o.conversation_id = c.id and o.user_id <> auth.uid()
  left join public.messages lm on lm.id = c.last_message_id
  where not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.user_id)
  order by c.updated_at desc;
$$;

-- After a message: bump the conversation, and replying to a request accepts it.
create or replace function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set updated_at = new.created_at, last_message_id = new.id where id = new.conversation_id;
  update public.conversation_members set status = 'active', last_read_at = new.created_at
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages for each row execute function public.on_message_insert();

-- RLS: only members read; only members send, as themselves, and never across a block.
drop policy if exists "conversations read" on public.conversations;
create policy "conversations read" on public.conversations for select to authenticated using (public.is_conversation_member(id));

drop policy if exists "members read" on public.conversation_members;
create policy "members read" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and not public.conversation_blocked(conversation_id)
  -- A declined request can't be continued by the person who declined without accepting first.
  and not exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid() and m.status = 'declined')
);

drop policy if exists "messages unsend" on public.messages;
create policy "messages unsend" on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- ─── Storage: chat photos in media/chat/{your id}/… ────────────────────────

drop policy if exists "media objects insert" on storage.objects;
create policy "media objects insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    ((storage.foldername(name))[1] in ('avatars', 'posts', 'drift', 'stories', 'chat') and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'boards' and exists (
      select 1 from public.boards b where b.id = (storage.foldername(name))[2] and b.owner_id = auth.uid()))
  )
);

-- ─── Realtime ───────────────────────────────────────────────────────────────

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.conversation_members; exception when duplicate_object then null; end;
  end if;
end $$;

-- ─── Grants (Supabase grants table access to authenticated by default; explicit for clarity) ─

grant execute on function public.request_connection(uuid, boolean) to authenticated;
grant execute on function public.can_message(uuid) to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.my_conversations() to authenticated;
revoke execute on function public.message_status(uuid, uuid) from public, anon, authenticated;
