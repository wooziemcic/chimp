-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 9 · Social intelligence + engagement loop
--
-- Run AFTER 0011 (it checks). Additive and idempotent: safe to run twice.
-- Never re-run 0001–0011 after it. Nothing is renamed or dropped except
-- functions/constraints that are recreated here with a superset of their
-- old behaviour. RLS stays on everywhere; no `with check (true)`.
--
--   1. board_pins            pin / unpin a World (user_id, board_id, pinned_at).
--                            Pinning never grants access: you can only pin a
--                            World you can see, and other people's pins are
--                            readable only for Worlds THEY may see AND you may
--                            see (private Worlds never leak through a pin).
--   2. Story replies         messages.story_item_id / story_kind; send_story_reply()
--      and reactions → DMs   puts a reply or a reaction into the normal 1:1 DM
--                            (Messages, push, Realtime, receipts). The story
--                            must be live and visible to the sender; blocks,
--                            declined requests and message permissions apply.
--                            The DM stays after the story expires.
--   3. Background Delivered  mark_delivered_upto(cid, message_id): the recipient
--                            phone acknowledges a message it received (also from
--                            a background push). Message pushes now carry the
--                            newest message id (a coalesced burst too).
--   4. Activity              likes, replies, replies in a thread you're in,
--      notifications         new posts in Worlds you follow (and your own),
--                            people joining your Worlds → user_events (in-app,
--                            Realtime) + push_outbox (category 'activity', its
--                            own setting). Never to yourself, never across a
--                            block, never for a World the recipient can't see;
--                            throttled per post / World so bursts don't spam;
--                            removed again when the post (or World) is deleted.
--   5. suggest_people()      "People you may want to know": mutual connections
--                            and shared Worlds (counts only, privacy-filtered).
--   6. set_video_poster()    lazy poster backfill: the OWNER's phone can attach
--                            a poster to one of their own older Buzz videos that
--                            has none (the iOS poster bug). Only next to the
--                            clip (<name>-poster.jpg), only once, only a file
--                            they uploaded. Same bucket and URL scheme as the
--                            clip itself, so it is exactly as visible as the clip.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'mark_delivered' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 0011_phase8_device_messaging.sql first.';
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('board_pins_max', '20'),
  ('world_push_every_hours', '3')
on conflict (key) do nothing;

-- ─── 0. Helper: could THIS user see that World? (can_see_board for someone else) ─
create or replace function public._can_see_board_as(p_user uuid, bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (bid is null or exists (
    select 1 from public.boards b
     where b.id = bid and (
       b.visibility = 'public' or b.owner_id = p_user
       or exists (select 1 from public.board_memberships m where m.board_id = b.id and m.user_id = p_user)
       or (b.visibility = 'connections' and public.are_connected(p_user, b.owner_id)))));
$$;

-- ─── 1. Pinned Worlds ────────────────────────────────────────────────────────

create table if not exists public.board_pins (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  board_id  text not null references public.boards (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
create index if not exists board_pins_user_idx on public.board_pins (user_id, pinned_at desc);
alter table public.board_pins enable row level security;
-- Pins are private: you only ever read your own. (Nothing in the app shows
-- other people's pins, and a shared check would let anyone probe who blocked
-- them or who is connected to whom.)
drop policy if exists "pins read" on public.board_pins;
create policy "pins read" on public.board_pins for select to authenticated using (user_id = auth.uid());
drop function if exists public.pin_visible(uuid, text);
-- Writes only through set_board_pin() (can't pin what you can't see; capped).

create or replace function public.set_board_pin(p_board_id text, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not p_on then
    delete from public.board_pins where user_id = me and board_id = p_board_id;
    return false;
  end if;
  if not public.can_see_board(p_board_id) or not exists (select 1 from public.boards where id = p_board_id) then
    raise exception 'That World isn''t available.' using errcode = '42501';
  end if;
  if exists (select 1 from public.board_pins where user_id = me and board_id = p_board_id) then return true; end if;
  if (select count(*) from public.board_pins where user_id = me) >= public._setting_int('board_pins_max', 20) then
    raise exception 'You can pin up to % Worlds. Unpin one first.', public._setting_int('board_pins_max', 20) using errcode = '54000';
  end if;
  insert into public.board_pins (user_id, board_id) values (me, p_board_id) on conflict do nothing;
  return true;
end $$;

-- ─── 2. Story replies and reactions → the normal DM ─────────────────────────

alter table public.messages add column if not exists story_item_id uuid;          -- no FK: the DM outlives the story
alter table public.messages add column if not exists story_kind text;
do $$ begin
  alter table public.messages add constraint messages_story_kind_check check (story_kind is null or story_kind in ('reply', 'reaction'));
exception when duplicate_object then null; end $$;
-- The story link is set ONLY by send_story_reply() (which checks the story is
-- live, visible and unblocked) and never changes afterwards. A direct insert /
-- update from the app (role authenticated / anon) can't set or alter it.
create or replace function public.messages_story_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if (new.story_item_id is not null or new.story_kind is not null) and current_user in ('authenticated', 'anon') then
      raise exception 'Story replies are sent with send_story_reply().' using errcode = '42501';
    end if;
  elsif new.story_item_id is distinct from old.story_item_id or new.story_kind is distinct from old.story_kind then
    raise exception 'A message''s story link can''t change.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists messages_story_guard on public.messages;
create trigger messages_story_guard before insert or update on public.messages for each row execute function public.messages_story_guard();

create or replace function public.send_story_reply(p_story_item_id uuid, p_kind text, p_body text, p_client_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.story_items;
  cid uuid;
  mid uuid;
  txt text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('reply', 'reaction') then raise exception 'Unknown story action.' using errcode = '22023'; end if;
  select * into s from public.story_items where id = p_story_item_id and expires_at > now();
  -- Expired, deleted, not visible to you, or across a block: the same answer (nothing is revealed).
  if not found or not public.can_see_board(s.board_id) or public.is_blocked_between(me, s.author_id) then
    raise exception 'story_unavailable' using errcode = 'P0002';
  end if;
  if s.author_id = me then raise exception 'That''s your own Story.' using errcode = '22023'; end if;
  if p_kind = 'reaction' then
    if p_body is null or p_body not in ('❤️', '😂', '🔥', '😮', '😢', '👏') then raise exception 'Unknown reaction.' using errcode = '22023'; end if;
    txt := p_body;
  else
    txt := btrim(coalesce(p_body, ''));
    if char_length(txt) = 0 or char_length(txt) > 1000 then raise exception 'Write a reply first.' using errcode = '22023'; end if;
  end if;
  if p_client_id is not null and p_client_id !~ '^[A-Za-z0-9_.:-]{6,80}$' then raise exception 'Bad client id.' using errcode = '22023'; end if;

  -- The same rules as any DM: start_direct_conversation refuses people you
  -- can't message (blocked, requests off and nothing in common).
  cid := public.start_direct_conversation(s.author_id);
  -- Same as the "messages send" policy: a person who declined can't write.
  if exists (select 1 from public.conversation_members m where m.conversation_id = cid and m.user_id = me and m.status = 'declined') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.messages (conversation_id, sender_id, body, message_type, client_id, story_item_id, story_kind)
  values (cid, me, txt, 'text', p_client_id, s.id, p_kind)
  on conflict (conversation_id, sender_id, client_id) where client_id is not null do nothing
  returning id into mid;
  if mid is null then  -- a retry of the same send: the first one stands
    select id into mid from public.messages where conversation_id = cid and sender_id = me and client_id = p_client_id;
  end if;
  return jsonb_build_object('message_id', mid, 'conversation_id', cid, 'user_id', s.author_id);
end $$;

-- ─── 3. Push plumbing (0009) with two fixes ─────────────────────────────────
-- (a) a coalesced burst keeps the NEWEST message's data (its id), so a phone
--     acknowledging "Delivered" from the push covers the whole burst;
-- (b) category 'activity' (its own setting).

-- Activity pushes start OFF (null) until a Phase 9 app turns them on for the
-- account (it does so once, on push registration): older TestFlight builds
-- have no switch for them and can't open them. In-app events are unaffected.
alter table public.notification_prefs add column if not exists activity boolean;
alter table public.notification_prefs alter column activity drop not null, alter column activity drop default;  -- (a project that ran an early draft)

create or replace function public._push_allowed(p_user uuid, p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_category = 'activity'
              then coalesce((select activity from public.notification_prefs where user_id = p_user), false)
              else coalesce((select case p_category when 'messages' then messages when 'connections' then connections
                                                    when 'after_dark' then after_dark end
                               from public.notification_prefs where user_id = p_user), true) end;
$$;

drop function if exists public.set_notification_prefs(boolean, boolean, boolean);
create or replace function public.set_notification_prefs(p_messages boolean default null, p_connections boolean default null,
                                                         p_after_dark boolean default null, p_activity boolean default null)
returns public.notification_prefs
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.notification_prefs;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.notification_prefs (user_id) values (me) on conflict (user_id) do nothing;
  update public.notification_prefs
     set messages = coalesce(p_messages, messages), connections = coalesce(p_connections, connections),
         after_dark = coalesce(p_after_dark, after_dark), activity = coalesce(p_activity, activity), updated_at = now()
   where user_id = me returning * into r;
  return r;
end $$;

-- New kinds / category on the outbox and the event feed.
do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.push_outbox'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%MESSAGE_RECEIVED%' or pg_get_constraintdef(oid) like '%after_dark%') loop
    execute format('alter table public.push_outbox drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint
            where conrelid = 'public.user_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.user_events drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'MESSAGE_RECEIVED', 'AFTER_DARK_MESSAGE', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED', 'FOLLOW_RECEIVED',
  'MUTUAL_CRUSH', 'VIBE_REQUEST', 'VIBE_ACCEPTED', 'CHALLENGE_YOUR_TURN', 'PLAN_WAITING_FOR_YOU',
  'CONTENT_LIKED', 'CONTENT_COMMENTED', 'THREAD_REPLY', 'WORLD_ACTIVITY', 'WORLD_JOIN'));
alter table public.push_outbox add constraint push_outbox_category_check check (category in ('messages', 'connections', 'after_dark', 'activity'));
alter table public.user_events add constraint user_events_kind_check check (kind in (
  'connection_request', 'connection_accepted', 'connection_updated',
  'mutual_crush', 'relationship_updated',
  'vibe_request', 'vibe_accepted', 'vibe_updated',
  'challenge_your_turn', 'challenge_completed',
  'plan_waiting', 'plan_updated',
  'message_received',
  'follow',
  'content_like', 'content_comment', 'thread_reply', 'world_post', 'world_join'));

-- What an activity event is about (deep links): the post (ref_id + ref_kind) and/or its World.
alter table public.user_events add column if not exists ref_kind text;
alter table public.user_events add column if not exists board_id text;
do $$ begin
  alter table public.user_events add constraint user_events_ref_kind_check check (ref_kind is null or ref_kind in ('buzz', 'drift'));
exception when duplicate_object then null; end $$;
create index if not exists user_events_ref_idx on public.user_events (ref_id) where ref_id is not null;
create index if not exists user_events_board_idx on public.user_events (board_id) where board_id is not null;

-- 0009's _push_enqueue, with (a): the coalesced row takes the newest data.
create or replace function public._push_enqueue(p_user uuid, p_actor uuid, p_kind text, p_category text, p_dedupe text, p_collapse text,
                                                p_source uuid, p_title text, p_body text, p_data jsonb, p_plural_body text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare pending public.push_outbox;
begin
  if p_user is null or p_user = p_actor then return; end if;
  begin
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  if not public._push_allowed(p_user, p_category) then return; end if;
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return; end if;
  if p_collapse is not null and p_plural_body is not null then
    select * into pending from public.push_outbox
     where user_id = p_user and collapse_key = p_collapse and status = 'pending'
       and created_at > now() - make_interval(secs => public._setting_int('push_coalesce_seconds', 30))
     order by created_at desc limit 1 for update skip locked;
    if found then
      update public.push_outbox
         set coalesced = coalesced + 1, body = left(replace(p_plural_body, '{n}', (pending.coalesced + 1)::text), 160),
             data = pending.data || coalesce(p_data, '{}'::jsonb),
             source_id = coalesce(p_source, source_id)
       where id = pending.id;
      return;
    end if;
  end if;
  insert into public.push_outbox (user_id, actor_id, kind, category, dedupe_key, collapse_key, source_id, title, body, data, next_attempt_at)
  values (p_user, p_actor, p_kind, p_category, p_dedupe, p_collapse, p_source, left(p_title, 80), left(p_body, 160), coalesce(p_data, '{}'::jsonb),
          case when p_collapse is not null then now() + make_interval(secs => public._setting_int('push_message_delay_seconds', 2)) else now() end)
  on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'push enqueue skipped (%): %', p_kind, sqlstate;
  end;
end $$;

-- Messages → push (0009) + the message id (background Delivered) + Story wording.
create or replace function public.messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations; m record; who text; grp text; line text;
begin
  if new.deleted_at is not null then return new; end if;
  begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then return new; end if;
  who := public._first_name(new.sender_id);
  line := case new.story_kind
            when 'reaction' then who || ' reacted ' || left(coalesce(new.body, '❤️'), 8) || ' to your story'
            when 'reply' then who || ' replied to your story'
            else null end;
  for m in select cm.user_id, cm.status from public.conversation_members cm
            where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id and cm.status in ('active', 'request') loop
    if c.kind = 'vibe' then
      perform public._push_enqueue(m.user_id, new.sender_id, 'AFTER_DARK_MESSAGE', 'after_dark', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', 'New After Dark message',
        jsonb_build_object('type', 'vibe_message', 'conversation_id', c.id, 'vibe_id', (select v.id from public.vibes v where v.conversation_id = c.id)),
        'New After Dark messages');
    elsif c.kind = 'group' then
      grp := left(btrim(regexp_replace(coalesce(c.title, 'your group'), '[[:cntrl:]]', ' ', 'g')), 40);
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, grp, who || ' sent a message',
        jsonb_build_object('type', 'group_message', 'conversation_id', c.id, 'message_id', new.id), '{n} new messages');
    elsif m.status = 'request' then
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', coalesce(line, who || ' sent you a message request'),
        jsonb_build_object('type', 'message', 'conversation_id', c.id, 'user_id', new.sender_id, 'message_id', new.id), who || ' sent you a message request');
    else
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', coalesce(line, who || ' sent you a message'),
        jsonb_build_object('type', 'message', 'conversation_id', c.id, 'user_id', new.sender_id, 'message_id', new.id), who || ' sent you {n} messages');
    end if;
  end loop;
  exception when others then
    raise warning 'messages_push skipped: %', sqlstate;
  end;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public.messages_push();

-- ─── 3b. Delivered from the recipient's phone, up to one message ────────────
-- Same rules as mark_delivered (0011): an ACTIVE member, never a Vibe, never
-- across a block; the cursor only moves forward, to that message's server
-- time. The message must be someone else's, in that conversation.
create or replace function public.mark_delivered_upto(p_cid uuid, p_message_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); upto timestamptz; n int;
begin
  if me is null or p_cid is null or p_message_id is null then return false; end if;
  select x.created_at into upto from public.messages x
   where x.id = p_message_id and x.conversation_id = p_cid and x.sender_id <> me;
  if upto is null then return false; end if;
  if exists (select 1 from public.conversations c where c.id = p_cid and c.kind = 'vibe') then return false; end if;
  if public.conversation_blocked(p_cid) then return false; end if;
  update public.conversation_members m
     set last_delivered_at = upto
   where m.conversation_id = p_cid and m.user_id = me and m.status = 'active'
     and (m.last_delivered_at is null or m.last_delivered_at < upto);
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ─── 4. Activity events + pushes ────────────────────────────────────────────

-- Internal: one activity event (never to yourself, never across a block, never
-- for a World the recipient can't see; per-actor hourly cap as in 0008).
create or replace function public._emit_activity(p_user uuid, p_kind text, p_actor uuid, p_ref uuid, p_ref_kind text, p_board text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  if p_board is not null and not public._can_see_board_as(p_user, p_board) then return; end if;
  -- Its own hourly budget per sender (likes / World posts never use up the
  -- budget for connection requests, Vibes or challenges — see _emit below).
  if p_actor is not null and (select count(*) from public.user_events e
                               where e.user_id = p_user and e.actor_id = p_actor and e.created_at > now() - interval '1 hour'
                                 and e.kind in ('content_like', 'content_comment', 'thread_reply', 'world_post', 'world_join'))
                              >= public._setting_int('user_events_per_actor_hour', 30) then
    return;
  end if;
  insert into public.user_events (user_id, kind, actor_id, ref_id, ref_kind, board_id) values (p_user, p_kind, p_actor, p_ref, p_ref_kind, p_board);
end $$;

-- 0008's _emit, unchanged except that activity events don't count against its
-- per-sender budget (a burst of likes must not silence a connection request).
create or replace function public._emit(p_user uuid, p_kind text, p_actor uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  if p_actor is not null and not exists (select 1 from public.profiles where id = p_actor) then p_actor := null; end if;
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  if p_actor is not null and (select count(*) from public.user_events e
                               where e.user_id = p_user and e.actor_id = p_actor and e.created_at > now() - interval '1 hour'
                                 and e.kind not in ('content_like', 'content_comment', 'thread_reply', 'world_post', 'world_join'))
                              >= public._setting_int('user_events_per_actor_hour', 30) then
    return;
  end if;
  insert into public.user_events (user_id, kind, actor_id, ref_id) values (p_user, p_kind, p_actor, p_ref);
end $$;

-- The post an id points at: author and World (null if gone).
create or replace function public._post_of(p_kind text, p_id text, out author uuid, out board text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
  if p_kind = 'buzz' then
    select x.author_id, x.board_id into author, board from public.buzz_items x where x.id = p_id::uuid;
  elsif p_kind = 'drift' then
    select x.author_id, x.board_id into author, board from public.drift_items x where x.id = p_id::uuid;
  end if;
end $$;

-- Likes → the post's author. One event per person per post per day (like /
-- unlike / like again doesn't notify twice).
create or replace function public.reactions_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  begin
    if new.kind <> 'like' or new.target_kind not in ('buzz', 'drift') then return new; end if;
    select * into p from public._post_of(new.target_kind, new.target_id);
    if p.author is null or p.author = new.user_id then return new; end if;
    if exists (select 1 from public.user_events e
                where e.user_id = p.author and e.actor_id = new.user_id and e.kind = 'content_like'
                  and e.ref_id = new.target_id::uuid and e.created_at > now() - interval '24 hours') then
      return new;
    end if;
    perform public._emit_activity(p.author, 'content_like', new.user_id, new.target_id::uuid, new.target_kind, p.board);
  exception when others then
    raise warning 'reactions_events skipped: %', sqlstate;   -- the like itself always stands
  end;
  return new;
end $$;
drop trigger if exists reactions_events on public.reactions;
create trigger reactions_events after insert on public.reactions for each row execute function public.reactions_events();

-- Replies → the post's author ('content_comment') and, at most once an hour
-- per thread, the others who already replied there ('thread_reply').
create or replace function public.comments_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; r record;
begin
  begin
    if new.target_kind not in ('buzz', 'drift') then return new; end if;
    select * into p from public._post_of(new.target_kind, new.target_id);
    if p.author is null then return new; end if;
    if p.author <> new.author_id then
      perform public._emit_activity(p.author, 'content_comment', new.author_id, new.target_id::uuid, new.target_kind, p.board);
    end if;
    for r in select distinct c.author_id from public.comments c
              where c.target_kind = new.target_kind and c.target_id = new.target_id and c.id <> new.id
                and c.author_id <> new.author_id and c.author_id <> p.author
                and c.created_at > now() - interval '30 days'
              limit 25 loop
      if not exists (select 1 from public.user_events e where e.user_id = r.author_id and e.kind = 'thread_reply'
                       and e.ref_id = new.target_id::uuid and e.created_at > now() - interval '1 hour') then
        perform public._emit_activity(r.author_id, 'thread_reply', new.author_id, new.target_id::uuid, new.target_kind, p.board);
      end if;
    end loop;
  exception when others then
    raise warning 'comments_events skipped: %', sqlstate;
  end;
  return new;
end $$;
drop trigger if exists comments_events on public.comments;
create trigger comments_events after insert on public.comments for each row execute function public.comments_events();

-- New post in a World → its followers and its owner (never the author; only
-- people who can see that World; at most 500 recipients per post).
create or replace function public.world_post_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; k text := tg_argv[0];
begin
  begin
    if new.board_id is null then return new; end if;
    for r in select q.user_id from (
               select f.user_id from public.board_follows f where f.board_id = new.board_id
               union
               select b.owner_id from public.boards b where b.id = new.board_id and b.owner_id is not null) q
             limit 500 loop
      if r.user_id <> new.author_id then
        begin
          perform public._emit_activity(r.user_id, 'world_post', new.author_id, new.id, k, new.board_id);
        exception when others then
          raise warning 'world_post_events: one recipient skipped: %', sqlstate;
        end;
      end if;
    end loop;
  exception when others then
    raise warning 'world_post_events skipped: %', sqlstate;   -- the post itself always stands
  end;
  return new;
end $$;
drop trigger if exists buzz_world_events on public.buzz_items;
create trigger buzz_world_events after insert on public.buzz_items for each row execute function public.world_post_events('buzz');
drop trigger if exists drift_world_events on public.drift_items;
create trigger drift_world_events after insert on public.drift_items for each row execute function public.world_post_events('drift');

-- Someone joined your World → you (the owner).
create or replace function public.world_join_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  begin
    if new.role = 'owner' then return new; end if;
    select owner_id into o from public.boards where id = new.board_id;
    if o is null or o = new.user_id then return new; end if;
    perform public._emit_activity(o, 'world_join', new.user_id, null, null, new.board_id);
  exception when others then
    raise warning 'world_join_events skipped: %', sqlstate;
  end;
  return new;
end $$;
drop trigger if exists board_join_events on public.board_memberships;
create trigger board_join_events after insert on public.board_memberships for each row execute function public.world_join_events();

-- A deleted post / World takes its notifications with it (no broken deep links);
-- anything still waiting to be pushed is skipped.
create or replace function public.content_gone_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'boards' then
      update public.push_outbox o set status = 'skipped', error = 'content deleted'
       where o.status = 'pending' and o.source_id in (select e.id from public.user_events e where e.board_id = old.id);
      delete from public.user_events where board_id = old.id;
    else
      update public.push_outbox o set status = 'skipped', error = 'content deleted'
       where o.status = 'pending' and o.source_id in (select e.id from public.user_events e where e.ref_id = old.id);
      delete from public.user_events where ref_id = old.id;
    end if;
  exception when others then
    raise warning 'content_gone_events skipped: %', sqlstate;
  end;
  return old;
end $$;
drop trigger if exists buzz_gone_events on public.buzz_items;
create trigger buzz_gone_events after delete on public.buzz_items for each row execute function public.content_gone_events();
drop trigger if exists drift_gone_events on public.drift_items;
create trigger drift_gone_events after delete on public.drift_items for each row execute function public.content_gone_events();
drop trigger if exists board_gone_events on public.boards;
create trigger board_gone_events after delete on public.boards for each row execute function public.content_gone_events();

-- user_events → push: 0010's function + the activity kinds. Throttled so a
-- popular post or a busy World becomes one notification, not a stream.
create or replace function public.user_events_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; hr text := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'); dy text := to_char(now(), 'YYYYMMDD');
        pair text := least(new.user_id, coalesce(new.actor_id, new.user_id))::text || greatest(new.user_id, coalesce(new.actor_id, new.user_id))::text;
        wtitle text; slot text; post jsonb;
begin
  begin
  who := case when new.actor_id is not null then public._first_name(new.actor_id) else 'Someone' end;
  if new.board_id is not null then
    wtitle := left(btrim(regexp_replace(coalesce((select b.title from public.boards b where b.id = new.board_id), 'a World'), '[[:cntrl:]]', ' ', 'g')), 40);
  end if;
  post := case when new.ref_id is not null and new.ref_kind is not null
               then jsonb_build_object('type', 'post', 'post_kind', new.ref_kind, 'id', new.ref_id) end;
  case new.kind
    when 'follow' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'FOLLOW_RECEIVED', 'connections', 'follow:' || new.actor_id || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', who || ' followed you', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
    when 'connection_request' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONNECTION_REQUEST', 'connections', 'connreq:' || new.actor_id || ':' || new.user_id || ':' || hr, null, new.id,
        'Chimp', who || ' wants to connect', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
    when 'connection_accepted' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONNECTION_ACCEPTED', 'connections', 'connacc:' || new.actor_id || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', who || ' accepted your connection', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
    when 'mutual_crush' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'MUTUAL_CRUSH', 'after_dark', 'mutual:' || pair || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', 'Something new is waiting for you', jsonb_build_object('type', 'after_dark', 'tab', 'vibes'));
    when 'vibe_request' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'VIBE_REQUEST', 'after_dark', 'vibereq:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id, null, new.id,
        'Chimp', 'Someone sent you a Vibe request', jsonb_build_object('type', 'after_dark', 'tab', 'inbox'));
    when 'vibe_accepted' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'VIBE_ACCEPTED', 'after_dark', 'vibeacc:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id, null, new.id,
        'Chimp', 'Your Vibe request was accepted', jsonb_build_object('type', 'vibe', 'vibe_id', new.ref_id));
    when 'challenge_your_turn' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CHALLENGE_YOUR_TURN', 'after_dark', 'event:' || new.id, null, new.id,
        'Chimp', 'A challenge is waiting for you', jsonb_build_object('type', 'challenge', 'challenge_id', new.ref_id));
    when 'plan_waiting' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'PLAN_WAITING_FOR_YOU', 'after_dark', 'plan:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id || ':' || hr, null, new.id,
        'Chimp', 'A plan is waiting for you', jsonb_build_object('type', 'after_dark', 'tab', 'plans'));
    -- Phase 9: activity. At most one push per post per hour; extra likes /
    -- replies inside the short coalescing window fold into it.
    when 'content_like' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONTENT_LIKED', 'activity', 'like:' || new.ref_id || ':' || new.user_id || ':' || hr,
        'act:like:' || new.ref_id, new.id, 'Chimp', who || ' liked your post', post, '{n} people liked your post');
    when 'content_comment' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONTENT_COMMENTED', 'activity', 'comment:' || new.ref_id || ':' || new.user_id || ':' || hr,
        'act:comment:' || new.ref_id, new.id, 'Chimp', who || ' replied to your post', post, '{n} new replies to your post');
    when 'thread_reply' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'THREAD_REPLY', 'activity', 'thread:' || new.ref_id || ':' || new.user_id || ':' || hr,
        null, new.id, 'Chimp', who || ' also replied to a post you replied to', post);
    -- A World: at most one push per World every few hours ("NYC Rooftops has new posts").
    when 'world_post' then
      slot := floor(extract(epoch from now()) / (3600 * greatest(1, public._setting_int('world_push_every_hours', 3))))::bigint::text;
      perform public._push_enqueue(new.user_id, new.actor_id, 'WORLD_ACTIVITY', 'activity', 'world:' || new.board_id || ':' || new.user_id || ':' || slot,
        'act:world:' || new.board_id, new.id, coalesce(wtitle, 'Chimp'), who || ' posted in ' || coalesce(wtitle, 'a World'),
        jsonb_build_object('type', 'world', 'board_id', new.board_id), '{n} new posts in ' || coalesce(wtitle, 'a World'));
    when 'world_join' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'WORLD_JOIN', 'activity', 'join:' || new.board_id || ':' || new.user_id || ':' || hr,
        'act:join:' || new.board_id, new.id, coalesce(wtitle, 'Chimp'), who || ' joined ' || coalesce(wtitle, 'your World'),
        jsonb_build_object('type', 'world', 'board_id', new.board_id), '{n} people joined ' || coalesce(wtitle, 'your World'));
    else
      null;
  end case;
  exception when others then
    raise warning 'user_events_push skipped: %', sqlstate;
  end;
  return new;
end $$;
drop trigger if exists user_events_push on public.user_events;
create trigger user_events_push after insert on public.user_events for each row execute function public.user_events_push();

-- ─── 5. People you may want to know ─────────────────────────────────────────
-- Counts only (never who the mutual connections are; mutual counts only from 2). Candidates: not you,
-- not blocked either way, not already connected or followed by you, onboarded.
create or replace function public.suggest_people(p_limit int default 12)
returns table (user_id uuid, mutual_connections int, shared_worlds int)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id),
  mine as (  -- my connections
    select case when c.user_a = (select id from me) then c.user_b else c.user_a end as uid
      from public.connections c
     where c.status = 'connected' and (select id from me) in (c.user_a, c.user_b)
  ),
  my_worlds as (select m.board_id from public.board_memberships m where m.user_id = (select id from me)),
  cand as (
    select p.id from public.profiles p
     where p.id <> (select id from me) and p.onboarded_at is not null
       and not public.is_blocked_between((select id from me), p.id)
       and not exists (select 1 from mine where mine.uid = p.id)
       and not exists (select 1 from public.follows f where f.follower_id = (select id from me) and f.followee_id = p.id)
  ),
  mutual as (
    select x.uid as cid, count(*)::int as n from (
      select case when c.user_a = k.uid then c.user_b else c.user_a end as uid
        from mine k join public.connections c on c.status = 'connected' and k.uid in (c.user_a, c.user_b)
    ) x join cand on cand.id = x.uid group by x.uid
  ),
  shared as (
    select m.user_id as cid, count(distinct m.board_id)::int as n
      from public.board_memberships m join my_worlds w on w.board_id = m.board_id join cand on cand.id = m.user_id
     group by m.user_id
  )
  -- A single mutual connection is never shown on its own: with one connection
  -- C it would list C's whole (private) connection list. From 2 up it's a count.
  select cand.id, case when coalesce(mu.n, 0) >= 2 then mu.n else 0 end, coalesce(sh.n, 0)
    from cand left join mutual mu on mu.cid = cand.id left join shared sh on sh.cid = cand.id
   where (select id from me) is not null and (coalesce(mu.n, 0) >= 2 or coalesce(sh.n, 0) > 0)
   order by case when coalesce(mu.n, 0) >= 2 then mu.n else 0 end desc, coalesce(sh.n, 0) desc, cand.id
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

-- ─── 6. Video poster backfill ───────────────────────────────────────────────
-- 0001 has no UPDATE policy on media (rows are immutable from the app); this is
-- the one narrow way to fill in a missing poster.
create or replace function public.set_video_poster(p_media_id uuid, p_poster_path text) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.media;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into m from public.media where id = p_media_id;
  if not found or m.owner_id is distinct from auth.uid() then
    raise exception 'Not your video.' using errcode = '42501';
  end if;
  if m.kind <> 'video' or m.bucket <> 'media' or split_part(m.storage_path, '/', 1) <> 'posts' then
    raise exception 'Not a Buzz video.' using errcode = '22023';
  end if;
  if m.poster_path is not null then return false; end if;  -- already has one (idempotent)
  if p_poster_path is null or p_poster_path like '%..%'
     or p_poster_path <> regexp_replace(m.storage_path, '\.[A-Za-z0-9]+$', '') || '-poster.jpg' then
    raise exception 'The poster must sit next to the video.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = p_poster_path and o.owner_id = auth.uid()::text) then
    raise exception 'Upload the poster first.' using errcode = 'P0002';
  end if;
  update public.media set poster_path = p_poster_path where id = p_media_id and poster_path is null;
  return found;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public._can_see_board_as(uuid, text), public._emit_activity(uuid, text, uuid, uuid, text, text),
                           public._post_of(text, text), public.reactions_events(), public.comments_events(),
                           public.world_post_events(), public.world_join_events(), public.content_gone_events(),
                           public.user_events_push(), public.messages_push(), public.messages_story_guard(), public._push_enqueue(uuid, uuid, text, text, text, text, uuid, text, text, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.set_board_pin(text, boolean), public.send_story_reply(uuid, text, text, text),
                           public.mark_delivered_upto(uuid, uuid), public.suggest_people(int),
                           public.set_notification_prefs(boolean, boolean, boolean, boolean), public.set_video_poster(uuid, text)
  from public, anon;
grant execute on function public.set_board_pin(text, boolean), public.send_story_reply(uuid, text, text, text),
                          public.mark_delivered_upto(uuid, uuid), public.suggest_people(int),
                          public.set_notification_prefs(boolean, boolean, boolean, boolean), public.set_video_poster(uuid, text)
  to authenticated;
revoke all on public.board_pins from anon;
grant select on public.board_pins to authenticated;

commit;
